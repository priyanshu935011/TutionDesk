import axios from "axios";
import SystemSetting from "../models/SystemSetting.js";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Note from "../models/Note.js";
import Notice from "../models/Notice.js";
import TestResult from "../models/TestResult.js";
import { supabase } from "../utils/supabase.js";
import {
  getSupabaseInstituteRow,
  getInstituteWalletBalance,
} from "./whatsappService.js";
import {
  updateInstituteAiWalletBalanceMetadata,
  updateInstituteAiSettingsMetadata,
} from "../utils/supabaseModel.js";

// Safe JSON parser for LLM responses
export function extractJsonFromText(text) {
  if (!text) return null;
  const cleaned = text.trim();
  // Check for ```json ... ``` or ``` ... ```
  const jsonBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    try {
      return JSON.parse(jsonBlockMatch[1].trim());
    } catch (_) {}
  }
  // Try raw parse
  try {
    return JSON.parse(cleaned);
  } catch (_) {}
  // Try finding first { and last } or first [ and last ]
  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
    } catch (_) {}
  }
  const firstBracket = cleaned.indexOf("[");
  const lastBracket = cleaned.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
    } catch (_) {}
  }
  return null;
}

// 1. Fetch AI Global Settings
export async function getAiGlobalSettings() {
  let setting = await SystemSetting.findOne({ key: "ai_global_settings" });
  if (!setting || !setting.value) {
    const defaultSettings = {
      geminiApiKey: process.env.GEMINI_API_KEY || "",
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      provider: "gemini",
      model: "gemini-1.5-flash",
      rates: {
        query: 0.20,
        vision: 0.50,
        quiz: 0.40,
        doubt: 0.25,
      },
      defaultEnabled: false,
    };
    return defaultSettings;
  }
  return setting.value;
}

// 2. Fetch live Institute AI balance & settings
export async function getInstituteAiDetails(instituteId) {
  const instIdStr = String(instituteId || "").trim();
  if (!instIdStr) return null;

  let sbRow = null;
  try {
    sbRow = await getSupabaseInstituteRow(instIdStr);
  } catch (_) {}

  let mongoInst = null;
  try {
    mongoInst = await Institute.findById(instIdStr);
  } catch (_) {}
  if (!mongoInst) {
    try {
      mongoInst = await Institute.findOne({
        $or: [{ _id: instIdStr }, { id: instIdStr }, { adminUser: instIdStr }],
      });
    } catch (_) {}
  }

  const globalSettings = await getAiGlobalSettings();
  const defaultRates = globalSettings?.rates || {
    query: 0.20,
    vision: 0.50,
    quiz: 0.40,
    doubt: 0.25,
  };

  const aiEnabled = sbRow?.ai_enabled ?? mongoInst?.aiEnabled ?? false;
  const aiStudentEnabled = sbRow?.ai_student_enabled ?? mongoInst?.aiStudentEnabled ?? false;

  const rawBal = sbRow?.ai_wallet_balance ?? mongoInst?.aiWalletBalance ?? 0;
  const aiWalletBalance = Number(rawBal || 0);

  const rates = {
    query: Number(sbRow?.ai_query_rate ?? mongoInst?.aiQueryRate ?? defaultRates.query ?? 0.20),
    vision: Number(sbRow?.ai_vision_rate ?? mongoInst?.aiVisionRate ?? defaultRates.vision ?? 0.50),
    quiz: Number(sbRow?.ai_quiz_rate ?? mongoInst?.aiQuizRate ?? defaultRates.quiz ?? 0.40),
    doubt: Number(sbRow?.ai_doubt_rate ?? mongoInst?.aiDoubtRate ?? defaultRates.doubt ?? 0.25),
  };

  return {
    instituteId: instIdStr,
    name: mongoInst?.name || sbRow?.name || "Tuition",
    aiEnabled: Boolean(aiEnabled),
    aiStudentEnabled: Boolean(aiStudentEnabled),
    aiWalletBalance,
    rates,
    mongoInst,
    sbRow,
  };
}

