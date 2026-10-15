import TestSeriesFolder from "../models/TestSeriesFolder.js";
import TestSeries from "../models/TestSeries.js";
import InstituteTestSeriesAccess from "../models/InstituteTestSeriesAccess.js";
import TestSeriesAttempt from "../models/TestSeriesAttempt.js";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import mongoose from "../utils/supabaseModel.js";

const DEFAULT_CATEGORIES = [
  "Class 10",
  "Class 11",
  "Class 12",
  "JEE Main & Advanced",
  "NEET",
  "Bank & SSC",
  "CUET",
  "Foundation",
  "Olympiad",
  "General",
];

// Helper to sanitize questions for student taking test (hide answers)
function sanitizeQuestionsForStudent(questions = []) {
  return questions.map((q) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    questionImageUrl: q.questionImageUrl || "",
    options: (q.options || []).map((opt) => ({
      id: opt.id,
      text: opt.text || "",
      imageUrl: opt.imageUrl || "",
    })),
    marks: q.marks,
    negativeMarks: q.negativeMarks,
  }));
}

// -------------------------------------------------------------
// CATEGORIES & FOLDERS
// -------------------------------------------------------------

export const getCategories = async (req, res) => {
  try {
    const folders = await TestSeriesFolder.find({}).select("category");
    const tests = await TestSeries.find({}).select("category");

    const categorySet = new Set(DEFAULT_CATEGORIES);
    folders.forEach((f) => {
      if (f.category) categorySet.add(f.category.trim());
    });
    tests.forEach((t) => {
      if (t.category) categorySet.add(t.category.trim());
    });

    res.json({ categories: Array.from(categorySet).sort() });
  } catch (error) {
    console.error("Error fetching categories:", error);
    res.status(500).json({ message: "Failed to fetch categories" });
  }
};

export const getFolders = async (req, res) => {
  try {
    const { category, parentFolder } = req.query;
    const filter = {};

    if (category) filter.category = category;
    if (parentFolder !== undefined) {
      filter.parentFolder = parentFolder === "null" || !parentFolder ? null : parentFolder;
    }

    // Role check: super admin sees all global; teachers see allowed categories or own institute
    const isSuperAdmin = req.user?.role === "super_admin" || req.user?.role === "tech_admin";
    if (!isSuperAdmin) {
      const instituteId = req.user?.institute?._id || req.user?.institute || req.instituteId;
      const institute = await Institute.findById(instituteId);
      const allowedCategories = institute?.allowedTestSeriesCategories || [];

      filter.$or = [
        { isGlobal: true, category: { $in: allowedCategories.length > 0 ? allowedCategories : DEFAULT_CATEGORIES } },
        { institute: instituteId },
      ];
    }

    const folders = await TestSeriesFolder.find(filter).sort({ name: 1 });
    res.json({ folders });
  } catch (error) {
    console.error("Error fetching folders:", error);
    res.status(500).json({ message: "Failed to fetch folders" });
  }
};

export const createFolder = async (req, res) => {
  try {
    const { name, parentFolder, category, isGlobal } = req.body;
    if (!name) {
      return res.status(400).json({ message: "Folder name is required" });
    }

    let path = name.trim();
    let resolvedCategory = category ? category.trim() : "General";

    if (parentFolder) {
      const parent = await TestSeriesFolder.findById(parentFolder);
      if (parent) {
        path = `${parent.path} / ${name.trim()}`;
        if (!category && parent.category) {
          resolvedCategory = parent.category;
        }
      }
    }

    const isSuperAdmin = req.user?.role === "super_admin" || req.user?.role === "tech_admin";
    const instituteId = !isSuperAdmin
      ? req.user?.institute?._id || req.user?.institute || req.instituteId
      : null;

    const folder = await TestSeriesFolder.create({
      name: name.trim(),
      parentFolder: parentFolder || null,
      category: resolvedCategory,
      path,
      isGlobal: isSuperAdmin ? (isGlobal !== false) : false,
      institute: instituteId,
      createdBy: req.user?._id,
    });

    res.status(201).json({ folder });
  } catch (error) {
    console.error("Error creating folder:", error);
    res.status(500).json({ message: "Failed to create folder" });
  }
};

