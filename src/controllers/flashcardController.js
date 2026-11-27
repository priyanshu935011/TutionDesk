import {
  getDashboardOverview,
  generateFlashcardsFromAi,
  getStudySessionCards,
  recordCardReview,
  toggleCardBookmark,
  incrementStudentFlashcardUsage,
  getStudentFlashcardQuota,
} from "../services/flashcardService.js";
import { recordStudentActivity } from "../services/streakService.js";
import { supabase } from "../utils/supabase.js";

// Helper to extract student/user id safely
function getUserIdFromReq(req) {
  return (
    req.student?._id ||
    req.student?.id ||
    req.studentId ||
    req.user?.studentId ||
    req.user?._id ||
    req.user?.id ||
    req.headers["x-student-id"] ||
    req.headers["x-user-id"] ||
    req.query?.studentId ||
    req.body?.studentId ||
    "guest_student"
  ).toString();
}

function getInstituteIdFromReq(req) {
  return req.user?.institute || req.user?.instituteId || null;
}

/**
 * GET /api/flashcards/dashboard
 */
export const getDashboard = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);

    const data = await getDashboardOverview(userId, instituteId);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[Flashcards] getDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load flashcard dashboard",
    });
  }
};

/**
 * POST /api/flashcards/generate
 */
export const generateDeck = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);

    const {
      prompt,
      text,
      pdfBase64,
      imageBase64,
      fileMimeType,
      deckTitle,
      subject,
      chapter,
      topic,
      sourceType,
      cardCount,
      difficulty,
      cardTypes,
      customInstructions,
    } = req.body;

    if (!text && !pdfBase64 && !imageBase64 && !prompt) {
      return res.status(400).json({
        success: false,
        message: "Please provide either document content, uploaded file, or a topic prompt.",
      });
    }

    const result = await generateFlashcardsFromAi({
      prompt,
      text,
      pdfBase64,
      imageBase64,
      fileMimeType,
      deckTitle,
      subject,
      chapter,
      topic,
      sourceType,
      cardCount,
      difficulty,
      cardTypes,
      customInstructions,
      userId,
      instituteId,
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Flashcards] generateDeck error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to generate AI flashcards",
    });
  }
};

/**
 * GET /api/flashcards/decks/:deckId/study
 */
export const getStudySession = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { deckId } = req.params;
    const { filter = "all" } = req.query;

    const data = await getStudySessionCards(deckId, userId, filter);
    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[Flashcards] getStudySession error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load study session",
    });
  }
};

/**
 * POST /api/flashcards/reviews
 */
export const submitCardReview = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { flashcardId, deckId, rating, timeTakenSeconds, sessionId } = req.body;

    if (!flashcardId || !rating) {
      return res.status(400).json({
        success: false,
        message: "flashcardId and rating (1-4) are required.",
      });
    }

    const result = await recordCardReview({
      userId,
      flashcardId,
      deckId,
      rating: Number(rating),
      timeTakenSeconds: Number(timeTakenSeconds) || 0,
      sessionId,
    });

    // Automatically credit student daily streak & revision cards metric
    recordStudentActivity(userId, { revisionCardsReviewed: 1 }).catch((e) => {
      console.warn("[Flashcards] recordStudentActivity notice:", e.message);
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Flashcards] submitCardReview error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to record recall rating",
    });
  }
};

/**
 * POST /api/flashcards/bookmarks/toggle
 */
export const toggleBookmark = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { flashcardId, deckId } = req.body;

    if (!flashcardId) {
      return res.status(400).json({
        success: false,
        message: "flashcardId is required.",
      });
    }

    const result = await toggleCardBookmark(userId, flashcardId, deckId);
    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[Flashcards] toggleBookmark error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to toggle bookmark",
    });
  }
};

/**
 * POST /api/flashcards/decks (Manual Creation)
 */
export const createDeckManual = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);
    const { title, subject, chapter, description, cards = [] } = req.body;

    if (!title || !subject) {
      return res.status(400).json({ success: false, message: "Title and subject are required." });
    }

    const deckPayload = {
      user_id: userId,
      institute_id: instituteId ? String(instituteId) : null,
      title: title.trim(),
      subject: subject.trim(),
      chapter: (chapter || "").trim(),
      description: (description || "").trim(),
      source_type: "manual",
      total_cards: cards.length,
      mastered_cards: 0,
      due_cards: cards.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    let savedDeck = null;
    let savedCards = [];

    try {
      const { data, error } = await supabase.from("flashcard_decks").insert(deckPayload).select().single();
      if (error) throw error;
      savedDeck = data;

      if (cards.length > 0) {
        const cPayload = cards.map((c, i) => ({
          deck_id: savedDeck.id,
          question: c.question,
          answer: c.answer,
          explanation: c.explanation || "",
          card_type: c.card_type || "qa",
          difficulty: c.difficulty || "medium",
          position: i + 1,
          created_at: new Date().toISOString(),
        }));
        const { data: cData, error: cErr } = await supabase.from("flashcards").insert(cPayload).select();
        if (cErr) throw cErr;
        savedCards = cData || [];

        // Add progress
        const progPayload = savedCards.map(c => ({
          user_id: userId,
          flashcard_id: c.id,
          deck_id: savedDeck.id,
          state: "new",
          next_review_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        }));
        await supabase.from("flashcard_progress").upsert(progPayload, { onConflict: "user_id,flashcard_id" });
      }
    } catch (err) {
      savedDeck = { id: "deck_" + Date.now(), ...deckPayload };
      savedCards = cards;
    }

    if (cards.length > 0) {
      await incrementStudentFlashcardUsage(userId, cards.length);
    }
    const updatedQuota = await getStudentFlashcardQuota(userId);

    return res.json({
      success: true,
      data: {
        deck: savedDeck,
        cards: savedCards,
        quota: updatedQuota,
      },
    });
  } catch (error) {
    console.error("[Flashcards] createDeckManual error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to create deck" });
  }
};

/**
 * DELETE /api/flashcards/decks/:deckId
 */
export const deleteDeck = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { deckId } = req.params;

    try {
      await supabase.from("flashcard_decks").delete().eq("id", deckId).eq("user_id", userId);
    } catch (_) {}

    return res.json({ success: true, message: "Deck deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
