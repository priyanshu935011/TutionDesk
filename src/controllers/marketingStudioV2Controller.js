/**
 * CLASSTECH MARKETING STUDIO V2.0 - MASTER CONTROLLER
 * REST APIs for Super Admin Visual Studio & Institute Creative Hub
 */

import path from "path";
import fs from "fs";
import cloudinary from "../utils/cloudinary.js";
import MarketingCategory from "../models/MarketingCategory.js";
import MarketingTemplateV2 from "../models/MarketingTemplateV2.js";
import MarketingTemplateVersion from "../models/MarketingTemplateVersion.js";
import MarketingAsset from "../models/MarketingAsset.js";
import InstituteMarketingDesign from "../models/InstituteMarketingDesign.js";
import MarketingExport from "../models/MarketingExport.js";
import MarketingTemplateUsage from "../models/MarketingTemplateUsage.js";
import Institute from "../models/Institute.js";
import {
  validateCanonicalTemplate,
  resolveTemplatePlaceholders,
  convertV1ToCanonicalV2,
  CANONICAL_PRESETS,
} from "../utils/templateEngine.js";
import { processExportJob } from "../services/marketingExportService.js";
import {
  generateMarketingTemplateWithAi,
  analyzeReferenceFlyer,
  generateMarketingBackgroundImage,
  refineMarketingTemplate,
  generateAspectVariations,
  POSTER_STYLES,
} from "../services/marketingAiService.js";

// Helper to validate UUIDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (val) => typeof val === "string" && UUID_REGEX.test(val);

