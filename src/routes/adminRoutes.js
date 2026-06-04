import express from "express";
import {
  createInstitute,
  deleteInstitute,
  getAdminOverview,
  getInstituteDetail,
  getUptimeOverview,
  renewInstituteSubscription,
  updateInstitute,
  getAdminTeachers,
  getAdminStudents,
} from "../controllers/adminController.js";
import protect from "../middleware/authMiddleware.js";
import superAdminOnly from "../middleware/superAdminMiddleware.js";

const router = express.Router();

router.use(protect, superAdminOnly);

router.get("/overview", getAdminOverview);
router.get("/uptime", getUptimeOverview);
router.get("/teachers", getAdminTeachers);
router.get("/students", getAdminStudents);
router.get("/institutes/:id", getInstituteDetail);
router.post("/institutes", createInstitute);
router.put("/institutes/:id", updateInstitute);
router.post("/institutes/:id/renew", renewInstituteSubscription);
router.delete("/institutes/:id", deleteInstitute);

export default router;
