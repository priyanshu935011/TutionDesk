import bcrypt from "bcryptjs";
import { Readable } from "stream";
import Batch from "../models/Batch.js";
import Institute from "../models/Institute.js";
import Note from "../models/Note.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import TestResult from "../models/TestResult.js";
import cloudinary from "../utils/cloudinary.js";
import {
  buildNoteDownloadFilename,
  streamRemoteFileAsAttachment,
} from "../utils/noteDownload.js";
import { supabase, supabaseBucket } from "../utils/supabase.js";

import {
  forceStopLiveQuiz,
  getActiveSessionForTeacher,
  startLiveQuiz,
} from "../services/quizRuntime.js";
import { getCache, setCache, deleteCache, clearCachePattern } from "../utils/cache.js";

const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "tutiondesk/notes",
        ...options,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(result);
      },
    );

    Readable.from(buffer).pipe(uploadStream);
  });

export const getTeacherDashboard = async (req, res) => {
  try {
    const cacheKey = `teacher:dashboard:${req.user._id}`;
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const instituteId = req.user.institute?._id || req.user.institute;
    const institute = await Institute.findById(instituteId).select(
      "name status subscriptionPlan subscriptionEnd adminUser tuitionType quizFeatureEnabled brandingEnabled themeColor logoUrl"
    );
    const ownerId = req.user.role === "teacher" ? institute?.adminUser : req.user._id;

    let studentQuery = { user: ownerId };
    let batchQuery = { user: ownerId };
    let quizQuery = { institute: instituteId };
    let noteQuery = { institute: instituteId };
    let testQuery = { institute: instituteId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => b._id);
      
      batchQuery.teacher = req.user._id;
      studentQuery.batch = { $in: batchIds };
      
      const myStudents = await Student.find({ user: ownerId, batch: { $in: batchIds } }).select("_id");
      const studentIds = myStudents.map((s) => s._id);
      testQuery.student = { $in: studentIds };

      noteQuery.$or = [
        { targetType: "batch", batch: { $in: batchIds } },
        { targetType: "batch", batch: null },
        { targetType: "student", students: { $in: studentIds } },
        { targetType: { $exists: false }, $or: [{ batch: { $in: batchIds } }, { batch: null }] }
      ];
      quizQuery.batches = { $in: batchIds };
    }

    const [students, batches, quizzes, notes, testResults] = await Promise.all([
      Student.find(studentQuery).populate(
        "batch",
        "name scheduleDays startTime endTime",
      ),
      Batch.find(batchQuery).sort({ createdAt: -1 }).populate("teacher", "name email"),
      Quiz.find(quizQuery).sort({ createdAt: -1 }),
      Note.find(noteQuery)
        .sort({ createdAt: -1 })
        .populate("batch", "name")
        .populate("students", "name enrollmentNumber"),
      TestResult.find(testQuery)
        .sort({ createdAt: -1 })
        .populate("student", "name enrollmentNumber email"),
    ]);

    let totalCollectedFees = 0;
    let totalPendingFees = 0;
    if (req.user.role === "institute_admin") {
      for (const student of students) {
        totalCollectedFees += Number(student.paidAmount || 0);
        const pending = Number(student.pendingAmount ?? (Number(student.totalFees || 0) - Number(student.paidAmount || 0)));
        totalPendingFees += pending > 0 ? pending : 0;
      }
    }

    const summary = {
      totalStudents: students.length,
      totalBatches: batches.length,
      totalQuizzes: quizzes.length,
      totalNotes: notes.length,
      totalTestResults: testResults.length,
      liveQuiz: getActiveSessionForTeacher(instituteId),
      totalCollectedFees: req.user.role === "institute_admin" ? totalCollectedFees : undefined,
      totalPendingFees: req.user.role === "institute_admin" ? totalPendingFees : undefined,
    };


    let processedStudents = students;
    if (req.user.role === "teacher") {
      processedStudents = students.map((s) => {
        const obj = s.toJSON();
        delete obj.totalFees;
        delete obj.feePlanType;
        delete obj.paymentHistory;
        delete obj.paidAmount;
        delete obj.pendingAmount;
        delete obj.dueDate;
        return obj;
      });
    }

    const responsePayload = {
      summary,
      students: processedStudents,
      batches,
      quizzes,
      notes,
      testResults,
      institute,
    };

    await setCache(cacheKey, responsePayload, 1800);

    return res.json(responsePayload);
  } catch (error) {
    console.error("getTeacherDashboard error stack:", error);
    return res
      .status(500)
      .json({ message: "Could not load teacher dashboard" });
  }
};