export const updateFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category } = req.body;

    const folder = await TestSeriesFolder.findById(id);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    if (name) folder.name = name.trim();
    if (category) folder.category = category.trim();

    // Recompute path
    if (folder.parentFolder) {
      const parent = await TestSeriesFolder.findById(folder.parentFolder);
      folder.path = parent ? `${parent.path} / ${folder.name}` : folder.name;
    } else {
      folder.path = folder.name;
    }

    await folder.save();
    res.json({ folder });
  } catch (error) {
    console.error("Error updating folder:", error);
    res.status(500).json({ message: "Failed to update folder" });
  }
};

export const deleteFolder = async (req, res) => {
  try {
    const { id } = req.params;
    const folder = await TestSeriesFolder.findById(id);
    if (!folder) {
      return res.status(404).json({ message: "Folder not found" });
    }

    // Delete subfolders as well
    await TestSeriesFolder.deleteMany({
      $or: [{ _id: id }, { parentFolder: id }, { path: new RegExp(`^${folder.path}`) }],
    });

    res.json({ message: "Folder and nested items removed successfully" });
  } catch (error) {
    console.error("Error deleting folder:", error);
    res.status(500).json({ message: "Failed to delete folder" });
  }
};

// -------------------------------------------------------------
// TEST SERIES CRUD
// -------------------------------------------------------------

export const getTestSeriesList = async (req, res) => {
  try {
    const { folder, category, search } = req.query;
    const isSuperAdmin = req.user?.role === "super_admin" || req.user?.role === "tech_admin";

    if (isSuperAdmin) {
      const filter = {};
      if (folder) filter.folder = folder;
      if (category) filter.category = category;
      if (search) filter.title = { $regex: search, $options: "i" };

      const testSeries = await TestSeries.find(filter).sort({ createdAt: -1 });
      return res.json({ testSeries });
    }

    // Teacher Request
    const instituteId = req.user?.institute?._id || req.user?.institute || req.instituteId;
    const institute = await Institute.findById(instituteId);

    const isFeatureEnabled =
      institute?.testSeriesFeatureEnabled === true ||
      (Array.isArray(institute?.allowedFeatures) && institute.allowedFeatures.includes("test_series"));

    if (!isFeatureEnabled) {
      return res.json({
        enabled: false,
        testSeries: [],
        message: "Test Series feature is not enabled for your institute.",
      });
    }

    const allowedSeriesIds = Array.isArray(institute?.allowedTestSeries)
      ? institute.allowedTestSeries.map(String).filter(Boolean)
      : [];
    const allowedCategories = Array.isArray(institute?.allowedTestSeriesCategories)
      ? institute.allowedTestSeriesCategories
      : [];

    let globalTestCondition;
    if (allowedSeriesIds.length > 0) {
      globalTestCondition = {
        isGlobal: true,
        _id: { $in: allowedSeriesIds },
      };
    } else if (allowedCategories.length > 0) {
      globalTestCondition = {
        isGlobal: true,
        category: { $in: allowedCategories },
      };
    } else {
      globalTestCondition = { isGlobal: true };
    }

    // Filter tests: global tests matching allowed series/categories + institute's custom tests
    const query = {
      $or: [
        globalTestCondition,
        { institute: instituteId },
      ],
    };

    if (folder) query.folder = folder;
    if (category) query.category = category;
    if (search) query.title = { $regex: search, $options: "i" };

    const tests = await TestSeries.find(query).sort({ createdAt: -1 });

    // Attach institute access info (isEnabled & assignedBatches)
    const accessRecords = await InstituteTestSeriesAccess.find({
      institute: instituteId,
    });
    const accessMap = new Map();
    accessRecords.forEach((acc) => {
      accessMap.set(String(acc.testSeries), acc);
    });

    const enrichedTests = tests.map((t) => {
      const tObj = t.toObject ? t.toObject() : { ...t };
      const access = accessMap.get(String(t._id));
      tObj.access = access
        ? { isEnabled: access.isEnabled, assignedBatches: access.assignedBatches }
        : { isEnabled: false, assignedBatches: [] };
      return tObj;
    });

    res.json({
      enabled: true,
      allowedCategories,
      testSeries: enrichedTests,
    });
  } catch (error) {
    console.error("Error fetching test series:", error);
    res.status(500).json({ message: "Failed to fetch test series" });
  }
};

