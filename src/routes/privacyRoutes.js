import express from "express";
import {
  adminListAccessLogs,
  adminListGrievances,
  adminResolveGrievance,
  adminTriggerRetentionSweep,
  exportPersonalData,
  getPrivacyOverview,
  getPublicDpdpNotice,
  protectAnyPrincipal,
  requestDataCorrection,
  selfServiceDeleteAccount,
  submitGrievance,
  updateConsents,
} from "../controllers/privacyController.js";

const router = express.Router();

// Public DPDP Rule 3 notice (English / Hindi)
router.get("/notice", getPublicDpdpNotice);

// Authenticated Principal Routes (Teacher, Institute Admin, Student, Parent, Super Admin)
router.use(protectAnyPrincipal);

router.get("/overview", getPrivacyOverview);
router.put("/consents", updateConsents);
router.get("/export", exportPersonalData);
router.post("/correction", requestDataCorrection);
router.get("/grievances", getPrivacyOverview);
router.post("/grievances", submitGrievance);
router.post("/delete-account", selfServiceDeleteAccount);

// Super Admin Governance Routes
router.get("/admin/grievances", adminListGrievances);
router.put("/admin/grievances/:id", adminResolveGrievance);
router.get("/admin/access-logs", adminListAccessLogs);
router.post("/admin/retention-sweep", adminTriggerRetentionSweep);

export default router;
