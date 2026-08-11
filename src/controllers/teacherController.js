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
import { sendMessage, getSessionStatus } from "../services/whatsappService.js";
import { getGlobalTemplates, formatTestMarksMessage } from "../utils/whatsappTemplateHelper.js";

const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "raw",
        folder: "classtech/notes",
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

// ─── Direct DB feature read — no cache, no Redis ──────────────────────────
// Reads allowedFeatures straight from MongoDB every time so admin changes
// are reflected instantly on the next app launch.
export const getInstituteFeatures = async (req, res) => {
  try {
    const rawInst = req.user.institute;
    const instIdStr = rawInst?._id ? String(rawInst._id) : (rawInst ? String(rawInst) : null);
    if (!instIdStr) {
      return res.status(400).json({ message: "No institute linked to this account" });
    }

    const institute = await Institute.findById(instIdStr)
      .select("allowedFeatures");

    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    return res.json({
      allowedFeatures: Array.isArray(institute.allowedFeatures)
        ? institute.allowedFeatures
        : [],
    });
  } catch (error) {
    console.error("getInstituteFeatures error:", error);
    return res.status(500).json({ message: "Could not load features" });
  }
};

export const getTeacherDashboard = async (req, res) => {
  try {
    const rawInst = req.user.institute;
    const instIdStr = rawInst?._id ? String(rawInst._id) : (rawInst ? String(rawInst) : null);
    const instituteId = instIdStr;

    let institute = null;
    if (instIdStr) {
      institute = await Institute.findById(instIdStr)
        .select(
          "name status subscriptionPlan subscriptionEnd adminUser tuitionType quizFeatureEnabled brandingEnabled themeColor logoUrl allowedFeatures whatsappSettings"
        );
    }

    if (institute && instIdStr) {
      const savedSettings = await getCache(`institute:whatsapp_settings:${instIdStr}`);
      if (savedSettings) {
        institute.whatsappSettings = savedSettings;
      }
    }

    const cacheKey = `teacher:dashboard:${req.user._id}`;
    if (req.query.nocache !== "true") {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        // ALWAYS attach fresh live institute from MongoDB so allowedFeatures & branding are never stale
        cachedData.institute = institute;
        return res.json(cachedData);
      }
    }
    const ownerId = req.user.role === "teacher" ? (institute?.adminUser || rawInst?.adminUser || req.user._id) : req.user._id;

    let studentQuery = { user: ownerId };
    let batchQuery = { user: ownerId };
    let quizQuery = { institute: instituteId };
    let noteQuery = { institute: instituteId };
    let testQuery = { institute: instituteId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => String(b._id || b.id || b)).filter(Boolean);

      batchQuery.teacher = req.user._id;

      if (batchIds.length > 0) {
        studentQuery.batch = { $in: batchIds };
        const myStudents = await Student.find({ user: ownerId, batch: { $in: batchIds } }).select("_id");
        const studentIds = myStudents.map((s) => String(s._id || s.id || s)).filter(Boolean);

        testQuery.student = studentIds.length > 0 ? { $in: studentIds } : null;

        noteQuery.$or = [
          { batch: { $in: batchIds } },
          { batch: null },
          ...(studentIds.length > 0 ? [{ students: { $in: studentIds } }] : [])
        ];
        quizQuery.batches = { $in: batchIds };
      } else {
        studentQuery.batch = null;
        testQuery.student = null;
        noteQuery.batch = null;
        quizQuery.batches = null;
      }
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
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();

      for (const student of students) {
        let collectedThisMonth = 0;
        for (const payment of student.paymentHistory || []) {
          const pDate = new Date(payment.paymentDate);
          if (pDate.getFullYear() === currentYear && pDate.getMonth() === currentMonth) {
            collectedThisMonth += Number(payment.amount || 0);
          }
        }
        totalCollectedFees += collectedThisMonth;
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
        const obj = typeof s?.toJSON === "function" ? s.toJSON() : (typeof s?.toObject === "function" ? s.toObject() : { ...s });
        delete obj.totalFees;
        delete obj.feePlanType;
        delete obj.paymentHistory;
        delete obj.paidAmount;
        delete obj.pendingAmount;
        delete obj.dueDate;
        return obj;
      });
    }

    const processedBatches = batches.map((batch) => {
      const count = students.filter(
        (s) => s.batch && String(s.batch._id || s.batch) === String(batch._id)
      ).length;
      const bObj = typeof batch?.toJSON === "function" ? batch.toJSON() : (typeof batch?.toObject === "function" ? batch.toObject() : { ...batch });
      return {
        ...bObj,
        studentCount: count,
      };
    });

    const responsePayload = {
      summary,
      students: processedStudents,
      batches: processedBatches,
      quizzes,
      notes,
      testResults,
      institute,
      user: {
        id: req.user._id,
        role: req.user.role,
        name: req.user.name,
        email: req.user.email,
      },
    };

    await setCache(cacheKey, responsePayload, 86400);

    return res.json(responsePayload);
  } catch (error) {
    console.error("getTeacherDashboard error stack:", error);
    return res
      .status(500)
      .json({ message: error.message || "Could not load teacher dashboard" });
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
    const rawInst = req.user.institute;
    let instId = "";
    if (rawInst) {
      if (typeof rawInst === "object") {
        instId = String(rawInst._id || rawInst.id || "");
      } else {
        instId = String(rawInst);
      }
    }
    if (!instId && req.user.institute_id) {
      instId = String(req.user.institute_id);
    }

    const ownerId = req.user.role === "teacher" && rawInst?.adminUser
      ? String(rawInst.adminUser)
      : String(req.user._id || req.user.id || "");

    const { supabase: sb } = await import("../utils/supabase.js");

    let query = sb.from("notes").select("*");

    if (req.user.role !== "super_admin") {
      const validIds = Array.from(new Set([instId, ownerId])).filter((id) => id && id.length > 5 && id !== "[object Object]");
      if (validIds.length > 0) {
        query = query.in("institute_id", validIds);
      }
    }

    const { data: rows, error } = await query.order("created_at", { ascending: false });

    if (error) {
      console.error("getNotes Supabase error:", error.message);
      return res.status(500).json({ message: "Could not fetch notes" });
    }

    // Resolve batch names
    const batchIds = [...new Set((rows || []).map((r) => r.batch_id).filter(Boolean))];
    let batchMap = {};
    if (batchIds.length > 0) {
      const { data: batches } = await sb
        .from("batches")
        .select("id, name")
        .in("id", batchIds);
      if (batches) {
        batches.forEach((b) => {
          batchMap[b.id] = b.name;
        });
      }
    }

    const notes = (rows || []).map((row) => ({
      _id: row.id,
      id: row.id,
      title: row.title,
      pdfUrl: row.file_url,
      pdfPublicId: row.pdf_public_id,
      targetType: row.target_type || "batch",
      batch: row.batch_id
        ? { _id: row.batch_id, name: batchMap[row.batch_id] || row.batch_id }
        : null,
      students: row.student_ids || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return res.json(notes);
  } catch (error) {
    console.error("getNotes error:", error.message);
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
    const rawInst = req.user.institute;
    let instituteId = "";
    if (rawInst) {
      if (typeof rawInst === "object") {
        instituteId = String(rawInst._id || rawInst.id || "");
      } else {
        instituteId = String(rawInst);
      }
    }
    if (!instituteId && req.user.institute_id) {
      instituteId = String(req.user.institute_id);
    }
    if (!instituteId) {
      instituteId = String(req.user._id || req.user.id || "");
    }
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

    const fileExt = req.file.originalname ? (req.file.originalname.split('.').pop() || 'pdf') : 'pdf';
    const cleanBaseName = sanitizeFilename(req.file.originalname ? req.file.originalname.replace(/\.[^/.]+$/, "") : "note");
    const uniquePublicId = `note_${Date.now()}_${cleanBaseName}.${fileExt}`;

    let secure_url = "";
    let public_id = uniquePublicId;

    // Try Cloudinary first
    try {
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_CLOUD_NAME !== "your_cloud_name") {
        const result = await uploadBufferToCloudinary(req.file.buffer, {
          public_id: uniquePublicId,
          type: "private",
        });
        if (result && result.secure_url) {
          secure_url = result.secure_url;
          public_id = result.public_id;
          console.log("Note uploaded to Cloudinary:", secure_url);
        }
      }
    } catch (cErr) {
      console.error("Cloudinary upload error:", cErr.message);
    }

    // Fallback to Supabase Storage
    if (!secure_url) {
      try {
        const { data: sData, error: sError } = await supabase.storage
          .from(supabaseBucket)
          .upload(uniquePublicId, req.file.buffer, {
            contentType: req.file.mimetype || "application/pdf",
            upsert: true,
          });

        if (!sError && sData) {
          const { data: pData } = supabase.storage
            .from(supabaseBucket)
            .getPublicUrl(uniquePublicId);
          secure_url = pData?.publicUrl || "";
          console.log("Note uploaded to Supabase Storage:", secure_url);
        } else if (sError) {
          console.error("Supabase storage error:", sError.message);
        }
      } catch (sErr) {
        console.error("Supabase upload error:", sErr.message);
      }
    }

    // Last resort: store as base64 data URL
    if (!secure_url) {
      const base64Str = req.file.buffer.toString("base64");
      secure_url = `data:${req.file.mimetype || "application/pdf"};base64,${base64Str}`;
      console.log("Note stored as base64 data URL");
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

    // Use Supabase client directly to insert note — avoids .populate() issue
    const { supabase: sb } = await import("../utils/supabase.js");
    const notePayload = {
      institute_id: String(instituteId),
      created_by: String(req.user._id),
      title: title.trim(),
      file_url: secure_url,
      pdf_public_id: public_id,
      target_type: targetType || "batch",
      batch_id: targetType === "student" ? null : (batchId || null),
      student_ids: targetType === "student" ? resolvedStudentIds : [],
    };

    const { data: noteData, error: noteError } = await sb
      .from("notes")
      .insert(notePayload)
      .select()
      .maybeSingle();

    if (noteError) {
      console.error("Supabase notes insert error:", noteError);
      // Try stripping unknown columns and retry
      const safe = {
        institute_id: notePayload.institute_id,
        title: notePayload.title,
        file_url: notePayload.file_url,
      };
      const { data: retryData, error: retryError } = await sb
        .from("notes")
        .insert(safe)
        .select()
        .maybeSingle();

      if (retryError) {
        return res.status(500).json({ message: retryError.message || "Failed to save note metadata" });
      }

      await deleteCache(`teacher:dashboard:${req.user._id}`);
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("student:dashboard:*");
      return res.status(201).json({
        _id: retryData?.id,
        title: title.trim(),
        pdfUrl: secure_url,
        pdfPublicId: public_id,
        targetType: targetType || "batch",
        batch: batchId || null,
        students: resolvedStudentIds,
        createdAt: new Date().toISOString(),
      });
    }

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    return res.status(201).json({
      _id: noteData?.id || noteData?.note_id,
      title: noteData?.title || title.trim(),
      pdfUrl: noteData?.file_url || secure_url,
      pdfPublicId: noteData?.pdf_public_id || public_id,
      targetType: noteData?.target_type || targetType || "batch",
      batch: noteData?.batch_id || batchId || null,
      students: noteData?.student_ids || resolvedStudentIds,
      createdAt: noteData?.created_at || new Date().toISOString(),
    });
  } catch (error) {
    console.error("uploadNote error:", error);
    return res.status(500).json({ message: error.message || "Failed to upload note" });
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
    const query = { institute: instituteId };
    if (req.query.studentId) {
      query.student = req.query.studentId;
    }
    const results = await TestResult.find(query)
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
    const { studentId, title, score, totalMarks, examDate, remarks, subject } = req.body;

    if (
      !studentId ||
      !title ||
      score === undefined ||
      totalMarks === undefined ||
      !examDate ||
      !subject
    ) {
      return res
        .status(400)
        .json({ message: "All test result fields are required, including subject" });
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
      subject: subject.trim(),
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
    const { batchId, title, examDate, totalMarks, entries = [], sendWhatsApp = false, subject } = req.body;

    if (
      !batchId ||
      !title ||
      !examDate ||
      totalMarks === undefined ||
      !Array.isArray(entries) ||
      !entries.length ||
      !subject
    ) {
      return res.status(400).json({
        message:
          "Batch, title, date, total marks, subject, and at least one student mark are required",
      });
    }

    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;

    const batch = await Batch.findOne({
      _id: batchId,
      $or: [{ institute: instituteId }, { user: ownerId }],
    }).select("_id");
    if (!batch) {
      return res.status(404).json({ message: "Batch not found" });
    }

    const studentIds = entries.map((entry) => entry.studentId).filter(Boolean);

    // Build marks JSONB map: { studentId: score }
    const marksMap = {};
    for (const entry of entries) {
      if (entry.studentId) {
        marksMap[String(entry.studentId)] = Number(entry.score || 0);
      }
    }

    // Directly upsert into the test_marks table using Supabase client
    // (which stores one row per test with marks as a JSON map)
    const { supabase: sb } = await import("../utils/supabase.js");
    const { data: insertedRow, error: insertError } = await sb
      .from("test_marks")
      .insert({
        institute_id: String(instituteId),
        batch_id: String(batchId),
        test_name: title.trim(),
        subject: subject.trim(),
        max_marks: Number(totalMarks),
        test_date: new Date(examDate).toISOString().substring(0, 10),
        marks: marksMap,
      })
      .select()
      .maybeSingle();

    if (insertError) {
      console.error("Supabase test_marks insert error:", insertError);
      return res.status(500).json({ message: insertError.message || "Could not save test marks" });
    }

    // Build a response shaped like the website expects (array of per-student results)
    const populatedResults = studentIds.map((sid) => ({
      _id: `${insertedRow?.id || "new"}_${sid}`,
      student: { _id: sid, name: "", enrollmentNumber: "" },
      title: title.trim(),
      subject: subject.trim(),
      score: marksMap[sid] ?? 0,
      totalMarks: Number(totalMarks),
      examDate,
    }));

    await deleteCache(`teacher:dashboard:${req.user._id}`);
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("student:dashboard:*");

    // Asynchronous background WhatsApp test mark alerts
    if (sendWhatsApp) {
      setImmediate(async () => {
        try {
          const inst = await Institute.findById(instituteId);
          const allowed = inst?.allowedFeatures || ["attendance", "whatsapp", "quizzes"];
          if (!allowed.includes("whatsapp")) {
            console.warn(`WhatsApp feature disabled for institute ${instituteId}. Skipping test mark alerts.`);
            return;
          }

          const statusObj = getSessionStatus(String(instituteId));
          if (statusObj.status !== "connected") {
            console.warn(`WhatsApp session not connected for institute ${instituteId}.`);
            return;
          }

          const fullStudents = await Student.find({ _id: { $in: studentIds } });
          const studentMap = (fullStudents || []).reduce((map, s) => {
            map[String(s._id)] = s;
            return map;
          }, {});

          const formattedDate = new Date(examDate).toLocaleDateString("en-IN");
          const totalNum = Number(totalMarks);
          const globalTemplates = await getGlobalTemplates();

          for (const entry of entries) {
            const student = studentMap[String(entry.studentId)];
            if (!student) continue;

            const targetPhone = (student.parentPhone && student.parentPhone.trim()) ? student.parentPhone.trim() : student.phone;
            if (!targetPhone) continue;

            const scoreNum = Number(entry.score || 0);
            const percentage = totalNum > 0 ? Math.round((scoreNum / totalNum) * 100) : 0;

            const messageText = formatTestMarksMessage({
              template: globalTemplates.testMarks,
              studentName: student.name,
              testName: title,
              marksObtained: String(scoreNum),
              totalMarks: String(totalNum),
              percentage: String(percentage),
              remarks: entry.remarks || "-",
              instituteName: inst?.name || "Classtech",
            });

            try {
              await sendMessage(String(instituteId), targetPhone, messageText);
              await new Promise((r) => setTimeout(r, 500));
            } catch (wErr) {
              console.error(`Failed to send test marks WhatsApp alert for ${student.name}:`, wErr.message);
            }
          }
        } catch (bgErr) {
          console.error("Background test marks WhatsApp alert error:", bgErr);
        }
      });
    }

    return res.status(201).json(populatedResults);
  } catch (error) {
    console.error("createTestResultsBulk error:", error);
    return res.status(500).json({ message: error.message || "Could not save test marks" });
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

    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    if (institute.tuitionType !== "institution") {
      institute.tuitionType = "institution";
      await institute.save();
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
    console.error("addHiredTeacher error:", error);
    return res.status(500).json({ message: error.message || "Could not create teacher" });
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
      folder: "classtech/logos",
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
        name: name ? name.trim() : "Classtech",
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
