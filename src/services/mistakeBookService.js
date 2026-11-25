import { supabase } from "../utils/supabase.js";
import { callGeminiRaw, extractJsonFromText } from "./aiService.js";
import fs from "fs";
import path from "path";

const FALLBACK_DIR = process.env.FALLBACK_DIR || path.join(process.cwd(), "scratch", "data");
const MISTAKES_FALLBACK_FILE = path.join(FALLBACK_DIR, "mistakes_fallback.json");

function getFallbackStore() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    if (fs.existsSync(MISTAKES_FALLBACK_FILE)) {
      return JSON.parse(fs.readFileSync(MISTAKES_FALLBACK_FILE, "utf-8"));
    }
  } catch (_) {}
  return { mistakes: {}, retests: {} };
}

function saveFallbackStore(store) {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    fs.writeFileSync(MISTAKES_FALLBACK_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[MistakeBook] Fallback store write error:", err);
  }
}

/**
 * Normalizes input list/array
 */
function toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  try {
    const parsed = typeof val === "string" ? JSON.parse(val) : val;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch (_) {
    return [val];
  }
}

/**
 * 1. Get Mistake Dashboard Overview & Filtered List
 */
export async function getMistakeDashboardOverview({
  userId,
  instituteId = null,
  subject = "all",
  reasonTag = "all",
  status = "all",
  isDueOnly = false,
  isStarredOnly = false,
  search = "",
  page = 1,
  limit = 50,
}) {
  const uid = String(userId);
  let allUserMistakes = [];

  // Try Supabase first
  try {
    let query = supabase
      .from("student_mistakes")
      .select("*")
      .eq("user_id", uid)
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    if (instituteId) {
      query = query.eq("institute_id", instituteId);
    }

    const { data, error } = await query;
    if (!error && Array.isArray(data)) {
      allUserMistakes = data;
    } else {
      throw error || new Error("Supabase query returned empty/error");
    }
  } catch (err) {
    // Fallback local store
    const store = getFallbackStore();
    allUserMistakes = Object.values(store.mistakes || {}).filter(
      (m) => String(m.user_id) === uid && !m.is_archived
    );
  }

  // Calculate High-Level Analytics across all active mistakes
  const now = new Date();
  let totalMistakes = allUserMistakes.length;
  let masteredCount = 0;
  let inProgressCount = 0;
  let unresolvedCount = 0;
  let dueForRetestCount = 0;

  const reasonCounts = {
    conceptual: 0,
    calculation: 0,
    trap_misread: 0,
    time_pressure: 0,
    unclassified: 0,
  };

  const subjectCounts = {};

  allUserMistakes.forEach((m) => {
    // Status counts
    if (m.status === "mastered") {
      masteredCount++;
    } else if (m.status === "in_progress") {
      inProgressCount++;
    } else {
      unresolvedCount++;
    }

    // Due for retest check
    if (m.status !== "mastered") {
      const reviewDate = m.next_review_at ? new Date(m.next_review_at) : now;
      if (reviewDate <= now) {
        dueForRetestCount++;
      }
    }

    // Reason Tag counts
    const rTag = (m.mistake_reason_tag || "unclassified").toLowerCase();
    if (reasonCounts[rTag] !== undefined) {
      reasonCounts[rTag]++;
    } else {
      reasonCounts.unclassified++;
    }

    // Subject breakdown
    const subj = m.subject || "General";
    subjectCounts[subj] = (subjectCounts[subj] || 0) + 1;
  });

  const masteryPercentage =
    totalMistakes > 0 ? Math.round((masteredCount / totalMistakes) * 100) : 0;

  // Apply In-Memory Filtering for the requested view
  let filtered = allUserMistakes.filter((m) => {
    if (subject && subject !== "all" && m.subject?.toLowerCase() !== subject.toLowerCase()) {
      return false;
    }
    if (reasonTag && reasonTag !== "all" && m.mistake_reason_tag?.toLowerCase() !== reasonTag.toLowerCase()) {
      return false;
    }
    if (status && status !== "all") {
      if (status === "due") {
        const reviewDate = m.next_review_at ? new Date(m.next_review_at) : now;
        if (m.status === "mastered" || reviewDate > now) return false;
      } else if (m.status !== status) {
        return false;
      }
    }
    if (isDueOnly) {
      const reviewDate = m.next_review_at ? new Date(m.next_review_at) : now;
      if (m.status === "mastered" || reviewDate > now) return false;
    }
    if (isStarredOnly && !m.is_starred) {
      return false;
    }
    if (search && search.trim()) {
      const q = search.toLowerCase();
      const textMatch = (m.question_text || "").toLowerCase().includes(q);
      const chapterMatch = (m.chapter || "").toLowerCase().includes(q);
      const topicMatch = (m.topic || "").toLowerCase().includes(q);
      if (!textMatch && !chapterMatch && !topicMatch) return false;
    }
    return true;
  });

  // Sort: Due first, then created desc
  filtered.sort((a, b) => {
    const aDue = a.next_review_at ? new Date(a.next_review_at) : now;
    const bDue = b.next_review_at ? new Date(b.next_review_at) : now;
    if (a.status !== "mastered" && aDue <= now && (b.status === "mastered" || bDue > now)) {
      return -1;
    }
    if (b.status !== "mastered" && bDue <= now && (a.status === "mastered" || aDue > now)) {
      return 1;
    }
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  const p = Math.max(1, Number(page) || 1);
  const lim = Math.max(1, Number(limit) || 50);
  const paginated = filtered.slice((p - 1) * lim, p * lim);

  return {
    analytics: {
      totalMistakes,
      masteredCount,
      inProgressCount,
      unresolvedCount,
      dueForRetestCount,
      masteryPercentage,
      reasonCounts,
      subjectCounts,
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
 * 2. Ingest a Mistake (from Test Series, Flashcard, or Manual/Camera)
 */
export async function ingestMistake({
  userId,
  instituteId = null,
  questionId = null,
  questionText,
  questionImageUrl = "",
  questionType = "single_choice",
  options = [],
  studentWrongAnswer = [],
  correctAnswer = [],
  explanation = "",
  aiRootCause = "",
  aiMicroConcept = "",
  subject = "General",
  chapter = "",
  topic = "",
  difficulty = "medium",
  sourceChannel = "test_series",
  sourceReferenceId = "",
  sourceTitle = "",
  mistakeReasonTag = "conceptual",
  studentNotes = "",
  isStarred = false,
}) {
  const uid = String(userId);
  if (!questionText || !questionText.trim()) {
    throw new Error("Question text is required");
  }

  // Deduplication check: check if question already exists for user
  let existingId = null;
  try {
    let checkQuery = supabase
      .from("student_mistakes")
      .select("id, total_retests, consecutive_correct")
      .eq("user_id", uid)
      .eq("is_archived", false);

    if (questionId) {
      checkQuery = checkQuery.eq("question_id", questionId);
    } else {
      checkQuery = checkQuery.ilike("question_text", questionText.trim().substring(0, 100) + "%");
    }

    const { data } = await checkQuery.maybeSingle();
    if (data?.id) existingId = data.id;
  } catch (_) {}

  // If already exists, reset consecutive_correct & mark unresolved
  if (existingId) {
    const updatePayload = {
      student_wrong_answer: toArray(studentWrongAnswer),
      correct_answer: toArray(correctAnswer),
      status: "unresolved",
      consecutive_correct: 0,
      next_review_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    try {
      await supabase.from("student_mistakes").update(updatePayload).eq("id", existingId);
    } catch (_) {}
    return { id: existingId, isUpdated: true };
  }

  // Auto-generate AI Root Cause and Micro Concept if missing
  let finalRootCause = aiRootCause;
  let finalMicroConcept = aiMicroConcept;

  if (!finalRootCause && (correctAnswer.length > 0 || explanation)) {
    try {
      const aiDiag = await generateAiRootCauseAnalysis({
        questionText,
        options,
        studentAnswer: studentWrongAnswer,
        correctAnswer,
        subject,
        topic,
      });
      if (aiDiag) {
        finalRootCause = aiDiag.rootCause || "";
        finalMicroConcept = aiDiag.microConcept || "";
        if (!mistakeReasonTag || mistakeReasonTag === "unclassified") {
          mistakeReasonTag = aiDiag.suggestedTag || "conceptual";
        }
      }
    } catch (err) {
      console.warn("[MistakeBook] AI Root cause generation warning:", err.message);
    }
  }

  const newMistake = {
    id: `mstk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    user_id: uid,
    institute_id: instituteId,
    question_id: questionId,
    question_text: questionText.trim(),
    question_image_url: questionImageUrl || "",
    question_type: questionType,
    options: toArray(options),
    student_wrong_answer: toArray(studentWrongAnswer),
    correct_answer: toArray(correctAnswer),
    explanation: explanation || "",
    ai_root_cause: finalRootCause || "",
    ai_micro_concept: finalMicroConcept || "",
    subject: subject || "General",
    chapter: chapter || "",
    topic: topic || "",
    difficulty: difficulty || "medium",
    source_channel: sourceChannel,
    source_reference_id: sourceReferenceId || "",
    source_title: sourceTitle || "",
    mistake_reason_tag: mistakeReasonTag || "conceptual",
    status: "unresolved",
    mastery_score: 0,
    consecutive_correct: 0,
    total_retests: 0,
    next_review_at: new Date().toISOString(),
    student_notes: studentNotes || "",
    is_starred: Boolean(isStarred),
    is_archived: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Write to Supabase
  try {
    const { data, error } = await supabase
      .from("student_mistakes")
      .insert(newMistake)
      .select()
      .single();

    if (error) throw error;
    return data || newMistake;
  } catch (err) {
    // Write to fallback store
    const store = getFallbackStore();
    store.mistakes[newMistake.id] = newMistake;
    saveFallbackStore(store);
    return newMistake;
  }
}

/**
 * 3. AI Root-Cause Explainer (Using Gemini)
 */
export async function generateAiRootCauseAnalysis({
  questionText,
  options = [],
  studentAnswer = [],
  correctAnswer = [],
  subject = "General",
  topic = "",
}) {
  const prompt = `
You are an expert diagnostic tutor for competitive exams (JEE, NEET, CBSE, SAT).
A student attempted this question and made a mistake.

Subject: ${subject}
Topic: ${topic || "General"}
Question:
"${questionText}"

Options:
${JSON.stringify(options)}

Student's Selected (Incorrect) Answer:
${JSON.stringify(studentAnswer)}

Correct Answer:
${JSON.stringify(correctAnswer)}

Diagnose why the student fell into this trap:
1. "rootCause": In 2-3 sentences, pinpoint the exact cognitive misconception, missing formula, or trick in the question that caused this specific mistake.
2. "suggestedTag": One of ["conceptual", "calculation", "trap_misread", "time_pressure"].
3. "microConcept": A sharp, memorable 1-2 line "Golden Rule" or formula mnemonic the student can memorize so they never repeat this mistake.
4. "stepCorrection": 2-3 bullet steps showing the crisp correction path.

Return ONLY a valid JSON object with keys:
{
  "rootCause": "string",
  "suggestedTag": "conceptual" | "calculation" | "trap_misread" | "time_pressure",
  "microConcept": "string",
  "stepCorrection": ["step 1", "step 2"]
}
`;

  try {
    const rawRes = await callGeminiRaw({
      prompt,
      systemInstruction: "You are a master AI tutor specializing in student error diagnostics. Return pure JSON only.",
      temperature: 0.2,
    });
    const parsed = extractJsonFromText(rawRes);
    if (parsed && parsed.rootCause) return parsed;
  } catch (err) {
    console.error("[MistakeBook] generateAiRootCauseAnalysis error:", err.message);
  }

  return {
    rootCause: "Review the fundamental theory and sign conventions for this concept.",
    suggestedTag: "conceptual",
    microConcept: "Always verify given conditions and fundamental definitions before calculating.",
    stepCorrection: ["Identify target variable", "Apply core formula", "Check final units"],
  };
}

/**
 * 4. AI Twin / Variant Question Generator (Using Gemini)
 */
export async function generateAiTwinQuestion({
  mistakeId,
  questionText,
  options = [],
  correctAnswer = [],
  subject = "General",
  topic = "",
  difficulty = "medium",
}) {
  const prompt = `
You are an expert exam question creator.
A student solved this question wrong in their exam:
Subject: ${subject}
Topic: ${topic}
Original Question:
"${questionText}"
Correct Answer: ${JSON.stringify(correctAnswer)}

TASK:
Create a "Twin / Mirror Question" testing the EXACT SAME mathematical or conceptual principle and difficulty level, but with CHANGED numbers, variables, or context, so the student tests true mastery rather than memorizing the previous answer.

Provide 4 multiple-choice options (A, B, C, D), mark the correct answer, and give a step-by-step solution.

Return ONLY valid JSON matching this structure:
{
  "question": "string",
  "options": [
    {"id": "A", "text": "string"},
    {"id": "B", "text": "string"},
    {"id": "C", "text": "string"},
    {"id": "D", "text": "string"}
  ],
  "correctAnswer": ["A"],
  "explanation": "string",
  "hint": "string"
}
`;

  try {
    const rawRes = await callGeminiRaw({
      prompt,
      systemInstruction: "You are a top exam question creator. Create an equivalent twin question and return pure JSON.",
      temperature: 0.3,
    });
    const parsed = extractJsonFromText(rawRes);
    if (parsed && parsed.question && Array.isArray(parsed.options)) {
      return parsed;
    }
  } catch (err) {
    console.error("[MistakeBook] generateAiTwinQuestion error:", err.message);
  }

  // Fallback variant
  return {
    question: `Variant: Based on the same concept as "${questionText.substring(0, 80)}...", evaluate the condition when the principal variable is doubled.`,
    options: [
      { id: "A", text: "Remains constant" },
      { id: "B", text: "Doubles" },
      { id: "C", text: "Increases by factor of 4" },
      { id: "D", text: "Halves" },
    ],
    correctAnswer: ["B"],
    explanation: "Linear proportionality holds under given boundary conditions.",
    hint: "Recall the direct proportionality equation discussed in the original mistake.",
  };
}

/**
 * 5. Offline Paper Ingestion: Snap & Solve OCR with Gemini Vision
 */
export async function extractQuestionFromImage({
  imageBase64,
  mimeType = "image/jpeg",
  studentNotes = "",
}) {
  const prompt = `
Analyze this image of a textbook or exam question uploaded by a student.
Perform OCR, extract the mathematical symbols, chemical equations, or text accurately.

Extract:
1. "questionText": Full question text (use clean formatting or LaTeX for equations).
2. "options": Array of objects: [{"id": "A", "text": "..."}, {"id": "B", "text": "..."}, ...] if multiple choice.
3. "correctAnswer": Array of option id(s) e.g. ["A"] or correct numerical/text answer.
4. "explanation": Step-by-step complete solution with logic.
5. "subject": One of ["Physics", "Chemistry", "Mathematics", "Biology", "General"].
6. "chapter": Detected chapter name.
7. "topic": Detected topic.
8. "difficulty": "easy" | "medium" | "hard".
9. "aiRootCause": Why students typically get this wrong.
10. "microConcept": 1-2 sentence core formula or takeaway.

Student notes accompanying image: "${studentNotes || "None"}"

Return ONLY valid JSON matching this schema:
{
  "questionText": "string",
  "options": [{"id": "A", "text": "string"}],
  "correctAnswer": ["A"],
  "explanation": "string",
  "subject": "string",
  "chapter": "string",
  "topic": "string",
  "difficulty": "medium",
  "aiRootCause": "string",
  "microConcept": "string"
}
`;

  try {
    const rawRes = await callGeminiRaw({
      prompt,
      systemInstruction: "You are an expert OCR and academic solver. Parse images into structured question JSON.",
      imageBase64,
      imageMimeType: mimeType,
      temperature: 0.1,
    });
    const parsed = extractJsonFromText(rawRes);
    if (parsed && parsed.questionText) {
      return parsed;
    }
  } catch (err) {
    console.error("[MistakeBook] extractQuestionFromImage error:", err.message);
  }

  throw new Error("Unable to read question clearly from image. Please ensure good lighting and try again.");
}

/**
 * 6. Record a Retest Attempt (Spaced Repetition & Mastery Update)
 */
export async function recordRetestAttempt({
  userId,
  mistakeId,
  selectedAnswer = [],
  isCorrect = false,
  timeTakenSeconds = 0,
  wasTwinQuestion = false,
  twinQuestionData = {},
  feedbackNotes = "",
}) {
  const uid = String(userId);
  const mId = String(mistakeId);

  // Fetch current mistake state
  let mistake = null;
  try {
    const { data } = await supabase
      .from("student_mistakes")
      .select("*")
      .eq("id", mId)
      .single();
    if (data) mistake = data;
  } catch (_) {
    const store = getFallbackStore();
    mistake = store.mistakes[mId];
  }

  if (!mistake) {
    throw new Error("Mistake record not found");
  }

  const prevConsecutive = Number(mistake.consecutive_correct || 0);
  const totalRetests = Number(mistake.total_retests || 0) + 1;
  let newConsecutive = isCorrect ? prevConsecutive + 1 : 0;
  let newStatus = mistake.status;
  let newMasteryScore = Number(mistake.mastery_score || 0);
  let nextReviewDate = new Date();

  if (isCorrect) {
    if (newConsecutive >= 3) {
      // 3 consecutive correct spaced passes -> MASTERED!
      newStatus = "mastered";
      newMasteryScore = 100;
      nextReviewDate.setDate(nextReviewDate.getDate() + 30); // Monthly checkup
    } else if (newConsecutive === 2) {
      newStatus = "in_progress";
      newMasteryScore = 70;
      nextReviewDate.setDate(nextReviewDate.getDate() + 7); // 7-day spaced review
    } else {
      // First correct retest
      newStatus = "in_progress";
      newMasteryScore = 40;
      nextReviewDate.setDate(nextReviewDate.getDate() + 2); // 2-day spaced review
    }
  } else {
    // Retest failed: reset consecutive streak, mark unresolved
    newStatus = "unresolved";
    newMasteryScore = 15;
    nextReviewDate.setDate(nextReviewDate.getDate() + 1); // Retest due tomorrow
  }

  const updateFields = {
    status: newStatus,
    mastery_score: newMasteryScore,
    consecutive_correct: newConsecutive,
    total_retests: totalRetests,
    last_reviewed_at: new Date().toISOString(),
    next_review_at: nextReviewDate.toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Log retest attempt
  const retestLog = {
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    mistake_id: mId,
    user_id: uid,
    selected_answer: toArray(selectedAnswer),
    is_correct: Boolean(isCorrect),
    time_taken_seconds: Number(timeTakenSeconds) || 0,
    was_twin_question: Boolean(wasTwinQuestion),
    twin_question_data: twinQuestionData || {},
    feedback_notes: feedbackNotes || "",
    attempted_at: new Date().toISOString(),
  };

  try {
    await supabase.from("student_mistakes").update(updateFields).eq("id", mId);
    await supabase.from("mistake_retest_logs").insert(retestLog);
  } catch (_) {
    const store = getFallbackStore();
    if (store.mistakes[mId]) {
      Object.assign(store.mistakes[mId], updateFields);
    }
    if (!store.retests[mId]) store.retests[mId] = [];
    store.retests[mId].push(retestLog);
    saveFallbackStore(store);
  }

  return {
    success: true,
    mistakeId: mId,
    isCorrect,
    newStatus,
    newMasteryScore,
    consecutiveCorrect: newConsecutive,
    nextReviewAt: nextReviewDate.toISOString(),
  };
}

/**
 * 7. Get Due Retest Quiz (Smart Practice Session)
 */
export async function getDueRetestQuiz({
  userId,
  instituteId = null,
  subject = "all",
  limit = 10,
}) {
  const { items } = await getMistakeDashboardOverview({
    userId,
    instituteId,
    subject,
    isDueOnly: true,
    limit: Number(limit) || 10,
  });

  // If fewer than requested due items, fill with other unresolved mistakes
  let quizPool = [...items];
  if (quizPool.length < limit) {
    const { items: unresolvedItems } = await getMistakeDashboardOverview({
      userId,
      instituteId,
      subject,
      status: "unresolved",
      limit: Number(limit) - quizPool.length,
    });
    const existingIds = new Set(quizPool.map((m) => m.id));
    for (const item of unresolvedItems) {
      if (!existingIds.has(item.id)) {
        quizPool.push(item);
      }
    }
  }

  return quizPool.slice(0, limit);
}

/**
 * 8. Hook: Auto-Ingest from Test Series Submission
 */
export async function autoIngestFromTestAttempt({
  userId,
  instituteId = null,
  testTitle = "",
  attemptId = "",
  evaluatedAnswers = [],
}) {
  if (!Array.isArray(evaluatedAnswers)) return;

  const wrongOrSkipped = evaluatedAnswers.filter(
    (ans) => !ans.isCorrect || (ans.selectedAnswers || []).length === 0
  );

  for (const q of wrongOrSkipped) {
    try {
      await ingestMistake({
        userId,
        instituteId,
        questionId: String(q.questionId || ""),
        questionText: q.question || "Untitled Question",
        questionImageUrl: q.questionImageUrl || "",
        questionType: q.type || "single_choice",
        options: q.options || [],
        studentWrongAnswer: q.selectedAnswers || [],
        correctAnswer: q.correctAnswers || [],
        explanation: q.explanation || "",
        subject: q.subject || "General",
        chapter: q.chapter || "",
        topic: q.topic || "",
        sourceChannel: "test_series",
        sourceReferenceId: String(attemptId || ""),
        sourceTitle: testTitle || "Mock Test",
        mistakeReasonTag: (q.selectedAnswers || []).length === 0 ? "time_pressure" : "conceptual",
      });
    } catch (err) {
      console.warn("[MistakeBook] Auto-ingest test question error:", err.message);
    }
  }
}

/**
 * 9. Hook: Auto-Ingest from Flashcards (SM-2 Rating 1 = "Again")
 */
export async function autoIngestFromFlashcard({
  userId,
  instituteId = null,
  flashcardId,
  deckTitle = "Flashcard Deck",
  question,
  answer,
  explanation = "",
  subject = "General",
  topic = "",
}) {
  try {
    await ingestMistake({
      userId,
      instituteId,
      questionId: String(flashcardId || ""),
      questionText: question,
      questionType: "flashcard",
      studentWrongAnswer: ["Failed Recall / Again"],
      correctAnswer: [answer],
      explanation: explanation || answer,
      subject,
      topic,
      sourceChannel: "flashcard",
      sourceTitle: deckTitle,
      mistakeReasonTag: "conceptual",
    });
  } catch (err) {
    console.warn("[MistakeBook] Auto-ingest flashcard error:", err.message);
  }
}