export const getQuizzes = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const quizzes = await Quiz.find({ institute: instituteId })
      .sort({ createdAt: -1 })
      .populate("batches", "name scheduleDays startTime endTime");
    return res.json(quizzes);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch quizzes" });
  }
};

export const createQuiz = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const {
      title,
      durationSeconds,
      restSeconds,
      negativeMarkingEnabled,
      negativeMarkPerWrong,
      pointsPerCorrect,
      questions,
      batchIds = [],
    } = req.body;

    if (
      !title ||
      !durationSeconds ||
      !Array.isArray(questions) ||
      !questions.length
    ) {
      return res
        .status(400)
        .json({ message: "Quiz title, duration, and questions are required" });
    }

    const selectedBatchIds = Array.isArray(batchIds)
      ? batchIds.filter(Boolean)
      : String(batchIds || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;

    if (selectedBatchIds.length) {
      const existingBatches = await Batch.find({
        _id: { $in: selectedBatchIds },
        user: ownerId,
      }).select("_id");

      if (existingBatches.length !== selectedBatchIds.length) {
        return res
          .status(400)
          .json({ message: "One or more selected batches are invalid" });
      }
    }

    const quiz = await Quiz.create({
      institute: instituteId,
      createdBy: req.user._id,
      batches: selectedBatchIds,
      title,
      durationSeconds: Number(durationSeconds),
      restSeconds: Number(restSeconds || 10),
      negativeMarkingEnabled: Boolean(negativeMarkingEnabled),
      negativeMarkPerWrong: Number(negativeMarkPerWrong || 0),
      pointsPerCorrect: Number(pointsPerCorrect || 10),
      questions: questions.map((question) => ({
        text: question.text,
        options: (question.options || []).map((option) => ({
          text: option.text || option,
        })),
        correctOptionIndex: Number(question.correctOptionIndex),
      })),
    });

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.status(201).json(quiz);
  } catch (error) {
    return res.status(500).json({ message: "Could not create quiz" });
  }
};

export const updateQuiz = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      institute: instituteId,
    });

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    if (quiz.status === "completed") {
      return res.status(400).json({ message: "Conducted/completed quizzes cannot be edited" });
    }

    const {
      title,
      durationSeconds,
      restSeconds,
      negativeMarkingEnabled,
      negativeMarkPerWrong,
      pointsPerCorrect,
      questions,
      batchIds = [],
    } = req.body;

    const selectedBatchIds = Array.isArray(batchIds)
      ? batchIds.filter(Boolean)
      : String(batchIds || "")
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean);

    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;

    if (selectedBatchIds.length) {
      const existingBatches = await Batch.find({
        _id: { $in: selectedBatchIds },
        user: ownerId,
      }).select("_id");

      if (existingBatches.length !== selectedBatchIds.length) {
        return res
          .status(400)
          .json({ message: "One or more selected batches are invalid" });
      }
    }

    if (title !== undefined) quiz.title = title;
    if (durationSeconds !== undefined)
      quiz.durationSeconds = Number(durationSeconds);
    if (restSeconds !== undefined) quiz.restSeconds = Number(restSeconds);
    if (negativeMarkingEnabled !== undefined)
      quiz.negativeMarkingEnabled = Boolean(negativeMarkingEnabled);
    if (negativeMarkPerWrong !== undefined)
      quiz.negativeMarkPerWrong = Number(negativeMarkPerWrong);
    if (pointsPerCorrect !== undefined)
      quiz.pointsPerCorrect = Number(pointsPerCorrect);
    if (batchIds !== undefined) quiz.batches = selectedBatchIds;
    if (Array.isArray(questions) && questions.length) {
      quiz.questions = questions.map((question) => ({
        text: question.text,
        options: (question.options || []).map((option) => ({
          text: option.text || option,
        })),
        correctOptionIndex: Number(question.correctOptionIndex),
      }));
    }

    await quiz.save();

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json(quiz);
  } catch (error) {
    return res.status(500).json({ message: "Could not update quiz" });
  }
};

