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
  let setting = null;
  try {
    setting = await SystemSetting.findOne({ key: "ai_global_settings" });
  } catch (_) {}

  const defaultSettings = {
    geminiApiKey: process.env.GEMINI_API_KEY || "",
    openaiApiKey: process.env.OPENAI_API_KEY || "",
    provider: "gemini",
    model: "gemini-3.5-flash",
    rates: {
      query: 0.2,
      vision: 0.5,
      quiz: 0.4,
      doubt: 0.25,
    },
    defaultEnabled: false,
  };

  if (!setting || !setting.value) {
    return defaultSettings;
  }

  const val = setting.value;
  return {
    ...defaultSettings,
    ...val,
    geminiApiKey: (val.geminiApiKey || process.env.GEMINI_API_KEY || "").trim(),
    openaiApiKey: (val.openaiApiKey || process.env.OPENAI_API_KEY || "").trim(),
    model: (val.model || val.defaultModel || "gemini-3.5-flash").trim(),
    rates: {
      query: Number(
        val.aiQueryRate ?? val.rates?.query ?? defaultSettings.rates.query,
      ),
      vision: Number(
        val.aiVisionRate ?? val.rates?.vision ?? defaultSettings.rates.vision,
      ),
      quiz: Number(
        val.aiQuizRate ?? val.rates?.quiz ?? defaultSettings.rates.quiz,
      ),
      doubt: Number(
        val.aiDoubtRate ?? val.rates?.doubt ?? defaultSettings.rates.doubt,
      ),
    },
  };
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
    query: 0.2,
    vision: 0.5,
    quiz: 0.4,
    doubt: 0.25,
  };

  const aiEnabled = sbRow?.ai_enabled ?? mongoInst?.aiEnabled ?? false;
  const aiStudentEnabled =
    sbRow?.ai_student_enabled ?? mongoInst?.aiStudentEnabled ?? false;

  const rawBal = sbRow?.ai_wallet_balance ?? mongoInst?.aiWalletBalance ?? 0;
  const aiWalletBalance = Number(rawBal || 0);

  const rates = {
    query: Number(
      sbRow?.ai_query_rate ??
        mongoInst?.aiQueryRate ??
        defaultRates.query ??
        0.2,
    ),
    vision: Number(
      sbRow?.ai_vision_rate ??
        mongoInst?.aiVisionRate ??
        defaultRates.vision ??
        0.5,
    ),
    quiz: Number(
      sbRow?.ai_quiz_rate ?? mongoInst?.aiQuizRate ?? defaultRates.quiz ?? 0.4,
    ),
    doubt: Number(
      sbRow?.ai_doubt_rate ??
        mongoInst?.aiDoubtRate ??
        defaultRates.doubt ??
        0.25,
    ),
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
export async function deductAiCredits(
  instituteId,
  taskType,
  customCost = null,
) {
  const details = await getInstituteAiDetails(instituteId);
  if (!details) {
    throw new Error("Institute not found for AI billing");
  }

  if (!details.aiEnabled) {
    const error = new Error(
      "AI feature is locked for this institution. Please contact Super Admin.",
    );
    error.status = 403;
    error.code = "AI_LOCKED";
    throw error;
  }

  const cost =
    customCost !== null
      ? Number(customCost)
      : details.rates[taskType] || details.rates.query || 0.2;

  if (details.aiWalletBalance < cost) {
    const error = new Error(
      `Insufficient AI credits. Current balance: ₹${details.aiWalletBalance.toFixed(2)}, required: ₹${cost.toFixed(2)}.`,
    );
    error.status = 402;
    error.code = "INSUFFICIENT_CREDITS";
    error.currentBalance = details.aiWalletBalance;
    error.requiredCost = cost;
    throw error;
  }

  const newBalance = Math.max(
    0,
    Number((details.aiWalletBalance - cost).toFixed(2)),
  );

  // Update Supabase
  try {
    if (details.sbRow?.id) {
      await supabase
        .from("institutes")
        .update({ ai_wallet_balance: newBalance })
        .eq("id", details.sbRow.id);
    }
  } catch (sbErr) {
    console.warn(
      "[deductAiCredits] Supabase column update skipped/failed:",
      sbErr.message,
    );
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

// Helper: Call OpenAI Chat Completions API
async function callOpenAiRaw({
  prompt,
  systemInstruction = "",
  imageBase64 = null,
  imageMimeType = "image/jpeg",
  temperature = 0.2,
  apiKey,
  model = "gpt-4o-mini",
}) {
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }

  if (imageBase64) {
    const cleanBase64 = imageBase64.replace(
      /^data:image\/[a-zA-Z]+;base64,/,
      "",
    );
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt },
        {
          type: "image_url",
          image_url: {
            url: `data:${imageMimeType || "image/jpeg"};base64,${cleanBase64}`,
          },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt });
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: model || "gpt-4o-mini",
        messages,
        temperature,
        max_tokens: 2048,
      },
      {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        timeout: 35000,
      },
    );

    const reply = response.data?.choices?.[0]?.message?.content;
    if (!reply) {
      throw new Error("No response generated by OpenAI model.");
    }
    return reply;
  } catch (err) {
    const errMsg = err.response?.data?.error?.message || err.message;
    const customErr = new Error(`OpenAI API Error: ${errMsg}`);
    customErr.status = 502;
    customErr.code = "OPENAI_API_ERROR";
    throw customErr;
  }
}