export const getTestSeriesById = async (req, res) => {
  try {
    const { id } = req.params;
    const test = await TestSeries.findById(id);
    if (!test) {
      return res.status(404).json({ message: "Test series not found" });
    }

    let access = null;
    const instituteId = req.user?.institute?._id || req.user?.institute || req.instituteId;
    if (instituteId) {
      access = await InstituteTestSeriesAccess.findOne({
        institute: instituteId,
        testSeries: id,
      });
    }

    res.json({ testSeries: test, access });
  } catch (error) {
    console.error("Error fetching test series by id:", error);
    res.status(500).json({ message: "Failed to fetch test series" });
  }
};

export const createTestSeries = async (req, res) => {
  try {
    const {
      title,
      description,
      folder,
      category,
      durationMinutes,
      totalMarks,
      passingMarks,
      instructions,
      questions,
      isGlobal,
    } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Title is required" });
    }

    let folderPath = "";
    let resolvedCategory = category || "General";

    if (folder) {
      const folderDoc = await TestSeriesFolder.findById(folder);
      if (folderDoc) {
        folderPath = folderDoc.path;
        if (!category && folderDoc.category) {
          resolvedCategory = folderDoc.category;
        }
      }
    }

    const isSuperAdmin = req.user?.role === "super_admin" || req.user?.role === "tech_admin";
    const instituteId = !isSuperAdmin
      ? req.user?.institute?._id || req.user?.institute || req.instituteId
      : null;

    // Validate and format questions
    const formattedQuestions = (Array.isArray(questions) ? questions : []).map((q, idx) => ({
      id: q.id || `q_${Date.now()}_${idx}`,
      type: q.type || "single_choice",
      question: q.question || "",
      questionImageUrl: q.questionImageUrl || "",
      options: (Array.isArray(q.options) ? q.options : []).map((opt, oIdx) => ({
        id: opt.id || `opt_${oIdx + 1}`,
        text: opt.text || "",
        imageUrl: opt.imageUrl || "",
      })),
      correctAnswers: Array.isArray(q.correctAnswers) ? q.correctAnswers : (q.correctAnswer ? [q.correctAnswer] : []),
      marks: Number(q.marks || 4),
      negativeMarks: Number(q.negativeMarks || 0),
      explanation: q.explanation || "",
    }));

    const calculatedTotalMarks =
      totalMarks !== undefined && Number(totalMarks) > 0
        ? Number(totalMarks)
        : formattedQuestions.reduce((acc, q) => acc + q.marks, 0);

    const testSeries = await TestSeries.create({
      title: title.trim(),
      description: description || "",
      folder: folder || null,
      folderPath,
      category: resolvedCategory,
      durationMinutes: Number(durationMinutes || 60),
      totalMarks: calculatedTotalMarks || 100,
      passingMarks: Number(passingMarks || 40),
      instructions: instructions || "",
      questions: formattedQuestions,
      isGlobal: isSuperAdmin ? (isGlobal !== false) : false,
      institute: instituteId,
      createdBy: req.user?._id,
      isPublished: true,
    });

    res.status(201).json({ testSeries });
  } catch (error) {
    console.error("Error creating test series:", error);
    res.status(500).json({ message: "Failed to create test series" });
  }
};

