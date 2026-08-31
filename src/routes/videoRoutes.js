import express from "express";
import {
  getBunnySettings,
  updateBunnySettings,
  updateInstituteVideoSettings,
  getBunnyUploadSignature,
  createVideoLecture,
  uploadThumbnail,
  getTeacherVideos,
  updateVideoLecture,
  deleteVideoLecture,
  recordStudentWatchProgress,
  getVideoWatchAnalytics,
  getSuperAdminVideoStats,
  getInstituteVideoStatsSuperAdmin,
  getStudentVideos,
} from "../controllers/videoController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);

// Super Admin Bunny & Storage Settings
router.get("/super-admin/bunny-settings", getBunnySettings);
router.put("/super-admin/bunny-settings", updateBunnySettings);
router.put("/super-admin/institute-settings/:instituteId", updateInstituteVideoSettings);
router.get("/super-admin/stats", getSuperAdminVideoStats);
router.get("/super-admin/institute-stats/:instituteId", getInstituteVideoStatsSuperAdmin);

// Teacher Video Management & Upload Signature
router.post("/bunny/signature", getBunnyUploadSignature);
router.post("/thumbnail", uploadThumbnail);
router.get("/teacher", getTeacherVideos);
router.post("/teacher", createVideoLecture);
router.put("/teacher/:id", updateVideoLecture);
router.delete("/teacher/:id", deleteVideoLecture);
router.get("/teacher/:id/analytics", getVideoWatchAnalytics);

// Student Watch Log & Video Feed Endpoint
router.get("/student", getStudentVideos);
router.post("/student/progress", recordStudentWatchProgress);

export default router;
