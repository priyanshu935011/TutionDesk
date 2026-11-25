import { supabase } from "../utils/supabase.js";
import { callGeminiRaw, extractJsonFromText } from "./aiService.js";
import { autoIngestFromFlashcard } from "./mistakeBookService.js";
import fs from "fs";
import path from "path";

const FALLBACK_DIR = process.env.FALLBACK_DIR || path.join(process.cwd(), "scratch", "data");
const FLASHCARD_FALLBACK_FILE = path.join(FALLBACK_DIR, "flashcards_fallback.json");

// Helper to ensure fallback JSON store exists
function getFallbackStore() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    if (fs.existsSync(FLASHCARD_FALLBACK_FILE)) {
      return JSON.parse(fs.readFileSync(FLASHCARD_FALLBACK_FILE, "utf-8"));
    }
  } catch (_) {}
  return { decks: {}, cards: {}, progress: {}, reviews: {}, sessions: {} };
}

function saveFallbackStore(store) {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    fs.writeFileSync(FLASHCARD_FALLBACK_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[Flashcards] Fallback store write error:", err);
  }
}

/**
 * SuperMemo SM-2 Algorithm Calculation
 * @param {number} rating - 1: Again, 2: Hard, 3: Good, 4: Easy
 * @param {number} prevReps - Previous consecutive repetitions
 * @param {number} prevInterval - Previous review interval in days
 * @param {number} prevEF - Previous ease factor (default 2.5)
 */
export function calculateSM2(rating, prevReps = 0, prevInterval = 0, prevEF = 2.5) {
  let reps = Number(prevReps) || 0;
  let interval = Number(prevInterval) || 0;
  let ef = Number(prevEF) || 2.5;
  let state = "learning";

  // Map 1..4 rating to SM-2 quality q (1->1, 2->3, 3->4, 4->5)
  const q = rating === 1 ? 1 : rating === 2 ? 3 : rating === 3 ? 4 : 5;

  // New Ease Factor formula
  ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  if (ef < 1.3) ef = 1.3;
  if (ef > 3.0) ef = 3.0;
  ef = Math.round(ef * 1000) / 1000;

  if (rating === 1) {
    // Again: Failure, reset repetitions, review today / next day
    reps = 0;
    interval = 1; // 1 day
    state = "relearning";
  } else if (rating === 2) {
    // Hard: Slightly lower interval growth
    reps += 1;
    interval = Math.max(1, Math.round(interval * 1.2));
    state = reps >= 3 ? "reviewing" : "learning";
  } else if (rating === 3) {
    // Good: Standard SM-2 interval progression
    if (reps === 0) {
      interval = 1;
    } else if (reps === 1) {
      interval = 6;
    } else {
      interval = Math.round(interval * ef);
    }
    reps += 1;
    state = reps >= 4 ? "mastered" : reps >= 2 ? "reviewing" : "learning";
  } else if (rating === 4) {
    // Easy: Accelerated mastery
    if (reps === 0) {
      interval = 4;
    } else if (reps === 1) {
      interval = 14;
    } else {
      interval = Math.round(interval * ef * 1.3);
    }
    reps += 1;
    state = "mastered";
  }

  const nextReviewAt = new Date(Date.now() + interval * 86400 * 1000);

  return {
    repetitions: reps,
    intervalDays: interval,
    easeFactor: ef,
    state,
    nextReviewAt,
  };
}

/**
 * Fetch Flashcards Quota for a student
 */
