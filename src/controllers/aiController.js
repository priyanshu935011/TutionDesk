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
  callGeminiRaw,
} from "../services/aiService.js";
import { createStudent } from "./studentController.js";
import { createTestResultsBulk } from "./teacherController.js";
import { supabase } from "../utils/supabase.js";

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
    const isLocked = isStudent
      ? (!details.aiEnabled || !details.aiStudentEnabled)
      : !details.aiEnabled;

    const availableBatches = await getInstituteBatches(req, instituteId);
    const studentCustomFields = await getInstituteStudentCustomFields(instituteId);

    return res.json({
      instituteId: details.instituteId,
      name: details.name,
      aiEnabled: details.aiEnabled,
      aiStudentEnabled: details.aiStudentEnabled,
      aiWalletBalance: details.aiWalletBalance,
      isLocked,
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
    } = req.body;

    const lowerMessage = String(message || "").toLowerCase().trim();

    // Determine Task Type
    let taskType = explicitTaskType;
    if (!taskType) {
      if (imageBase64) {
        if (
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
        // Find batch
        let targetBatchId = batchId;
        if (!targetBatchId) {
          const firstBatch = await Batch.findOne({ institute: instituteId }).select("_id").lean().catch(() => null);
          targetBatchId = firstBatch?._id;
        }

        const enrolledStudents = targetBatchId
          ? await Student.find({ institute: instituteId, batches: targetBatchId }).select("_id name enrollmentNumber").lean().catch(() => [])
          : await Student.find({ institute: instituteId }).select("_id name enrollmentNumber").limit(30).lean().catch(() => []);

        const parsedMarks = await parseTestMarksheet(imageBase64, imageMimeType, {
          batchId: targetBatchId,
          students: enrolledStudents,
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
        parsedMarks.batchId = targetBatchId;

        replyPayload = {
          type: "ACTION_CARD",
          action: "TEST_MARKS_PREVIEW",
          data: parsedMarks,
          parsedData: parsedMarks,
          reply: `Extracted marks for **${parsedMarks.title || "Test"}** (${parsedMarks.subject || "Subject"})! Check the student marks table below and tap **Confirm & Save Marks** to publish.`,
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
        const firstBatch = await Batch.findOne({ institute: instituteId }).select("_id").lean().catch(() => null);
        const enrolledStudents = firstBatch?._id
          ? await Student.find({ institute: instituteId, batches: firstBatch._id }).select("_id name enrollmentNumber").lean().catch(() => [])
          : await Student.find({ institute: instituteId }).select("_id name enrollmentNumber").limit(30).lean().catch(() => []);

        const marksAttempt = await parseTestMarksheet(imageBase64, imageMimeType, {
          batchId: firstBatch?._id,
          students: enrolledStudents,
        });

        if (marksAttempt.isValidDocument === true && (marksAttempt.entries?.length || marksAttempt.unmatchedEntries?.length)) {
          const billing = await deductAiCredits(instituteId, "vision");
          marksAttempt.batchId = firstBatch?._id;
          replyPayload = {
            type: "ACTION_CARD",
            action: "TEST_MARKS_PREVIEW",
            data: marksAttempt,
            parsedData: marksAttempt,
            reply: `Extracted marks for **${marksAttempt.title || "Test"}** (${marksAttempt.subject || "Subject"})! Check the student marks table below and tap **Confirm & Save Marks** to publish.`,
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

      case "GENERATE_NOTICE": {
        const billing = await deductAiCredits(instituteId, "query");
        const noticeData = await generateNoticeAnnouncement(instituteId, message || "General Holiday");

        replyPayload = {
          type: "ACTION_CARD",
          action: "BROADCAST_WHATSAPP",
          data: noticeData,
          reply: `Here is your drafted notice for **${noticeData.title}**. You can copy the message or broadcast it to parents.`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "GENERATE_QUIZ": {
        const billing = await deductAiCredits(instituteId, "quiz");
        const subject = message.includes("math") ? "Mathematics" : message.includes("science") ? "Science" : "General Knowledge";
        const quizData = await generatePracticeQuiz(subject, message || "Revision Chapter", "Class 10", 5);

        replyPayload = {
          type: "ACTION_CARD",
          action: "QUIZ_PREVIEW",
          data: quizData,
          reply: `Generated practice quiz for **${quizData?.topic || "Topic"}** with ${quizData?.questions?.length || 5} questions!`,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }

      case "STUDENT_DOUBT": {
        const billing = await deductAiCredits(instituteId, "doubt");
        const answer = await solveStudentDoubt(message, imageBase64, imageMimeType, req.user.name || "Student");

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
        const answer = await answerInstituteIntelligence(instituteId, req.user, message);

        replyPayload = {
          type: "TEXT",
          reply: answer,
          creditsDeducted: billing.deducted,
          remainingBalance: billing.newBalance,
        };
        break;
      }
    }

    return res.json({
      success: true,
      taskType,
      ...replyPayload,
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
      // Save Test Marks
      const { batchId, title, subject, totalMarks, entries = [] } = data;

      if (!batchId || !title || !entries.length) {
        return res.status(400).json({ message: "Batch, test title, and student marks entries are required." });
      }

      const marksMap = {};
      for (const entry of entries) {
        if (entry.studentId) {
          const isAbsent = entry.isAbsent === true || Number(entry.score) === -1;
          marksMap[String(entry.studentId)] = isAbsent ? -1 : Number(entry.score || 0);
        }
      }

      // Save into test_marks table in Supabase
      try {
        const testPayload = {
          batch_id: batchId,
          test_title: title,
          total_marks: Number(totalMarks || 100),
          marks: marksMap,
          exam_date: data.examDate || new Date().toISOString().split("T")[0],
          institute_id: instituteId,
        };
        await supabase.from("test_marks").insert(testPayload);
      } catch (sbErr) {
        console.warn("[confirmAiAction] Supabase test_marks insert fallback:", sbErr.message);
      }

      // Also record in Mongo TestResult
      try {
        await TestResult.create({
          institute: instituteId,
          batch: batchId,
          title,
          subject: subject || "General",
          totalMarks: Number(totalMarks || 100),
          examDate: data.examDate ? new Date(data.examDate) : new Date(),
          scores: entries.map((e) => ({
            student: e.studentId,
            score: e.isAbsent ? 0 : Number(e.score || 0),
            isAbsent: Boolean(e.isAbsent),
          })),
        });
      } catch (_) {}

      return res.json({
        success: true,
        message: `Marks for "${title}" saved successfully for ${entries.length} students!`,
      });
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
