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
import { isReceptionist, isReceptionistFeatureAllowed, isHiredTeacher } from "../utils/staffPermissionHelper.js";

const router = express.Router();

// Role check middleware: institute_admin, or authorized receptionist with "leads" feature allowed
const requireLeadAccess = (req, res, next) => {
  if (isHiredTeacher(req.user)) {
    return res.status(403).json({ message: "Access denied. Hired teachers cannot access lead management." });
  }

  if (isReceptionist(req.user)) {
    if (!isReceptionistFeatureAllowed(req.user, "leads")) {
      return res.status(403).json({ message: "Access denied. Enquiries & Leads feature is not enabled for your account." });
    }
  }

  next();
};

// Admin-only middleware for destructive or configuration operations (e.g. API keys, deleting forms)
const requireInstituteAdminOnly = (req, res, next) => {
  if (req.user && (req.user.role === "teacher" || isReceptionist(req.user))) {
    return res.status(403).json({ message: "Access denied. Only institute administrators can manage API keys and delete forms." });
  }
  next();
};

// Public webhook endpoint for website lead submission
router.post("/submit", submitLead);

// Protected endpoints for dashboard lead management
router.use(protect);
router.use(requireLeadAccess);

router.get("/", getLeads);
router.route("/:id").put(updateLead).delete(deleteLead);

router.route("/forms")
  .get(getLeadForms)
  .post(createLeadForm);

router.route("/forms/:id")
  .put(updateLeadForm)
  .delete(requireInstituteAdminOnly, deleteLeadForm);

// Sensitive API key management is strictly institute admin only
router.get("/api-key", requireInstituteAdminOnly, getLeadApiKey);
router.post("/api-key/regenerate", requireInstituteAdminOnly, regenerateLeadApiKey);

export default router;