export async function getStudentFlashcardQuota(userId) {
  let limit = 25;
  let created = 0;
  let planTier = "free";

  if (!userId || userId === "guest_student") {
    return { limit, created, remaining: limit - created, planTier };
  }

  // 1. Try Supabase students table
  try {
    const { data, error } = await supabase
      .from("students")
      .select("flashcards_limit, flashcards_created, plan_tier")
      .or(`id.eq.${userId},user_id.eq.${userId}`)
      .limit(1)
      .maybeSingle();

    if (data && !error) {
      limit = Number(data.flashcards_limit ?? 25);
      created = Number(data.flashcards_created ?? 0);
      planTier = data.plan_tier || "free";
      return {
        limit,
        created,
        remaining: Math.max(0, limit - created),
        planTier,
      };
    }
  } catch (_) {}

  // 2. Try Mongoose Student model
  try {
    const mongoose = (await import("mongoose")).default;
    const Student = (await import("../models/Student.js")).default;
    let stu = null;
    if (mongoose.Types.ObjectId.isValid(userId)) {
      stu = await Student.findById(userId).lean();
    }
    if (!stu) {
      stu = await Student.findOne({
        $or: [{ _id: userId }, { user: userId }, { phone: userId }, { email: userId }],
      }).lean();
    }
    if (stu) {
      limit = Number(stu.flashcards_limit ?? stu.flashcardsLimit ?? 25);
      created = Number(stu.flashcards_created ?? stu.flashcardsCreated ?? 0);
      planTier = stu.plan_tier || stu.planTier || "free";
    }
  } catch (_) {}

  return {
    limit,
    created,
    remaining: Math.max(0, limit - created),
    planTier,
  };
}

/**
 * Increment student flashcard usage count
 */
export async function incrementStudentFlashcardUsage(userId, count) {
  if (!count || count <= 0 || !userId || userId === "guest_student") return;

  // 1. Supabase update
  try {
    await supabase.rpc("increment_student_flashcard_usage", {
      p_student_id: String(userId),
      p_count: count,
    }).catch(async () => {
      const { data: row } = await supabase
        .from("students")
        .select("flashcards_created")
        .or(`id.eq.${userId},user_id.eq.${userId}`)
        .limit(1)
        .maybeSingle();
      const cur = Number(row?.flashcards_created || 0);
      await supabase
        .from("students")
        .update({ flashcards_created: cur + count })
        .or(`id.eq.${userId},user_id.eq.${userId}`);
    });
  } catch (err) {
    console.warn("[Flashcards] Supabase usage increment error:", err.message);
  }

  // 2. Mongoose update
  try {
    const mongoose = (await import("mongoose")).default;
    const Student = (await import("../models/Student.js")).default;
    let query = { $or: [{ phone: userId }, { email: userId }] };
    if (mongoose.Types.ObjectId.isValid(userId)) {
      query.$or.unshift({ _id: userId }, { user: userId });
    }
    await Student.findOneAndUpdate(
      query,
      {
        $inc: {
          flashcards_created: count,
          flashcardsCreated: count,
        },
      }
    );
  } catch (err) {
    console.warn("[Flashcards] Mongoose usage increment error:", err.message);
  }
}

/**
 * Generate Flashcards using Gemini AI
 */
