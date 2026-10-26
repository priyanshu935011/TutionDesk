import axios from "axios";
import SystemSetting from "../models/SystemSetting.js";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Note from "../models/Note.js";
import Notice from "../models/Notice.js";
import TestResult from "../models/TestResult.js";
import TestSeriesAttempt from "../models/TestSeriesAttempt.js";
import { getISTDateStr } from "../utils/feeHelper.js";
import { supabase } from "../utils/supabase.js";
import {
  getSupabaseInstituteRow,
  getInstituteWalletBalance,
} from "./whatsappService.js";
import {
  updateInstituteAiWalletBalanceMetadata,
  updateInstituteAiSettingsMetadata,
  readTestsMetadata,
  toValidUUID,
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

  const rawCreditsPerRupee = sbRow?.ai_credits_per_rupee ?? mongoInst?.aiCreditsPerRupee ?? 10;
  const aiCreditsPerRupee = Number(rawCreditsPerRupee || 10);
  const aiWalletCredits = Math.round(aiWalletBalance * aiCreditsPerRupee);

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
    aiCreditsPerRupee,
    aiWalletCredits,
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
  history = [],
}) {
  const messages = [];
  if (systemInstruction) {
    messages.push({ role: "system", content: systemInstruction });
  }

  // Inject prior turns
  if (Array.isArray(history) && history.length > 0) {
    for (const h of history) {
      const text = typeof h.text === "string" ? h.text.trim() : (typeof h.content === "string" ? h.content.trim() : "");
      if (text) {
        messages.push({
          role: h.role === "user" ? "user" : "assistant",
          content: text,
        });
      }
    }
  }

  if (imageBase64) {
    const cleanBase64 = imageBase64.replace(
      /^data:image\/[a-zA-Z]+;base64,/,
      "",
    );
    messages.push({
      role: "user",
      content: [
        { type: "text", text: prompt || "" },
        {
          type: "image_url",
          image_url: {
            url: `data:${imageMimeType || "image/jpeg"};base64,${cleanBase64}`,
          },
        },
      ],
    });
  } else {
    messages.push({ role: "user", content: prompt || "" });
  }

  try {
    const response = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      {
        model: model || "gpt-4o-mini",
        messages,
        temperature,
        max_tokens: 8192,
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
  preferredModel = "gemini-3.5-flash",
  history = [],
}) {
  const cleanBase64 = imageBase64
    ? imageBase64.replace(/^data:image\/[a-zA-Z]+;base64,/, "")
    : null;

  const contents = [];

  // Inject prior conversation turns
  if (Array.isArray(history) && history.length > 0) {
    for (const h of history) {
      const text =
        typeof h.text === "string"
          ? h.text.trim()
          : typeof h.content === "string"
            ? h.content.trim()
            : "";
      if (!text) continue;
      const role =
        h.role === "assistant" || h.role === "model" ? "model" : "user";
      if (contents.length > 0 && contents[contents.length - 1].role === role) {
        contents[contents.length - 1].parts[0].text += `\n${text}`;
      } else {
        contents.push({ role, parts: [{ text }] });
      }
    }
  }

  // Gemini requires the first turn to be from 'user'
  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  const userParts = [];
  if (cleanBase64) {
    userParts.push({
      inlineData: {
        mimeType: imageMimeType || "image/jpeg",
        data: cleanBase64,
      },
    });
  }
  userParts.push({ text: prompt || "" });

  if (contents.length > 0 && contents[contents.length - 1].role === "user") {
    contents[contents.length - 1].parts.push(...userParts);
  } else {
    contents.push({ role: "user", parts: userParts });
  }

  const payload = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens: 16384,
      thinkingConfig: {
        thinkingBudget: 0,
      },
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
    "gemini-3.8-flash",
    "gemini-3.5-flash-lite",
    "gemini-3-flash-preview",
    "gemini-2.5-flash",
    "gemini-flash-latest",
  ].filter((m, idx, arr) => m && arr.indexOf(m) === idx);

  let lastError = null;

  for (const modelName of modelsToTry) {
    for (const apiVersion of ["v1beta", "v1"]) {
      const url = `https://generativelanguage.googleapis.com/${apiVersion}/models/${modelName}:generateContent?key=${apiKey}`;
      try {
        let response;
        try {
          response = await axios.post(url, payload, {
            headers: { "Content-Type": "application/json" },
            timeout: 35000,
          });
        } catch (postErr) {
          const postErrMsg = postErr.response?.data?.error?.message || "";
          if (
            payload.generationConfig?.thinkingConfig &&
            (postErrMsg.toLowerCase().includes("thinkingconfig") ||
             postErrMsg.toLowerCase().includes("thinking_config"))
          ) {
            const fallbackPayload = {
              ...payload,
              generationConfig: {
                temperature,
                maxOutputTokens: 16384,
              },
            };
            response = await axios.post(url, fallbackPayload, {
              headers: { "Content-Type": "application/json" },
              timeout: 35000,
            });
          } else {
            throw postErr;
          }
        }

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
  history = [],
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
        history,
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
      history,
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
      history,
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
  batchContext = {},
) {
  const students = batchContext.students || [];
  const batches = batchContext.availableBatches || [];
  const batchListStr = batches
    .map((b) => `${b._id || b.id}: ${b.name}`)
    .join(", ");
  const studentListStr = students
    .slice(0, 500)
    .map(
      (s) =>
        `[id: "${s._id || s.id}", name: "${s.name}", roll: "${s.enrollmentNumber || ""}", batchId: "${s.batchId || ""}"]`,
    )
    .join(", ");

  const systemInstruction = `You are a high-precision OCR and document verification assistant for tuition teachers grading test papers and marksheets.
TASK 1: VERIFY DOCUMENT TYPE FIRST.
Examine whether the provided image is a genuine test marksheet, student score sheet, grading list, or exam result table.
If the image is NOT a test marksheet or student scores table (for example: a selfie, person, animal, scenery, vehicle, food, random object, meme, admission form, or unrelated document), you MUST reject it by setting "isValidDocument": false.

${batchListStr ? `Available Batches: [${batchListStr}].` : ""}
${studentListStr ? `Enrolled Students:\n${studentListStr}` : ""}`;

  const prompt = `Analyze this image carefully.
STEP 1: Verify if this is a test marksheet or exam score list.
If it is NOT a test marksheet, respond ONLY with:
{
  "isValidDocument": false,
  "documentType": "invalid",
  "reason": "The uploaded image does not appear to be a test marksheet. Please upload the correct document."
}

STEP 2: If and ONLY IF it is a valid marksheet or test score record, extract the subject, test title, total marks, conducted date, detected batch name, and student score entries:
{
  "isValidDocument": true,
  "documentType": "test_marksheet",
  "title": "Unit Test 1 / Weekly Test / Exam Name",
  "subject": "Mathematics / Physics / Science / etc.",
  "totalMarks": 25,
  "examDate": "YYYY-MM-DD",
  "detectedBatchName": "Name of class/batch if written on sheet or empty string",
  "entries": [
    {
      "studentId": "matched_student_id_or_null",
      "studentName": "student_name_on_marksheet",
      "rollNumber": "roll_or_serial_number_if_present",
      "score": 22,
      "isAbsent": false
    }
  ],
  "unmatchedEntries": [
    {
      "detectedName": "student_name_if_not_in_roster",
      "rollNumber": "",
      "score": 18,
      "isAbsent": false
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
export async function answerInstituteIntelligence(
  instituteId,
  user,
  question,
  history = [],
) {
  const instIdStr = String(instituteId || "").trim();
  const todayISTStr = getISTDateStr(new Date());

  // Resolve all possible institute/admin/user IDs for comprehensive data lookup
  const instQueryIds = [instIdStr];
  if (user) {
    if (user.institute) {
      if (typeof user.institute === "object") {
        if (user.institute._id) instQueryIds.push(String(user.institute._id));
        if (user.institute.id) instQueryIds.push(String(user.institute.id));
        if (user.institute.adminUser) instQueryIds.push(String(user.institute.adminUser));
      } else {
        instQueryIds.push(String(user.institute));
      }
    }
    if (user._id) instQueryIds.push(String(user._id));
    if (user.id) instQueryIds.push(String(user.id));
    if (user.institute_id) instQueryIds.push(String(user.institute_id));
  }
  const allInstIds = Array.from(new Set(instQueryIds.filter(Boolean).map(String)));

  // Gather live context from DB safely
  let students = [];
  let batches = [];
  let notes = 0;
  let notices = [];
  let tests = [];
  let supabaseTestMarks = [];
  let testSeriesAttempts = [];
  const testsMeta = readTestsMetadata() || {};

  try {
    const results = await Promise.allSettled([
      Student.find({
        $or: [
          { institute: { $in: allInstIds } },
          { user: { $in: allInstIds } },
        ],
      })
        .select(
          "name phone enrollmentNumber totalFees paidAmount pendingAmount feePlanType batch batches status isArchived lastActiveAt attendanceRecords",
        )
        .lean(),
      Batch.find({
        $or: [
          { institute: { $in: allInstIds } },
          { user: { $in: allInstIds } },
        ],
      })
        .select("_id name status scheduleDays startTime endTime")
        .lean(),
      Note.countDocuments({
        $or: [
          { institute: { $in: allInstIds } },
          { user: { $in: allInstIds } },
        ],
      }),
      Notice.find({
        $or: [
          { institute: { $in: allInstIds } },
          { user: { $in: allInstIds } },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .lean(),
      supabase
        .from("test_marks")
        .select("*")
        .in("institute_id", allInstIds),
      TestSeriesAttempt.find({
        institute: { $in: allInstIds },
      })
        .populate("testSeries", "title category totalMarks")
        .sort({ submittedAt: -1 })
        .limit(250)
        .lean()
        .catch(() => []),
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
    if (
      results[4].status === "fulfilled" &&
      results[4].value?.data &&
      Array.isArray(results[4].value.data)
    )
      supabaseTestMarks = results[4].value.data;
    if (results[5].status === "fulfilled" && Array.isArray(results[5].value))
      testSeriesAttempts = results[5].value;
  } catch (err) {
    console.error("Error gathering DB context for AI:", err);
  }

  // Also query standalone TestResult collection safely if available
  try {
    const mongoTests = await TestResult.find({
      institute: { $in: allInstIds },
    })
      .limit(250)
      .lean();
    if (Array.isArray(mongoTests)) {
      tests = mongoTests;
    }
  } catch (_) {}

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

  // Map test scores (Supabase test_marks + MongoDB TestResult + Online TestSeriesAttempt) per student
  const studentTestsMap = new Map();

  const addTestToStudentKey = (key, testEntry) => {
    const k = String(key || "").trim().toLowerCase();
    if (!k) return;
    if (!studentTestsMap.has(k)) studentTestsMap.set(k, []);
    studentTestsMap.get(k).push(testEntry);
  };

  // 1. Process Supabase test_marks table rows (Classroom / Offline test results)
  (supabaseTestMarks || []).forEach((row) => {
    const marksObj = row.marks || {};
    const testMeta = testsMeta[row.id] || {};
    const bracketSubject =
      row.test_name && row.test_name.includes("(") && row.test_name.includes(")")
        ? row.test_name.split("(").pop().replace(")", "").trim()
        : "";
    const resolvedSubject =
      testMeta.subject || bracketSubject || "General";
    const total = Number(row.max_marks || 100);
    const dateStr =
      row.test_date ||
      (row.created_at ? getISTDateStr(row.created_at) : "");

    for (const [stKey, val] of Object.entries(marksObj)) {
      const isAbsent =
        val === -1 ||
        Number(val) === -1 ||
        String(val).toLowerCase() === "absent" ||
        String(val).toLowerCase() === "a";
      const score = isAbsent ? 0 : Number(val || 0);
      const pct =
        isAbsent
          ? 0
          : total > 0
            ? Math.round((score / total) * 100)
            : 0;

      const testEntry = {
        title: row.test_name || "Unit Test",
        subject: resolvedSubject,
        score: isAbsent ? "Absent" : score,
        scoreNum: score,
        totalMarks: total,
        percentage: pct,
        isAbsent,
        date: dateStr,
        remarks: isAbsent ? "Absent" : "",
        type: "Classroom Test",
      };

      addTestToStudentKey(stKey, testEntry);
    }
  });

  // 2. Process MongoDB TestResult rows
  (tests || []).forEach((t) => {
    const sId = String(
      t.student?._id || t.student?.id || t.student || t.studentId || t.student_id || "",
    );
    if (!sId) return;

    const isAbsent =
      t.isAbsent === true ||
      t.score === -1 ||
      Number(t.score) === -1 ||
      String(t.score).toLowerCase() === "absent";
    const score = isAbsent ? 0 : Number(t.score || 0);
    const total = Number(t.totalMarks || 100);
    const pct =
      isAbsent
        ? 0
        : total > 0
          ? Math.round((score / total) * 100)
          : 0;

    const testEntry = {
      title: t.title || "Class Test",
      subject: t.subject || "General",
      score: isAbsent ? "Absent" : score,
      scoreNum: score,
      totalMarks: total,
      percentage: pct,
      isAbsent,
      date: t.examDate ? getISTDateStr(t.examDate) : (t.test_date || ""),
      remarks: t.remarks || (isAbsent ? "Absent" : ""),
      type: "Classroom Test",
    };

    addTestToStudentKey(sId, testEntry);
  });

  // 3. Process TestSeriesAttempt rows (Online Test Series)
  (testSeriesAttempts || []).forEach((ta) => {
    const sId = String(
      ta.student?._id || ta.student?.id || ta.student || "",
    );
    if (!sId) return;

    const seriesTitle =
      ta.testSeries?.title || ta.batchName || "Online Test Series";
    const seriesSubject = ta.testSeries?.category || "Test Series";
    const total = Number(ta.totalMarks || ta.testSeries?.totalMarks || 100);
    const score = Number(ta.score || 0);
    const pct =
      typeof ta.percentage === "number"
        ? Math.round(ta.percentage)
        : total > 0
          ? Math.round((score / total) * 100)
          : 0;

    const testEntry = {
      title: seriesTitle,
      subject: seriesSubject,
      score,
      scoreNum: score,
      totalMarks: total,
      percentage: pct,
      isAbsent: false,
      date: ta.submittedAt ? getISTDateStr(ta.submittedAt) : "",
      remarks: "",
      type: "Online Test Series",
    };

    addTestToStudentKey(sId, testEntry);
  });

  // Filter Active Enrolled Students & compute Attendance + Academic Metrics
  const activeStudents = [];
  const inactiveStudents = [];
  const todayPresentStudents = [];
  const todayAbsentStudents = [];
  const todayUnmarkedStudents = [];

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
      // Calculate overall attendance metrics
      const attRecords = Array.isArray(s.attendanceRecords)
        ? s.attendanceRecords
        : [];
      const totalSessions = attRecords.length;
      const presentSessions = attRecords.filter(
        (r) => r.status === "present",
      ).length;
      const absentSessions = totalSessions - presentSessions;
      const attendancePercentage =
        totalSessions > 0
          ? Math.round((presentSessions / totalSessions) * 100)
          : 100;

      s.attendancePct = attendancePercentage;
      s.totalSessions = totalSessions;
      s.presentSessions = presentSessions;
      s.absentSessions = absentSessions;

      // Today's attendance tracking (IST date)
      const todayRecord = attRecords.find(
        (r) => getISTDateStr(r.date) === todayISTStr,
      );
      if (todayRecord) {
        if (todayRecord.status === "present") {
          s.todayStatus = "Present";
          todayPresentStudents.push(s);
        } else if (todayRecord.status === "absent") {
          s.todayStatus = "Absent";
          todayAbsentStudents.push(s);
        } else {
          s.todayStatus = todayRecord.status || "Marked";
        }
      } else {
        s.todayStatus = "Not Marked";
        todayUnmarkedStudents.push(s);
      }

      // Attach test scores by checking all student identifiers
      const sId = String(s._id || s.id || "").trim().toLowerCase();
      const sUUID = toValidUUID(s._id || s.id).toLowerCase();
      const sEnrollment = String(s.enrollmentNumber || "").trim().toLowerCase();
      const sName = String(s.name || "").trim().toLowerCase();

      const combinedTests = [
        ...(studentTestsMap.get(sId) || []),
        ...(sUUID !== sId ? (studentTestsMap.get(sUUID) || []) : []),
        ...(sEnrollment ? (studentTestsMap.get(sEnrollment) || []) : []),
        ...(sName ? (studentTestsMap.get(sName) || []) : []),
      ];

      // Deduplicate if a test appears in both sources
      const seenTestKeys = new Set();
      const studentTests = [];
      for (const t of combinedTests) {
        const key = `${t.title}_${t.date}_${t.score}_${t.totalMarks}`;
        if (!seenTestKeys.has(key)) {
          seenTestKeys.add(key);
          studentTests.push(t);
        }
      }

      s.tests = studentTests;
      if (studentTests.length > 0) {
        const validPercentages = studentTests
          .filter((t) => !t.isAbsent)
          .map((t) => t.percentage);
        const avg =
          validPercentages.length > 0
            ? Math.round(
                validPercentages.reduce((acc, p) => acc + p, 0) /
                  validPercentages.length,
              )
            : 0;
        s.testAvgPct = avg;
      } else {
        s.testAvgPct = null;
      }

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

  // Complete Student Roster with Fees, Attendance & Academic Performance
  const fullRosterFormatted = activeStudents
    .map((s, idx) => {
      const bNames = getStudentBatchNames(s);
      const due = Number(s.pendingAmount || 0);
      const feeStatus =
        due > 0
          ? `Pending: ₹${due.toLocaleString("en-IN")}`
          : "Paid / No Due";
      const attText =
        s.totalSessions > 0
          ? `${s.attendancePct}% (${s.presentSessions}/${s.totalSessions} present)`
          : `100% (No marked absences)`;
      const todayText =
        s.todayStatus === "Present"
          ? "✅ Present Today"
          : s.todayStatus === "Absent"
            ? "❌ Absent Today"
            : "⏳ Today Not Marked";

      let testSummary = "No tests recorded yet";
      if (s.tests && s.tests.length > 0) {
        const testsList = s.tests
          .slice(0, 6)
          .map(
            (t) =>
              `${t.title} [${t.subject}]: ${t.score}/${t.totalMarks} (${t.percentage}%)`,
          )
          .join("; ");
        testSummary = `${s.tests.length} tests completed (Avg: ${s.testAvgPct}%). Recent: ${testsList}`;
      }

      return `${idx + 1}. **${s.name}** | Batch: ${bNames} | Phone: ${s.phone || "N/A"} | Today: ${todayText} | Overall Attendance: ${attText} | Fees: ${feeStatus}\n   • Academic & Test Scores: ${testSummary}`;
    })
    .join("\n\n");

  // Attendance Highlights
  const studentsWithAttendance = activeStudents.filter(
    (s) => s.totalSessions > 0,
  );
  const below75Attendance = activeStudents.filter(
    (s) => s.totalSessions > 0 && s.attendancePct < 75,
  );
  const perfectAttendance = activeStudents.filter(
    (s) => s.attendancePct === 100,
  );

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

  const todayPresentNames =
    todayPresentStudents
      .map((s) => `${s.name} (${getStudentBatchNames(s)})`)
      .join(", ") || "None marked present today";
  const todayAbsentNames =
    todayAbsentStudents
      .map((s) => `${s.name} (${getStudentBatchNames(s)})`)
      .join(", ") || "None marked absent today";
  const todayUnmarkedCount = todayUnmarkedStudents.length;

  const contextStr = `
Institute Live Snapshot:
• Date Today (IST): ${todayISTStr}
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

Today's Attendance Snapshot (${todayISTStr}):
• Present Today (${todayPresentStudents.length}): ${todayPresentNames}
• Absent Today (${todayAbsentStudents.length}): ${todayAbsentNames}
• Not Marked Yet Today (${todayUnmarkedCount} students): ${todayUnmarkedCount > 0 ? (todayUnmarkedCount <= 12 ? todayUnmarkedStudents.map((s) => `${s.name} (${getStudentBatchNames(s)})`).join(", ") : `${todayUnmarkedCount} students pending mark`) : "All students marked"}

Students Roster by Batch:
${batchWiseRoster || "No active batches."}

Complete Active Student Roster (${activeStudents.length} Active Students with Today's Attendance, Overall Attendance, Fees, and Test Marks):
${fullRosterFormatted || "No enrolled students."}
`;

  const systemInstruction = `You are ClassTech AI, the intelligent, friendly, and ultra-accurate management assistant for this coaching institute.
Use the real-time context above and ongoing conversation history to answer all questions accurately, concisely, and cleanly.

CRITICAL OPERATIONAL RULES:

1. TODAY'S ATTENDANCE INQUIRIES:
   - When asked questions like:
     * "How many students were present today?"
     * "Tell me today's absent students" / "Who is absent today?"
     * "Who came today?" / "Attendance of today"
   - Answer directly using "Today's Attendance Snapshot" for date ${todayISTStr}:
     • If asked about present students: State the exact count (**${todayPresentStudents.length}**) and list their names and batches. If 0 present, explain that no students are marked present yet today.
     • If asked about absent students: State the exact count (**${todayAbsentStudents.length}**) and list their names and batches. If 0 absent, mention that no students have been marked absent today.
     • If attendance hasn't been marked for students, clearly note that ${todayUnmarkedCount} student(s) have not had attendance recorded yet today.

2. STUDENT ACADEMIC REPORT CARD & PERFORMANCE ANALYSIS:
   - When asked "How is [Student Name] doing?", "Give me a report card of [Student Name]", "Analyze [Student Name]'s marks", or about any student's performance:
   - Find the student by name in the student roster and test data above (fuzzy match case-insensitively, e.g. "Priyanshu" matches any student named "PRIYANSHU" or "Priyanshu").
   - Carefully inspect that student's "• Academic & Test Scores" field in the Complete Active Student Roster.
   - If tests are listed there, you MUST list out every single test:
     • Test Title and Subject (e.g. "Unit Test 34 [General]")
     • Marks obtained and Total Marks (e.g. "20/50 (40%)")
     • Date of examination if available
     • Overall average percentage across all tests
   - NEVER state "No test marks have been recorded in the system yet" if the student has tests listed in their roster entry! Only state that if the field explicitly says "No tests recorded yet".
   - Highlight their performance, strongest areas, and subjects requiring improvement.
   - Combine with their Attendance (today's status and overall %) and Fee status to produce an encouraging, comprehensive, and professional **Student Academic Report Card**.

3. CONTEXTUAL FOLLOW-UPS & MULTI-TURN MEMORY:
   - You maintain full conversational context. If the user refers to previous questions (e.g., "what about his fees?", "is he present?", "show for the other batch", "yes please do that", "generate it"), use the ongoing conversation history to understand who or what they are referring to without asking them to repeat themselves.

4. SUMMARY OF ENROLLED STUDENTS:
   - When asked for a "summary", "overview", or "total enrolled students":
   - ALWAYS report the count of ACTIVE students (**${activeStudents.length}**) as Total Enrolled Students. Never report archived or inactive students in the total enrolled figure.

5. LIST DOWN ALL STUDENTS:
   - When asked to "list down all students", "show all students", "give student roster", or "list students":
   - You MUST list ALL ${activeStudents.length} active students from the "Complete Active Student Roster" above!
   - List EVERY SINGLE student IRRESPECTIVE of their pending fees.
   - Show their sequential number, name, and batch.

6. STUDENTS OF A PARTICULAR BATCH:
   - When asked for students of any particular batch:
   - Identify the requested batch name from "Students Roster by Batch" or the student roster.
   - List all students enrolled in that specific batch.
   - If that batch has no students, clearly state that no students are currently enrolled.

7. ATTENDANCE QUERIES & NUMERIC FILTERING:
   - When asked to list students having attendance less than, greater than, or equal to a percentage:
     * Filter students directly based on their exact Attendance percentage from the active student roster.
     * List all matching students with sequential number, Student Name, Batch Name, and exact Attendance Percentage & Ratio.

8. FORMATTING RULES:
   - Write in a natural, clean, professional style.
   - Use clean bullet points (• or -).
   - Highlight key metrics with single bold (e.g. • Total Enrolled Students: **${activeStudents.length}**).
   - Never use double bold syntax like "**Label:** **Value**" (bold only the value or label, not both).
   - Do NOT use markdown headers with hashtags (### or ##); use emoji headings or clear labels instead.
   - Keep answers crisp, helpful, and focused on coaching/tuition operations.
   - Answer in the language requested (English or Hinglish).

Real-time Context:
8. MATHEMATICAL FORMULAS, MATRICES & FRACTIONS:
   - When answering questions involving mathematics, physics, or science, write them realistically just as we write on paper and in textbooks.
   - For fractions like 1/2, 1/3, 1/4: Use clean Unicode fractions (½, ⅓, ¼) or clear notation like ½(A + B).
   - For matrices, format them realistically and cleanly so they are easy to read and understand on mobile screens:
     * Keep columns neatly aligned row by row:
       [ 3,  1 ]
       [ 5, -1 ]
       or wrap multi-line matrix calculations in monospace blocks so columns never get distorted or staggered.
     * When showing operations like matrix multiplication, write each row and calculation clearly step-by-step.
   - Always write mathematical formulas using standard, readable Unicode symbols: ∫, dy/dx, √, ², ³, ÷, ×, ±, ≈, ≤, ≥, ≠, π, θ, Δ, etc.
   - NEVER wrap formulas or text in raw '$' or '$$' signs.
   - Do NOT use unescaped LaTeX commands like \\frac or \\int when clean Unicode and standard paper-like notation can be used.

${contextStr}`;

  return await callGeminiRaw({
    prompt: question,
    systemInstruction,
    temperature: 0.2,
    history,
  });
}

// 8. Task D: Announcement & WhatsApp Broadcast Generator
export async function generateNoticeAnnouncement(
  instituteId,
  topic,
  history = [],
) {
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
    history,
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
  history = [],
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
      history,
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
  history = [],
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
    history,
  });
}

// 11. Task G: Structured Notes Generator
export async function generateStructuredNotes(
  promptOrTopic,
  targetClass = "Class 10",
  history = [],
) {
  let topic = (promptOrTopic || "Revision Notes").trim();
  const matchQuote = topic.match(/topic:\s*["']([^"']+)["']/i);
  if (matchQuote && matchQuote[1]) {
    topic = matchQuote[1].trim();
  } else {
    const matchOn = topic.match(/(?:notes\s+on|about)\s+([A-Za-z0-9\s\-]+?)(?:\s+for|\.|$)/i);
    if (matchOn && matchOn[1]) {
      topic = matchOn[1].trim();
    } else if (topic.toLowerCase().startsWith("generate ")) {
      topic = topic
        .replace(/^Generate\s+(?:comprehensive\s+|detailed\s+|quick\s+)?(?:study\s+)?notes\s+(?:on\s+topic:\s*|on\s+|about\s+)?/i, "")
        .replace(/\s+for\s+Class\s+\d+.*$/i, "")
        .replace(/["']/g, "")
        .trim();
    }
  }
  if (!topic || topic.length > 60) {
    topic = topic ? topic.substring(0, 60).trim() : "Revision Notes";
  }

  const prompt = `You are a master educator creating high-quality, comprehensive study and revision notes for students.
Topic: "${topic}"
Target Grade / Level: "${targetClass}"

Create comprehensive, structured chapter revision notes on "${topic}".
Rules:
- Title must be exactly: "${topic}". Do NOT output prompt instructions or request text.
- STRICT BRANDING RULE: Do NOT mention "ClassTech", "classtech.in", or any corporate/app branding anywhere.
- Format text continuously without artificial line breaks in the middle of sentences. Paragraphs and bullet points must flow as full continuous sentences.
- STRICT NO-ASCII-ART / NO-BOX-DRAWING RULE: NEVER use ASCII art or box characters (┌, ─, │, ├, etc.). Use clean Markdown tables or arrow process steps.
- COMPARISONS & FLOWCHARTS: When comparing concepts or illustrating categories/types, ALWAYS use a clean standard Markdown table (e.g. | Column 1 | Column 2 | with | --- | --- |) or clean bulleted process steps with arrows (e.g. Step 1 ➔ Step 2 ➔ Step 3).
- RELEVANT IMAGES: Include an educational illustration/diagram ONLY IF genuinely relevant to the topic (e.g. Science diagrams, Anatomy, Geography maps, Geometric figures, Physics circuits, Historical events). Use standard markdown image format: ![Diagram: Description](url) or leave it out if not needed.
- Structure with clear sections:
  # ${topic}
  ## 1. Overview & Key Objectives
  ## 2. Core Definitions & Foundational Principles
  ## 3. Important Concepts & Detailed Explanations
  ## 4. Key Classifications / Formulas / Comparisons
  ## 5. Solved Illustrations & Key Examples
  ## 6. Exam Tips, Common Mistakes & High-Yield Points
  ## 7. Chapter Summary
- Provide real, in-depth, deeply educational content explaining "${topic}" thoroughly.

Output the notes directly in clean Markdown format starting with '# ${topic}'.`;

  try {
    const raw = await callGeminiRaw({
      prompt,
      systemInstruction: `You are an expert teacher. Write full comprehensive study and revision notes on topic: "${topic}" for ${targetClass}. Output directly in clean Markdown format starting with '# ${topic}'. Do not include prompt text or metadata.`,
      temperature: 0.3,
    });

    if (raw && raw.trim().length > 30) {
      let content = raw.trim();

      // Check if wrapped in JSON codeblock
      const parsed = extractJsonFromText(content);
      if (parsed && parsed.notesText) {
        content = parsed.notesText;
      }

      // Remove any prompt echoes if LLM repeated the prompt
      content = content.replace(/^Generate\s+Comprehensive\s+study\s+notes\s+on\s+topic:.*?\n+/i, '');
      content = content.replace(/^#\s*Generate\s+Comprehensive\s+study\s+notes\s+on\s+topic:.*?\n+/i, '');

      // Ensure it starts with # Topic
      if (!content.startsWith('#')) {
        content = `# ${topic}\n\n` + content;
      }

      return {
        title: `${topic} - ${targetClass} Notes`,
        topic: topic,
        category: "Chapter Notes",
        notesText: content,
      };
    }
  } catch (err) {
    console.error("generateStructuredNotes error:", err.message);
  }

  return {
    title: `${topic} - ${targetClass} Notes`,
    topic: topic,
    category: "Chapter Notes",
    notesText: `# ${topic}\n\n## 1. Overview & Key Objectives\nComprehensive revision notes and foundational concepts for ${topic} (${targetClass}).\n\n## 2. Core Definitions & Principles\n• Fundamental principles and definitions of ${topic}.\n• Key conceptual frameworks and core laws.\n\n## 3. Important Concepts & Detailed Analysis\n• Critical components and operational mechanisms.\n• Detailed analysis and comparative distinctions.\n\n## 4. Key Takeaways & Exam Summary\n• High-yield exam points, formula review, and practical takeaways.`,
  };
}

// 12. Task H: Comprehensive Test Series Generator
export async function generateComprehensiveTestSeries({
  topic = "General Test",
  targetExam = "Class 10",
  numQuestions = 10,
  correctMarks = 4,
  negativeMarks = 1,
  durationMinutes = 30,
  difficulty = "Medium",
}, history = []) {
  const count = Math.min(30, Math.max(1, parseInt(numQuestions, 10) || 10));
  const cMarks = Number(correctMarks) || 4;
  const nMarks = Number(negativeMarks) || 1;
  const duration = Number(durationMinutes) || 30;

  const prompt = `Create an official, high-quality test series paper.
Topic: "${topic}"
Target Level / Exam: "${targetExam}"
Number of Questions: ${count}
Marks per correct question: +${cMarks}
Negative marks per wrong question: -${nMarks}
Duration: ${duration} minutes
Difficulty: "${difficulty}"

Rules:
- Generate exactly ${count} multiple choice questions (MCQs).
- Each question must have 4 clear, plausible options (A, B, C, D).
- Specify correctOption as an integer 0, 1, 2, or 3 corresponding to option index.
- Provide a clear, step-by-step explanation for each question.
- Write math/science formulas using standard Unicode symbols (e.g. ∫, dy/dx, √, ², ³, ÷, ×, ±, ≈, ≤, ≥, ≠, π, θ). Do NOT use raw $ or $$ signs.

Return ONLY valid JSON:
{
  "title": "${topic} Test Series (${targetExam})",
  "category": "${targetExam}",
  "durationMinutes": ${duration},
  "passingMarks": ${Math.round(count * cMarks * 0.4)},
  "totalMarks": ${count * cMarks},
  "correctMarks": ${cMarks},
  "negativeMarks": ${nMarks},
  "instructions": "Attempt all questions. Each correct answer carries +${cMarks} marks. Each incorrect answer deducts -${nMarks} marks. Test cannot be paused once started.",
  "questions": [
    {
      "id": "q_1",
      "question": "Question text here",
      "type": "single_choice",
      "marks": ${cMarks},
      "negativeMarks": ${nMarks},
      "options": [
        {"id": "opt_0", "text": "Option A text", "isCorrect": true},
        {"id": "opt_1", "text": "Option B text", "isCorrect": false},
        {"id": "opt_2", "text": "Option C text", "isCorrect": false},
        {"id": "opt_3", "text": "Option D text", "isCorrect": false}
      ],
      "correctOption": 0,
      "explanation": "Detailed explanation of the correct answer."
    }
  ]
}`;

  try {
    const raw = await callGeminiRaw({
      prompt,
      systemInstruction: "You are an expert examiner creating professional test series and mock exams. Return strictly valid JSON.",
      temperature: 0.3,
      history,
    });
    const parsed = extractJsonFromText(raw);
    if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
      return parsed;
    }
  } catch (err) {
    console.error("generateComprehensiveTestSeries error:", err.message);
  }

  return {
    title: `${topic} Test Series`,
    category: targetExam,
    durationMinutes: duration,
    passingMarks: Math.round(count * cMarks * 0.4),
    totalMarks: count * cMarks,
    correctMarks: cMarks,
    negativeMarks: nMarks,
    instructions: `Answer all questions within ${duration} minutes.`,
    questions: [
      {
        id: "q_1",
        question: `Sample Question on ${topic}`,
        type: "single_choice",
        marks: cMarks,
        negativeMarks: nMarks,
        options: [
          {"id": "opt_0", "text": "Correct Option", "isCorrect": true},
          {"id": "opt_1", "text": "Distractor B", "isCorrect": false},
          {"id": "opt_2", "text": "Distractor C", "isCorrect": false},
          {"id": "opt_3", "text": "Distractor D", "isCorrect": false}
        ],
        correctOption: 0,
        explanation: "Correct explanation."
      }
    ]
  };
}

// 13. Task I: Student Assignment Generator
export async function generateAssignment({
  topic = "General Assignment",
  numQuestions = 10,
  difficulty = "Medium",
  batchName = "Selected Batch",
  imageBase64 = null,
  imageMimeType = "image/jpeg",
}, history = []) {
  const count = Math.min(25, Math.max(1, parseInt(numQuestions, 10) || 10));

  const prompt = `You are an expert teacher creating a comprehensive student homework / practice assignment.
${imageBase64 ? "The teacher has uploaded a photo. Analyze the questions/concepts in the photo and create an assignment around this topic." : `Topic: "${topic}".`}
Number of Questions: ${count}
Difficulty: "${difficulty}"
Target Batch: "${batchName}"

Rules:
- Generate a well-structured assignment with:
  * Title and target Batch
  * Section A: Conceptual & Short Answer Questions
  * Section B: Numerical / Problem-Solving Questions
  * Section C: Higher Order Thinking / Long Answer Questions
  * Answer Key & Hints: Clear step-by-step solutions/hints at the end.
- Use standard Unicode mathematical symbols (∫, dy/dx, √, ², ³, ÷, ×, ±, ≈, ≤, ≥, ≠, π, θ). Do NOT use raw $ or $$ signs.

Return ONLY valid JSON:
{
  "title": "${topic} - Assignment",
  "topic": "${topic}",
  "numQuestions": ${count},
  "difficulty": "${difficulty}",
  "batchName": "${batchName}",
  "assignmentText": "Full formatted assignment text with sections, question numbers, sub-parts, and solution key."
}`;

  try {
    const raw = await callGeminiRaw({
      prompt,
      systemInstruction: "You are an expert curriculum designer. Return strictly valid JSON.",
      imageBase64,
      imageMimeType,
      temperature: 0.3,
      history,
    });
    const parsed = extractJsonFromText(raw);
    if (parsed && parsed.assignmentText) {
      return parsed;
    }
  } catch (err) {
    console.error("generateAssignment error:", err.message);
  }

  return {
    title: `${topic} - Assignment`,
    topic,
    numQuestions: count,
    difficulty,
    batchName,
    assignmentText: `# ${topic} Assignment\n\n**Batch**: ${batchName} | **Difficulty**: ${difficulty}\n\n## Section A: Conceptual Questions\n1. Explain the fundamental principles of ${topic}.\n2. State the key laws and governing equations.\n\n## Section B: Practice Problems\n3. Solve the standard problem with given parameters.\n\n## Answer Key & Hints\n• Detailed hints and solutions for all problems.`,
  };
}
