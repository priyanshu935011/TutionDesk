import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import TestResult from "../models/TestResult.js";
import {
  getInstituteAiDetails,
  deductAiCredits,
  parseAdmissionForm,
  parseTestMarksheet,
  answerInstituteIntelligence,
  generateNoticeAnnouncement,
  generatePracticeQuiz,
  solveStudentDoubt,
  generateStructuredNotes,
  generateComprehensiveTestSeries,
  generateAssignment,
  callGeminiRaw,
} from "../services/aiService.js";
import { createStudent } from "./studentController.js";
import { createTestResultsBulk } from "./teacherController.js";
import { supabase } from "../utils/supabase.js";
import { logAiHarvest } from "../utils/aiHarvestLogger.js";

// Helper to get clean institute ID from req.user
function getInstituteIdFromReq(req) {
  if (!req.user) return null;
  const rawInst = req.user.institute;
  if (rawInst?._id) return String(rawInst._id);
  if (rawInst) return String(rawInst);
  return String(req.user._id);
}

// Helper to get active batches for an institute
async function getInstituteBatches(req, instituteId) {
  try {
    const inst = await Institute.findById(instituteId).lean().catch(() => null);
    const userIds = [
      instituteId,
      inst?.adminUser,
      req?.user?._id,
      req?.user?.institute?._id,
      req?.user?.institute?.adminUser,
    ].filter(Boolean);

    const batches = await Batch.find({
      $or: [
        { user: { $in: userIds } },
        { institute: instituteId },
      ],
      status: { $ne: "archived" },
    }).select("_id name").lean().catch(() => []);

    return batches.map((b) => ({
      _id: String(b._id || b.id),
      id: String(b._id || b.id),
      name: b.name || "Batch",
    }));
  } catch (err) {
    console.warn("getInstituteBatches error:", err.message);
    return [];
  }
}

// Helper to get active student custom fields for an institute
async function getInstituteStudentCustomFields(instituteId) {
  try {
    const inst = await Institute.findById(instituteId).select("studentCustomFields").lean().catch(() => null);
    return Array.isArray(inst?.studentCustomFields) ? inst.studentCustomFields : [];
  } catch (err) {
    console.warn("getInstituteStudentCustomFields error:", err.message);
    return [];
  }
}

// Helper to get active students for an institute with their batches
async function getInstituteStudents(req, instituteId) {
  try {
    const inst = await Institute.findById(instituteId).lean().catch(() => null);
    const userIds = [
      instituteId,
      inst?.adminUser,
      req?.user?._id,
      req?.user?.institute?._id,
      req?.user?.institute?.adminUser,
    ].filter(Boolean);

    const students = await Student.find({
      $or: [
        { user: { $in: userIds } },
        { institute: instituteId },
      ],
      status: { $ne: "archived" },
      isArchived: { $ne: true },
    })
      .select("_id name enrollmentNumber rollNumber batch batches phone")
      .lean()
      .catch(() => []);

    return students.map((s) => ({
      _id: String(s._id || s.id),
      id: String(s._id || s.id),
      name: s.name || "Student",
      enrollmentNumber: s.enrollmentNumber || s.rollNumber || "",
      batchId: s.batch ? String(s.batch._id || s.batch) : (Array.isArray(s.batches) && s.batches[0] ? String(s.batches[0]._id || s.batches[0]) : null),
      batchIds: Array.from(new Set([
        ...(s.batch ? [String(s.batch._id || s.batch)] : []),
        ...(Array.isArray(s.batches) ? s.batches.map((b) => String(b._id || b)) : []),
      ])),
    }));
  } catch (err) {
    console.warn("getInstituteStudents error:", err.message);
    return [];
  }
}