// Helper: Call Google Gemini with automatic model & version fallback
async function callGeminiApiWithFallback({
  prompt,
  systemInstruction = "",
  imageBase64 = null,
  imageMimeType = "image/jpeg",
  temperature = 0.2,
  apiKey,
  preferredModel = "gemini-2.5-flash",
}) {
  const cleanBase64 = imageBase64
    ? imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, "")
    : null;

  const contents = [];
  const parts = [];
  if (cleanBase64) {
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

  const cleanPref = (preferredModel || "").trim();
  const modelsToTry = [
    cleanPref,
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.8-flash",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-flash-latest",
    "gemini-2.5-flash-lite",
    "gemini-3.1-pro-preview",
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;

  for (const modelName of modelsToTry) {
    for (const apiVersion of ["v1beta", "v1"]) {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
      try {
        const response = await axios.post(url, payload, {
          headers: { "Content-Type": "application/json" },
          timeout: 30000,
        });

        const candidates = response.data?.candidates;
        if (candidates && candidates.length > 0) {
          const resultText =
            candidates[0]?.content?.parts?.map((p) => p.text).join("") || "";
          if (resultText) return resultText;
        }
      } catch (err) {
        lastError = err;
        const status = err.response?.status;
        const errData = err.response?.data;
        const errMsg = errData?.error?.message || err.message || "";

        // If model not found (404), continue to next model/version candidate
        if (status === 404 || errMsg.toLowerCase().includes("not found")) {
          continue;
        }

        // If authentication error, stop looping and throw friendly error
        if (
          status === 400 ||
          status === 401 ||
          status === 403 ||
          errMsg.toLowerCase().includes("api key") ||
          errMsg.toLowerCase().includes("permission_denied")
        ) {
          const customErr = new Error(
            `Google AI Studio Authentication Error: ${errMsg || "Invalid API key"}. Please check your Gemini API key in Super Admin > AI & Models.`,
          );
          customErr.status = 502;
          customErr.code = "AI_AUTH_FAILED";
          throw customErr;
        }

        // If quota exceeded (429)
        if (status === 429) {
          const customErr = new Error(
            `Gemini Rate Limit / Quota Exceeded: ${errMsg || "Too many requests"}. Please wait a moment or check your Google AI Studio quota.`,
          );
          customErr.status = 429;
          customErr.code = "AI_QUOTA_EXCEEDED";
          throw customErr;
        }
      }
    }
  }

  const rawMsg =
    lastError?.response?.data?.error?.message ||
    lastError?.message ||
    "Google Generative AI service did not respond.";
  const friendlyErr = new Error(
    `AI Provider Error: ${rawMsg}. Please verify your API Key and active models in Super Admin > AI & Models.`,
  );
  friendlyErr.status = 502;
  friendlyErr.code = "UPSTREAM_AI_FAILED";
  throw friendlyErr;
}

// 4. Multi-Provider LLM Caller (Google Gemini & OpenAI)
export async function callGeminiRaw({
  prompt,
  systemInstruction = "",
  imageBase64 = null,
  imageMimeType = "image/jpeg",
  temperature = 0.2,
}) {
  const globalSettings = await getAiGlobalSettings();
  const geminiKey = (
    globalSettings.geminiApiKey ||
    process.env.GEMINI_API_KEY ||
    ""
  ).trim();
  const openaiKey = (
    globalSettings.openaiApiKey ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();
  const chosenModel = (
    globalSettings.model ||
    globalSettings.defaultModel ||
    "gemini-2.5-flash"
  ).trim();
  const provider = (
    globalSettings.provider ||
    (chosenModel.startsWith("gpt") ? "openai" : "gemini")
  ).toLowerCase();

  // If OpenAI is selected or model is GPT
  if ((provider === "openai" || chosenModel.startsWith("gpt")) && openaiKey) {
    try {
      return await callOpenAiRaw({
        prompt,
        systemInstruction,
        imageBase64,
        imageMimeType,
        temperature,
        apiKey: openaiKey,
        model: chosenModel.startsWith("gpt") ? chosenModel : "gpt-4o-mini",
      });
    } catch (openAiErr) {
      if (!geminiKey) {
        throw openAiErr;
      }
      console.warn(
        "[callGeminiRaw] OpenAI call failed, falling back to Gemini:",
        openAiErr.message,
      );
    }
  }

  // If Gemini key is available
  if (geminiKey) {
    return await callGeminiApiWithFallback({
      prompt,
      systemInstruction,
      imageBase64,
      imageMimeType,
      temperature,
      apiKey: geminiKey,
      preferredModel: chosenModel.startsWith("gpt")
        ? "gemini-2.5-flash"
        : chosenModel,
    });
  }

  // If only OpenAI key is available
  if (openaiKey) {
    return await callOpenAiRaw({
      prompt,
      systemInstruction,
      imageBase64,
      imageMimeType,
      temperature,
      apiKey: openaiKey,
      model: "gpt-4o-mini",
    });
  }

  const missingErr = new Error(
    "No AI API Key is configured. Please enter your Google Gemini or OpenAI API Key in Super Admin Settings > AI & Models.",
  );
  missingErr.status = 502;
  missingErr.code = "AI_KEY_NOT_CONFIGURED";
  throw missingErr;
}

// 5. Task A: Admission Form OCR
export async function parseAdmissionForm(
  imageBase64,
  imageMimeType,
  availableBatches = [],
  instituteCustomFields = [],
) {
  const batchListStr = availableBatches
    .map((b) => `${b._id || b.id}: ${b.name}`)
    .join(", ");
  const customFieldsStr = (instituteCustomFields || [])
    .map((f) => `${f.name || f.label} (${f.label || f.name})`)
    .join(", ");

  const systemInstruction = `You are a high-precision OCR and document verification assistant for tuition admissions in India.
TASK 1: VERIFY DOCUMENT TYPE FIRST.
Examine whether the provided image is a genuine student admission form, enrollment application, student registration slip, or tuition admission receipt.
If the image is NOT an admission form (for example: a selfie, person, animal, scenery, vehicle, food, random object, meme, test marksheet, or unrelated document), you MUST reject it by setting "isValidDocument": false.

Available Batches: [${batchListStr}].
Select the closest matching batch ID if mentioned in the form.
${customFieldsStr ? `Active Custom Fields for this Institute: [${customFieldsStr}]. If any of these custom fields are found on the form, extract them into "customFields" dictionary with the exact field name as the key.` : ""}`;

  const prompt = `Analyze this image carefully.
STEP 1: Verify if this is an admission form.
If it is NOT an admission form or enrollment slip, respond ONLY with:
{
  "isValidDocument": false,
  "documentType": "invalid",
  "reason": "The uploaded image does not appear to be an admission form. Please upload the correct document."
}

STEP 2: If and ONLY IF it is a valid admission form or enrollment slip, extract only the fields that will be stored in the student database record and respond ONLY with:
{
  "isValidDocument": true,
  "documentType": "admission_form",
  "name": "Full Student Name",
  "phone": "10-digit mobile number or empty string",
  "parentName": "Father or Mother name or empty string",
  "parentPhone": "Parent phone number or empty string",
  "email": "Student email or empty string",
  "address": "Residential address or empty string",
  "batchId": "Matching batch ID from available batches or null",
  "batchName": "Name of class/batch/grade mentioned",
  "feePlanType": "monthly | full_course | partial",
  "totalFees": 10000,
  "paidAmount": 0,
  "feeStatus": "paid | unpaid",
  "dueDate": "YYYY-MM-DD or empty string",
  "customFields": {}
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
    return {
      isValidDocument: false,
      documentType: "invalid",
      reason: "Could not read document. Please upload a clear photo of an admission form.",
    };
  }
  return parsed;
}

// 6. Task B: Marksheet OCR
export async function parseTestMarksheet(
  imageBase64,
  imageMimeType,
  batchContext,
) {
  const students = batchContext.students || [];
  const studentListStr = students
    .map(
      (s) =>
        `[id: "${s._id || s.id}", name: "${s.name}", roll: "${s.enrollmentNumber || ""}"]`,
    )
    .join(", ");

  const systemInstruction = `You are a high-precision OCR and document verification assistant for tuition teachers grading test papers and marksheets.
TASK 1: VERIFY DOCUMENT TYPE FIRST.
Examine whether the provided image is a genuine test marksheet, student score sheet, grading list, or exam result table.
If the image is NOT a test marksheet or student scores table (for example: a selfie, person, animal, scenery, vehicle, food, random object, meme, admission form, or unrelated document), you MUST reject it by setting "isValidDocument": false.

Enrolled Students for this Batch:
${studentListStr}`;

  const prompt = `Analyze this image carefully.
STEP 1: Verify if this is a test marksheet or exam score list.
If it is NOT a test marksheet, respond ONLY with:
{
  "isValidDocument": false,
  "documentType": "invalid",
  "reason": "The uploaded image does not appear to be a test marksheet. Please upload the correct document."
}

STEP 2: If and ONLY IF it is a valid marksheet or test score record, extract the subject, test title, total marks, and student score entries:
{
  "isValidDocument": true,
  "documentType": "test_marksheet",
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
    return {
      isValidDocument: false,
      documentType: "invalid",
      reason: "Could not read marksheet. Please upload a clear photo of a test marksheet.",
    };
  }
  return parsed;
}

// 7. Task C: Real-Time Institute Intelligence Q&A
export async function answerInstituteIntelligence(instituteId, user, question) {
  const instIdStr = String(instituteId || "").trim();

  // Gather live context from DB safely
  let students = [];
  let batches = [];
  let notes = 0;
  let notices = [];
  let tests = [];

  try {
    const results = await Promise.allSettled([
      Student.find({ $or: [{ institute: instIdStr }, { user: instIdStr }] })
        .select(
          "name phone enrollmentNumber totalFees paidAmount pendingAmount feePlanType batch batches status isArchived lastActiveAt attendanceRecords",
        )
        .lean(),
      Batch.find({ $or: [{ institute: instIdStr }, { user: instIdStr }] })
        .select("_id name status scheduleDays startTime endTime")
        .lean(),
      Note.countDocuments({ $or: [{ institute: instIdStr }, { user: instIdStr }] }),
      Notice.find({ $or: [{ institute: instIdStr }, { user: instIdStr }] })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      TestResult.find({ $or: [{ institute: instIdStr }, { user: instIdStr }] })
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
    ]);

    if (results[0].status === "fulfilled" && Array.isArray(results[0].value))
      students = results[0].value;
    if (results[1].status === "fulfilled" && Array.isArray(results[1].value))
      batches = results[1].value;
    if (
      results[2].status === "fulfilled" &&
      typeof results[2].value === "number"
    )
      notes = results[2].value;
    if (results[3].status === "fulfilled" && Array.isArray(results[3].value))
      notices = results[3].value;
    if (results[4].status === "fulfilled" && Array.isArray(results[4].value))
      tests = results[4].value;
  } catch (err) {
    console.error("Error gathering DB context for AI:", err);
  }

  // Active batches & Batch map
  const activeBatches = batches.filter((b) => b.status !== "archived");
  const activeBatchIds = new Set(activeBatches.map((b) => String(b._id || b.id)));
  const batchNameMap = new Map();
  batches.forEach((b) => {
    batchNameMap.set(String(b._id || b.id), b.name);
  });

  const getStudentBatchNames = (s) => {
    const names = [];
    const sBatchId = s.batch ? String(s.batch._id || s.batch) : null;
    if (sBatchId && batchNameMap.has(sBatchId)) {
      names.push(batchNameMap.get(sBatchId));
    }
    if (Array.isArray(s.batches)) {
      s.batches.forEach((b) => {
        const bId = String(b._id || b);
        const bName = batchNameMap.get(bId);
        if (bName && !names.includes(bName)) names.push(bName);
      });
    }
    return names.length > 0 ? names.join(", ") : "No Batch";
  };

  // Filter Active Enrolled Students (exclude archived / inactive)
  const activeStudents = [];
  const inactiveStudents = [];

  students.forEach((s) => {
    const isArchived =
      s.isArchived === true || s.status === "archived" || s.status === "inactive";
    const sBatchIds = [];
    if (s.batch) sBatchIds.push(String(s.batch._id || s.batch));
    if (Array.isArray(s.batches))
      s.batches.forEach((b) => sBatchIds.push(String(b._id || b)));
    if (Array.isArray(s.enrolledBatchIds))
      s.enrolledBatchIds.forEach((b) => sBatchIds.push(String(b)));

    if (isArchived) {
      inactiveStudents.push(s);
    } else if (
      sBatchIds.length > 0 &&
      !sBatchIds.some((bId) => activeBatchIds.has(bId))
    ) {
      inactiveStudents.push(s);
    } else {
      // Calculate attendance metrics
      const attRecords = Array.isArray(s.attendanceRecords) ? s.attendanceRecords : [];
      const totalSessions = attRecords.length;
      const presentSessions = attRecords.filter((r) => r.status === "present").length;
      const absentSessions = totalSessions - presentSessions;
      const attendancePercentage = totalSessions > 0 ? Math.round((presentSessions / totalSessions) * 100) : 100;

      s.attendancePct = attendancePercentage;
      s.totalSessions = totalSessions;
      s.presentSessions = presentSessions;
      s.absentSessions = absentSessions;
      activeStudents.push(s);
    }
  });

  // Calculate fees on active students
  let totalCollected = 0;
  let totalPending = 0;
  const defaulters = [];

  activeStudents.forEach((s) => {
    const due = Number(s.pendingAmount || 0);
    const paid = Number(s.paidAmount || 0);
    totalPending += due;
    totalCollected += paid;
    if (due > 0) {
      defaulters.push({
        name: s.name,
        phone: s.phone,
        batch: getStudentBatchNames(s),
        due,
      });
    }
  });

  defaulters.sort((a, b) => b.due - a.due);

  // Complete Student Roster with Fees and Attendance
  const fullRosterFormatted = activeStudents
    .map((s, idx) => {
      const bNames = getStudentBatchNames(s);
      const due = Number(s.pendingAmount || 0);
      const feeStatus = due > 0 ? `Pending: ₹${due.toLocaleString("en-IN")}` : "Paid / No Due";
      const attText = s.totalSessions > 0
        ? `${s.attendancePct}% (${s.presentSessions}/${s.totalSessions} present)`
        : `100% (No marked absences)`;
      return `${idx + 1}. **${s.name}** | Batch: ${bNames} | Phone: ${s.phone || "N/A"} | Attendance: ${attText} | Fees: ${feeStatus}`;
    })
    .join("\n");

  // Attendance Highlights
  const studentsWithAttendance = activeStudents.filter((s) => s.totalSessions > 0);
  const below75Attendance = activeStudents.filter((s) => s.totalSessions > 0 && s.attendancePct < 75);
  const perfectAttendance = activeStudents.filter((s) => s.attendancePct === 100);

  // Batch-wise Student Breakdown
  const batchWiseRoster = activeBatches
    .map((b) => {
      const bId = String(b._id || b.id);
      const inThisBatch = activeStudents.filter((s) => {
        const sBatch = s.batch ? String(s.batch._id || s.batch) : null;
        const inBatches =
          Array.isArray(s.batches) &&
          s.batches.some((x) => String(x._id || x) === bId);
        return sBatch === bId || inBatches;
      });
      const names = inThisBatch.map((s) => s.name).join(", ");
      return `• Batch: **${b.name}** (${inThisBatch.length} students): ${names || "No students enrolled"}`;
    })
    .join("\n");

  const contextStr = `
Institute Live Snapshot:
• Total Enrolled Students (Active): ${activeStudents.length}
• Total Active Batches: ${activeBatches.map((b) => b.name).join(", ") || "None"}
• Total Fees Collected: ₹${totalCollected.toLocaleString("en-IN")}
• Total Outstanding Fees: ₹${totalPending.toLocaleString("en-IN")}
• Total Fee Defaulters: ${defaulters.length} active students
• Top Defaulters: ${defaulters.slice(0, 8).map((d) => `${d.name} (${d.batch}, ₹${d.due.toLocaleString("en-IN")})`).join(", ") || "None"}
• Active Students with Recorded Attendance: ${studentsWithAttendance.length} of ${activeStudents.length}
• Students with Attendance < 75%: ${below75Attendance.length > 0 ? below75Attendance.map((s) => `${s.name} (${s.attendancePct}%, ${getStudentBatchNames(s)})`).join(", ") : "None"}
• Students with 100% Attendance: ${perfectAttendance.length > 0 ? perfectAttendance.map((s) => `${s.name} (${getStudentBatchNames(s)})`).join(", ") : "None"}
• Total Study Notes Uploaded: ${notes}
• Recent Notices: ${notices.map((n) => n.title).join(", ") || "None"}
• User Inquiring: ${user.name} (${user.role})

Students Roster by Batch:
${batchWiseRoster || "No active batches."}

Complete Active Student Roster (${activeStudents.length} Active Students with Attendance & Fees):
${fullRosterFormatted || "No enrolled students."}
`;

  const systemInstruction = `You are ClassTech AI, the intelligent, friendly, and ultra-accurate management assistant for this coaching institute.
Use the real-time context above to answer all questions accurately, concisely, and cleanly.

CRITICAL OPERATIONAL RULES:
1. SUMMARY OF ENROLLED STUDENTS:
   - When asked for a "summary", "overview", or "total enrolled students":
   - ALWAYS report the count of ACTIVE students (**${activeStudents.length}**) as Total Enrolled Students. Never report archived or inactive students in the total enrolled figure.

2. LIST DOWN ALL STUDENTS:
   - When asked to "list down all students", "show all students", "give student roster", or "list students":
   - You MUST list ALL ${activeStudents.length} active students from the "Complete Active Student Roster" above!
   - List EVERY SINGLE student IRRESPECTIVE of their pending fees (both students who paid full fees and students who owe pending fees).
   - Show their sequential number, name, and batch.

3. STUDENTS OF A PARTICULAR BATCH:
   - When asked for students of any particular batch (e.g. "show students of Neet batch", "who is in [batch name]", "students in Class 10"):
   - Identify the requested batch name from "Students Roster by Batch" or the student roster.
   - List all students who are in that specific batch.
   - If that batch has students, list them clearly with their names.
   - If that batch has no students, clearly state that no students are currently enrolled in that batch.

4. ATTENDANCE QUERIES & NUMERIC FILTERING:
   - When asked to list or identify students having attendance less than, greater than, or equal to a percentage (e.g., "attendance less than 75%", "< 75%", "100% attendance", "students having 100 percent attendance", "attendance below 80%"):
     * Filter students directly based on their exact Attendance percentage from the active student roster.
     * List all matching students with:
       • Sequential number and Student Name
       • Batch Name
       • Exact Attendance Percentage and Ratio (e.g. 60% (3/5 sessions))
     * If no students match the criterion (e.g., if no students have attendance below 75%), clearly state: "No students currently have attendance below 75%."
     * If all students have 100% attendance (or no absences have been marked), explain that clearly.

5. FORMATTING RULES:
   - Write in a natural, clean, professional style.
   - Use clean bullet points (• or -).
   - Highlight key metrics with single bold (e.g. • Total Enrolled Students: **${activeStudents.length}**).
   - Never use double bold syntax like "**Label:** **Value**" (bold only the value or label, not both).
   - Do NOT use markdown headers with hashtags (### or ##); use emoji headings or clear labels instead.
   - Keep answers crisp, helpful, and focused on coaching/tuition operations.
   - Answer in the language requested (English or Hinglish).

Real-time Context:
${contextStr}`;

  return await callGeminiRaw({
    prompt: question,
    systemInstruction,
    temperature: 0.2,
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
    systemInstruction:
      "You are an expert communicator for educational coaching centers.",
    temperature: 0.4,
  });

  const parsed = extractJsonFromText(raw);
  return (
    parsed || {
      title: "Institute Announcement",
      whatsappText: raw,
    }
  );
}

// 9. Task E: Quiz / Question Paper Generator
export async function generatePracticeQuiz(
  subjectOrPrompt,
  topic = null,
  classLevel = "Class 10",
  numQuestions = 5,
) {
  const isFreeformPrompt =
    !topic ||
    topic === subjectOrPrompt ||
    topic.toLowerCase().startsWith("generate") ||
    topic.toLowerCase().startsWith("create");

  const prompt = isFreeformPrompt
    ? `The user requested a practice quiz: "${subjectOrPrompt}".
Create a high-quality practice quiz based on this request.
- Extract or choose an appropriate Subject (e.g. Science, Mathematics, Physics, Chemistry, Biology, English, or General Knowledge).
- Choose a clean, specific Topic name (e.g. "Laws of Motion", "Algebra & Quadratic Equations", "Cell Biology", etc. Do NOT use "generate quiz" as the topic name).
- Generate exactly ${numQuestions} multiple choice questions (MCQs) with 4 options each, the correct answer index (0-3), and an explanation.
Return ONLY valid JSON:
{
  "subject": "Extracted Subject",
  "topic": "Clean Short Topic Name",
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
}`
    : `Create a high-quality practice quiz for ${classLevel} on Subject: "${subjectOrPrompt}", Topic: "${topic}".
Generate exactly ${numQuestions} multiple choice questions with answers and explanations.
Return ONLY valid JSON:
{
  "subject": "${subjectOrPrompt}",
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

  try {
    const raw = await callGeminiRaw({
      prompt,
      systemInstruction:
        "You are an expert curriculum and exam question creator. Always return strictly valid JSON.",
      temperature: 0.3,
    });

    const parsed = extractJsonFromText(raw);
    if (
      parsed &&
      Array.isArray(parsed.questions) &&
      parsed.questions.length > 0
    ) {
      return parsed;
    }
  } catch (err) {
    console.error("generatePracticeQuiz LLM error:", err.message);
  }

  // Reliable fallback quiz so the user never sees an empty card
  return {
    subject: "General Science & Mathematics",
    topic: "Core Concept Check",
    classLevel: classLevel || "Class 10",
    questions: [
      {
        id: 1,
        question: "Which organelle is known as the powerhouse of the cell?",
        options: ["Ribosome", "Mitochondria", "Nucleus", "Endoplasmic Reticulum"],
        correctIndex: 1,
        explanation: "Mitochondria generate most of the chemical energy needed to power the cell's biochemical reactions.",
      },
      {
        id: 2,
        question: "What is the standard acceleration due to gravity on Earth's surface?",
        options: ["8.9 m/s²", "9.8 m/s²", "10.5 m/s²", "12.0 m/s²"],
        correctIndex: 1,
        explanation: "Standard acceleration due to Earth's gravity is approximately 9.8 m/s².",
      },
      {
        id: 3,
        question: "What is the value of x if 2x + 6 = 14?",
        options: ["x = 2", "x = 4", "x = 6", "x = 8"],
        correctIndex: 1,
        explanation: "2x = 14 - 6 = 8, so x = 8 / 2 = 4.",
      },
      {
        id: 4,
        question: "What is the chemical formula for water?",
        options: ["H2O", "CO2", "NaCl", "CH4"],
        correctIndex: 0,
        explanation: "Water consists of two hydrogen atoms bonded to one oxygen atom (H2O).",
      },
      {
        id: 5,
        question: "Which gas do plants absorb from the atmosphere during photosynthesis?",
        options: ["Oxygen", "Carbon Dioxide", "Nitrogen", "Argon"],
        correctIndex: 1,
        explanation: "Plants absorb carbon dioxide and release oxygen during photosynthesis.",
      },
    ],
  };
}

// 10. Task F: Student Doubt Solver
export async function solveStudentDoubt(
  questionText,
  imageBase64,
  imageMimeType,
  studentName = "Student",
) {
  const systemInstruction = `You are a supportive, friendly AI tutor for students.
Your goal is to explain concepts clearly, provide step-by-step solutions, highlight formulas, and encourage learning.
If the student uploaded a math, science, or physics question photo, solve it step-by-step.
Address student by name: ${studentName}.
Formatting rules:
- Present steps with clear numbering (Step 1, Step 2).
- Use clean bullet points (•) and highlight final answers and formulas cleanly.
- Do not use hashtag headers (### or ##); use clean headings like 📌 Concept: or 💡 Solution:`;

  return await callGeminiRaw({
    prompt:
      questionText ||
      "Please explain this question step by step and give the solution.",
    systemInstruction,
    imageBase64,
    imageMimeType,
    temperature: 0.3,
  });
}