// 3. Atomically Deduct AI Credits
export async function deductAiCredits(instituteId, taskType, customCost = null) {
  const details = await getInstituteAiDetails(instituteId);
  if (!details) {
    throw new Error("Institute not found for AI billing");
  }

  if (!details.aiEnabled) {
    const error = new Error("AI feature is locked for this institution. Please contact Super Admin.");
    error.status = 403;
    error.code = "AI_LOCKED";
    throw error;
  }

  const cost = customCost !== null ? Number(customCost) : (details.rates[taskType] || details.rates.query || 0.20);

  if (details.aiWalletBalance < cost) {
    const error = new Error(`Insufficient AI credits. Current balance: ₹${details.aiWalletBalance.toFixed(2)}, required: ₹${cost.toFixed(2)}.`);
    error.status = 402;
    error.code = "INSUFFICIENT_CREDITS";
    error.currentBalance = details.aiWalletBalance;
    error.requiredCost = cost;
    throw error;
  }

  const newBalance = Math.max(0, Number((details.aiWalletBalance - cost).toFixed(2)));

  // Update Supabase
  try {
    if (details.sbRow?.id) {
      await supabase
        .from("institutes")
        .update({ ai_wallet_balance: newBalance })
        .eq("id", details.sbRow.id);
    }
  } catch (sbErr) {
    console.warn("[deductAiCredits] Supabase column update skipped/failed:", sbErr.message);
  }

  // Update Mongo/Metadata
  if (details.mongoInst) {
    details.mongoInst.aiWalletBalance = newBalance;
    await details.mongoInst.save().catch(() => {});
  }
  updateInstituteAiWalletBalanceMetadata(instituteId, newBalance);
  if (details.mongoInst?._id) {
    updateInstituteAiWalletBalanceMetadata(details.mongoInst._id, newBalance);
  }

  // Attempt to log usage into ai_usage_logs
  try {
    await supabase.from("ai_usage_logs").insert({
      institute_id: String(instituteId),
      task_type: taskType,
      credits_deducted: cost,
    });
  } catch (_) {}

  return {
    deducted: cost,
    newBalance,
  };
}

// 4. Low-level LLM Caller (Google Gemini)
export async function callGeminiRaw({
  prompt,
  systemInstruction = "",
  imageBase64 = null,
  imageMimeType = "image/jpeg",
  temperature = 0.2,
}) {
  const globalSettings = await getAiGlobalSettings();
  const apiKey = globalSettings.geminiApiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error("Gemini API Key is not configured. Please add it in Super Admin Settings > AI & Automation.");
  }

  const model = globalSettings.model || "gemini-1.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const contents = [];
  const parts = [];

  if (imageBase64) {
    // Strip header if data URL
    const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, "");
    parts.push({
      inlineData: {
        mimeType: imageMimeType || "image/jpeg",
        data: cleanBase64,
      },
    });
  }

  parts.push({ text: prompt });
  contents.push({ role: "user", parts });

  const payload = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 2048,
    },
  };

  if (systemInstruction) {
    payload.systemInstruction = {
      parts: [{ text: systemInstruction }],
    };
  }

  const response = await axios.post(url, payload, {
    headers: { "Content-Type": "application/json" },
    timeout: 30000,
  });

  const candidates = response.data?.candidates;
  if (!candidates || !candidates.length) {
    throw new Error("No response generated by AI model.");
  }

  const resultText = candidates[0]?.content?.parts?.map((p) => p.text).join("") || "";
  return resultText;
}