export const updateTestSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const test = await TestSeries.findById(id);
    if (!test) {
      return res.status(404).json({ message: "Test series not found" });
    }

    const {
      title,
      description,
      folder,
      category,
      durationMinutes,
      totalMarks,
      passingMarks,
      instructions,
      questions,
      isPublished,
    } = req.body;

    if (title) test.title = title.trim();
    if (description !== undefined) test.description = description;
    if (folder !== undefined) {
      test.folder = folder || null;
      if (folder) {
        const fDoc = await TestSeriesFolder.findById(folder);
        if (fDoc) test.folderPath = fDoc.path;
      } else {
        test.folderPath = "";
      }
    }
    if (category) test.category = category;
    if (durationMinutes !== undefined) test.durationMinutes = Number(durationMinutes);
    if (passingMarks !== undefined) test.passingMarks = Number(passingMarks);
    if (instructions !== undefined) test.instructions = instructions;
    if (isPublished !== undefined) test.isPublished = Boolean(isPublished);

    if (Array.isArray(questions)) {
      test.questions = questions.map((q, idx) => ({
        id: q.id || `q_${Date.now()}_${idx}`,
        type: q.type || "single_choice",
        question: q.question || "",
        questionImageUrl: q.questionImageUrl || "",
        options: (Array.isArray(q.options) ? q.options : []).map((opt, oIdx) => ({
          id: opt.id || `opt_${oIdx + 1}`,
          text: opt.text || "",
          imageUrl: opt.imageUrl || "",
        })),
        correctAnswers: Array.isArray(q.correctAnswers) ? q.correctAnswers : (q.correctAnswer ? [q.correctAnswer] : []),
        marks: Number(q.marks || 4),
        negativeMarks: Number(q.negativeMarks || 0),
        explanation: q.explanation || "",
      }));
    }

    test.totalMarks =
      totalMarks !== undefined && Number(totalMarks) > 0
        ? Number(totalMarks)
        : test.questions.reduce((acc, q) => acc + q.marks, 0);

    await test.save();
    res.json({ testSeries: test });
  } catch (error) {
    console.error("Error updating test series:", error);
    res.status(500).json({ message: "Failed to update test series" });
  }
};

export const deleteTestSeries = async (req, res) => {
  try {
    const { id } = req.params;
    const test = await TestSeries.findById(id);
    if (!test) {
      return res.status(404).json({ message: "Test series not found" });
    }

    await TestSeries.findByIdAndDelete(id);
    await InstituteTestSeriesAccess.deleteMany({ testSeries: id });
    await TestSeriesAttempt.deleteMany({ testSeries: id });

    res.json({ message: "Test series deleted successfully" });
  } catch (error) {
    console.error("Error deleting test series:", error);
    res.status(500).json({ message: "Failed to delete test series" });
  }
};

// -------------------------------------------------------------
// TEACHER BATCH ASSIGNMENT & ANALYTICS
// -------------------------------------------------------------

export const assignTestSeries = async (req, res) => {
  try {
    const { id } = req.params; // testSeriesId
    const { isEnabled, assignedBatches } = req.body;
    const instituteId = req.user?.institute?._id || req.user?.institute || req.instituteId;

    if (!instituteId) {
      return res.status(400).json({ message: "Institute ID required" });
    }

    let access = await InstituteTestSeriesAccess.findOne({
      institute: instituteId,
      testSeries: id,
    });

    if (!access) {
      access = new InstituteTestSeriesAccess({
        institute: instituteId,
        testSeries: id,
        isEnabled: Boolean(isEnabled),
        assignedBatches: Array.isArray(assignedBatches) ? assignedBatches : [],
        assignedBy: req.user?._id,
      });
    } else {
      if (isEnabled !== undefined) access.isEnabled = Boolean(isEnabled);
      if (assignedBatches !== undefined) {
        access.assignedBatches = Array.isArray(assignedBatches) ? assignedBatches : [];
      }
      access.assignedBy = req.user?._id;
    }

    await access.save();

    res.json({
      message: "Test series assignment updated",
      access: {
        isEnabled: access.isEnabled,
        assignedBatches: access.assignedBatches,
      },
    });
  } catch (error) {
    console.error("Error assigning test series:", error);
    res.status(500).json({ message: "Failed to update assignment" });
  }
};

