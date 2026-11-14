import express from "express";
import multer from "multer";
import protect, { optionalAuth } from "../middleware/authMiddleware.js";
import superAdminOnly from "../middleware/superAdminMiddleware.js";
import {
  getMarketingTemplates,
  trackTemplateAction,
  getAllTemplatesAdmin,
  createTemplateAdmin,
  updateTemplateAdmin,
  deleteTemplateAdmin,
  getMarketingStatsAdmin,
  aiDetectAndCleanBrandingAdmin,
  getAdminMarketingMedia,
  uploadAdminMarketingMedia,
  deleteAdminMarketingMedia,
} from "../controllers/marketingController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB poster image limit
});

const posterUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "storyImage", maxCount: 1 },
]);

const router = express.Router();

// Educator / App endpoints (optionalAuth allows unauthenticated fallback & enriches when logged in)
router.get("/templates", optionalAuth, getMarketingTemplates);
router.post("/templates/:id/track", optionalAuth, trackTemplateAction);

// Super Admin management endpoints
router.get("/admin/templates", protect, superAdminOnly, getAllTemplatesAdmin);
router.post("/admin/templates", protect, superAdminOnly, posterUpload, createTemplateAdmin);
router.put("/admin/templates/:id", protect, superAdminOnly, posterUpload, updateTemplateAdmin);
router.delete("/admin/templates/:id", protect, superAdminOnly, deleteTemplateAdmin);
router.get("/admin/stats", protect, superAdminOnly, getMarketingStatsAdmin);
router.post("/admin/ai-detect-and-clean", protect, superAdminOnly, posterUpload, aiDetectAndCleanBrandingAdmin);

// Super Admin Media Library Endpoints
router.get("/admin/media", protect, superAdminOnly, getAdminMarketingMedia);
router.post("/admin/media", protect, superAdminOnly, upload.single("file"), uploadAdminMarketingMedia);
router.delete("/admin/media/:id", protect, superAdminOnly, deleteAdminMarketingMedia);

export default router;
