import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import {
  solveDoubt,
  getHistory,
  getDoubtDetail,
  followupDoubt,
  toggleStar,
  convertToMistake,
  deleteDoubt,
} from "../controllers/doubtController.js";

const router = express.Router();

router.use(optionalAuth);

// Solve doubt with Gemini AI (text or image)
router.post("/solve", solveDoubt);

// Get student's solved doubt history
router.get("/history", getHistory);

// Single doubt details & chat thread
router.get("/:id", getDoubtDetail);
router.delete("/:id", deleteDoubt);

// Follow-up question thread
router.post("/:id/followup", followupDoubt);

// Star/bookmark doubt
router.post("/:id/toggle-star", toggleStar);

// Convert to Mistake Notebook
router.post("/:id/convert-to-mistake", convertToMistake);

export default router;
