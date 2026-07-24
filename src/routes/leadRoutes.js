import express from "express";
import {
  deleteLead,
  getLeadApiKey,
  getLeads,
  regenerateLeadApiKey,
  submitLead,
  updateLead,
} from "../controllers/leadController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

// Public webhook endpoint for website lead submission
router.post("/submit", submitLead);

// Protected endpoints for dashboard lead management
router.use(protect);
router.get("/", getLeads);
router.get("/api-key", getLeadApiKey);
router.post("/api-key/regenerate", regenerateLeadApiKey);
router.route("/:id").put(updateLead).delete(deleteLead);

export default router;
