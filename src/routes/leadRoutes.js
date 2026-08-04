import express from "express";
import {
  deleteLead,
  getLeadApiKey,
  getLeads,
  regenerateLeadApiKey,
  submitLead,
  updateLead,
  getLeadForms,
  createLeadForm,
  updateLeadForm,
  deleteLeadForm,
} from "../controllers/leadController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

// Role check middleware: only institute_admin can access lead management
const requireInstituteAdmin = (req, res, next) => {
  if (req.user && req.user.role === "teacher") {
    return res.status(403).json({ message: "Access denied. Hired teachers cannot access lead management." });
  }
  next();
};

// Public webhook endpoint for website lead submission
router.post("/submit", submitLead);

// Protected endpoints for dashboard lead management
router.use(protect);
router.use(requireInstituteAdmin);
router.get("/", getLeads);
router.get("/api-key", getLeadApiKey);
router.post("/api-key/regenerate", regenerateLeadApiKey);

router.route("/forms")
  .get(getLeadForms)
  .post(createLeadForm);
router.route("/forms/:id")
  .put(updateLeadForm)
  .delete(deleteLeadForm);

router.route("/:id").put(updateLead).delete(deleteLead);

export default router;
