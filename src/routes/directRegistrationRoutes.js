import express from "express";
import {
  sendRegistrationOtp,
  verifyOtpAndRegister,
  getAdminDirectRegistrations,
  updateAdminDirectRegistration,
  convertTrialToInstitute,
  getAdminTrialDefaults,
  updateAdminTrialDefaults,
} from "../controllers/directRegistrationController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

// Public registration endpoints (called from mobile/web app)
router.post("/send-otp", sendRegistrationOtp);
router.post("/verify-otp", verifyOtpAndRegister);
router.get("/defaults", getAdminTrialDefaults);

// Super Admin management endpoints
router.get("/admin/registrations", protect, getAdminDirectRegistrations);
router.put("/admin/registrations/:id", protect, updateAdminDirectRegistration);
router.post("/admin/registrations/:id/convert", protect, convertTrialToInstitute);
router.get("/admin/defaults", protect, getAdminTrialDefaults);
router.put("/admin/defaults", protect, updateAdminTrialDefaults);

export default router;