export const getTestSeriesAnalytics = async (req, res) => {
  try {
    const { id } = req.params; // testSeriesId
    const instituteId = req.user?.institute?._id || req.user?.institute || req.instituteId;

    const test = await TestSeries.findById(id).select("title totalMarks passingMarks durationMinutes questions");
    if (!test) {
      return res.status(404).json({ message: "Test series not found" });
    }

    const attempts = await TestSeriesAttempt.find({
      testSeries: id,
      ...(instituteId ? { institute: instituteId } : {}),
    }).sort({ submittedAt: -1 });

    const totalAttempts = attempts.length;
    let totalScoreSum = 0;
    let totalTimeSum = 0;
    let passCount = 0;

    attempts.forEach((att) => {
      totalScoreSum += att.score || 0;
      totalTimeSum += att.timeTakenSeconds || 0;
      if (att.isPassed) passCount++;
    });

    const averageScore = totalAttempts > 0 ? Number((totalScoreSum / totalAttempts).toFixed(1)) : 0;
    const averagePercentage =
      totalAttempts > 0 && test.totalMarks > 0
        ? Number(((averageScore / test.totalMarks) * 100).toFixed(1))
        : 0;
    const averageTimeTakenSeconds = totalAttempts > 0 ? Math.round(totalTimeSum / totalAttempts) : 0;

    res.json({
      test: {
        id: test._id,
        title: test.title,
        totalMarks: test.totalMarks,
        passingMarks: test.passingMarks,
        durationMinutes: test.durationMinutes,
        questionsCount: test.questions?.length || 0,
      },
      summary: {
        totalAttempts,
        passCount,
        failCount: totalAttempts - passCount,
        averageScore,
        averagePercentage,
        averageTimeTakenSeconds,
      },
      attempts: attempts.map((att) => ({
        id: att._id,
        studentId: att.student,
        studentName: att.studentName || "Student",
        studentEmail: att.studentEmail,
        studentPhone: att.studentPhone,
        batchName: att.batchName || "-",
        score: att.score,
        totalMarks: att.totalMarks,
        percentage: att.percentage,
        isPassed: att.isPassed,
        timeTakenSeconds: att.timeTakenSeconds,
        correctAnswersCount: att.correctAnswersCount,
        wrongAnswersCount: att.wrongAnswersCount,
        unansweredCount: att.unansweredCount,
        submittedAt: att.submittedAt,
        answers: att.answers,
      })),
    });
  } catch (error) {
    console.error("Error fetching test analytics:", error);
    res.status(500).json({ message: "Failed to fetch test analytics" });
  }
};

// -------------------------------------------------------------
// STUDENT ACTIONS
// -------------------------------------------------------------

export const getStudentTests = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student record not found" });
    }

    const instId = student.user || student.institute;
    const institute = await Institute.findById(instId);

    const isFeatureEnabled =
      institute?.testSeriesFeatureEnabled === true ||
      (Array.isArray(institute?.allowedFeatures) && institute.allowedFeatures.includes("test_series"));

    if (!isFeatureEnabled) {
      return res.json({
        enabled: false,
        testSeries: [],
        message: "Test Series feature is not enabled for your institute.",
      });
    }

    // Collect all batch IDs student is enrolled in
    const studentBatchIds = [];
    if (student.batch) studentBatchIds.push(String(student.batch));
    if (Array.isArray(student.batches)) student.batches.forEach((b) => studentBatchIds.push(String(b._id || b)));
    if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => studentBatchIds.push(String(b)));

    // Find enabled assignments for this institute where assignedBatches intersects student batches
    const accessRecords = await InstituteTestSeriesAccess.find({
      institute: instId,
      isEnabled: true,
    });

    const matchingTestIds = accessRecords
      .filter((acc) => {
        if (!acc.assignedBatches || acc.assignedBatches.length === 0) return true; // all batches if empty
        return acc.assignedBatches.some((bId) => studentBatchIds.includes(String(bId)));
      })
      .map((acc) => acc.testSeries);

    const tests = await TestSeries.find({
      _id: { $in: matchingTestIds },
      isPublished: true,
    }).select("title description category folderPath durationMinutes totalMarks passingMarks instructions questions");

    // Fetch student's prior attempts
    const attempts = await TestSeriesAttempt.find({
      student: student._id,
      testSeries: { $in: matchingTestIds },
    });

    const attemptMap = new Map();
    attempts.forEach((att) => {
      const existing = attemptMap.get(String(att.testSeries));
      if (!existing || new Date(att.submittedAt) > new Date(existing.submittedAt)) {
        attemptMap.set(String(att.testSeries), att);
      }
    });

    const result = tests.map((t) => {
      const att = attemptMap.get(String(t._id));
      return {
        id: t._id,
        title: t.title,
        description: t.description,
        category: t.category,
        folderPath: t.folderPath,
        durationMinutes: t.durationMinutes,
        totalMarks: t.totalMarks,
        passingMarks: t.passingMarks,
        questionsCount: t.questions?.length || 0,
        instructions: t.instructions,
        hasAttempted: Boolean(att),
        latestAttempt: att
          ? {
              attemptId: att._id,
              score: att.score,
              totalMarks: att.totalMarks,
              percentage: att.percentage,
              isPassed: att.isPassed,
              timeTakenSeconds: att.timeTakenSeconds,
              submittedAt: att.submittedAt,
            }
          : null,
      };
    });

    res.json({
      enabled: true,
      testSeries: result,
    });
  } catch (error) {
    console.error("Error fetching student test series:", error);
    res.status(500).json({ message: "Failed to fetch student tests" });
  }
};

