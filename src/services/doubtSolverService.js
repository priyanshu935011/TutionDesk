import { supabase } from "../utils/supabase.js";
import { callGeminiRaw, extractJsonFromText } from "./aiService.js";
import { logAiHarvest } from "../utils/aiHarvestLogger.js";
import { ingestMistake } from "./mistakeBookService.js";
import { formatDisplayMath } from "../utils/mathFormatter.js";
import fs from "fs";
import path from "path";

const FALLBACK_DIR = process.env.FALLBACK_DIR || path.join(process.cwd(), "scratch", "data");
const DOUBTS_FALLBACK_FILE = path.join(FALLBACK_DIR, "doubts_fallback.json");

function getFallbackStore() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    if (fs.existsSync(DOUBTS_FALLBACK_FILE)) {
      return JSON.parse(fs.readFileSync(DOUBTS_FALLBACK_FILE, "utf-8"));
    }
  } catch (_) {}
  return { doubts: {} };
}

function saveFallbackStore(store) {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    fs.writeFileSync(DOUBTS_FALLBACK_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[DoubtSolver] Fallback store write error:", err);
  }
}

/**
 * Check student daily doubt usage quota
 */
export async function checkDailyDoubtQuota(userId) {
  const uid = String(userId);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let todayCount = 0;
  let isPremium = false;

  try {
    // Check if student has active ClassTech Premium
    const { data: subData } = await supabase
      .from("student_subscriptions")
      .select("status, current_period_end")
      .eq("user_id", uid)
      .eq("status", "active")
      .gt("current_period_end", new Date().toISOString())
      .maybeSingle();

    if (subData) isPremium = true;

    // Count doubts solved today
    const { count } = await supabase
      .from("student_doubts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", uid)
      .gte("created_at", todayStart.toISOString());

    todayCount = count || 0;
  } catch (_) {
    const store = getFallbackStore();
    const userDoubts = Object.values(store.doubts || {}).filter(
      (d) => String(d.user_id) === uid && new Date(d.created_at) >= todayStart
    );
    todayCount = userDoubts.length;
  }

  const freeLimit = 5;
  const remaining = isPremium ? 9999 : Math.max(0, freeLimit - todayCount);
  const canSolve = isPremium || todayCount < freeLimit;

  return {
    isPremium,
    todayCount,
    freeLimit,
    remaining,
    canSolve,
  };
}

/**
 * 1. Solve Doubt with Gemini Multimodal AI
 */
