import express from "express";
import multer from "multer";
import protect from "../middleware/authMiddleware.js";
import staffOnly from "../middleware/staffMiddleware.js";
import {
  createTicket,
  getMyTickets,
  getFaqs,
  getTutorials,
  askAiHelp,
  adminGetTickets,
  adminUpdateTicket,
  adminReplyTicket,
  adminGetFaqs,
  adminCreateFaq,
  adminUpdateFaq,
  adminDeleteFaq,
  adminGetTutorials,
  adminCreateTutorial,
  adminUpdateTutorial,
  adminDeleteTutorial,
} from "../controllers/supportController.js";

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
});

// User / In-App Endpoints
router.post("/tickets", protect, upload.single("screenshot"), createTicket);
router.get("/my-tickets", protect, getMyTickets);
router.get("/faqs", getFaqs);
router.get("/tutorials", getTutorials);
router.post("/ai-help", protect, askAiHelp);

// Super Admin / Staff Endpoints
// Tickets
router.get("/admin/tickets", protect, staffOnly, adminGetTickets);
router.put("/admin/tickets/:id", protect, staffOnly, adminUpdateTicket);
router.post("/admin/tickets/:id/reply", protect, staffOnly, adminReplyTicket);

// FAQs Management
router.get("/admin/faqs", protect, staffOnly, adminGetFaqs);
router.post("/admin/faqs", protect, staffOnly, adminCreateFaq);
router.put("/admin/faqs/:id", protect, staffOnly, adminUpdateFaq);
router.delete("/admin/faqs/:id", protect, staffOnly, adminDeleteFaq);

// Tutorials Management
router.get("/admin/tutorials", protect, staffOnly, adminGetTutorials);
router.post("/admin/tutorials", protect, staffOnly, adminCreateTutorial);
router.put("/admin/tutorials/:id", protect, staffOnly, adminUpdateTutorial);
router.delete("/admin/tutorials/:id", protect, staffOnly, adminDeleteTutorial);

export default router;
