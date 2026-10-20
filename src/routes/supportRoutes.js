import express from "express";
import multer from "multer";
import protect from "../middleware/authMiddleware.js";
import {
  createTicket,
  getMyTickets,
  getFaqs,
  getTutorials,
  askAiHelp,
} from "../controllers/supportController.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// Ticket endpoints
router.post("/tickets", protect, upload.single("screenshot"), createTicket);
router.get("/my-tickets", protect, getMyTickets);

// Self-help resources
router.get("/faqs", getFaqs);
router.get("/tutorials", getTutorials);

// AI Help assistant
router.post("/ai-help", protect, askAiHelp);

export default router;
