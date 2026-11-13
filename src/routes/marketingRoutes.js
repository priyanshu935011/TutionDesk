import express from "express";
import multer from "multer";
import protect from "../middleware/authMiddleware.js";
import superAdminOnly from "../middleware/superAdminMiddleware.js";
import {
  getMarketingTemplates,
  trackTemplateAction,
  getAllTemplatesAdmin,
  createTemplateAdmin,
  updateTemplateAdmin,
  deleteTemplateAdmin,
  getMarketingStatsAdmin,
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

// Educator / App endpoints
router.get("/templates", protect, getMarketingTemplates);
router.post("/templates/:id/track", protect, trackTemplateAction);

// Super Admin management endpoints
router.get("/admin/templates", protect, superAdminOnly, getAllTemplatesAdmin);
router.post("/admin/templates", protect, superAdminOnly, posterUpload, createTemplateAdmin);
router.put("/admin/templates/:id", protect, superAdminOnly, posterUpload, updateTemplateAdmin);
router.delete("/admin/templates/:id", protect, superAdminOnly, deleteTemplateAdmin);
router.get("/admin/stats", protect, superAdminOnly, getMarketingStatsAdmin);

export default router;