export async function solveDoubtWithAi({
  userId,
  instituteId = null,
  questionText = "",
  imageBase64 = null,
  mimeType = "image/jpeg",
  subject = "General",
  gradeLevel = "Class 11/12 - JEE/NEET",
  studentNotes = "",
}) {
  const uid = String(userId);

  if (!questionText.trim() && !imageBase64) {
    throw new Error("Please provide question text or an image.");
  }

  // Quota check
  const quota = await checkDailyDoubtQuota(uid);
  if (!quota.canSolve) {
    throw new Error(
      `Daily free doubt limit (${quota.freeLimit} doubts) reached. Upgrade to ClassTech Premium for unlimited doubt solving.`
    );
  }

  const prompt = `
You are a distinguished master educator and problem solver for competitive exams (JEE Main & Advanced, NEET, CBSE, ICSE, Olympiad, SAT).
A student has asked this doubt:

Target Grade / Level: ${gradeLevel || "Class 11/12"}
Subject Preference: ${subject || "General"}
Student's Specific Notes: "${studentNotes || "None"}"

${questionText.trim() ? `Question Text:\n"${questionText.trim()}"` : "Question is provided in the attached image."}

TASK:
Solve this academic doubt with supreme clarity, precision, and educational quality.
Break your solution into a pedagogical structure so the student truly understands every step.
CRITICAL FORMATTING RULES:
- Never use raw ASCII carets or bracketed powers like [M^0 L T^(-3)] or x^2 or 10^(-6). Format all dimensional formulas, physical units, exponents, and mathematical powers using real-world Unicode superscripts: e.g. [M⁰ L T⁻³], [M¹ L² T⁻²], 10⁻⁶, x², cm³, kg m⁻³.
- Never wrap simple standalone numbers or arithmetic in stray dollar signs (never output $2$, $2 + 2$, or $a = 2$; write them cleanly as 2, 2 + 2, a = 2).

Return ONLY a valid JSON object matching this exact schema:
{
  "extractedQuestion": "Clean, full text of the question (use clean formatting or LaTeX for equations)",
  "subject": "Physics" | "Chemistry" | "Mathematics" | "Biology" | "General",
  "chapter": "Specific chapter name",
  "topic": "Specific topic name",
  "difficulty": "easy" | "medium" | "hard",
  "givenParameters": "Clear list of known variables and target variable (e.g. Mass m = 2 kg, Speed v = 10 m/s, Find: Work W)",
  "governingFormula": "The core theorem, law, or mathematical formula with LaTeX symbols",
  "steps": [
    {
      "stepNumber": 1,
      "title": "Title of step (e.g. Setting up Force Balance)",
      "explanation": "Clear prose explaining the physical/mathematical reasoning",
      "latex": "Formula or algebraic line (e.g. F_net = m * a)"
    },
    {
      "stepNumber": 2,
      "title": "Title of step (e.g. Solving for target variable)",
      "explanation": "Calculation details",
      "latex": "W = \\int F \\cdot dr = 100\\text{ J}"
    }
  ],
  "finalAnswer": "Boxed final answer with exact numerical value and units (e.g. 100 Joules or Option C)",
  "memoryTip": "A sharp 1-2 sentence golden rule or mnemonic trick to remember for exams",
  "commonPitfall": "The exact trap, false assumption, or calculation slip students typically make here"
}
`;

  let solutionData = null;
  let rawAiResponse = "";

  try {
    rawAiResponse = await callGeminiRaw({
      prompt,
      systemInstruction:
        "You are an expert IIT-JEE / NEET faculty. Return pure JSON with mathematical rigor and step-by-step clarity.",
      imageBase64,
      imageMimeType: mimeType,
      temperature: 0.2,
    });

    solutionData = extractJsonFromText(rawAiResponse);
  } catch (err) {
    console.error("[DoubtSolver] Gemini call error:", err);
    throw new Error(`AI Doubt Solver failed: ${err.message}`);
  }

  if (!solutionData || !solutionData.finalAnswer) {
    // Graceful fallback structure
    solutionData = {
      extractedQuestion: questionText || "Uploaded question",
      subject: subject || "General",
      chapter: "General Studies",
      topic: "Problem Solving",
      difficulty: "medium",
      givenParameters: "Extracted from question stem",
      governingFormula: "Standard analytical approach",
      steps: [
        {
          stepNumber: 1,
          title: "Identify given constraints",
          explanation: rawAiResponse.substring(0, 300) || "Analyze the problem setup carefully.",
          latex: "",
        },
      ],
      finalAnswer: "Refer to detailed steps above.",
      memoryTip: "Double check units and boundary conditions.",
      commonPitfall: "Misreading question constraints.",
    };
  }

  // Sanitize and format powers to real-world superscripts across all solution fields
  if (solutionData.extractedQuestion) solutionData.extractedQuestion = formatDisplayMath(solutionData.extractedQuestion);
  if (solutionData.givenParameters) solutionData.givenParameters = formatDisplayMath(solutionData.givenParameters);
  if (solutionData.governingFormula) solutionData.governingFormula = formatDisplayMath(solutionData.governingFormula);
  if (solutionData.finalAnswer) solutionData.finalAnswer = formatDisplayMath(solutionData.finalAnswer);
  if (solutionData.memoryTip) solutionData.memoryTip = formatDisplayMath(solutionData.memoryTip);
  if (solutionData.commonPitfall) solutionData.commonPitfall = formatDisplayMath(solutionData.commonPitfall);
  if (Array.isArray(solutionData.steps)) {
    solutionData.steps = solutionData.steps.map((s) => ({
      ...s,
      title: formatDisplayMath(s.title || ""),
      explanation: formatDisplayMath(s.explanation || ""),
      latex: formatDisplayMath(s.latex || ""),
    }));
  }

  const doubtRecord = {
    id: `dbt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    user_id: uid,
    institute_id: instituteId,
    question_text: solutionData.extractedQuestion || questionText || "Photo Doubt",
    question_image_url: imageBase64 ? `data:${mimeType};base64,${imageBase64}` : "",
    subject: solutionData.subject || subject || "General",
    chapter: solutionData.chapter || "",
    topic: solutionData.topic || "",
    difficulty: solutionData.difficulty || "medium",
    status: "solved",
    solution_data: solutionData,
    followup_messages: [],
    is_starred: false,
    is_added_to_mistake_book: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // 1. Save Doubt to Database
  try {
    await supabase.from("student_doubts").insert(doubtRecord);
  } catch (_) {
    const store = getFallbackStore();
    store.doubts[doubtRecord.id] = doubtRecord;
    saveFallbackStore(store);
  }

  // 2. USER REQUIREMENT: Save in AI Harvest Training Table
  try {
    await logAiHarvest({
      instituteId,
      user: { _id: uid, role: "student" },
      taskType: "DOUBT_SOLVER",
      prompt: questionText || "[Image Question]",
      response: rawAiResponse || JSON.stringify(solutionData),
      generatedContent: solutionData,
      metadata: {
        subject: doubtRecord.subject,
        chapter: doubtRecord.chapter,
        difficulty: doubtRecord.difficulty,
        hasImage: Boolean(imageBase64),
      },
    });
  } catch (harvestErr) {
    console.warn("[DoubtSolver] AI Harvest logging error:", harvestErr.message);
  }

  return doubtRecord;
}

/**
 * 2. Ask Follow-up Question in Doubt Thread
 */
export async function askDoubtFollowup({
  userId,
  instituteId = null,
  doubtId,
  userMessage,
}) {
  const uid = String(userId);
  const dId = String(doubtId);

  // Fetch doubt
  let doubt = null;
  try {
    const { data } = await supabase
      .from("student_doubts")
      .select("*")
      .eq("id", dId)
      .eq("user_id", uid)
      .single();
    if (data) doubt = data;
  } catch (_) {
    const store = getFallbackStore();
    doubt = store.doubts[dId];
  }

  if (!doubt) {
    throw new Error("Doubt record not found");
  }

  const existingMessages = Array.isArray(doubt.followup_messages) ? doubt.followup_messages : [];
  const sol = doubt.solution_data || {};

  const prompt = `
You are the personal AI tutor who just solved this problem for the student:
Original Question:
"${doubt.question_text}"

Your Previous Solution:
Governing Formula: ${sol.governingFormula || ""}
Final Answer: ${sol.finalAnswer || ""}
Key Steps: ${JSON.stringify(sol.steps || [])}

Previous Conversation History:
${JSON.stringify(existingMessages)}

The student is asking this FOLLOW-UP question:
"${userMessage}"

TASK:
Provide an encouraging, clear, and direct explanation addressing their exact confusion. Use simple analogies or mathematical working if needed. Keep tone supportive and teacher-like.
`;

  let aiReply = "";
  try {
    aiReply = await callGeminiRaw({
      prompt,
      systemInstruction: "You are a warm, highly clear IIT-JEE / NEET professor answering a student's follow-up doubt.",
      temperature: 0.3,
    });
  } catch (err) {
    aiReply = "I understand your question! Review the governing formula and substitute the parameters carefully. If you need step-by-step re-derivation, let me know!";
  }

  const now = new Date().toISOString();
  const updatedMessages = [
    ...existingMessages,
    { sender: "user", message: userMessage, timestamp: now },
    { sender: "ai", message: aiReply.trim(), timestamp: new Date().toISOString() },
  ];

  // Update Database
  try {
    await supabase
      .from("student_doubts")
      .update({
        followup_messages: updatedMessages,
        updated_at: new Date().toISOString(),
      })
      .eq("id", dId);
  } catch (_) {
    const store = getFallbackStore();
    if (store.doubts[dId]) {
      store.doubts[dId].followup_messages = updatedMessages;
      saveFallbackStore(store);
    }
  }

  // USER REQUIREMENT: Log Followup to AI Harvest Table
  try {
    await logAiHarvest({
      instituteId,
      user: { _id: uid, role: "student" },
      taskType: "DOUBT_FOLLOWUP",
      prompt: userMessage,
      response: aiReply,
      generatedContent: { doubtId: dId, originalQuestion: doubt.question_text },
      metadata: { doubtId: dId, subject: doubt.subject },
    });
  } catch (harvestErr) {
    console.warn("[DoubtSolver] AI Harvest followup error:", harvestErr.message);
  }

  return {
    doubtId: dId,
    userMessage,
    aiReply: aiReply.trim(),
    messages: updatedMessages,
  };
}

/**
 * 3. Get Student Doubt History & Analytics
 */
export async function getStudentDoubtHistory({
  userId,
  instituteId = null,
  subject = "all",
  isStarredOnly = false,
  search = "",
  page = 1,
  limit = 30,
}) {
  const uid = String(userId);
  let allDoubts = [];

  try {
    let query = supabase
      .from("student_doubts")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (instituteId) query = query.eq("institute_id", instituteId);

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      allDoubts = data;
    }
  } catch (_) {
    const store = getFallbackStore();
    allDoubts = Object.values(store.doubts || {}).filter((d) => String(d.user_id) === uid);
  }

  // Analytics
  const totalDoubts = allDoubts.length;
  let starredCount = 0;
  const subjectCounts = {};

  allDoubts.forEach((d) => {
    if (d.is_starred) starredCount++;
    const s = d.subject || "General";
    subjectCounts[s] = (subjectCounts[s] || 0) + 1;
  });

  // Filter in memory
  let filtered = allDoubts.filter((d) => {
    if (subject && subject !== "all" && d.subject?.toLowerCase() !== subject.toLowerCase()) {
      return false;
    }
    if (isStarredOnly && !d.is_starred) {
      return false;
    }
    if (search && search.trim()) {
      const q = search.toLowerCase();
      const matchQ = (d.question_text || "").toLowerCase().includes(q);
      const matchCh = (d.chapter || "").toLowerCase().includes(q);
      const matchTop = (d.topic || "").toLowerCase().includes(q);
      if (!matchQ && !matchCh && !matchTop) return false;
    }
    return true;
  });

  const p = Math.max(1, Number(page) || 1);
  const lim = Math.max(1, Number(limit) || 30);
  const paginated = filtered.slice((p - 1) * lim, p * lim);

  const quota = await checkDailyDoubtQuota(uid);

  return {
    analytics: {
      totalDoubts,
      starredCount,
      subjectCounts,
      quota,
    },
    items: paginated,
    pagination: {
      total: filtered.length,
      page: p,
      limit: lim,
      totalPages: Math.ceil(filtered.length / lim),
    },
  };
}

/**
 * 4. Toggle Doubt Star
 */
export async function toggleDoubtStar({ userId, doubtId }) {
  const uid = String(userId);
  const dId = String(doubtId);

  let current = false;
  try {
    const { data } = await supabase
      .from("student_doubts")
      .select("is_starred")
      .eq("id", dId)
      .eq("user_id", uid)
      .single();
    if (data) current = Boolean(data.is_starred);

    await supabase
      .from("student_doubts")
      .update({ is_starred: !current })
      .eq("id", dId);
  } catch (_) {
    const store = getFallbackStore();
    if (store.doubts[dId]) {
      current = Boolean(store.doubts[dId].is_starred);
      store.doubts[dId].is_starred = !current;
      saveFallbackStore(store);
    }
  }

  return { doubtId: dId, isStarred: !current };
}

/**
 * 5. Convert Solved Doubt to AI Mistake Notebook Entry
 */
export async function saveDoubtToMistakeNotebook({
  userId,
  instituteId = null,
  doubtId,
  studentNotes = "",
  mistakeReasonTag = "conceptual",
}) {
  const uid = String(userId);
  const dId = String(doubtId);

  // Fetch doubt
  let doubt = null;
  try {
    const { data } = await supabase
      .from("student_doubts")
      .select("*")
      .eq("id", dId)
      .eq("user_id", uid)
      .single();
    if (data) doubt = data;
  } catch (_) {
    const store = getFallbackStore();
    doubt = store.doubts[dId];
  }

  if (!doubt) {
    throw new Error("Doubt not found");
  }

  const sol = doubt.solution_data || {};

  // Ingest into Mistake Book
  const mistake = await ingestMistake({
    userId: uid,
    instituteId,
    questionText: doubt.question_text,
    questionImageUrl: doubt.question_image_url || "",
    correctAnswer: [sol.finalAnswer || "Correct Answer"],
    studentWrongAnswer: ["Doubt / Stuck"],
    explanation: Array.isArray(sol.steps)
      ? sol.steps.map((s) => `${s.title}: ${s.explanation}`).join("\n")
      : sol.governingFormula || "Step by step solution provided",
    aiRootCause: sol.commonPitfall || "Stuck during homework / problem solving",
    aiMicroConcept: sol.memoryTip || sol.governingFormula || "",
    subject: doubt.subject || "General",
    chapter: doubt.chapter || "",
    topic: doubt.topic || "",
    sourceChannel: "doubt_solver",
    sourceReferenceId: dId,
    sourceTitle: `Doubt: ${doubt.question_text.substring(0, 30)}...`,
    mistakeReasonTag: mistakeReasonTag || "conceptual",
    studentNotes: studentNotes || doubt.student_notes || "",
  });

  // Update doubt record
  try {
    await supabase
      .from("student_doubts")
      .update({
        is_added_to_mistake_book: true,
        mistake_id: mistake.id,
      })
      .eq("id", dId);
  } catch (_) {
    const store = getFallbackStore();
    if (store.doubts[dId]) {
      store.doubts[dId].is_added_to_mistake_book = true;
      store.doubts[dId].mistake_id = mistake.id;
      saveFallbackStore(store);
    }
  }

  // Harvest this conversion action
  try {
    await logAiHarvest({
      instituteId,
      user: { _id: uid, role: "student" },
      taskType: "DOUBT_TO_MISTAKE",
      prompt: doubt.question_text,
      response: `Exported to mistake book ID: ${mistake.id}`,
      generatedContent: { mistakeId: mistake.id, doubtId: dId },
      metadata: { subject: doubt.subject, reasonTag: mistakeReasonTag },
    });
  } catch (_) {}

  return {
    success: true,
    doubtId: dId,
    mistakeId: mistake.id,
  };
}
