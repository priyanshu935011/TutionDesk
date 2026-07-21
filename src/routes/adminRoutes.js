import express from "express";
import multer from "multer";
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
  updateAdminTeacher,
  deleteAdminTeacher,
  updateAdminStudent,
  deleteAdminStudent,
  uploadInstituteLogo,
} from "../controllers/adminController.js";
import protect from "../middleware/authMiddleware.js";
import superAdminOnly from "../middleware/superAdminMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect, superAdminOnly);

router.get("/overview", getAdminOverview);
router.get("/uptime", getUptimeOverview);

router.route("/teachers")
  .get(getAdminTeachers);
router.route("/teachers/:id")
  .put(updateAdminTeacher)
  .delete(deleteAdminTeacher);

router.route("/students")
  .get(getAdminStudents);
router.route("/students/:id")
  .put(updateAdminStudent)
  .delete(deleteAdminStudent);

router.get("/institutes/:id", getInstituteDetail);
router.post("/institutes", createInstitute);
router.put("/institutes/:id", updateInstitute);
router.post("/institutes/upload-logo", upload.single("logo"), uploadInstituteLogo);
router.post("/institutes/:id/renew", renewInstituteSubscription);
router.delete("/institutes/:id", deleteInstitute);

export default router;