export const deleteQuiz = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      institute: instituteId,
    });

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    if (quiz.status === "completed") {
      return res.status(400).json({ message: "Conducted/completed quizzes cannot be deleted" });
    }

    await Quiz.deleteOne({ _id: req.params.id });

    await forceStopLiveQuiz(req.params.id);

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Quiz deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete quiz" });
  }
};

export const startQuizLive = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const quiz = await Quiz.findOne({
      _id: req.params.id,
      institute: instituteId,
    });

    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }

    const liveState = await startLiveQuiz(quiz);
    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");
    return res.json(liveState);
  } catch (error) {
    return res.status(500).json({ message: "Could not start live quiz" });
  }
};

export const getNotes = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const notes = await Note.find({ institute: instituteId })
      .sort({ createdAt: -1 })
      .populate("batch", "name")
      .populate("students", "name enrollmentNumber");
    return res.json(notes);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch notes" });
  }
};

export const downloadNote = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const note = await Note.findOne({
      _id: req.params.id,
      institute: instituteId,
    });

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    if (note.pdfUrl && note.pdfUrl.startsWith("http")) {
      let downloadUrl = note.pdfUrl;
      if (note.pdfUrl.includes("/raw/private/")) {
        downloadUrl = cloudinary.utils.private_download_url(note.pdfPublicId, "", {
          resource_type: "raw",
          type: "private",
        });
      }

      await streamRemoteFileAsAttachment({
        res,
        url: downloadUrl,
        filename: buildNoteDownloadFilename(note),
      });
    } else {
      // Fetch from Supabase
      const { data, error } = await supabase.storage
        .from(supabaseBucket)
        .download(note.pdfPublicId || note.pdfUrl);

      if (error || !data) {
        return res.status(404).json({ message: "Note file not found in storage" });
      }

      const arrayBuffer = await data.arrayBuffer();
      res.setHeader("Content-Type", "application/pdf");
      res.send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    if (res.headersSent) {
      return;
    }
    return res.status(500).json({ message: "Could not download note" });
  }
};


export const uploadNote = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const { title, batchId, targetType, studentIds } = req.body;

    if (!title || !req.file) {
      return res
        .status(400)
        .json({ message: "Title and PDF file are required" });
    }

    const sanitizeFilename = (value) =>
      String(value || "note")
        .trim()
        .replace(/[^\w.-]+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "");

    const fileExt = req.file.originalname.split('.').pop() || 'pdf';
    const cleanBaseName = sanitizeFilename(req.file.originalname.replace(/\.[^/.]+$/, ""));
    const uniquePublicId = `note_${Date.now()}_${cleanBaseName}.${fileExt}`;

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      public_id: uniquePublicId,
      type: "private",
    });

    if (!result || !result.secure_url) {
      return res.status(502).json({ message: "Cloudinary upload failed" });
    }

    let resolvedStudentIds = [];
    if (targetType === "student" && studentIds) {
      if (Array.isArray(studentIds)) {
        resolvedStudentIds = studentIds;
      } else if (typeof studentIds === "string") {
        try {
          resolvedStudentIds = JSON.parse(studentIds);
        } catch (e) {
          resolvedStudentIds = studentIds.split(",").map(id => id.trim()).filter(Boolean);
        }
      }
    }

    const note = await Note.create({
      institute: instituteId,
      createdBy: req.user._id,
      title,
      pdfUrl: result.secure_url,
      pdfPublicId: result.public_id,
      targetType: targetType || "batch",
      batch: targetType === "student" ? null : (batchId || null),
      students: targetType === "student" ? resolvedStudentIds : [],
    });

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.status(201).json(await note.populate([
      { path: "batch", select: "name" },
      { path: "students", select: "name enrollmentNumber" }
    ]));
  } catch (error) {
    return res.status(500).json({ message: error.message || error });
  }
};

export const deleteNote = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const note = await Note.findOne({
      _id: req.params.id,
      institute: instituteId,
    });

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    if (note.pdfPublicId) {
      if (note.pdfUrl.startsWith("http")) {
        // Delete from Cloudinary
        try {
          await cloudinary.uploader.destroy(note.pdfPublicId, { resource_type: "raw" });
        } catch (cloudinaryErr) {
          console.error(`Failed to delete file from Cloudinary: ${cloudinaryErr.message || cloudinaryErr}`);
        }
      } else {
        // Fallback for legacy Supabase files
        const { error: deleteStorageError } = await supabase.storage
          .from(supabaseBucket)
          .remove([note.pdfPublicId]);

        if (deleteStorageError) {
          console.error(`Failed to delete file from Supabase storage: ${deleteStorageError.message}`);
        }
      }
    }

    await Note.findByIdAndDelete(note._id);

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Note deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: error.message || error });
  }
};