// Helper to generate a lightweight SVG thumbnail if no background image is uploaded
export function generateSvgThumbnail(canonicalData) {
  try {
    if (!canonicalData || !canonicalData.canvas) return "";
    const width = canonicalData.canvas.width || 1080;
    const height = canonicalData.canvas.height || 1080;
    const bg = canonicalData.canvas.backgroundColor || "#FFFFFF";
    const bgImg = canonicalData.canvas.backgroundImageUrl;

    let elementsSvg = "";
    if (bgImg && typeof bgImg === "string" && bgImg.startsWith("http")) {
      elementsSvg += `<image href="${bgImg}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>`;
    }

    if (Array.isArray(canonicalData.elements)) {
      const sorted = [...canonicalData.elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
      sorted.forEach((el) => {
        if (!el || el.isVisible === false) return;
        const x = el.x || 0;
        const y = el.y || 0;
        const w = el.width || 100;
        const h = el.height || 100;
        const opacity = el.opacity !== undefined ? el.opacity : 1;

        if (el.type === "rectangle" || el.type === "shape") {
          const fill = el.styling?.fill || el.styling?.backgroundColor || "#2563EB";
          const stroke = el.styling?.stroke || "none";
          const rx = el.styling?.borderRadius || 0;
          elementsSvg += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" stroke="${stroke}" opacity="${opacity}" />`;
        } else if (el.type === "circle") {
          const r = Math.min(w, h) / 2;
          const fill = el.styling?.fill || el.styling?.backgroundColor || "#2563EB";
          elementsSvg += `<circle cx="${x + r}" cy="${y + r}" r="${r}" fill="${fill}" opacity="${opacity}" />`;
        } else if (el.type === "text") {
          const fontSize = el.styling?.fontSize || 36;
          const fill = el.styling?.color || "#1E293B";
          const fontWeight = el.styling?.fontWeight || "bold";
          const fontFamily = el.styling?.fontFamily || "Inter, sans-serif";
          const align = (el.styling?.textAlign || "center").toLowerCase();
          const textAnchor = align === "center" ? "middle" : align === "right" ? "end" : "start";
          const textX = align === "center" ? x + w / 2 : align === "right" ? x + w : x;
          const textY = y + h / 2;
          const text = (el.content || el.placeholder || "").replace(/[<>&"]/g, " ");
          elementsSvg += `<text x="${textX}" y="${textY}" text-anchor="${textAnchor}" dominant-baseline="central" font-size="${fontSize}" font-family="${fontFamily}" font-weight="${fontWeight}" fill="${fill}" opacity="${opacity}">${text.substring(0, 80)}</text>`;
        } else if ((el.type === "image" || el.type === "logo") && el.content) {
          elementsSvg += `<image href="${el.content}" x="${x}" y="${y}" width="${w}" height="${h}" opacity="${opacity}" preserveAspectRatio="xMidYMid meet" />`;
        }
      });
    }

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${bg}"/>${elementsSvg}</svg>`;
    return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  } catch (err) {
    return "";
  }
}

// Helper to resolve category ID whether provided as UUID or category slug
async function resolveCategoryId(categoryIdOrSlug) {
  if (!categoryIdOrSlug) return null;
  if (isUuid(categoryIdOrSlug)) return categoryIdOrSlug;
  if (typeof categoryIdOrSlug === "string" && categoryIdOrSlug.trim() !== "") {
    const clean = categoryIdOrSlug.trim().toLowerCase();
    try {
      const cat = await MarketingCategory.findOne({ slug: clean }).lean();
      if (cat) {
        const id = cat.id || cat._id;
        if (isUuid(id)) return id;
      }
    } catch (err) {
      console.warn("[MarketingStudioV2] Error resolving category slug:", err.message);
    }
  }
  return null;
}

// Helper to extract institute ID from authenticated user or request
function getInstituteIdFromReq(req) {
  if (!req.user) return null;
  return req.user.institute || (req.user.role === "admin" ? req.user.id : null);
}

// Helper to fetch institute branding snapshot
async function fetchInstituteBranding(instituteId) {
  const defaultBranding = {
    name: "Premier Coaching Academy",
    phone: "+91 98765 43210",
    email: "contact@institute.com",
    address: "Main Academic Complex, City Center",
    logo: "",
    tagline: "Empowering Students to Excel",
    primaryColor: "#2563EB",
    secondaryColor: "#1E40AF",
    accentColor: "#F59E0B",
  };

  if (!instituteId) return defaultBranding;

  try {
    const inst = await Institute.findById(instituteId).lean();
    if (!inst) return defaultBranding;

    return {
      name: inst.name || inst.instituteName || defaultBranding.name,
      phone: inst.phone || inst.contactNumber || inst.ownerPhone || defaultBranding.phone,
      email: inst.email || inst.contactEmail || defaultBranding.email,
      address: inst.address || inst.city || defaultBranding.address,
      logo: inst.logoUrl || inst.logo || "",
      tagline: inst.tagline || defaultBranding.tagline,
      primaryColor: inst.themeColor || inst.primaryColor || defaultBranding.primaryColor,
      secondaryColor: inst.secondaryColor || defaultBranding.secondaryColor,
      accentColor: inst.accentColor || defaultBranding.accentColor,
    };
  } catch (err) {
    console.warn("[MarketingStudioV2] Error fetching institute branding:", err.message);
    return defaultBranding;
  }
}

// ============================================================================
// 1. CATEGORY MANAGEMENT
// ============================================================================

export const getCategories = async (req, res) => {
  try {
    let categories = await MarketingCategory.find({ is_active: true })
      .sort({ display_order: 1 })
      .lean();

    // Fallback if table is not yet seeded
    if (!categories || categories.length === 0) {
      categories = [
        { id: "admissions", name: "Admissions Open", slug: "admissions", icon: "fi-rr-graduation-cap" },
        { id: "new_batches", name: "New Batches", slug: "new_batches", icon: "fi-rr-rocket-lunch" },
        { id: "results", name: "Results & Toppers", slug: "results", icon: "fi-rr-trophy" },
        { id: "festivals", name: "Festivals & Wishes", slug: "festivals", icon: "fi-rr-party-horn" },
        { id: "faculty", name: "Faculty & Mentors", slug: "faculty", icon: "fi-rr-user" },
        { id: "quotes", name: "Daily Quotes", slug: "quotes", icon: "fi-rr-comment-quote" },
        { id: "offers", name: "Offers & Discounts", slug: "offers", icon: "fi-rr-sparkles" },
        { id: "announcements", name: "Announcements", slug: "announcements", icon: "fi-rr-megaphone" },
        { id: "social_media", name: "Social Media & Stories", slug: "social_media", icon: "fi-rr-share" },
      ];
    }

    return res.json({ success: true, categories });
  } catch (error) {
    console.error("getCategories error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createCategoryAdmin = async (req, res) => {
  try {
    const { name, slug, description, icon, display_order } = req.body;
    if (!name || !slug) {
      return res.status(400).json({ success: false, message: "Category name and slug are required." });
    }

    const category = await MarketingCategory.create({
      name: name.trim(),
      slug: slug.trim().toLowerCase(),
      description: description || "",
      icon: icon || "fi-rr-apps",
      display_order: Number(display_order) || 0,
      is_active: true,
    });

    return res.status(201).json({ success: true, category });
  } catch (error) {
    console.error("createCategoryAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateCategoryAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, slug, description, icon, display_order, is_active } = req.body;
    const updateData = {};
    if (name) updateData.name = name.trim();
    if (slug) updateData.slug = slug.trim().toLowerCase();
    if (description !== undefined) updateData.description = description;
    if (icon) updateData.icon = icon;
    if (display_order !== undefined) updateData.display_order = Number(display_order);
    if (is_active !== undefined) updateData.is_active = Boolean(is_active);

    const category = await MarketingCategory.findByIdAndUpdate(id, updateData, { new: true });
    if (!category) {
      return res.status(404).json({ success: false, message: "Category not found." });
    }

    return res.json({ success: true, category });
  } catch (error) {
    console.error("updateCategoryAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteCategoryAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Category ID is required." });
    }

    // Unlink any templates associated with this category
    try {
      await MarketingTemplateV2.updateMany({ category_id: id }, { category_id: null });
    } catch (_) {}

    try {
      await MarketingCategory.findByIdAndDelete(id);
    } catch (delErr) {
      console.warn("[deleteCategoryAdmin] Hard delete failed, setting is_active=false:", delErr.message);
      await MarketingCategory.findByIdAndUpdate(id, { is_active: false });
    }
    return res.json({ success: true, message: "Category deleted successfully." });
  } catch (error) {
    console.error("deleteCategoryAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 2. SUPER ADMIN TEMPLATES V2
// ============================================================================

export const getAdminTemplatesV2 = async (req, res) => {
  try {
    const { category, status, aspect_ratio, search, page = 1, limit = 50 } = req.query;
    const filter = {};

    if (category && category !== "all") {
      filter.category_id = category;
    }
    if (status && status !== "all") {
      filter.status = status;
    }
    if (aspect_ratio && aspect_ratio !== "all") {
      filter.aspect_ratio = aspect_ratio;
    }

    let query = MarketingTemplateV2.find(filter)
      .sort({ priority: -1, created_at: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const templates = await query.lean();

    // Batch-fetch current template versions to attach elements & canonical JSON
    const templateIds = (templates || []).map((t) => t.id || t._id);
    const versionMap = new Map();
    if (templateIds.length > 0) {
      try {
        const versions = await MarketingTemplateVersion.find({
          template_id: { $in: templateIds },
        }).lean();
        (versions || []).forEach((v) => {
          versionMap.set(String(v.template_id), v);
        });
      } catch (_) {}
    }

    const enriched = (templates || []).map((t) => {
      const tid = String(t.id || t._id);
      const v = versionMap.get(tid);

      return {
        ...t,
        title: t.name || t.title,
        imageUrl: t.thumbnail_url || t.preview_url,
        image_url: t.thumbnail_url || t.preview_url,
        canvas: v?.template_json?.canvas || {
          width: t.canvas_width || 1080,
          height: t.canvas_height || 1080,
          backgroundColor: "#FFFFFF",
        },
        template_json: v?.template_json || null,
        elements: v?.template_json?.elements || [],
      };
    });

    return res.json({
      success: true,
      templates: enriched,
      presets: CANONICAL_PRESETS,
    });
  } catch (error) {
    console.error("getAdminTemplatesV2 error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminTemplateV2ById = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MarketingTemplateV2.findById(id).lean();
    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found." });
    }

    // Get current version
    const version = await MarketingTemplateVersion.findOne({
      template_id: id,
      version_number: template.current_version_number || 1,
    }).lean();

    return res.json({
      success: true,
      template,
      currentVersion: version,
      templateJson: version?.template_json || null,
    });
  } catch (error) {
    console.error("getAdminTemplateV2ById error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createAdminTemplateV2 = async (req, res) => {
  try {
    let {
      name,
      slug,
      category_id,
      description,
      aspect_ratio = "1:1",
      canvas_width = 1080,
      canvas_height = 1080,
      thumbnail_url = "",
      preview_url = "",
      status = "published",
      priority = 0,
      tags = [],
      default_share_caption = "",
      template_json,
    } = req.body;

    if (!name) {
      return res.status(400).json({ success: false, message: "Template name is required." });
    }

    if (!slug) {
      slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    }

    // Validate canonical template JSON
    let canonicalData;
    try {
      canonicalData = validateCanonicalTemplate(
        typeof template_json === "string" ? JSON.parse(template_json) : (template_json || { canvas: { width: canvas_width, height: canvas_height }, elements: [] })
      );
    } catch (vErr) {
      return res.status(400).json({ success: false, message: `Template validation error: ${vErr.message}` });
    }

    const resolvedCatId = await resolveCategoryId(category_id);
    const finalThumbnail = thumbnail_url || canonicalData.canvas?.backgroundImageUrl || generateSvgThumbnail(canonicalData);

    // 1. Create master template record
    const template = await MarketingTemplateV2.create({
      name: name.trim(),
      slug: slug.trim(),
      category_id: resolvedCatId,
      description: description || "",
      aspect_ratio,
      canvas_width: canonicalData.canvas.width || 1080,
      canvas_height: canonicalData.canvas.height || 1080,
      thumbnail_url: finalThumbnail,
      preview_url: preview_url || finalThumbnail,
      schema_version: "2.0",
      current_version_number: 1,
      status: status || "published",
      priority: Number(priority) || 0,
      tags: Array.isArray(tags) ? tags : [],
      default_share_caption: default_share_caption || "Warm wishes from {institute.name}! For inquiries, contact: {institute.phone}.",
      created_by: req.user?.email || "super_admin",
    });

    const templateId = template._id || template.id;

    // 2. Create immutable Version 1 snapshot
    const version = await MarketingTemplateVersion.create({
      template_id: templateId,
      version_number: 1,
      template_json: canonicalData,
      preview_url: preview_url || finalThumbnail,
      publication_status: status || "published",
      change_summary: "Initial master version creation",
      published_by: req.user?.email || "super_admin",
    });

    return res.status(201).json({
      success: true,
      message: "Template created successfully with Version 1 snapshot.",
      template,
      version,
    });
  } catch (error) {
    console.error("createAdminTemplateV2 error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAdminTemplateV2 = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      category_id,
      status,
      priority,
      tags,
      default_share_caption,
      template_json,
      change_summary = "Template updated",
    } = req.body;

    const template = await MarketingTemplateV2.findById(id);
    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found." });
    }

    let nextVersionNumber = (template.current_version_number || 1) + 1;
    let validatedJson = null;

    if (template_json) {
      try {
        validatedJson = validateCanonicalTemplate(
          typeof template_json === "string" ? JSON.parse(template_json) : template_json
        );
      } catch (valErr) {
        return res.status(400).json({ success: false, message: `Invalid template JSON: ${valErr.message}` });
      }

      // Create new immutable version record
      await MarketingTemplateVersion.create({
        template_id: id,
        version_number: nextVersionNumber,
        template_json: validatedJson,
        publication_status: status || template.status || "published",
        change_summary: change_summary || `Version ${nextVersionNumber} revision`,
        published_by: req.user?.email || "super_admin",
      });
    }

    const resolvedCatId = category_id !== undefined ? await resolveCategoryId(category_id) : undefined;
    const finalThumbnail = validatedJson ? (thumbnail_url || validatedJson.canvas?.backgroundImageUrl || generateSvgThumbnail(validatedJson)) : thumbnail_url;

    const updateFields = {
      ...(name ? { name: name.trim() } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(resolvedCatId !== undefined ? { category_id: resolvedCatId } : {}),
      ...(finalThumbnail ? { thumbnail_url: finalThumbnail, preview_url: finalThumbnail } : {}),
      ...(status ? { status } : {}),
      ...(priority !== undefined ? { priority: Number(priority) } : {}),
      ...(tags ? { tags } : {}),
      ...(default_share_caption ? { default_share_caption } : {}),
      ...(validatedJson ? { current_version_number: nextVersionNumber } : {}),
      ...(validatedJson?.canvas?.width ? { canvas_width: validatedJson.canvas.width } : {}),
      ...(validatedJson?.canvas?.height ? { canvas_height: validatedJson.canvas.height } : {}),
    };

    const updatedTemplate = await MarketingTemplateV2.findByIdAndUpdate(id, updateFields, { new: true });

    return res.json({
      success: true,
      message: `Template updated successfully to Version ${updatedTemplate.current_version_number}.`,
      template: updatedTemplate,
    });
  } catch (error) {
    console.error("updateAdminTemplateV2 error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const duplicateAdminTemplateV2 = async (req, res) => {
  try {
    const { id } = req.params;
    const sourceTemplate = await MarketingTemplateV2.findById(id).lean();
    if (!sourceTemplate) {
      return res.status(404).json({ success: false, message: "Source template not found." });
    }

    const latestVersion = await MarketingTemplateVersion.findOne({
      template_id: id,
      version_number: sourceTemplate.current_version_number || 1,
    }).lean();

    const newName = `${sourceTemplate.name} (Copy)`;
    const newSlug = `${sourceTemplate.slug}-copy-${Date.now()}`;

    const newTemplate = await MarketingTemplateV2.create({
      name: newName,
      slug: newSlug,
      category_id: (sourceTemplate.category_id && isUuid(sourceTemplate.category_id)) ? sourceTemplate.category_id : null,
      description: sourceTemplate.description,
      aspect_ratio: sourceTemplate.aspect_ratio,
      canvas_width: sourceTemplate.canvas_width,
      canvas_height: sourceTemplate.canvas_height,
      thumbnail_url: sourceTemplate.thumbnail_url,
      preview_url: sourceTemplate.preview_url,
      status: "draft",
      current_version_number: 1,
      priority: 0,
      tags: sourceTemplate.tags || [],
      default_share_caption: sourceTemplate.default_share_caption,
      created_by: req.user?.email || "super_admin",
    });

    const newTemplateId = newTemplate._id || newTemplate.id;

    await MarketingTemplateVersion.create({
      template_id: newTemplateId,
      version_number: 1,
      template_json: latestVersion?.template_json || { canvas: { width: sourceTemplate.canvas_width, height: sourceTemplate.canvas_height }, elements: [] },
      preview_url: sourceTemplate.preview_url,
      publication_status: "draft",
      change_summary: `Duplicated from ${sourceTemplate.name}`,
      published_by: req.user?.email || "super_admin",
    });

    return res.status(201).json({
      success: true,
      message: "Template duplicated successfully.",
      template: newTemplate,
    });
  } catch (error) {
    console.error("duplicateAdminTemplateV2 error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteAdminTemplateV2 = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Template ID is required." });
    }

    try {
      await MarketingTemplateVersion.deleteMany({ template_id: id });
    } catch (vErr) {
      console.warn("[deleteAdminTemplateV2] Error deleting template versions:", vErr.message);
    }

    try {
      await MarketingTemplateUsage.deleteMany({ template_id: id });
    } catch (uErr) {
      console.warn("[deleteAdminTemplateV2] Error deleting template usage:", uErr.message);
    }

    const deleted = await MarketingTemplateV2.findByIdAndDelete(id);
    if (!deleted) {
      const checkExists = await MarketingTemplateV2.findById(id);
      if (!checkExists) {
        return res.json({ success: true, message: "Template deleted successfully." });
      }
      return res.status(404).json({ success: false, message: "Template not found." });
    }

    return res.json({ success: true, message: "Template deleted successfully." });
  } catch (error) {
    console.error("deleteAdminTemplateV2 error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getAdminTemplateVersions = async (req, res) => {
  try {
    const { id } = req.params;
    const versions = await MarketingTemplateVersion.find({ template_id: id })
      .sort({ version_number: -1 })
      .lean();

    return res.json({ success: true, versions: versions || [] });
  } catch (error) {
    console.error("getAdminTemplateVersions error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 3. ASSET LIBRARY MANAGEMENT
// ============================================================================

export const getAdminAssets = async (req, res) => {
  try {
    const { asset_type, search } = req.query;
    const filter = { owner_type: "super_admin" };
    if (asset_type && asset_type !== "all") {
      filter.asset_type = asset_type;
    }

    const assets = await MarketingAsset.find(filter).sort({ created_at: -1 }).lean();
    return res.json({ success: true, assets: assets || [] });
  } catch (error) {
    console.error("getAdminAssets error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const uploadAdminAsset = async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      return res.status(400).json({ success: false, message: "No asset file uploaded." });
    }

    // Strict MIME validation
    const allowedMimes = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
    if (!allowedMimes.includes(file.mimetype)) {
      return res.status(400).json({
        success: false,
        message: `Unsupported file type: ${file.mimetype}. Allowed formats: PNG, JPG, SVG, WebP.`,
      });
    }

    // 15MB file size limit
    if (file.size > 15 * 1024 * 1024) {
      return res.status(400).json({ success: false, message: "Asset file exceeds 15MB size limit." });
    }

    const { asset_name, asset_type = "background", tags = "[]" } = req.body;

    let publicUrl = "";
    let storagePath = "";

    // Upload to Cloudinary
    try {
      const b64 = `data:${file.mimetype};base64,${file.buffer.toString("base64")}`;
      const uploadRes = await cloudinary.uploader.upload(b64, {
        resource_type: "image",
        folder: "marketing_studio_assets",
      });
      publicUrl = uploadRes.secure_url || uploadRes.url;
      storagePath = uploadRes.public_id;
    } catch (cErr) {
      // Local fallback
      const filename = `asset_${Date.now()}_${file.originalname.replace(/\s+/g, "_")}`;
      const localPath = path.join(process.cwd(), "uploads", "marketing_assets", filename);
      fs.mkdirSync(path.dirname(localPath), { recursive: true });
      fs.writeFileSync(localPath, file.buffer);
      publicUrl = `/uploads/marketing_assets/${filename}`;
      storagePath = localPath;
    }

    const asset = await MarketingAsset.create({
      owner_type: "super_admin",
      owner_id: null,
      asset_name: asset_name || file.originalname,
      asset_type,
      storage_path: storagePath,
      public_url: publicUrl,
      mime_type: file.mimetype,
      file_size: file.size,
      tags: typeof tags === "string" ? JSON.parse(tags || "[]") : tags,
      created_by: req.user?.email || "super_admin",
    });

    return res.status(201).json({
      success: true,
      message: "Asset uploaded successfully to Studio Library.",
      asset,
    });
  } catch (error) {
    console.error("uploadAdminAsset error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteAdminAsset = async (req, res) => {
  try {
    const { id } = req.params;
    await MarketingAsset.findByIdAndDelete(id);
    return res.json({ success: true, message: "Asset deleted successfully." });
  } catch (error) {
    console.error("deleteAdminAsset error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 4. SUPER ADMIN ANALYTICS
// ============================================================================

export const getAdminStudioAnalytics = async (req, res) => {
  try {
    const totalTemplates = await MarketingTemplateV2.countDocuments();
    const publishedTemplates = await MarketingTemplateV2.countDocuments({ status: "published" });
    const totalDesigns = await InstituteMarketingDesign.countDocuments();
    const totalExports = await MarketingExport.countDocuments({ status: "ready" });

    // Recent activity usage
    const recentActivity = await MarketingTemplateUsage.find()
      .sort({ created_at: -1 })
      .limit(20)
      .lean();

    return res.json({
      success: true,
      analytics: {
        totalTemplates: totalTemplates || 0,
        publishedTemplates: publishedTemplates || 0,
        totalDesignsSaved: totalDesigns || 0,
        totalExportsRendered: totalExports || 0,
        recentActivity: recentActivity || [],
      },
    });
  } catch (error) {
    console.error("getAdminStudioAnalytics error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 5. INSTITUTE MOBILE & WEB ENDPOINTS
// ============================================================================

export const getInstituteCategories = async (req, res) => {
  try {
    let categories = await MarketingCategory.find({ is_active: true })
      .sort({ display_order: 1 })
      .lean();

    if (!categories || categories.length === 0) {
      categories = [
        { id: "admissions", name: "Admissions Open", slug: "admissions", icon: "fi-rr-graduation-cap" },
        { id: "new_batches", name: "New Batches", slug: "new_batches", icon: "fi-rr-rocket-lunch" },
        { id: "results", name: "Results & Toppers", slug: "results", icon: "fi-rr-trophy" },
        { id: "festivals", name: "Festivals & Wishes", slug: "festivals", icon: "fi-rr-party-horn" },
        { id: "faculty", name: "Faculty & Mentors", slug: "faculty", icon: "fi-rr-user" },
        { id: "quotes", name: "Daily Quotes", slug: "quotes", icon: "fi-rr-comment-quote" },
        { id: "offers", name: "Offers & Discounts", slug: "offers", icon: "fi-rr-sparkles" },
        { id: "announcements", name: "Announcements", slug: "announcements", icon: "fi-rr-megaphone" },
        { id: "social_media", name: "Social Media & Stories", slug: "social_media", icon: "fi-rr-share" },
      ];
    }

    // Calculate published template counts per category
    const counts = {};
    try {
      const templates = await MarketingTemplateV2.find({ status: "published" }).select("category_id").lean();
      (templates || []).forEach((t) => {
        if (t.category_id) {
          counts[String(t.category_id)] = (counts[String(t.category_id)] || 0) + 1;
        }
      });
    } catch (_) {}

    const enriched = (categories || []).map((c) => {
      const cid = String(c.id || c._id);
      return {
        ...c,
        id: cid,
        template_count: counts[cid] || (c.slug ? counts[c.slug] : 0) || 0,
      };
    });

    return res.json({ success: true, categories: enriched });
  } catch (error) {
    console.error("getInstituteCategories error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getInstituteBrandingSnapshot = async (req, res) => {
  try {
    const instituteId = getInstituteIdFromReq(req);
    const branding = await fetchInstituteBranding(instituteId);
    return res.json({ success: true, branding });
  } catch (error) {
    console.error("getInstituteBrandingSnapshot error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getInstituteTemplates = async (req, res) => {
  try {
    const { category, aspect_ratio, search, page = 1, limit = 40 } = req.query;
    const filter = { status: "published" };

    if (category && category !== "all") {
      const resolvedCatId = await resolveCategoryId(category);
      if (resolvedCatId && resolvedCatId !== category) {
        filter.$or = [
          { category_id: category },
          { category_id: resolvedCatId },
        ];
      } else {
        filter.category_id = category;
      }
    }
    if (aspect_ratio && aspect_ratio !== "all") {
      filter.aspect_ratio = aspect_ratio;
    }
    if (search && search.trim()) {
      filter.name = new RegExp(search.trim(), "i");
    }

    const templates = await MarketingTemplateV2.find(filter)
      .sort({ priority: -1, created_at: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit))
      .lean();

    const instituteId = getInstituteIdFromReq(req);
    const branding = await fetchInstituteBranding(instituteId);

    // Batch-fetch current template versions to attach elements/canonical JSON
    const templateIds = (templates || []).map((t) => t.id || t._id);
    const versionMap = new Map();
    if (templateIds.length > 0) {
      try {
        const versions = await MarketingTemplateVersion.find({
          template_id: { $in: templateIds },
        }).lean();
        (versions || []).forEach((v) => {
          versionMap.set(String(v.template_id), v);
        });
      } catch (_) {}
    }

    // Enforce safe default share caption interpolation and attach version JSON
    const enriched = (templates || []).map((t) => {
      let caption = t.default_share_caption || "Warm wishes from {institute.name}! Contact us: {institute.phone}.";
      caption = caption
        .replace(/\{institute\.name\}|\{instituteName\}/gi, branding.name)
        .replace(/\{institute\.phone\}|\{phone\}/gi, branding.phone)
        .replace(/\{institute\.address\}|\{address\}/gi, branding.address);

      const tid = String(t.id || t._id);
      const v = versionMap.get(tid);

      return {
        ...t,
        title: t.name || t.title,
        imageUrl: t.thumbnail_url || t.preview_url,
        image_url: t.thumbnail_url || t.preview_url,
        rendered_caption: caption,
        canvas: v?.template_json?.canvas || {
          width: t.canvas_width || 1080,
          height: t.canvas_height || 1080,
          backgroundColor: "#FFFFFF",
        },
        template_json: v?.template_json || null,
        elements: v?.template_json?.elements || [],
      };
    });

    return res.json({
      success: true,
      templates: enriched,
      branding,
    });
  } catch (error) {
    console.error("getInstituteTemplates error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getInstituteTemplateById = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MarketingTemplateV2.findById(id).lean();
    if (!template) {
      return res.status(404).json({ success: false, message: "Template not found." });
    }

    const version = await MarketingTemplateVersion.findOne({
      template_id: id,
      version_number: template.current_version_number || 1,
    }).lean();

    const instituteId = getInstituteIdFromReq(req);
    const branding = await fetchInstituteBranding(instituteId);

    // Resolve placeholders for immediate zero-latency mobile rendering
    const resolvedDesign = resolveTemplatePlaceholders(version?.template_json || {}, {
      id: instituteId,
      name: branding.name,
      logoUrl: branding.logo,
      phone: branding.phone,
      address: branding.address,
      email: branding.email,
      primaryColor: branding.primaryColor,
      secondaryColor: branding.secondaryColor,
      accentColor: branding.accentColor,
    });

    return res.json({
      success: true,
      template,
      version: version?.version_number || 1,
      resolvedDesign,
      branding,
    });
  } catch (error) {
    console.error("getInstituteTemplateById error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getInstituteDesigns = async (req, res) => {
  try {
    const instituteId = getInstituteIdFromReq(req);
    if (!instituteId) {
      return res.status(401).json({ success: false, message: "Authentication required to view saved designs." });
    }

    const designs = await InstituteMarketingDesign.find({ institute_id: instituteId })
      .sort({ updated_at: -1 })
      .lean();

    return res.json({ success: true, designs: designs || [] });
  } catch (error) {
    console.error("getInstituteDesigns error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const saveInstituteDesign = async (req, res) => {
  try {
    const instituteId = getInstituteIdFromReq(req);
    if (!instituteId) {
      return res.status(401).json({ success: false, message: "Authentication required to save designs." });
    }

    const {
      designId,
      template_id,
      template_version_id,
      design_name = "My Custom Design",
      design_json,
      thumbnail_url,
      status = "saved",
    } = req.body;

    if (!template_id && !designId) {
      return res.status(400).json({ success: false, message: "template_id or designId is required." });
    }

    const validatedDesign = validateCanonicalTemplate(design_json);
    const brandingSnapshot = await fetchInstituteBranding(instituteId);

    let design;
    if (designId) {
      // Update existing design
      design = await InstituteMarketingDesign.findOneAndUpdate(
        { _id: designId, institute_id: instituteId },
        {
          design_name: design_name.trim(),
          design_json: validatedDesign,
          branding_snapshot: brandingSnapshot,
          ...(thumbnail_url ? { thumbnail_url } : {}),
          status,
          $inc: { revision_number: 1 },
          updated_by: req.user?.id || null,
        },
        { new: true }
      );

      if (!design) {
        return res.status(404).json({ success: false, message: "Design not found or access denied." });
      }
    } else {
      // Create new saved design
      design = await InstituteMarketingDesign.create({
        institute_id: instituteId,
        template_id,
        template_version_id: template_version_id || null,
        design_name: design_name.trim(),
        design_json: validatedDesign,
        branding_snapshot: brandingSnapshot,
        thumbnail_url: thumbnail_url || "",
        status,
        revision_number: 1,
        created_by: req.user?.id || null,
      });
    }

    // Log save_draft action
    try {
      await MarketingTemplateUsage.create({
        institute_id: instituteId,
        template_id: template_id || design.template_id,
        design_id: design._id || design.id,
        action: "save_draft",
        metadata: { design_name: design.design_name },
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Design saved to cloud successfully.",
      design,
    });
  } catch (error) {
    console.error("saveInstituteDesign error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteInstituteDesign = async (req, res) => {
  try {
    const { id } = req.params;
    const instituteId = getInstituteIdFromReq(req);

    const deleted = await InstituteMarketingDesign.findOneAndDelete({
      _id: id,
      institute_id: instituteId,
    });

    if (!deleted) {
      return res.status(404).json({ success: false, message: "Design not found or unauthorized." });
    }

    return res.json({ success: true, message: "Design removed successfully." });
  } catch (error) {
    console.error("deleteInstituteDesign error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const requestDesignExport = async (req, res) => {
  try {
    const { id } = req.params; // design ID
    const { format = "png", resolution_dpi = 300 } = req.body;
    const instituteId = getInstituteIdFromReq(req);

    if (!instituteId) {
      return res.status(401).json({ success: false, message: "Authentication required for high-DPI export." });
    }

    const design = await InstituteMarketingDesign.findOne({ _id: id, institute_id: instituteId });
    if (!design) {
      return res.status(404).json({ success: false, message: "Design not found." });
    }

    // Create export job record
    const exportJob = await MarketingExport.create({
      institute_id: instituteId,
      design_id: id,
      format: ["png", "jpg", "pdf"].includes(format.toLowerCase()) ? format.toLowerCase() : "png",
      resolution_dpi: Number(resolution_dpi) || 300,
      canvas_preset: `${design.design_json?.canvas?.width || 1080}x${design.design_json?.canvas?.height || 1080}`,
      status: "processing",
      requested_by: req.user?.id || null,
    });

    const exportId = exportJob._id || exportJob.id;

    // Trigger async rendering pipeline in background (non-blocking)
    processExportJob(exportId).catch((err) => {
      console.error(`[ExportJob] Unhandled error processing export ${exportId}:`, err);
    });

    // Log export action
    try {
      await MarketingTemplateUsage.create({
        institute_id: instituteId,
        template_id: design.template_id,
        design_id: id,
        action: "export",
        metadata: { format, resolution_dpi },
      });
    } catch (_) {}

    return res.status(202).json({
      success: true,
      message: "Export job started.",
      exportId,
      status: "processing",
    });
  } catch (error) {
    console.error("requestDesignExport error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getExportStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const exportJob = await MarketingExport.findById(id).lean();
    if (!exportJob) {
      return res.status(404).json({ success: false, message: "Export job not found." });
    }

    return res.json({
      success: true,
      export: {
        id: exportJob._id || exportJob.id,
        status: exportJob.status, // processing, ready, failed
        format: exportJob.format,
        resolution_dpi: exportJob.resolution_dpi,
        public_url: exportJob.public_url || "",
        file_size: exportJob.file_size || 0,
        error_message: exportJob.error_message || "",
        created_at: exportJob.created_at,
      },
    });
  } catch (error) {
    console.error("getExportStatus error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const trackTemplateAction = async (req, res) => {
  try {
    const { template_id, action, design_id, metadata } = req.body;
    const instituteId = getInstituteIdFromReq(req);

    if (!template_id || !action) {
      return res.status(400).json({ success: false, message: "template_id and action are required." });
    }

    await MarketingTemplateUsage.create({
      institute_id: instituteId || "00000000-0000-0000-0000-000000000000",
      template_id,
      design_id: design_id || null,
      action,
      metadata: metadata || {},
    });

    return res.json({ success: true, message: "Action tracked." });
  } catch (error) {
    console.error("trackTemplateAction error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// AI MARKETING ENGINE CONTROLLER ENDPOINTS (SUPER ADMIN ONLY)
// ============================================================================

export const getAiPosterStyles = (req, res) => {
  return res.json({
    success: true,
    styles: POSTER_STYLES,
  });
};

export const generateAiTemplate = async (req, res) => {
  try {
    const {
      prompt,
      category = "admissions",
      aspectRatio = "1:1",
      targetAudience = "students and parents",
      themeColor = "#1E3A8A",
      includeImage = false,
      visualStyle = "auto",
      saveAsTemplate = false,
      status = "published",
    } = req.body;

    if (!prompt) {
      return res.status(400).json({ success: false, message: "Prompt is required." });
    }

    const template = await generateMarketingTemplateWithAi({
      prompt,
      category,
      aspectRatio,
      targetAudience,
      themeColor,
      includeImage: Boolean(includeImage),
      visualStyle,
      user: req.user,
    });

    let savedRecord = null;
    let savedVersion = null;

    if (saveAsTemplate) {
      const resolvedCatId = await resolveCategoryId(category);
      const finalThumbnail = template.canvas?.backgroundImageUrl || generateSvgThumbnail(template);
      const name = template.name || `AI: ${prompt.substring(0, 30)}`;
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

      savedRecord = await MarketingTemplateV2.create({
        name,
        slug,
        category_id: resolvedCatId,
        description: `Generated by AI: "${prompt}"`,
        aspect_ratio: aspectRatio,
        canvas_width: template.canvas.width || 1080,
        canvas_height: template.canvas.height || 1080,
        thumbnail_url: finalThumbnail,
        preview_url: finalThumbnail,
        schema_version: "2.0",
        current_version_number: 1,
        status: status || "published",
        priority: 10,
        tags: ["ai-generated", category],
        default_share_caption: `Admissions open at {institute.name}! For inquiries, call {institute.phone}.`,
        created_by: req.user?.email || "super_admin",
      });

      const templateId = savedRecord._id || savedRecord.id;
      savedVersion = await MarketingTemplateVersion.create({
        template_id: templateId,
        version_number: 1,
        template_json: template,
        preview_url: finalThumbnail,
        publication_status: status || "published",
        change_summary: "AI Generated Master Template",
        published_by: req.user?.email || "super_admin",
      });
    }

    return res.json({
      success: true,
      message: "Template generated successfully.",
      template,
      savedRecord,
      savedVersion,
    });
  } catch (error) {
    console.error("generateAiTemplate error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to generate AI template.",
      code: error.code || "AI_GENERATION_FAILED",
    });
  }
};

export const deconstructFlyerWithAi = async (req, res) => {
  try {
    let imageBase64 = "";
    let imageMimeType = "image/jpeg";

    if (req.file) {
      imageBase64 = req.file.buffer.toString("base64");
      imageMimeType = req.file.mimetype || "image/jpeg";
    } else if (req.body.imageBase64) {
      imageBase64 = req.body.imageBase64;
      imageMimeType = req.body.imageMimeType || "image/jpeg";
      if (imageBase64.includes(",")) {
        const parts = imageBase64.split(",");
        imageBase64 = parts[1];
        const match = parts[0].match(/:(.*?);/);
        if (match) imageMimeType = match[1];
      }
    }

    if (!imageBase64) {
      return res.status(400).json({ success: false, message: "Please upload an image file or provide imageBase64." });
    }

    const {
      notes = "",
      category = "admissions",
      targetAspectRatio = "1:1",
      saveAsTemplate = false,
      status = "published",
    } = req.body;

    const template = await analyzeReferenceFlyer({
      imageBase64,
      imageMimeType,
      notes,
      category,
      targetAspectRatio,
      user: req.user,
    });

    let savedRecord = null;
    let savedVersion = null;

    if (saveAsTemplate) {
      const resolvedCatId = await resolveCategoryId(category);
      const finalThumbnail = template.canvas?.backgroundImageUrl || generateSvgThumbnail(template);
      const name = template.name || `Flyer: ${notes ? notes.substring(0, 30) : "Deconstructed Layout"}`;
      const slug = `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

      savedRecord = await MarketingTemplateV2.create({
        name,
        slug,
        category_id: resolvedCatId,
        description: `Deconstructed from reference flyer: ${notes}`,
        aspect_ratio: targetAspectRatio,
        canvas_width: template.canvas.width || 1080,
        canvas_height: template.canvas.height || 1080,
        thumbnail_url: finalThumbnail,
        preview_url: finalThumbnail,
        schema_version: "2.0",
        current_version_number: 1,
        status: status || "published",
        priority: 10,
        tags: ["flyer-deconstruct", category],
        default_share_caption: `Admissions open at {institute.name}! Contact: {institute.phone}.`,
        created_by: req.user?.email || "super_admin",
      });

      const templateId = savedRecord._id || savedRecord.id;
      savedVersion = await MarketingTemplateVersion.create({
        template_id: templateId,
        version_number: 1,
        template_json: template,
        preview_url: finalThumbnail,
        publication_status: status || "published",
        change_summary: "AI Deconstructed Flyer Template",
        published_by: req.user?.email || "super_admin",
      });
    }

    return res.json({
      success: true,
      message: "Flyer deconstructed into template successfully.",
      template,
      savedRecord,
      savedVersion,
    });
  } catch (error) {
    console.error("deconstructFlyerWithAi error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to deconstruct flyer.",
      code: error.code || "AI_VISION_FAILED",
    });
  }
};

export const generateAiBackground = async (req, res) => {
  try {
    const { prompt, aspectRatio = "1:1", style = "vector", themeColor = "#1E3A8A" } = req.body;
    if (!prompt) {
      return res.status(400).json({ success: false, message: "Prompt is required." });
    }

    const data = await generateMarketingBackgroundImage({
      prompt,
      aspectRatio,
      style,
      themeColor,
      user: req.user,
    });

    return res.json({
      success: true,
      message: "AI background generated successfully.",
      data,
    });
  } catch (error) {
    console.error("generateAiBackground error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to generate AI background image.",
      code: error.code || "AI_IMAGE_FAILED",
    });
  }
};

export const refineAiTemplate = async (req, res) => {
  try {
    const { currentTemplate, userInstruction } = req.body;
    if (!currentTemplate || !userInstruction) {
      return res.status(400).json({
        success: false,
        message: "currentTemplate and userInstruction are required.",
      });
    }

    const template = await refineMarketingTemplate({
      currentTemplate,
      userInstruction,
      user: req.user,
    });

    return res.json({
      success: true,
      message: "Template refined successfully.",
      template,
    });
  } catch (error) {
    console.error("refineAiTemplate error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to refine template.",
      code: error.code || "AI_REFINE_FAILED",
    });
  }
};

export const generateAiVariations = async (req, res) => {
  try {
    const { template, targetRatio = "9:16" } = req.body;
    if (!template) {
      return res.status(400).json({ success: false, message: "Template is required." });
    }

    const variedTemplate = await generateAspectVariations({
      template,
      targetRatio,
      user: req.user,
    });

    return res.json({
      success: true,
      message: `Variation for ${targetRatio} generated successfully.`,
      template: variedTemplate,
    });
  } catch (error) {
    console.error("generateAiVariations error:", error);
    return res.status(error.status || 500).json({
      success: false,
      message: error.message || "Failed to generate variation.",
      code: error.code || "AI_VARIATION_FAILED",
    });
  }
};