// 5. Task A: Admission Form OCR
export async function parseAdmissionForm(imageBase64, imageMimeType, availableBatches = []) {
  const batchListStr = availableBatches.map((b) => `${b._id || b.id}: ${b.name}`).join(", ");
  const systemInstruction = `You are a high-precision OCR assistant for tuition admissions in India.
Your task is to analyze photos of student admission forms, handwritten receipts, or student enrollment slips.
Extract all details accurately and map to a strict JSON structure.
Available Batches: [${batchListStr}].
Select the closest matching batch ID if mentioned in the form.`;

  const prompt = `Analyze this admission form image carefully. Extract all fields and respond ONLY with a valid JSON object with the following schema:
{
  "name": "Full Student Name",
  "phone": "10-digit mobile number or empty string",
  "parentName": "Father or Mother name or empty string",
  "parentPhone": "Parent phone number or empty string",
  "email": "Student email or empty string",
  "address": "Residential address or empty string",
  "batchId": "Matching batch ID from available batches or null",
  "batchName": "Name of class/batch/grade mentioned",
  "feePlanType": "monthly | quarterly | yearly | one_time",
  "totalFees": 10000,
  "paidAmount": 2000,
  "dueDate": "YYYY-MM-DD or empty string",
  "notes": "Any other detected notes (e.g. school name, board, discount, reference)"
}
Return only JSON. Do not include markdown preamble.`;

  const rawResponse = await callGeminiRaw({
    prompt,
    systemInstruction,
    imageBase64,
    imageMimeType,
    temperature: 0.1,
  });

  const parsed = extractJsonFromText(rawResponse);
  if (!parsed) {
    throw new Error("Failed to parse admission form data. Please ensure the photo is clear and readable.");
  }
  return parsed;
}

// 6. Task B: Marksheet OCR
export async function parseTestMarksheet(imageBase64, imageMimeType, batchContext) {
  const students = batchContext.students || [];
  const studentListStr = students
    .map((s) => `[id: "${s._id || s.id}", name: "${s.name}", roll: "${s.enrollmentNumber || ""}"]`)
    .join(", ");

  const systemInstruction = `You are an OCR assistant for tuition teachers grading test papers and marksheets.
Match handwritten or printed student marks to the enrolled student roster.
Enrolled Students for this Batch:
${studentListStr}
Return a strict JSON object with test title, maxMarks, subject, and student score entries.`;

  const prompt = `Analyze this marksheet or test score slip.
Extract the subject, test title, maximum total marks, and match each student with their score.
For absent students, set score to -1 and isAbsent to true.
Respond ONLY with a valid JSON object:
{
  "title": "Unit Test 1 / Weekly Test / Exam Name",
  "subject": "Mathematics / Physics / etc.",
  "totalMarks": 25,
  "examDate": "YYYY-MM-DD",
  "entries": [
    {
      "studentId": "matched_student_id",
      "studentName": "student_name",
      "score": 22,
      "isAbsent": false
    }
  ],
  "unmatchedEntries": [
    {
      "detectedName": "name_not_found_in_roster",
      "score": 18
    }
  ]
}
Return only JSON.`;

  const rawResponse = await callGeminiRaw({
    prompt,
    systemInstruction,
    imageBase64,
    imageMimeType,
    temperature: 0.1,
  });

  const parsed = extractJsonFromText(rawResponse);
  if (!parsed) {
    throw new Error("Failed to parse marksheet image. Please ensure handwriting or score column is legible.");
  }
  return parsed;
}