export const startStudentTest = async (req, res) => {
  try {
    const { id } = req.params; // testSeriesId
    const studentId = req.student?._id || req.user?._id;
    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const test = await TestSeries.findById(id);
    if (!test || !test.isPublished) {
      return res.status(404).json({ message: "Test series not found or unavailable" });
    }

    // Sanitize questions: strip answers & explanations
    const safeQuestions = sanitizeQuestionsForStudent(test.questions);

    res.json({
      testSeries: {
        id: test._id,
        title: test.title,
        description: test.description,
        category: test.category,
        folderPath: test.folderPath,
        durationMinutes: test.durationMinutes,
        totalMarks: test.totalMarks,
        passingMarks: test.passingMarks,
        instructions: test.instructions,
        questionsCount: safeQuestions.length,
        questions: safeQuestions,
      },
    });
  } catch (error) {
    console.error("Error starting student test:", error);
    res.status(500).json({ message: "Failed to start test" });
  }
};

export const submitStudentTest = async (req, res) => {
  try {
    const { id } = req.params; // testSeriesId
    const { timeTakenSeconds, answers = [] } = req.body;
    const studentId = req.student?._id || req.user?._id;

    const student = await Student.findById(studentId).populate("batch", "name");
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const test = await TestSeries.findById(id);
    if (!test) {
      return res.status(404).json({ message: "Test series not found" });
    }

    const instId = student.user || student.institute;
    let batchName = student.batch?.name || "";
    if (!batchName && student.batch) {
      const bDoc = await Batch.findById(student.batch);
      batchName = bDoc?.name || "";
    }

    // Build answer map from submission
    const submittedAnswerMap = new Map();
    answers.forEach((ans) => {
      const selected = Array.isArray(ans.selectedAnswers)
        ? ans.selectedAnswers
        : ans.selectedAnswer !== undefined
        ? [ans.selectedAnswer]
        : [];
      submittedAnswerMap.set(String(ans.questionId), selected);
    });

    let totalScore = 0;
    let correctCount = 0;
    let wrongCount = 0;
    let unansweredCount = 0;

    const evaluatedAnswers = test.questions.map((q) => {
      const submitted = submittedAnswerMap.get(String(q.id)) || [];
      const isUnanswered = submitted.length === 0;

      let isCorrect = false;
      let marksObtained = 0;

      if (isUnanswered) {
        unansweredCount++;
        marksObtained = 0;
      } else {
        const correctSet = new Set(q.correctAnswers.map((a) => String(a).trim()));
        const submittedSet = new Set(submitted.map((a) => String(a).trim()));

        if (q.type === "multiple_choice") {
          // Exactly matching set of answers
          isCorrect =
            correctSet.size === submittedSet.size &&
            [...correctSet].every((val) => submittedSet.has(val));
        } else {
          // single_choice, boolean, image_based
          isCorrect = submitted.length === 1 && correctSet.has(String(submitted[0]).trim());
        }

        if (isCorrect) {
          correctCount++;
          marksObtained = q.marks;
        } else {
          wrongCount++;
          marksObtained = -Math.abs(q.negativeMarks || 0);
        }
      }

      totalScore += marksObtained;

      return {
        questionId: q.id,
        selectedAnswers: submitted,
        isCorrect,
        marksObtained,
        // Detailed feedback for immediate review
        question: q.question,
        questionImageUrl: q.questionImageUrl || "",
        type: q.type,
        options: q.options,
        correctAnswers: q.correctAnswers,
        explanation: q.explanation,
        marks: q.marks,
        negativeMarks: q.negativeMarks,
      };
    });

    const totalPossibleMarks = test.totalMarks || 100;
    const finalScore = Math.max(0, totalScore);
    const percentage =
      totalPossibleMarks > 0
        ? Number(((finalScore / totalPossibleMarks) * 100).toFixed(1))
        : 0;
    const isPassed = finalScore >= (test.passingMarks || 0);

    const attempt = await TestSeriesAttempt.create({
      testSeries: test._id,
      student: student._id,
      studentName: student.name || "Student",
      studentEmail: student.email || "",
      studentPhone: student.phone || student.contactNumber || "",
      institute: instId,
      batch: student.batch?._id || student.batch || null,
      batchName,
      startedAt: new Date(Date.now() - (Number(timeTakenSeconds) || 0) * 1000),
      submittedAt: new Date(),
      timeTakenSeconds: Number(timeTakenSeconds) || 0,
      totalQuestions: test.questions.length,
      attemptedQuestions: correctCount + wrongCount,
      correctAnswersCount: correctCount,
      wrongAnswersCount: wrongCount,
      unansweredCount,
      score: finalScore,
      totalMarks: totalPossibleMarks,
      percentage,
      isPassed,
      answers: evaluatedAnswers.map((ea) => ({
        questionId: ea.questionId,
        selectedAnswers: ea.selectedAnswers,
        isCorrect: ea.isCorrect,
        marksObtained: ea.marksObtained,
      })),
    });

    res.json({
      message: "Test submitted successfully",
      result: {
        attemptId: attempt._id,
        testTitle: test.title,
        score: finalScore,
        totalMarks: totalPossibleMarks,
        passingMarks: test.passingMarks,
        percentage,
        isPassed,
        timeTakenSeconds: Number(timeTakenSeconds) || 0,
        totalQuestions: test.questions.length,
        correctAnswersCount: correctCount,
        wrongAnswersCount: wrongCount,
        unansweredCount,
        accuracy:
          correctCount + wrongCount > 0
            ? Number(((correctCount / (correctCount + wrongCount)) * 100).toFixed(1))
            : 0,
        review: evaluatedAnswers,
      },
    });
  } catch (error) {
    console.error("Error submitting student test:", error);
    res.status(500).json({ message: "Failed to submit test" });
  }
};