export async function generateFlashcardsFromAi({
  prompt,
  text,
  pdfBase64,
  imageBase64,
  fileMimeType = "application/pdf",
  deckTitle = "AI Flashcard Deck",
  subject = "General",
  chapter = "",
  topic = "",
  sourceType = "ai_generated",
  cardCount = 20,
  difficulty = "mixed",
  cardTypes = ["qa"],
  customInstructions = "",
  userId,
  instituteId,
}) {
  const count = Math.min(50, Math.max(5, Number(cardCount) || 20));

  // Quota validation
  const quota = await getStudentFlashcardQuota(userId);
  if (quota.remaining <= 0) {
    throw new Error(
      `You have reached your AI Flashcards limit (${quota.created}/${quota.limit} created). Upgrade to ClassTech Premium to generate more revision cards.`
    );
  }
  if (count > quota.remaining) {
    throw new Error(
      `You requested ${count} flashcards, but only ${quota.remaining} card(s) remain in your quota (${quota.created}/${quota.limit} used). Please adjust the card count or upgrade to ClassTech Premium.`
    );
  }

  let systemInstruction = `You are a world-class cognitive learning specialist and master teacher creating active-recall flashcards for student revision using spaced repetition.
Your goal is to extract high-yield, conceptually sound flashcards that maximize retention, active recall, and deep conceptual understanding.`;

  let userPrompt = `Generate exactly ${count} active recall flashcards from the provided study material.
Subject: ${subject}
${chapter ? `Chapter: ${chapter}` : ""}
${topic ? `Topic: ${topic}` : ""}
Difficulty preference: ${difficulty}
Target card types: ${Array.isArray(cardTypes) ? cardTypes.join(", ") : cardTypes}
${customInstructions ? `Specific instructions: ${customInstructions}` : ""}

Content / Context:
${text ? text.slice(0, 30000) : "Extract the most important concepts, formulas, definitions, and active recall questions from the attached document."}

RULES FOR FLASHCARDS:
1. Every question must be crisp, specific, and unambiguous. Avoid vague questions like "Tell me about X". Instead: "What is the primary function of X in Y?" or "How does X differ from Y?".
2. Every answer must be clear, precise, and immediately testable.
3. Every card must include an insightful "explanation" giving the mechanism, context, or formula derivation.
4. Clean mathematical & scientific symbols into readable Unicode (e.g. ², ³, √, ∫, ±, π, θ, λ, →, ⇌, ×, ÷). Do NOT use raw LaTeX dollar signs.
5. Provide a relevant subtopic tag for each card.
6. Provide a card_type for each card: "conceptual", "definition", "factual", "formula", "true_false", "fill_blank", or "qa".
7. Provide difficulty: "easy", "medium", or "hard".

Respond strictly with valid JSON in this exact structure:
{
  "deckTitle": "${deckTitle}",
  "subject": "${subject}",
  "chapter": "${chapter}",
  "cards": [
    {
      "question": "Clear question testing recall",
      "answer": "Concise, complete, accurate answer",
      "explanation": "Detailed conceptual explanation or step-by-step breakdown",
      "card_type": "conceptual",
      "difficulty": "medium",
      "topic": "${topic || subject}",
      "source_page": 1,
      "source_excerpt": "Key context citation"
    }
  ]
}`;

  const geminiPayload = {
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.25,
  };

  const fileData = pdfBase64 || imageBase64;
  if (fileData) {
    geminiPayload.imageBase64 = fileData;
    geminiPayload.imageMimeType = fileMimeType;
  }

  const rawAiResponse = await callGeminiRaw(geminiPayload);
  const parsed = extractJsonFromText(rawAiResponse);

  if (!parsed || !Array.isArray(parsed.cards) || parsed.cards.length === 0) {
    throw new Error("AI could not generate flashcards from the provided material. Please try with clearer text or a different file.");
  }

  const cleanDeckTitle = parsed.deckTitle || deckTitle || `${subject} Revision`;
  const cleanSubject = parsed.subject || subject || "General";
  const cleanChapter = parsed.chapter || chapter || "";
  const rawCards = parsed.cards;

  // Persist to Supabase
  const deckPayload = {
    user_id: String(userId),
    institute_id: instituteId ? String(instituteId) : null,
    title: cleanDeckTitle,
    description: `AI-generated revision deck for ${cleanSubject} ${cleanChapter ? `· ${cleanChapter}` : ""}`.trim(),
    subject: cleanSubject,
    chapter: cleanChapter,
    topic: topic || "",
    source_type: sourceType,
    difficulty,
    card_types: Array.isArray(cardTypes) ? cardTypes : [cardTypes],
    total_cards: rawCards.length,
    mastered_cards: 0,
    due_cards: rawCards.length,
    last_studied_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  let savedDeck = null;
  let savedCards = [];

  try {
    const { data: deckData, error: deckError } = await supabase
      .from("flashcard_decks")
      .insert(deckPayload)
      .select()
      .single();

    if (deckError) throw deckError;
    savedDeck = deckData;

    const cardsPayload = rawCards.map((c, idx) => ({
      deck_id: savedDeck.id,
      question: String(c.question || `Question ${idx + 1}`).trim(),
      answer: String(c.answer || "Answer not available").trim(),
      explanation: String(c.explanation || "").trim(),
      card_type: String(c.card_type || "conceptual").toLowerCase(),
      difficulty: String(c.difficulty || "medium").toLowerCase(),
      topic: String(c.topic || cleanChapter || cleanSubject).trim(),
      source_page: Number(c.source_page) || null,
      source_excerpt: String(c.source_excerpt || "").trim(),
      position: idx + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { data: cardsData, error: cardsError } = await supabase
      .from("flashcards")
      .insert(cardsPayload)
      .select();

    if (cardsError) throw cardsError;
    savedCards = cardsData || [];

    // Initialize progress for each card
    if (savedCards.length > 0) {
      const progressPayload = savedCards.map(sc => ({
        user_id: String(userId),
        flashcard_id: sc.id,
        deck_id: savedDeck.id,
        state: "new",
        repetitions: 0,
        interval_days: 0,
        ease_factor: 2.5,
        last_rating: 0,
        next_review_at: new Date().toISOString(), // Due immediately
        last_reviewed_at: null,
        total_reviews: 0,
        correct_reviews: 0,
        consecutive_correct: 0,
        is_bookmarked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }));

      await supabase.from("flashcard_progress").upsert(progressPayload, { onConflict: "user_id,flashcard_id" });
    }
  } catch (dbErr) {
    console.warn("[Flashcards] Supabase write failed, falling back to local store:", dbErr.message);

    // Fallback in-memory / JSON store
    const store = getFallbackStore();
    const fallbackDeckId = "deck_" + Date.now() + "_" + Math.random().toString(36).substring(2, 8);
    savedDeck = { id: fallbackDeckId, ...deckPayload };
    store.decks[fallbackDeckId] = savedDeck;

    savedCards = rawCards.map((c, idx) => {
      const cId = "card_" + fallbackDeckId + "_" + (idx + 1);
      const cardObj = {
        id: cId,
        deck_id: fallbackDeckId,
        question: String(c.question || `Question ${idx + 1}`).trim(),
        answer: String(c.answer || "Answer not available").trim(),
        explanation: String(c.explanation || "").trim(),
        card_type: String(c.card_type || "conceptual").toLowerCase(),
        difficulty: String(c.difficulty || "medium").toLowerCase(),
        topic: String(c.topic || cleanChapter || cleanSubject).trim(),
        source_page: Number(c.source_page) || null,
        source_excerpt: String(c.source_excerpt || "").trim(),
        position: idx + 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      store.cards[cId] = cardObj;

      // Progress
      const pKey = `${userId}_${cId}`;
      store.progress[pKey] = {
        id: "prog_" + pKey,
        user_id: String(userId),
        flashcard_id: cId,
        deck_id: fallbackDeckId,
        state: "new",
        repetitions: 0,
        interval_days: 0,
        ease_factor: 2.5,
        last_rating: 0,
        next_review_at: new Date().toISOString(),
        last_reviewed_at: null,
        total_reviews: 0,
        correct_reviews: 0,
        consecutive_correct: 0,
        is_bookmarked: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      return cardObj;
    });

    saveFallbackStore(store);
  }

  if (savedCards.length > 0) {
    await incrementStudentFlashcardUsage(userId, savedCards.length);
  }
  const updatedQuota = await getStudentFlashcardQuota(userId);

  return {
    success: true,
    deck: savedDeck,
    cards: savedCards,
    totalCards: savedCards.length,
    quota: updatedQuota,
  };
}

/**
 * Fetch Student Dashboard Data
 */
export async function getDashboardOverview(userId, instituteId = null) {
  const uid = String(userId);
  const nowIso = new Date().toISOString();
  const todayStartIso = new Date(new Date().setHours(0, 0, 0, 0)).toISOString();

  let decks = [];
  let totalCards = 0;
  let dueToday = 0;
  let masteredCards = 0;
  let completedToday = 0;

  try {
    // 1. Fetch all decks for user
    const { data: deckRows, error: deckErr } = await supabase
      .from("flashcard_decks")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false });

    if (deckErr) throw deckErr;
    decks = deckRows || [];

    // 2. Fetch progress stats for user
    const { data: progRows, error: progErr } = await supabase
      .from("flashcard_progress")
      .select("state, next_review_at, last_reviewed_at, is_bookmarked, deck_id")
      .eq("user_id", uid);

    if (progErr) throw progErr;
    const progressList = progRows || [];

    totalCards = progressList.length;
    for (const p of progressList) {
      if (p.next_review_at && p.next_review_at <= nowIso) {
        dueToday++;
      }
      if (p.state === "mastered") {
        masteredCards++;
      }
      if (p.last_reviewed_at && p.last_reviewed_at >= todayStartIso) {
        completedToday++;
      }
    }

    // Compute per-deck progress
    const deckStatsMap = {};
    for (const p of progressList) {
      if (!deckStatsMap[p.deck_id]) {
        deckStatsMap[p.deck_id] = { total: 0, mastered: 0, due: 0 };
      }
      deckStatsMap[p.deck_id].total++;
      if (p.state === "mastered") deckStatsMap[p.deck_id].mastered++;
      if (p.next_review_at && p.next_review_at <= nowIso) deckStatsMap[p.deck_id].due++;
    }

    decks = decks.map(d => {
      const stats = deckStatsMap[d.id] || { total: d.total_cards || 0, mastered: d.mastered_cards || 0, due: d.due_cards || 0 };
      const masteryPct = stats.total > 0 ? Math.round((stats.mastered / stats.total) * 100) : 0;
      return {
        ...d,
        total_cards: stats.total,
        mastered_cards: stats.mastered,
        due_cards: stats.due,
        mastery_percentage: masteryPct,
      };
    });
  } catch (err) {
    console.warn("[Flashcards] DB fetch failed, using fallback store:", err.message);
    const store = getFallbackStore();
    decks = Object.values(store.decks).filter(d => String(d.user_id) === uid);

    const progressList = Object.values(store.progress).filter(p => String(p.user_id) === uid);
    totalCards = progressList.length;
    for (const p of progressList) {
      if (p.next_review_at && p.next_review_at <= nowIso) dueToday++;
      if (p.state === "mastered") masteredCards++;
      if (p.last_reviewed_at && p.last_reviewed_at >= todayStartIso) completedToday++;
    }

    decks = decks.map(d => {
      const dProgs = progressList.filter(p => p.deck_id === d.id);
      const total = dProgs.length || d.total_cards || 0;
      const mastered = dProgs.filter(p => p.state === "mastered").length;
      const due = dProgs.filter(p => p.next_review_at && p.next_review_at <= nowIso).length;
      const masteryPct = total > 0 ? Math.round((mastered / total) * 100) : 0;
      return {
        ...d,
        total_cards: total,
        mastered_cards: mastered,
        due_cards: due,
        mastery_percentage: masteryPct,
      };
    });
  }

  const overallMastery = totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0;
  const targetDailyCards = dueToday + completedToday;
  const dailyProgressPercent = targetDailyCards > 0 ? Math.min(100, Math.round((completedToday / targetDailyCards) * 100)) : 0;

  const quota = await getStudentFlashcardQuota(uid);

  return {
    overview: {
      totalCards,
      dueToday,
      completedToday,
      masteredCards,
      overallMastery,
      dailyRevision: {
        completed: completedToday,
        target: targetDailyCards,
        percentage: dailyProgressPercent,
      },
    },
    quota,
    decks,
  };
}

/**
 * Fetch Cards for a Study Session
 */
export async function getStudySessionCards(deckId, userId, filter = "all") {
  const uid = String(userId);
  const nowIso = new Date().toISOString();

  let cards = [];
  let deckInfo = null;

  try {
    if (deckId === "daily_revision") {
      deckInfo = {
        id: "daily_revision",
        title: "Daily Smart Revision",
        subject: "All Subjects",
        chapter: "Personalised Recall",
      };

      // Query due cards across all user decks
      const { data: progData, error: pErr } = await supabase
        .from("flashcard_progress")
        .select("*, flashcards(*)")
        .eq("user_id", uid)
        .lte("next_review_at", nowIso)
        .order("next_review_at", { ascending: true })
        .limit(50);

      if (pErr) throw pErr;

      cards = (progData || [])
        .filter(p => p.flashcards)
        .map(p => ({
          ...p.flashcards,
          progress: {
            state: p.state,
            repetitions: p.repetitions,
            intervalDays: p.interval_days,
            easeFactor: p.ease_factor,
            isBookmarked: p.is_bookmarked,
            nextReviewAt: p.next_review_at,
          },
        }));
    } else {
      // Specific deck
      const { data: dData, error: dErr } = await supabase
        .from("flashcard_decks")
        .select("*")
        .eq("id", deckId)
        .single();

      if (dErr) throw dErr;
      deckInfo = dData;

      const { data: cData, error: cErr } = await supabase
        .from("flashcards")
        .select("*, flashcard_progress!left(*)")
        .eq("deck_id", deckId)
        .order("position", { ascending: true });

      if (cErr) throw cErr;

      cards = (cData || []).map(c => {
        const pList = Array.isArray(c.flashcard_progress) ? c.flashcard_progress : [];
        const p = pList.find(x => String(x.user_id) === uid) || {};
        return {
          id: c.id,
          deck_id: c.deck_id,
          question: c.question,
          answer: c.answer,
          explanation: c.explanation,
          card_type: c.card_type,
          difficulty: c.difficulty,
          topic: c.topic,
          source_page: c.source_page,
          source_excerpt: c.source_excerpt,
          position: c.position,
          progress: {
            state: p.state || "new",
            repetitions: p.repetitions || 0,
            intervalDays: p.interval_days || 0,
            easeFactor: p.ease_factor || 2.5,
            isBookmarked: p.is_bookmarked || false,
            nextReviewAt: p.next_review_at || null,
          },
        };
      });
    }
  } catch (err) {
    console.warn("[Flashcards] DB fetch cards failed, trying fallback:", err.message);
    const store = getFallbackStore();

    deckInfo = store.decks[deckId] || { id: deckId, title: "Revision Deck", subject: "General" };
    const allCards = Object.values(store.cards).filter(c => c.deck_id === deckId);
    cards = allCards.map(c => {
      const pKey = `${uid}_${c.id}`;
      const p = store.progress[pKey] || {};
      return {
        ...c,
        progress: {
          state: p.state || "new",
          repetitions: p.repetitions || 0,
          intervalDays: p.interval_days || 0,
          easeFactor: p.ease_factor || 2.5,
          isBookmarked: p.is_bookmarked || false,
          nextReviewAt: p.next_review_at || null,
        },
      };
    });
  }

  // Filter if needed
  if (filter === "bookmarked") {
    cards = cards.filter(c => c.progress?.isBookmarked);
  } else if (filter === "due_today") {
    cards = cards.filter(c => !c.progress?.nextReviewAt || c.progress.nextReviewAt <= nowIso);
  }

  return {
    deck: deckInfo,
    cards,
    totalCards: cards.length,
  };
}

/**
 * Record a Card Review (SM-2 Recall Rating)
 */
export async function recordCardReview({
  userId,
  flashcardId,
  deckId,
  rating, // 1: Again, 2: Hard, 3: Good, 4: Easy
  timeTakenSeconds = 0,
  sessionId = null,
}) {
  const uid = String(userId);
  const numRating = Number(rating);

  let currentProg = null;
  try {
    const { data, error } = await supabase
      .from("flashcard_progress")
      .select("*")
      .eq("user_id", uid)
      .eq("flashcard_id", flashcardId)
      .maybeSingle();

    if (!error && data) currentProg = data;
  } catch (_) {}

  const prevReps = currentProg?.repetitions || 0;
  const prevInterval = currentProg?.interval_days || 0;
  const prevEF = currentProg?.ease_factor || 2.5;

  const sm2Result = calculateSM2(numRating, prevReps, prevInterval, prevEF);

  const ratingLabels = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };
  const ratingLabel = ratingLabels[numRating] || "Good";

  const updatedProgress = {
    user_id: uid,
    flashcard_id: flashcardId,
    deck_id: deckId,
    state: sm2Result.state,
    repetitions: sm2Result.repetitions,
    interval_days: sm2Result.intervalDays,
    ease_factor: sm2Result.easeFactor,
    last_rating: numRating,
    next_review_at: sm2Result.nextReviewAt.toISOString(),
    last_reviewed_at: new Date().toISOString(),
    total_reviews: (currentProg?.total_reviews || 0) + 1,
    correct_reviews: (currentProg?.correct_reviews || 0) + (numRating >= 3 ? 1 : 0),
    consecutive_correct: numRating >= 3 ? (currentProg?.consecutive_correct || 0) + 1 : 0,
    updated_at: new Date().toISOString(),
  };

  try {
    await supabase.from("flashcard_progress").upsert(updatedProgress, { onConflict: "user_id,flashcard_id" });

    // Log review event
    await supabase.from("flashcard_reviews").insert({
      user_id: uid,
      flashcard_id: flashcardId,
      deck_id: deckId,
      session_id: sessionId,
      rating: numRating,
      rating_label: ratingLabel,
      ease_factor: sm2Result.easeFactor,
      interval_days: sm2Result.intervalDays,
      time_taken_seconds: Number(timeTakenSeconds) || 0,
      created_at: new Date().toISOString(),
    });

    // Update deck last studied time
    if (deckId) {
      await supabase.from("flashcard_decks").update({
        last_studied_at: new Date().toISOString(),
      }).eq("id", deckId);
    }

    // Auto-ingest into AI Mistake Notebook if student rated "Again" (1)
    if (numRating === 1) {
      (async () => {
        try {
          const { data: cData } = await supabase
            .from("flashcards")
            .select("question, answer, explanation, topic")
            .eq("id", flashcardId)
            .maybeSingle();

          const { data: dData } = await supabase
            .from("flashcard_decks")
            .select("title, subject")
            .eq("id", deckId)
            .maybeSingle();

          if (cData) {
            await autoIngestFromFlashcard({
              userId: uid,
              flashcardId,
              deckTitle: dData?.title || "Flashcard Deck",
              question: cData.question,
              answer: cData.answer,
              explanation: cData.explanation,
              subject: dData?.subject || "General",
              topic: cData.topic || "",
            });
          }
        } catch (_) {}
      })().catch(() => {});
    }
  } catch (err) {
    console.warn("[Flashcards] DB record review failed, updating fallback store:", err.message);
    const store = getFallbackStore();
    const pKey = `${uid}_${flashcardId}`;
    store.progress[pKey] = {
      ...(store.progress[pKey] || {}),
      ...updatedProgress,
    };
    saveFallbackStore(store);
  }

  return {
    success: true,
    rating: numRating,
    ratingLabel,
    nextReviewAt: sm2Result.nextReviewAt,
    intervalDays: sm2Result.intervalDays,
    state: sm2Result.state,
  };
}

/**
 * Toggle Card Bookmark
 */
export async function toggleCardBookmark(userId, flashcardId, deckId) {
  const uid = String(userId);
  let isBookmarked = true;

  try {
    const { data } = await supabase
      .from("flashcard_progress")
      .select("is_bookmarked")
      .eq("user_id", uid)
      .eq("flashcard_id", flashcardId)
      .maybeSingle();

    if (data) {
      isBookmarked = !data.is_bookmarked;
    }

    await supabase.from("flashcard_progress").upsert({
      user_id: uid,
      flashcard_id: flashcardId,
      deck_id: deckId,
      is_bookmarked: isBookmarked,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,flashcard_id" });
  } catch (err) {
    const store = getFallbackStore();
    const pKey = `${uid}_${flashcardId}`;
    isBookmarked = !store.progress[pKey]?.is_bookmarked;
    if (store.progress[pKey]) {
      store.progress[pKey].is_bookmarked = isBookmarked;
    } else {
      store.progress[pKey] = { user_id: uid, flashcard_id: flashcardId, deck_id: deckId, is_bookmarked: isBookmarked };
    }
    saveFallbackStore(store);
  }

  return { success: true, isBookmarked };
}


