import express from "express";
import multer from "multer";
import protect, { optionalAuth } from "../middleware/authMiddleware.js";
import superAdminOnly from "../middleware/superAdminMiddleware.js";
import {
  getMarketingTemplates,
  trackTemplateAction as trackTemplateActionV1,
  getAllTemplatesAdmin,
  createTemplateAdmin,
  updateTemplateAdmin,
  deleteTemplateAdmin,
  getMarketingStatsAdmin,
  aiDetectAndCleanBrandingAdmin,
  getAdminMarketingMedia,
  uploadAdminMarketingMedia,
  deleteAdminMarketingMedia,
  aiGeneratePosterAdmin,
} from "../controllers/marketingController.js";

import {
  getCategories,
  createCategoryAdmin,
  updateCategoryAdmin,
  deleteCategoryAdmin,
  getAdminTemplatesV2,
  getAdminTemplateV2ById,
  createAdminTemplateV2,
  updateAdminTemplateV2,
  duplicateAdminTemplateV2,
  deleteAdminTemplateV2,
  getAdminTemplateVersions,
  getAdminAssets,
  uploadAdminAsset,
  deleteAdminAsset,
  getAdminStudioAnalytics,
  getInstituteCategories,
  getInstituteBrandingSnapshot,
  getInstituteTemplates,
  getInstituteTemplateById,
  getInstituteDesigns,
  saveInstituteDesign,
  deleteInstituteDesign,
  requestDesignExport,
  getExportStatus,
  trackTemplateAction as trackTemplateActionV2,
} from "../controllers/marketingStudioV2Controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const posterUpload = upload.fields([
  { name: "image", maxCount: 1 },
  { name: "storyImage", maxCount: 1 },
]);

const router = express.Router();

// ============================================================================
// CLASSTECH MARKETING STUDIO V2.0 ROUTES
// ============================================================================

// Institute Creative Hub Endpoints (Mobile App & Web)
router.get("/v2/categories", optionalAuth, getInstituteCategories);
router.get("/v2/branding", optionalAuth, getInstituteBrandingSnapshot);
router.get("/v2/templates", optionalAuth, getInstituteTemplates);
router.get("/v2/templates/:id", optionalAuth, getInstituteTemplateById);
router.get("/v2/designs", optionalAuth, getInstituteDesigns);
router.post("/v2/designs", optionalAuth, saveInstituteDesign);
router.delete("/v2/designs/:id", optionalAuth, deleteInstituteDesign);
router.post("/v2/designs/:id/export", optionalAuth, requestDesignExport);
router.get("/v2/exports/:id", optionalAuth, getExportStatus);
router.post("/v2/track", optionalAuth, trackTemplateActionV2);

// Super Admin Visual Studio V2 Endpoints
router.get("/admin/v2/templates", protect, superAdminOnly, getAdminTemplatesV2);
router.get("/admin/v2/templates/:id", protect, superAdminOnly, getAdminTemplateV2ById);
router.post("/admin/v2/templates", protect, superAdminOnly, createAdminTemplateV2);
router.put("/admin/v2/templates/:id", protect, superAdminOnly, updateAdminTemplateV2);
router.delete("/admin/v2/templates/:id", protect, superAdminOnly, deleteAdminTemplateV2);
router.post("/admin/v2/templates/:id/duplicate", protect, superAdminOnly, duplicateAdminTemplateV2);
router.get("/admin/v2/templates/:id/versions", protect, superAdminOnly, getAdminTemplateVersions);

router.get("/admin/v2/categories", protect, superAdminOnly, getCategories);
router.post("/admin/v2/categories", protect, superAdminOnly, createCategoryAdmin);
router.put("/admin/v2/categories/:id", protect, superAdminOnly, updateCategoryAdmin);
router.delete("/admin/v2/categories/:id", protect, superAdminOnly, deleteCategoryAdmin);

router.get("/admin/v2/assets", protect, superAdminOnly, getAdminAssets);
router.post("/admin/v2/assets", protect, superAdminOnly, upload.single("file"), uploadAdminAsset);
router.delete("/admin/v2/assets/:id", protect, superAdminOnly, deleteAdminAsset);

router.get("/admin/v2/analytics", protect, superAdminOnly, getAdminStudioAnalytics);

// ============================================================================
// LEGACY V1 ENDPOINTS (Preserved for 100% backward compatibility)
// ============================================================================

router.get("/templates", optionalAuth, getMarketingTemplates);
router.post("/templates/:id/track", optionalAuth, trackTemplateActionV1);

router.get("/admin/templates", protect, superAdminOnly, getAllTemplatesAdmin);
router.post("/admin/templates", protect, superAdminOnly, posterUpload, createTemplateAdmin);
router.put("/admin/templates/:id", protect, superAdminOnly, posterUpload, updateTemplateAdmin);
router.delete("/admin/templates/:id", protect, superAdminOnly, deleteTemplateAdmin);
router.get("/admin/stats", protect, superAdminOnly, getMarketingStatsAdmin);
router.post("/admin/ai-detect-and-clean", protect, superAdminOnly, posterUpload, aiDetectAndCleanBrandingAdmin);

router.get("/admin/media", protect, superAdminOnly, getAdminMarketingMedia);
router.post("/admin/media", protect, superAdminOnly, upload.single("file"), uploadAdminMarketingMedia);
router.delete("/admin/media/:id", protect, superAdminOnly, deleteAdminMarketingMedia);
router.post("/admin/ai-generate-poster", protect, superAdminOnly, aiGeneratePosterAdmin);

export default router;
