import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import {
  getDashboard,
  generateDeck,
  getStudySession,
  submitCardReview,
  toggleBookmark,
  createDeckManual,
  deleteDeck,
} from "../controllers/flashcardController.js";

const router = express.Router();

router.use(optionalAuth);

// Dashboard Overview
router.get("/dashboard", getDashboard);

// AI Generation
router.post("/generate", generateDeck);

// Study Session
router.get("/decks/:deckId/study", getStudySession);

// Review submission (SM-2 recall rating)
router.post("/reviews", submitCardReview);

// Toggle Bookmark
router.post("/bookmarks/toggle", toggleBookmark);

// Manual Deck Management
router.post("/decks", createDeckManual);
router.delete("/decks/:deckId", deleteDeck);

export default router;