export const getTestResults = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const results = await TestResult.find({ institute: instituteId })
      .sort({ createdAt: -1 })
      .populate("student", "name enrollmentNumber email");
    return res.json(results);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch test results" });
  }
};

export const createTestResult = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const { studentId, title, score, totalMarks, examDate, remarks } = req.body;

    if (
      !studentId ||
      !title ||
      score === undefined ||
      totalMarks === undefined ||
      !examDate
    ) {
      return res
        .status(400)
        .json({ message: "All test result fields are required" });
    }

    const result = await TestResult.create({
      institute: instituteId,
      createdBy: req.user._id,
      student: studentId,
      title,
      score: Number(score),
      totalMarks: Number(totalMarks),
      examDate,
      remarks: remarks || "",
    });

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res
      .status(201)
      .json(await result.populate("student", "name enrollmentNumber email"));
  } catch (error) {
    return res.status(500).json({ message: "Could not create test result" });
  }
};

export const createTestResultsBulk = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const { batchId, title, examDate, totalMarks, entries = [] } = req.body;

    if (
      !batchId ||
      !title ||
      !examDate ||
      totalMarks === undefined ||
      !Array.isArray(entries) ||
      !entries.length
    ) {
      return res.status(400).json({
        message:
          "Batch, title, date, total marks, and at least one student mark are required",
      });
    }

    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;

    const batch = await Batch.findOne({
      _id: batchId,
      user: ownerId,
    }).select("_id");
    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    const studentIds = entries.map((entry) => entry.studentId).filter(Boolean);
    const students = await Student.find({
      _id: { $in: studentIds },
      user: ownerId,
      batch: batchId,
    }).select("_id");

    if (students.length !== studentIds.length) {
      return res
        .status(400)
        .json({ message: "One or more students are invalid for this batch" });
    }

    const payload = entries.map((entry) => ({
      institute: instituteId,
      createdBy: req.user._id,
      student: entry.studentId,
      title,
      score: Number(entry.score || 0),
      totalMarks: Number(totalMarks),
      examDate,
      remarks: entry.remarks || "",
    }));

    const createdResults = await TestResult.insertMany(payload);
    const populatedResults = await TestResult.find({
      _id: { $in: createdResults.map((result) => result._id) },
    })
      .sort({ createdAt: -1 })
      .populate("student", "name enrollmentNumber email");

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.status(201).json(populatedResults);
  } catch (error) {
    return res.status(500).json({ message: "Could not save test marks" });
  }
};

