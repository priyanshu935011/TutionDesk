import express from "express";
import multer from "multer";
import protect, { optionalAuth } from "../middleware/authMiddleware.js";
import superAdminOnly from "../middleware/superAdminMiddleware.js";

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
  trackTemplateAction,
  generateAiTemplate,
  deconstructFlyerWithAi,
  generateAiBackground,
  refineAiTemplate,
  generateAiVariations,
} from "../controllers/marketingStudioV2Controller.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB limit
});

const router = express.Router();

// ============================================================================
// CLASSTECH MARKETING STUDIO UNIFIED ROUTES
// ============================================================================

// Institute Creative Hub Endpoints (Mobile App & Web)
router.get(["/categories", "/v2/categories"], optionalAuth, getInstituteCategories);
router.get(["/branding", "/v2/branding"], optionalAuth, getInstituteBrandingSnapshot);
router.get(["/templates", "/v2/templates"], optionalAuth, getInstituteTemplates);
router.get(["/templates/:id", "/v2/templates/:id"], optionalAuth, getInstituteTemplateById);
router.get(["/designs", "/v2/designs"], optionalAuth, getInstituteDesigns);
router.post(["/designs", "/v2/designs"], optionalAuth, saveInstituteDesign);
router.delete(["/designs/:id", "/v2/designs/:id"], optionalAuth, deleteInstituteDesign);
router.post(["/designs/:id/export", "/v2/designs/:id/export"], optionalAuth, requestDesignExport);
router.get(["/exports/:id", "/v2/exports/:id"], optionalAuth, getExportStatus);
router.post(["/track", "/v2/track", "/templates/:id/track"], optionalAuth, trackTemplateAction);

// Super Admin Studio Endpoints
router.get(["/admin/templates", "/admin/v2/templates"], protect, superAdminOnly, getAdminTemplatesV2);
router.get(["/admin/templates/:id", "/admin/v2/templates/:id"], protect, superAdminOnly, getAdminTemplateV2ById);
router.post(["/admin/templates", "/admin/v2/templates"], protect, superAdminOnly, createAdminTemplateV2);
router.put(["/admin/templates/:id", "/admin/v2/templates/:id"], protect, superAdminOnly, updateAdminTemplateV2);
router.delete(["/admin/templates/:id", "/admin/v2/templates/:id"], protect, superAdminOnly, deleteAdminTemplateV2);
router.post(["/admin/templates/:id/duplicate", "/admin/v2/templates/:id/duplicate"], protect, superAdminOnly, duplicateAdminTemplateV2);
router.get(["/admin/templates/:id/versions", "/admin/v2/templates/:id/versions"], protect, superAdminOnly, getAdminTemplateVersions);

// Super Admin Categories
router.get(["/admin/categories", "/admin/v2/categories"], protect, superAdminOnly, getCategories);
router.post(["/admin/categories", "/admin/v2/categories"], protect, superAdminOnly, createCategoryAdmin);
router.put(["/admin/categories/:id", "/admin/v2/categories/:id"], protect, superAdminOnly, updateCategoryAdmin);
router.delete(["/admin/categories/:id", "/admin/v2/categories/:id"], protect, superAdminOnly, deleteCategoryAdmin);

// Super Admin Assets & Media
router.get(["/admin/assets", "/admin/v2/assets", "/admin/media"], protect, superAdminOnly, getAdminAssets);
router.post(["/admin/assets", "/admin/v2/assets", "/admin/media"], protect, superAdminOnly, upload.single("file"), uploadAdminAsset);
router.delete(["/admin/assets/:id", "/admin/v2/assets/:id", "/admin/media/:id"], protect, superAdminOnly, deleteAdminAsset);

// Super Admin Studio Analytics
router.get(["/admin/analytics", "/admin/v2/analytics", "/admin/stats"], protect, superAdminOnly, getAdminStudioAnalytics);

// Super Admin Gemini AI Engine Endpoints (Templates, Vision Layouts, Backgrounds, Refinement)
router.post(["/admin/ai/generate", "/admin/v2/ai/generate"], protect, superAdminOnly, generateAiTemplate);
router.post(["/admin/ai/deconstruct-flyer", "/admin/v2/ai/deconstruct-flyer"], protect, superAdminOnly, upload.single("image"), deconstructFlyerWithAi);
router.post(["/admin/ai/generate-background", "/admin/v2/ai/generate-background"], protect, superAdminOnly, generateAiBackground);
router.post(["/admin/ai/refine", "/admin/v2/ai/refine"], protect, superAdminOnly, refineAiTemplate);
router.post(["/admin/ai/variations", "/admin/v2/ai/variations"], protect, superAdminOnly, generateAiVariations);

export default router;
