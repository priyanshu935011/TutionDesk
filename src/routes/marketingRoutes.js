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
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB poster image limit
});

const router = express.Router();

// Educator / App endpoints
router.get("/templates", protect, getMarketingTemplates);
router.post("/templates/:id/track", protect, trackTemplateAction);

// Super Admin management endpoints
router.get("/admin/templates", protect, superAdminOnly, getAllTemplatesAdmin);
router.post("/admin/templates", protect, superAdminOnly, upload.single("image"), createTemplateAdmin);
router.put("/admin/templates/:id", protect, superAdminOnly, upload.single("image"), updateTemplateAdmin);
router.delete("/admin/templates/:id", protect, superAdminOnly, deleteTemplateAdmin);
router.get("/admin/stats", protect, superAdminOnly, getMarketingStatsAdmin);

export default router;