// Helper to match marksheet rows to institute students and filter to majority batch
function processMarksheetBatchMatching(parsedMarks, allStudents = [], availableBatches = [], requestedBatchId = null) {
  const rawList = [
    ...(Array.isArray(parsedMarks.entries) ? parsedMarks.entries : []),
    ...(Array.isArray(parsedMarks.unmatchedEntries) ? parsedMarks.unmatchedEntries : []),
  ];

  const normalize = (str) =>
    String(str || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .trim();

  // Match each row from the marksheet to a student in DB
  const matchedEntries = [];
  for (const item of rawList) {
    const rawName = item.studentName || item.detectedName || item.name || "";
    const normName = normalize(rawName);
    const rawRoll = normalize(item.rollNumber || item.roll || item.enrollmentNumber);
    const rawId = item.studentId || item.id || item._id;

    let matchedStudent = null;

    if (rawId && rawId !== "matched_student_id" && rawId !== "matched_student_id_or_null" && rawId !== "null") {
      matchedStudent = allStudents.find((s) => String(s._id || s.id) === String(rawId));
    }
    if (!matchedStudent && normName) {
      matchedStudent = allStudents.find((s) => normalize(s.name) === normName);
    }
    if (!matchedStudent && rawRoll) {
      matchedStudent = allStudents.find((s) => {
        const sRoll = normalize(s.enrollmentNumber || s.rollNumber);
        return sRoll && sRoll === rawRoll;
      });
    }
    if (!matchedStudent && normName.length >= 3) {
      const candidates = allStudents.filter((s) => {
        const sNorm = normalize(s.name);
        return sNorm.includes(normName) || normName.includes(sNorm);
      });
      if (candidates.length === 1) {
        matchedStudent = candidates[0];
      }
    }

    const isAbsent = Boolean(
      item.isAbsent ||
      String(item.score).toLowerCase() === "absent" ||
      String(item.score).toLowerCase() === "a" ||
      Number(item.score) === -1
    );
    const scoreVal = isAbsent ? 0 : Math.max(0, Number(item.score || 0));

    matchedEntries.push({
      studentId: matchedStudent ? String(matchedStudent._id || matchedStudent.id) : null,
      studentName: matchedStudent ? matchedStudent.name : (rawName || "Student"),
      enrollmentNumber: matchedStudent ? (matchedStudent.enrollmentNumber || "") : (item.rollNumber || ""),
      matchedStudent,
      score: scoreVal,
      isAbsent,
      remarks: item.remarks || "",
    });
  }

  // Tally batch occurrences for matched students
  const batchCounts = {};
  for (const entry of matchedEntries) {
    if (entry.matchedStudent) {
      const bIds = entry.matchedStudent.batchIds || [];
      for (const bId of bIds) {
        if (bId) {
          batchCounts[bId] = (batchCounts[bId] || 0) + 1;
        }
      }
    }
  }

  // Determine majority batch
  let majorityBatchId = null;
  let maxCount = -1;

  if (requestedBatchId && availableBatches.some((b) => String(b._id || b.id) === String(requestedBatchId))) {
    majorityBatchId = String(requestedBatchId);
  } else {
    for (const [bId, count] of Object.entries(batchCounts)) {
      if (count > maxCount) {
        maxCount = count;
        majorityBatchId = bId;
      }
    }
  }

  if (!majorityBatchId && availableBatches.length > 0) {
    majorityBatchId = String(availableBatches[0]._id || availableBatches[0].id);
  }

  const majorityBatchObj = availableBatches.find((b) => String(b._id || b.id) === String(majorityBatchId));
  const majorityBatchName = majorityBatchObj?.name || "Batch";

  // Filter: ONLY students belonging to majority batch are kept!
  // "see majority of the students belong to which batch and show that batch students name only , other student marks wont be added"
  const majorityBatchStudents = allStudents.filter((s) => {
    const bIds = s.batchIds || [];
    return bIds.some((id) => String(id) === String(majorityBatchId));
  });

  const finalEntries = [];
  const processedStudentIds = new Set();

  for (const entry of matchedEntries) {
    if (entry.matchedStudent) {
      const s = entry.matchedStudent;
      const sId = String(s._id || s.id);
      const belongsToMajority = (s.batchIds || []).some((id) => String(id) === String(majorityBatchId));

      if (belongsToMajority && !processedStudentIds.has(sId)) {
        processedStudentIds.add(sId);
        finalEntries.push({
          studentId: sId,
          studentName: s.name,
          enrollmentNumber: s.enrollmentNumber || "",
          score: entry.score,
          isAbsent: entry.isAbsent,
          remarks: entry.remarks || "",
        });
      }
      // Note: Students matching other batches are intentionally excluded:
      // other student marks won't be added!
    }
  }

  // Include any other students enrolled in majority batch who were not on the sheet as Absent
  for (const s of majorityBatchStudents) {
    const sId = String(s._id || s.id);
    if (!processedStudentIds.has(sId)) {
      processedStudentIds.add(sId);
      finalEntries.push({
        studentId: sId,
        studentName: s.name,
        enrollmentNumber: s.enrollmentNumber || "",
        score: 0,
        isAbsent: true,
        remarks: "Absent",
      });
    }
  }

  return {
    majorityBatchId,
    majorityBatchName,
    majorityBatchStudents,
    finalEntries,
  };
}

// 1. Get Live AI Status & Wallet Balance
export const getAiStatus = async (req, res) => {
  try {
    const instituteId = getInstituteIdFromReq(req);
    if (!instituteId) {
      return res.status(400).json({ message: "Institute ID not found in token." });
    }

    const details = await getInstituteAiDetails(instituteId);
    if (!details) {
      return res.status(404).json({ message: "Institute not found." });
    }

    // Role-based locked check
    const isStudent = req.user.role === "student";
    const isTeacher = req.user.role === "teacher";
    const teacherAiDisabled = isTeacher && req.user.aiAccessEnabled === false;
    const isLocked = isStudent
      ? (!details.aiEnabled || !details.aiStudentEnabled)
      : (teacherAiDisabled || !details.aiEnabled);

    const availableBatches = await getInstituteBatches(req, instituteId);
    const studentCustomFields = await getInstituteStudentCustomFields(instituteId);

    return res.json({
      instituteId: details.instituteId,
      name: details.name,
      aiEnabled: details.aiEnabled,
      aiStudentEnabled: details.aiStudentEnabled,
      aiWalletBalance: details.aiWalletBalance,
      aiCreditsPerRupee: details.aiCreditsPerRupee,
      aiWalletCredits: details.aiWalletCredits,
      aiCredits: details.aiWalletCredits,
      isLocked,
      teacherAiDisabled,
      aiAccessEnabled: req.user.aiAccessEnabled !== false,
      rates: details.rates,
      userRole: req.user.role,
      batches: availableBatches,
      studentCustomFields,
    });
  } catch (error) {
    console.error("getAiStatus error:", error);
    return res.status(500).json({ message: "Could not fetch AI status." });
  }
};

// 2. Main Conversational AI Chat & Action Dispatcher
export const chatWithAi = async (req, res) => {
  try {
    const instituteId = getInstituteIdFromReq(req);
    if (!instituteId) {
      return res.status(400).json({ message: "Institute ID required." });
    }

    const details = await getInstituteAiDetails(instituteId);
    if (!details) {
      return res.status(404).json({ message: "Institute not found." });
    }

    const isStudent = req.user.role === "student";

    if (req.user.role === "teacher" && req.user.aiAccessEnabled === false) {
      return res.status(403).json({
        message: "AI access has been disabled for your teacher account by the institute admin.",
        code: "TEACHER_AI_DISABLED",
        isLocked: true,
      });
    }

    // Locked check
    if (!details.aiEnabled) {
      return res.status(403).json({
        message: "AI Assistant is currently locked for this institute by Super Admin.",
        code: "AI_LOCKED",
      });
    }

    if (isStudent && !details.aiStudentEnabled) {
      return res.status(403).json({
        message: "AI Tutor has not been activated for students by your institute.",
        code: "STUDENT_AI_LOCKED",
      });
    }

    const {
      message = "",
      imageBase64 = null,
      imageMimeType = "image/jpeg",
      taskType: explicitTaskType = null,
      batchId = null,
      history = [],
    } = req.body;

    const lowerMessage = String(message || "").toLowerCase().trim();

    // Determine Task Type
    let taskType = explicitTaskType;
    if (!taskType) {
      if (imageBase64) {
        if (
          lowerMessage.includes("assignment") ||
          lowerMessage.includes("homework") ||
          lowerMessage.includes("worksheet")
        ) {
          taskType = "GENERATE_ASSIGNMENT";
        } else if (
          lowerMessage.includes("mark") ||
          lowerMessage.includes("score") ||
          lowerMessage.includes("test") ||
          lowerMessage.includes("result")
        ) {
          taskType = "MARKS_OCR";
        } else if (isStudent) {
          taskType = "STUDENT_DOUBT";
        } else if (
          lowerMessage.includes("admission") ||
          lowerMessage.includes("student") ||
          lowerMessage.includes("enroll") ||
          lowerMessage.includes("form")
        ) {
          taskType = "ADMISSION_FORM_OCR";
        } else {
          taskType = "GENERAL_IMAGE_OCR";
        }
      } else if (isStudent) {
        taskType = "STUDENT_DOUBT";
      } else if (
        lowerMessage.includes("test series") ||
        lowerMessage.includes("mock test")
      ) {
        taskType = "GENERATE_TEST_SERIES";
      } else if (
        lowerMessage.includes("generate notes") ||
        lowerMessage.includes("create notes") ||
        lowerMessage.includes("study notes") ||
        lowerMessage.includes("revision notes") ||
        lowerMessage.startsWith("notes on")
      ) {
        taskType = "GENERATE_NOTES";
      } else if (
        lowerMessage.includes("generate assignment") ||
        lowerMessage.includes("create assignment") ||
        lowerMessage.includes("homework assignment")
      ) {
        taskType = "GENERATE_ASSIGNMENT";
      } else if (
        lowerMessage.includes("notice") ||
        lowerMessage.includes("announcement") ||
        lowerMessage.includes("holiday") ||
        lowerMessage.includes("broadcast")
      ) {
        taskType = "GENERATE_NOTICE";
      } else if (
        lowerMessage.includes("quiz") ||
        lowerMessage.includes("mcq") ||
        lowerMessage.includes("question paper") ||
        lowerMessage.includes("test paper")
      ) {
        taskType = "GENERATE_QUIZ";
      } else {
        taskType = "QUERY";
      }
    }

    // Execute Task & Deduct Credits
    let replyPayload = {};

    switch (taskType) {
      case "ADMISSION_FORM_OCR": {
        const availableBatches = await getInstituteBatches(req, instituteId);
        const studentCustomFields = await getInstituteStudentCustomFields(instituteId);
        const parsedData = await parseAdmissionForm(imageBase64, imageMimeType, availableBatches, studentCustomFields);

        if (
          parsedData.isValidDocument === false ||
          parsedData.documentType === "invalid" ||
          (!parsedData.name && !parsedData.phone)
        ) {
          replyPayload = {
            type: "TEXT",
            reply:
              "⚠️ **Invalid Document**: The uploaded image does not appear to be an admission form. Please upload the correct document (such as a clear photo of a student admission or enrollment form).",
            isInvalidDocument: true,
            creditsDeducted: 0,
            remainingBalance: details.aiWalletBalance,
          };
          break;
        }

        const billing = await deductAiCredits(instituteId, "vision");
        const fullParsedData = {
          ...parsedData,
          availableBatches,
          studentCustomFields,
        };
        replyPayload = {
          type: "ACTION_CARD",
          action: "CREATE_STUDENT_PREVIEW",
          data: fullParsedData,
          parsedData: fullParsedData,
          reply: `I have scanned the admission form for **${parsedData.name || "New Student"}**! Please review the extracted details below and tap **Confirm & Add Student** to enroll them.`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "MARKS_OCR": {
        const availableBatches = await getInstituteBatches(req, instituteId);
        const allStudents = await getInstituteStudents(req, instituteId);

        const parsedMarks = await parseTestMarksheet(imageBase64, imageMimeType, {
          availableBatches,
          students: allStudents,
          batchId,
        });

        if (
          parsedMarks.isValidDocument === false ||
          parsedMarks.documentType === "invalid" ||
          (!parsedMarks.entries?.length && !parsedMarks.unmatchedEntries?.length)
        ) {
          replyPayload = {
            type: "TEXT",
            reply:
              "⚠️ **Invalid Document**: The uploaded image does not appear to be a test marksheet. Please upload the correct document (such as a clear photo of a marksheet or student scores table).",
            isInvalidDocument: true,
            creditsDeducted: 0,
            remainingBalance: details.aiWalletBalance,
          };
          break;
        }

        const billing = await deductAiCredits(instituteId, "vision");
        const processed = processMarksheetBatchMatching(parsedMarks, allStudents, availableBatches, batchId);

        const payloadData = {
          ...parsedMarks,
          title: parsedMarks.title || "Unit Test",
          subject: parsedMarks.subject || "General",
          totalMarks: Number(parsedMarks.totalMarks || 100),
          examDate: parsedMarks.examDate || new Date().toISOString().split("T")[0],
          batchId: processed.majorityBatchId,
          batchName: processed.majorityBatchName,
          availableBatches,
          allStudents,
          entries: processed.finalEntries,
          marks: processed.finalEntries,
        };

        replyPayload = {
          type: "ACTION_CARD",
          action: "TEST_MARKS_PREVIEW",
          data: payloadData,
          parsedData: payloadData,
          reply: `Extracted marks for **${payloadData.title}** (${payloadData.subject})! Detected Batch: **${payloadData.batchName}** (${processed.finalEntries.length} students). Review and edit scores below before saving.`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "GENERAL_IMAGE_OCR": {
        // Automatically check if image is an admission form, marksheet, or random image
        const availableBatches = await getInstituteBatches(req, instituteId);
        const studentCustomFields = await getInstituteStudentCustomFields(instituteId);
        const admissionAttempt = await parseAdmissionForm(imageBase64, imageMimeType, availableBatches, studentCustomFields);

        if (admissionAttempt.isValidDocument === true && (admissionAttempt.name || admissionAttempt.phone)) {
          const billing = await deductAiCredits(instituteId, "vision");
          const fullParsedData = {
            ...admissionAttempt,
            availableBatches,
            studentCustomFields,
          };
          replyPayload = {
            type: "ACTION_CARD",
            action: "CREATE_STUDENT_PREVIEW",
            data: fullParsedData,
            parsedData: fullParsedData,
            reply: `I have scanned the admission form for **${admissionAttempt.name || "New Student"}**! Please review the extracted details below and tap **Confirm & Add Student** to enroll them.`,
            creditsDeducted: billing.deducted,
            remainingBalance: billing.newBalance,
          };
          break;
        }

        // Try test marksheet
        const allStudents = await getInstituteStudents(req, instituteId);
        const marksAttempt = await parseTestMarksheet(imageBase64, imageMimeType, {
          availableBatches,
          students: allStudents,
          batchId,
        });

        if (marksAttempt.isValidDocument === true && (marksAttempt.entries?.length || marksAttempt.unmatchedEntries?.length)) {
          const billing = await deductAiCredits(instituteId, "vision");
          const processed = processMarksheetBatchMatching(marksAttempt, allStudents, availableBatches, batchId);

          const payloadData = {
            ...marksAttempt,
            title: marksAttempt.title || "Unit Test",
            subject: marksAttempt.subject || "General",
            totalMarks: Number(marksAttempt.totalMarks || 100),
            examDate: marksAttempt.examDate || new Date().toISOString().split("T")[0],
            batchId: processed.majorityBatchId,
            batchName: processed.majorityBatchName,
            availableBatches,
            allStudents,
            entries: processed.finalEntries,
            marks: processed.finalEntries,
          };

          replyPayload = {
            type: "ACTION_CARD",
            action: "TEST_MARKS_PREVIEW",
            data: payloadData,
            parsedData: payloadData,
            reply: `Extracted marks for **${payloadData.title}** (${payloadData.subject})! Detected Batch: **${payloadData.batchName}** (${processed.finalEntries.length} students). Review and edit scores below before saving.`,
            creditsDeducted: billing.deducted,
            remainingBalance: billing.newBalance,
          };
          break;
        }

        // Neither: Random image uploaded
        replyPayload = {
          type: "TEXT",
          reply:
            "⚠️ **Incorrect Document**: The uploaded image does not appear to be an admission form or a test marksheet. Please upload the correct document to proceed.",
          isInvalidDocument: true,
          creditsDeducted: 0,
          remainingBalance: details.aiWalletBalance,
        };
        break;
      }

      case "GENERATE_NOTES": {
        const billing = await deductAiCredits(instituteId, "query");
        const availableBatches = await getInstituteBatches(req, instituteId);
        const targetClass = req.body.targetClass || req.body.classLevel || "Class 10";
        const notesData = await generateStructuredNotes(message || "Revision Notes", targetClass, history);

        const payloadData = {
          ...notesData,
          availableBatches,
          batchId: batchId || (availableBatches[0]?._id || null),
          batchName: availableBatches[0]?.name || "All Batches",
        };

        replyPayload = {
          type: "ACTION_CARD",
          action: "NOTES_PREVIEW",
          data: payloadData,
          parsedData: payloadData,
          reply: notesData.notesText || `Generated comprehensive study notes for **${notesData.title}**!`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "GENERATE_TEST_SERIES": {
        const billing = await deductAiCredits(instituteId, "quiz");
        const topic = req.body.topic || message.replace(/generate|create|test series|mock test/gi, "").trim() || "Unit Test Series";
        const targetExam = req.body.targetExam || req.body.classLevel || "Class 10";
        const numQuestions = req.body.numQuestions || 10;
        const correctMarks = req.body.correctMarks || 4;
        const negativeMarks = req.body.negativeMarks || 1;
        const durationMinutes = req.body.durationMinutes || 30;
        const difficulty = req.body.difficulty || "Medium";

        const testSeriesData = await generateComprehensiveTestSeries({
          topic,
          targetExam,
          numQuestions,
          correctMarks,
          negativeMarks,
          durationMinutes,
          difficulty,
        }, history);

        replyPayload = {
          type: "ACTION_CARD",
          action: "TEST_SERIES_PREVIEW",
          data: testSeriesData,
          parsedData: testSeriesData,
          reply: `Generated official test series: **${testSeriesData.title}** (${testSeriesData.questions?.length || 0} Questions, ${testSeriesData.totalMarks || 40} Total Marks, ${testSeriesData.durationMinutes || 30} mins)! Preview or publish it directly below.`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "GENERATE_ASSIGNMENT": {
        const billing = await deductAiCredits(instituteId, imageBase64 ? "vision" : "query");
        const availableBatches = await getInstituteBatches(req, instituteId);
        let selectedBatchName = "Selected Batch";
        if (batchId) {
          const match = availableBatches.find(b => String(b._id || b.id) === String(batchId));
          if (match) selectedBatchName = match.name;
        } else if (availableBatches.length > 0) {
          selectedBatchName = availableBatches[0].name;
        }

        const topic = req.body.topic || message.replace(/generate|create|assignment|worksheet/gi, "").trim() || "Practice Assignment";
        const numQuestions = req.body.numQuestions || 10;
        const difficulty = req.body.difficulty || "Medium";

        const assignmentData = await generateAssignment({
          topic,
          numQuestions,
          difficulty,
          batchName: selectedBatchName,
          imageBase64,
          imageMimeType,
        }, history);

        const payloadData = {
          ...assignmentData,
          availableBatches,
          batchId: batchId || (availableBatches[0]?._id || null),
          batchName: selectedBatchName,
        };

        replyPayload = {
          type: "ACTION_CARD",
          action: "ASSIGNMENT_PREVIEW",
          data: payloadData,
          parsedData: payloadData,
          reply: assignmentData.assignmentText || `Generated homework assignment for **${assignmentData.title}** (${selectedBatchName})!`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "GENERATE_NOTICE": {
        const billing = await deductAiCredits(instituteId, "query");
        const noticeData = await generateNoticeAnnouncement(
          instituteId,
          message || "General Holiday",
          history,
        );

        // Suppress broadcast option: return clean message text with copy option
        replyPayload = {
          type: "TEXT",
          reply: `📢 **${noticeData.title || "Announcement"}**\n\n${noticeData.whatsappText || noticeData.content || ""}`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "GENERATE_QUIZ": {
        const billing = await deductAiCredits(instituteId, "quiz");
        const lower = message.toLowerCase();
        const numMatch = lower.match(/(\d+)\s*(?:questions|question|mcq|mcqs)/);
        const numQuestions = numMatch
          ? Math.min(20, Math.max(1, parseInt(numMatch[1], 10)))
          : 5;

        const quizData = await generatePracticeQuiz(
          message || "General Practice Quiz",
          null,
          "Class 10",
          numQuestions,
          history,
        );

        replyPayload = {
          type: "ACTION_CARD",
          action: "QUIZ_PREVIEW",
          data: quizData,
          parsedData: quizData,
          reply: `Generated practice quiz for **${quizData?.topic || quizData?.subject || "Practice Quiz"}** with ${quizData?.questions?.length || numQuestions} questions! Check the questions below.`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "STUDENT_DOUBT": {
        const billing = await deductAiCredits(instituteId, "doubt");
        const answer = await solveStudentDoubt(
          message,
          imageBase64,
          imageMimeType,
          req.user.name || "Student",
          history,
        );

        replyPayload = {
          type: "TEXT",
          reply: answer,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "QUERY":
      default: {
        const billing = await deductAiCredits(instituteId, "query");
        const answer = await answerInstituteIntelligence(
          instituteId,
          req.user,
          message,
          history,
        );

        replyPayload = {
          type: "TEXT",
          reply: answer,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }
    }

    // Harvest AI Interaction Log
    logAiHarvest({
      instituteId,
      user: req.user,
      taskType,
      prompt: message,
      response: replyPayload.reply,
      generatedContent: replyPayload.data || replyPayload.parsedData || null,
      metadata: {
        action: replyPayload.action || null,
        responseType: replyPayload.type || "TEXT",
        hasImage: Boolean(imageBase64),
        imageMimeType: imageBase64 ? imageMimeType : null,
        batchId: batchId || null,
        topic: req.body.topic || null,
        targetClass: req.body.targetClass || req.body.classLevel || null,
        targetExam: req.body.targetExam || null,
        numQuestions: req.body.numQuestions || null,
        difficulty: req.body.difficulty || null,
        durationMinutes: req.body.durationMinutes || null,
        historyLength: Array.isArray(history) ? history.length : 0,
      },
      creditsDeducted: replyPayload.creditsDeducted || 0,
    }).catch(() => null);

    const remainingBal = replyPayload.remainingBalance !== undefined ? replyPayload.remainingBalance : details.aiWalletBalance;
    const creditsPerRupee = Number(details.aiCreditsPerRupee || 10);
    const remainingCredits = Math.round(remainingBal * creditsPerRupee);

    return res.json({
      success: true,
      taskType,
      ...replyPayload,
      remainingCredits,
      aiCreditsPerRupee: creditsPerRupee,
    });
  } catch (error) {
    console.error("chatWithAi error:", error);
    const status = (error.status && error.status !== 404) ? error.status : 502;
    return res.status(status).json({
      message: error.message || "AI request failed.",
      code: error.code || "AI_ERROR",
      currentBalance: error.currentBalance,
      requiredCost: error.requiredCost,
    });
  }
};

// 3. Confirm & Execute Interactive Action Card
export const confirmAiAction = async (req, res) => {
  try {
    const instituteId = getInstituteIdFromReq(req);
    const actionType = req.body.actionType || req.body.action;
    const data = req.body.data;

    if (!actionType || !data) {
      return res.status(400).json({ message: "Action type and payload data are required." });
    }

    if (actionType === "CREATE_STUDENT_PREVIEW" || actionType === "add_student") {
      const {
        name,
        phone,
        parentName = "",
        parentPhone = "",
        email = "",
        address = "",
        batchId,
        batches,
        feePlanType = "monthly",
        totalFees = 0,
        paidAmount = 0,
        paidFees,
        feeStatus,
        dueDate = "",
        joinedOn,
        customFields = {},
      } = data;

      if (!name || !phone) {
        return res.status(400).json({ message: "Student Name and Phone number are required." });
      }

      // Check or resolve batch
      let targetBatch = batchId || (Array.isArray(batches) && batches.length > 0 ? batches[0] : null);
      if (!targetBatch) {
        const availableBatches = await getInstituteBatches(req, instituteId);
        targetBatch = availableBatches[0]?._id;
      }

      if (!targetBatch) {
        return res.status(400).json({ message: "No batch available to assign student. Please create a batch first." });
      }

      req.body = {
        name: String(name).trim(),
        phone: String(phone).trim(),
        parentName: String(parentName || "").trim(),
        parentPhone: String(parentPhone || "").trim(),
        email: String(email || "").trim(),
        address: String(address || "").trim(),
        batch: String(targetBatch),
        batches: [String(targetBatch)],
        joinedOn: joinedOn || new Date(),
        totalFees: Number(totalFees || 0),
        paidFees: Number(paidFees ?? paidAmount ?? 0),
        paidAmount: Number(paidAmount ?? paidFees ?? 0),
        feePlanType: feePlanType || "monthly",
        feeStatus: feeStatus || (Number(paidAmount ?? paidFees ?? 0) > 0 ? "paid" : "unpaid"),
        dueDate: dueDate || "",
        customFields: typeof customFields === "object" && customFields !== null ? customFields : {},
      };

      const originalRole = req.user?.role;
      if (req.user && req.user.role === "teacher") {
        req.user.role = "admin";
      }

      const originalJson = res.json.bind(res);
      let capturedStatus = 200;
      res.status = (code) => {
        capturedStatus = code;
        return res;
      };
      res.json = (body) => {
        if (req.user) req.user.role = originalRole;
        if (capturedStatus >= 200 && capturedStatus < 300) {
          return originalJson({
            success: true,
            message: `Student "${body?.name || name}" enrolled successfully!`,
            student: body,
          });
        }
        return originalJson(body);
      };

      return await createStudent(req, res);
    }

    if (actionType === "TEST_MARKS_PREVIEW" || actionType === "save_marks") {
      // Save Test Marks via createTestResultsBulk
      const rawEntries = Array.isArray(data.entries) ? data.entries : (Array.isArray(data.marks) ? data.marks : []);
      const resolvedTitle = (data.title || data.testName || "Unit Test").trim();
      const resolvedSubject = (data.subject || "General").trim();
      const resolvedDate = data.examDate || new Date().toISOString().split("T")[0];
      const resolvedTotal = Number(data.totalMarks || 100);
      const batchId = data.batchId;

      if (!batchId || !resolvedTitle || !rawEntries.length) {
        return res.status(400).json({ message: "Batch, test title, and student marks entries are required." });
      }

      req.body = {
        batchId,
        title: resolvedTitle,
        subject: resolvedSubject,
        examDate: resolvedDate,
        totalMarks: resolvedTotal,
        entries: rawEntries.map((e) => {
          const isAbsent = Boolean(
            e.isAbsent === true ||
            Number(e.score) === -1 ||
            String(e.score).toLowerCase() === "absent" ||
            String(e.score).toLowerCase() === "a"
          );
          return {
            studentId: e.studentId || e.id || e._id,
            score: isAbsent ? -1 : Number(e.score ?? 0),
            isAbsent,
            remarks: e.remarks || "",
          };
        }),
      };

      const originalRole = req.user?.role;
      if (req.user && req.user.role === "teacher") {
        req.user.role = "admin";
      }

      const originalJson = res.json.bind(res);
      let capturedStatus = 200;
      res.status = (code) => {
        capturedStatus = code;
        return res;
      };
      res.json = (body) => {
        if (req.user) req.user.role = originalRole;
        if (capturedStatus >= 200 && capturedStatus < 300) {
          return originalJson({
            success: true,
            message: `Marks for "${resolvedTitle}" saved successfully for ${req.body.entries.length} students!`,
            ...body,
          });
        }
        return originalJson(body);
      };

      return await createTestResultsBulk(req, res);
    }

    if (actionType === "BROADCAST_WHATSAPP" || actionType === "notice_draft") {
      return res.json({
        success: true,
        message: "Notice broadcast initiated successfully!",
      });
    }

    return res.status(400).json({ message: "Unsupported action type." });
  } catch (error) {
    console.error("confirmAiAction error:", error);
    return res.status(500).json({ message: error.message || "Failed to confirm action." });
  }
};