export const getStudentAttemptResult = async (req, res) => {
  try {
    const { attemptId } = req.params;
    const attempt = await TestSeriesAttempt.findById(attemptId);
    if (!attempt) {
      return res.status(404).json({ message: "Attempt not found" });
    }

    const test = await TestSeries.findById(attempt.testSeries);
    if (!test) {
      return res.status(404).json({ message: "Test series not found" });
    }

    const questionMap = new Map();
    test.questions.forEach((q) => questionMap.set(String(q.id), q));

    const review = (attempt.answers || []).map((ans) => {
      const q = questionMap.get(String(ans.questionId)) || {};
      return {
        questionId: ans.questionId,
        selectedAnswers: ans.selectedAnswers,
        isCorrect: ans.isCorrect,
        marksObtained: ans.marksObtained,
        question: q.question || "",
        questionImageUrl: q.questionImageUrl || "",
        type: q.type || "single_choice",
        options: q.options || [],
        correctAnswers: q.correctAnswers || [],
        explanation: q.explanation || "",
        marks: q.marks || 0,
        negativeMarks: q.negativeMarks || 0,
      };
    });

    res.json({
      attempt: {
        attemptId: attempt._id,
        testTitle: test.title,
        score: attempt.score,
        totalMarks: attempt.totalMarks,
        passingMarks: test.passingMarks,
        percentage: attempt.percentage,
        isPassed: attempt.isPassed,
        timeTakenSeconds: attempt.timeTakenSeconds,
        totalQuestions: attempt.totalQuestions,
        correctAnswersCount: attempt.correctAnswersCount,
        wrongAnswersCount: attempt.wrongAnswersCount,
        unansweredCount: attempt.unansweredCount,
        submittedAt: attempt.submittedAt,
        review,
      },
    });
  } catch (error) {
    console.error("Error fetching student attempt result:", error);
    res.status(500).json({ message: "Failed to fetch attempt result" });
  }
};
