import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import {
  getDashboard,
  getMistakeById,
  createMistake,
  updateMistake,
  deleteMistake,
  getRootCause,
  getTwinQuestion,
  ocrSnapMistake,
  getRetestQuiz,
  submitRetest,
} from "../controllers/mistakeBookController.js";

const router = express.Router();

router.use(optionalAuth);

// Dashboard overview & filtered lists
router.get("/dashboard", getDashboard);

// Retest Practice engine
router.get("/retest/quiz", getRetestQuiz);
router.post("/retest/submit", submitRetest);

// Offline Snap & Solve (Camera OCR via Gemini Vision)
router.post("/ocr-snap", ocrSnapMistake);

// CRUD on mistake items
router.post("/items", createMistake);
router.get("/items/:id", getMistakeById);
router.put("/items/:id", updateMistake);
router.delete("/items/:id", deleteMistake);

// AI Diagnosis & Twin Questions
router.post("/items/:id/root-cause", getRootCause);
router.post("/items/:id/twin-question", getTwinQuestion);

export default router;