// 7. Task C: Real-Time Institute Intelligence Q&A
export async function answerInstituteIntelligence(instituteId, user, question) {
  const instIdStr = String(instituteId || "").trim();

  // Gather live context from DB
  const [students, batches, notes, notices, tests] = await Promise.all([
    Student.find({ institute: instIdStr }).select("name phone totalFees paidAmount pendingAmount feePlanType batches status lastActiveAt").lean().catch(() => []),
    Batch.find({ institute: instIdStr }).select("name scheduleDays startTime endTime").lean().catch(() => []),
    Note.countDocuments({ institute: instIdStr }).catch(() => 0),
    Notice.find({ institute: instIdStr }).sort({ createdAt: -1 }).limit(3).lean().catch(() => []),
    TestResult.find({ institute: instIdStr }).sort({ createdAt: -1 }).limit(5).lean().catch(() => []),
  ]);

  const totalStudents = students.length;
  let totalCollected = 0;
  let totalPending = 0;
  const defaulters = [];

  students.forEach((s) => {
    const due = Number(s.pendingAmount || 0);
    const paid = Number(s.paidAmount || 0);
    totalPending += due;
    totalCollected += paid;
    if (due > 0) {
      defaulters.push({
        name: s.name,
        phone: s.phone,
        due,
      });
    }
  });

  // Sort top defaulters
  defaulters.sort((a, b) => b.due - a.due);
  const topDefaulters = defaulters.slice(0, 5);

  const contextStr = `
Institute Live Snapshot:
- Total Enrolled Students: ${totalStudents}
- Active Batches: ${batches.map((b) => b.name).join(", ") || "None"}
- Total Fees Collected: ₹${totalCollected.toLocaleString("en-IN")}
- Total Outstanding Fees: ₹${totalPending.toLocaleString("en-IN")}
- Top Fee Defaulters: ${topDefaulters.map((d) => `${d.name} (₹${d.due})`).join(", ") || "None"}
- Total Study Notes Uploaded: ${notes}
- Recent Notices: ${notices.map((n) => n.title).join(", ") || "None"}
- User Asking: ${user.name} (${user.role})
`;

  const systemInstruction = `You are DeskAI, the direct and friendly AI tuition assistant for this institute.
Use the real-time context below to answer accurately.
Format with clean bullet points, bold highlights, and rupee symbols (₹).
Keep answers crisp, helpful, and focused on coaching/tuition operations.
Answer in the language requested (English or Hinglish).
Context:
${contextStr}`;

  return await callGeminiRaw({
    prompt: question,
    systemInstruction,
    temperature: 0.3,
  });
}

// 8. Task D: Announcement & WhatsApp Broadcast Generator
export async function generateNoticeAnnouncement(instituteId, topic) {
  const prompt = `Draft a high-impact, professional WhatsApp announcement for tuition parents and students about:
"${topic}"
Include friendly greetings, clear points with emojis, date/time if relevant, and warm regards from institute management.
Return ONLY valid JSON:
{
  "title": "Short Notice Title",
  "whatsappText": "Complete ready-to-broadcast message with emojis and formatting."
}`;

  const raw = await callGeminiRaw({
    prompt,
    systemInstruction: "You are an expert communicator for educational coaching centers.",
    temperature: 0.4,
  });

  const parsed = extractJsonFromText(raw);
  return parsed || {
    title: "Institute Announcement",
    whatsappText: raw,
  };
}

// 9. Task E: Quiz / Question Paper Generator
export async function generatePracticeQuiz(subject, topic, classLevel = "Class 10", numQuestions = 5) {
  const prompt = `Create a high-quality practice quiz for ${classLevel} on Subject: "${subject}", Topic: "${topic}".
Generate exactly ${numQuestions} multiple choice questions with answers and explanations.
Return ONLY valid JSON:
{
  "subject": "${subject}",
  "topic": "${topic}",
  "classLevel": "${classLevel}",
  "questions": [
    {
      "id": 1,
      "question": "Question text here",
      "options": ["Option A", "Option B", "Option C", "Option D"],
      "correctIndex": 0,
      "explanation": "Brief explanation of why this option is correct."
    }
  ]
}`;

  const raw = await callGeminiRaw({
    prompt,
    systemInstruction: "You are an expert curriculum and exam question creator.",
    temperature: 0.3,
  });

  return extractJsonFromText(raw);
}

// 10. Task F: Student Doubt Solver
export async function solveStudentDoubt(questionText, imageBase64, imageMimeType, studentName = "Student") {
  const systemInstruction = `You are a supportive, friendly AI tutor for students.
Your goal is to explain concepts clearly, provide step-by-step solutions, highlight formulas, and encourage learning.
If the student uploaded a math, science, or physics question photo, solve it step-by-step.
Address student by name: ${studentName}.
Use easy-to-understand language with markdown formatting.`;

  return await callGeminiRaw({
    prompt: questionText || "Please explain this question step by step and give the solution.",
    systemInstruction,
    imageBase64,
    imageMimeType,
    temperature: 0.3,
  });
}