export const createHiredTeacher = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (req.user.role !== "institute_admin") {
      return res.status(403).json({ message: "Access denied. Only institute admins can add teachers." });
    }

    const instituteId = req.user.institute?._id || req.user.institute;
    const institute = await Institute.findById(instituteId);

    if (!institute || institute.tuitionType !== "institution") {
      return res.status(403).json({ message: "Access denied. Hired teachers can only be added for Institution accounts." });
    }

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required" });
    }

    const normalizedEmail = email.toLowerCase();
    const existingUser = await User.findOne({ email: normalizedEmail });

    if (existingUser) {
      return res.status(400).json({ message: "Email already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newTeacher = await User.create({
      name,
      email: normalizedEmail,
      password: hashedPassword,
      role: "teacher",
      institute: instituteId,
    });

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.status(201).json({
      _id: newTeacher._id,
      name: newTeacher.name,
      email: newTeacher.email,
      role: newTeacher.role,
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not create teacher" });
  }
};

export const getHiredTeachers = async (req, res) => {
  try {
    if (req.user.role !== "institute_admin") {
      return res.status(403).json({ message: "Access denied. Only institute admins can view teachers." });
    }

    const instituteId = req.user.institute?._id || req.user.institute;
    const teachers = await User.find({
      institute: instituteId,
      role: "teacher",
    }).select("name email role createdAt");

    return res.json(teachers);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch teachers" });
  }
};

export const deleteHiredTeacher = async (req, res) => {
  try {
    if (req.user.role !== "institute_admin") {
      return res.status(403).json({ message: "Access denied. Only institute admins can delete teachers." });
    }

    const instituteId = req.user.institute?._id || req.user.institute;
    const teacher = await User.findOneAndDelete({
      _id: req.params.id,
      institute: instituteId,
      role: "teacher",
    });

    if (!teacher) {
      return res.status(404).json({ message: "Teacher not found" });
    }

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Teacher deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete teacher" });
  }
};

export const getQuizLeaderboard = async (req, res) => {
  try {
    const quizId = req.params.id;
    const attempts = await QuizAttempt.find({ quiz: quizId })
      .populate("student", "name")
      .sort({ score: -1, updatedAt: 1 });

    const leaderboard = attempts.map((attempt, index) => ({
      studentId: attempt.student?._id || attempt.student,
      studentName: attempt.student?.name || "Unknown Student",
      score: attempt.score,
      lastAnswerAt: attempt.updatedAt,
    }));

    return res.json(leaderboard);
  } catch (error) {
    console.error("getQuizLeaderboard error:", error);
    return res.status(500).json({ message: "Could not fetch leaderboard" });
  }
};

export const uploadBrandingLogo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }

    if (req.user?.role !== "institute_admin") {
      return res.status(403).json({ message: "Only institute admins can update branding settings" });
    }

    const result = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "image",
      folder: "tutiondesk/logos",
    });

    return res.json({ logoUrl: result.secure_url });
  } catch (error) {
    console.error("uploadBrandingLogo error:", error);
    return res.status(500).json({ message: "Could not upload logo" });
  }
};

export const updateBrandingSettings = async (req, res) => {
  try {
    if (req.user?.role !== "institute_admin") {
      return res.status(403).json({ message: "Only institute admins can update branding settings" });
    }

    const { brandingEnabled, name, themeColor, logoUrl } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute;

    const institute = await Institute.findByIdAndUpdate(
      instituteId,
      {
        brandingEnabled: brandingEnabled !== false,
        name: name ? name.trim() : "TutionDesk",
        themeColor: themeColor || "#6366f1",
        logoUrl: logoUrl || null,
      },
      { new: true }
    );

    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({
      message: "Branding settings updated successfully",
      institute: {
        id: institute._id,
        name: institute.name,
        brandingEnabled: institute.brandingEnabled !== false,
        logoUrl: institute.logoUrl || null,
        themeColor: institute.themeColor || "#6366f1",
      }
    });
  } catch (error) {
    console.error("updateBrandingSettings error:", error);
    return res.status(500).json({ message: "Could not update branding settings" });
  }
};

export const updateTestResult = async (req, res) => {
  try {
    const { score, totalMarks, remarks } = req.body;
    const result = await TestResult.findById(req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Test result not found" });
    }

    if (score !== undefined) result.score = Number(score);
    if (totalMarks !== undefined) result.totalMarks = Number(totalMarks);
    if (remarks !== undefined) result.remarks = remarks;

    await result.save();

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Test result updated successfully", result });
  } catch (error) {
    return res.status(500).json({ message: "Could not update test result" });
  }
};

export const deleteTestResult = async (req, res) => {
  try {
    const result = await TestResult.findById(req.params.id);
    if (!result) {
      return res.status(404).json({ message: "Test result not found" });
    }

    await TestResult.deleteOne({ _id: req.params.id });

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Test result deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete test result" });
  }
};

export const updateGroupedTestResults = async (req, res) => {
  try {
    const { batchId, oldTitle, oldExamDate, title, examDate, totalMarks } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute;
    
    const results = await TestResult.find({
      institute: instituteId,
      batch: batchId,
      title: oldTitle,
      examDate: oldExamDate
    });

    for (const r of results) {
      if (title !== undefined) r.title = title.trim();
      if (examDate !== undefined) r.examDate = examDate;
      if (totalMarks !== undefined) r.totalMarks = Number(totalMarks);
      await r.save();
    }

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Grouped test details updated successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not update grouped test details" });
  }
};

export const deleteGroupedTestResults = async (req, res) => {
  try {
    const { batchId, title, examDate } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute;

    await TestResult.deleteMany({
      institute: instituteId,
      batch: batchId,
      title: title,
      examDate: examDate
    });

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.json({ message: "Grouped test results deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete grouped test results" });
  }
};
