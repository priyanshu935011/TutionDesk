import mongoose from "mongoose";
import axios from "axios";
import sharp from "sharp";
import MarketingTemplate from "../models/MarketingTemplate.js";
import Institute from "../models/Institute.js";
import cloudinary from "../utils/cloudinary.js";
import { callGeminiRaw, extractJsonFromText } from "../services/aiService.js";

// Starter presets seeded if no templates exist
const DEFAULT_SEED_TEMPLATES = [
  {
    title: "Diwali Mahotsav Greetings",
    category: "festival",
    aspectRatio: "1:1",
    imageUrl: "https://images.unsplash.com/photo-1605647540924-852290f6b0d5?auto=format&fit=crop&w=1200&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1605647540924-852290f6b0d5?auto=format&fit=crop&w=400&q=80",
    priority: 10,
    isActive: true,
    brandingConfig: {
      preset: "bottom_strip",
      backgroundColor: "#180828",
      textColor: "#FFFFFF",
      accentColor: "#F59E0B",
      showLogo: true,
      showInstituteName: true,
      showPhone: true,
      showAddress: true,
    },
    defaultShareCaption: "Wishing all our students, parents and teachers a luminous & prosperous Diwali! May this festival bring wisdom, growth & success. — {instituteName} (Contact: {phone})",
  },
  {
    title: "New Batch Admissions Open 2026-27",
    category: "admission",
    aspectRatio: "1:1",
    imageUrl: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=1200&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=400&q=80",
    priority: 9,
    isActive: true,
    brandingConfig: {
      preset: "bottom_strip",
      backgroundColor: "#0F172A",
      textColor: "#FFFFFF",
      accentColor: "#38BDF8",
      showLogo: true,
      showInstituteName: true,
      showPhone: true,
      showAddress: true,
    },
    defaultShareCaption: "Admissions Open for Academic Session 2026-27! Comprehensive coaching, regular mock tests & expert faculty. Enroll today at {instituteName}! Call: {phone}",
  },
  {
    title: "Independence & Republic Day Glory",
    category: "festival",
    aspectRatio: "1:1",
    imageUrl: "https://images.unsplash.com/photo-1532375810709-75b1da00537c?auto=format&fit=crop&w=1200&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1532375810709-75b1da00537c?auto=format&fit=crop&w=400&q=80",
    priority: 8,
    isActive: true,
    brandingConfig: {
      preset: "bottom_strip",
      backgroundColor: "#064E3B",
      textColor: "#FFFFFF",
      accentColor: "#F97316",
      showLogo: true,
      showInstituteName: true,
      showPhone: true,
      showAddress: true,
    },
    defaultShareCaption: "Saluting the spirit of freedom, unity, and excellence in education. Happy Independence Day from {instituteName}! Jai Hind! 🇮🇳",
  },
  {
    title: "Daily Motivation: Consistency Beats Genius",
    category: "quote",
    aspectRatio: "1:1",
    imageUrl: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1200&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=400&q=80",
    priority: 7,
    isActive: true,
    brandingConfig: {
      preset: "bottom_strip",
      backgroundColor: "#1E293B",
      textColor: "#FFFFFF",
      accentColor: "#10B981",
      showLogo: true,
      showInstituteName: true,
      showPhone: true,
      showAddress: false,
    },
    defaultShareCaption: "\"Success doesn't come from what you do occasionally, it comes from what you do consistently.\" Daily inspiration from {instituteName}!",
  },
  {
    title: "Congratulations Toppers & High Achievers",
    category: "achievement",
    aspectRatio: "1:1",
    imageUrl: "https://images.unsplash.com/photo-1577495508048-b635879837f1?auto=format&fit=crop&w=1200&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1577495508048-b635879837f1?auto=format&fit=crop&w=400&q=80",
    priority: 6,
    isActive: true,
    brandingConfig: {
      preset: "bottom_strip",
      backgroundColor: "#312E81",
      textColor: "#FFFFFF",
      accentColor: "#FBBF24",
      showLogo: true,
      showInstituteName: true,
      showPhone: true,
      showAddress: true,
    },
    defaultShareCaption: "Congratulations to our proud stars! Hard work, mentorship and dedication always prevail. Join the achievers league at {instituteName} — {phone}!",
  },
  {
    title: "Summer Crash Course & Test Series",
    category: "announcement",
    aspectRatio: "1:1",
    imageUrl: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=1200&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=400&q=80",
    priority: 5,
    isActive: true,
    brandingConfig: {
      preset: "bottom_strip",
      backgroundColor: "#1E1B4B",
      textColor: "#FFFFFF",
      accentColor: "#EC4899",
      showLogo: true,
      showInstituteName: true,
      showPhone: true,
      showAddress: true,
    },
    defaultShareCaption: "Boost your ranks with our fast-track Revision & Mock Test Series. Limited seats available! Reserve yours now at {instituteName} ({phone}).",
  },
];

const ensureSeedTemplates = async () => {
  try {
    const all = await MarketingTemplate.find();
    if (!all || all.length === 0) {
      const seeded = DEFAULT_SEED_TEMPLATES.map((t) => ({ ...t, isActive: true }));
      await MarketingTemplate.insertMany(seeded);
      console.log("[Marketing] Seeded initial default marketing templates.");
    } else {
      // Ensure all templates have isActive explicitly true if not set to false
      for (const t of all) {
        if (t.isActive === undefined || t.isActive === null) {
          await MarketingTemplate.findByIdAndUpdate(t._id || t.id, { isActive: true });
        }
      }
    }
  } catch (err) {
    console.warn("[Marketing] Seed templates skipped or failed:", err.message);
  }
};

// ============================================================================
// EDUCATOR FACING APIS
// ============================================================================

export const getMarketingTemplates = async (req, res) => {
  try {
    await ensureSeedTemplates();

    const { category, aspectRatio, search } = req.query;
    const now = new Date();

    const rawTemplates = await MarketingTemplate.find();
    let templates = (rawTemplates || []).map((t) => (t && typeof t.toObject === "function" ? t.toObject() : t));

    // Sort by priority desc, createdAt desc
    templates.sort((a, b) => (b.priority || 0) - (a.priority || 0) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    // Filter active (treat undefined/null as true by default so all templates are visible)
    templates = templates.filter((t) => t.isActive !== false && t.isActive !== "false");

    if (category && category !== "all") {
      templates = templates.filter((t) => (t.category || "").toLowerCase() === category.toLowerCase());
    }
    if (aspectRatio && aspectRatio !== "all") {
      templates = templates.filter((t) => t.aspectRatio === aspectRatio);
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      templates = templates.filter((t) => (t.title || "").toLowerCase().includes(q));
    }

    // Date range filter: include if startDate <= now and (endDate >= now or endDate is null)
    templates = templates.filter((t) => {
      if (t.startDate && new Date(t.startDate) > now) return false;
      if (t.endDate && new Date(t.endDate) < now) return false;
      return true;
    });

    // Fetch Institute info for caption interpolation and dynamic branding preview
    let instituteInfo = {
      name: "Your Coaching Name",
      phone: "+91 98765 43210",
      address: "Main Market, City Center",
      logo: "",
      tagline: "Excellence in Learning",
    };

    if (req.user) {
      const instId = req.user.institute || (req.user.role === "admin" ? req.user.id : null);
      if (instId) {
        try {
          const inst = await Institute.findById(instId).lean();
          if (inst) {
            instituteInfo = {
              name: inst.name || inst.instituteName || instituteInfo.name,
              phone: inst.phone || inst.contactNumber || inst.ownerPhone || instituteInfo.phone,
              address: inst.address || inst.city || instituteInfo.address,
              logo: inst.logoUrl || inst.logo || "",
              tagline: inst.tagline || instituteInfo.tagline,
              primaryColor: inst.themeColor || inst.primaryColor || "#4F46E5",
            };
          }
        } catch (_) {}
      }
    }

    // Interpolate default caption with actual institute data
    const enrichedTemplates = templates.map((t) => {
      let caption = t.defaultShareCaption || "";
      caption = caption
        .replace(/\{instituteName\}/gi, instituteInfo.name)
        .replace(/\{phone\}/gi, instituteInfo.phone)
        .replace(/\{address\}/gi, instituteInfo.address);

      return {
        ...t,
        renderedShareCaption: caption,
      };
    });

    return res.json({
      success: true,
      templates: enrichedTemplates,
      institute: instituteInfo,
      categories: [
        { id: "all", label: "All Materials", icon: "fi-rr-apps" },
        { id: "poster", label: "Posters", icon: "fi-rr-picture" },
        { id: "pamphlet", label: "Pamphlets", icon: "fi-rr-document" },
        { id: "admission_form", label: "Admission Forms", icon: "fi-rr-form" },
        { id: "quote", label: "Daily Quotes", icon: "fi-rr-comment-quote" },
        { id: "festival", label: "Festivals & Wishes", icon: "fi-rr-party-horn" },
        { id: "admission", label: "Admissions Open", icon: "fi-rr-graduation-cap" },
        { id: "achievement", label: "Toppers & Results", icon: "fi-rr-trophy" },
        { id: "holiday", label: "Holiday Notices", icon: "fi-rr-calendar" },
        { id: "announcement", label: "Special Offers", icon: "fi-rr-megaphone" },
      ],
    });
  } catch (error) {
    console.error("getMarketingTemplates error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const trackTemplateAction = async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // "share" | "download" | "view"

    if (!["share", "download", "view"].includes(action)) {
      return res.status(400).json({ message: "Invalid action. Must be share, download, or view." });
    }

    // Gracefully handle fallback or custom string IDs without throwing CastError
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.json({ success: true, message: `Action ${action} tracked for ${id}.` });
    }

    const field = action === "share" ? "stats.shares" : action === "download" ? "stats.downloads" : "stats.views";
    await MarketingTemplate.findByIdAndUpdate(id, { $inc: { [field]: 1 } });

    return res.json({ success: true, message: `Action ${action} tracked.` });
  } catch (error) {
    console.error("trackTemplateAction error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// SUPER ADMIN APIS
// ============================================================================

export const getAllTemplatesAdmin = async (req, res) => {
  try {
    await ensureSeedTemplates();

    const { category, search, page = 1, limit = 50 } = req.query;
    const rawTemplates = await MarketingTemplate.find();
    let templates = (rawTemplates || []).map((t) => (t && typeof t.toObject === "function" ? t.toObject() : t));

    // Sort by priority desc, createdAt desc
    templates.sort((a, b) => (b.priority || 0) - (a.priority || 0) || new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

    if (category && category !== "all") {
      templates = templates.filter((t) => (t.category || "").toLowerCase() === category.toLowerCase());
    }
    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      templates = templates.filter((t) => (t.title || "").toLowerCase().includes(q));
    }

    const total = templates.length;
    const p = Math.max(1, parseInt(page, 10));
    const lim = Math.max(1, parseInt(limit, 10));
    const skip = (p - 1) * lim;
    const pagedTemplates = templates.slice(skip, skip + lim);

    return res.json({
      success: true,
      templates: pagedTemplates,
      total,
      page: p,
      totalPages: Math.ceil(total / lim) || 1,
    });
  } catch (error) {
    console.error("getAllTemplatesAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createTemplateAdmin = async (req, res) => {
  try {
    let {
      title,
      category = "festival",
      aspectRatio = "1:1",
      imageUrl,
      storyImageUrl,
      thumbnailUrl,
      brandingConfig,
      brandingPositions,
      isActive = true,
      priority = 0,
      startDate,
      endDate,
      defaultShareCaption,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Poster title is required." });
    }

    // Handle primary square/main image file upload
    const imageFile = req.file || req.files?.image?.[0] || req.files?.templateFile?.[0];
    if (imageFile && imageFile.buffer) {
      try {
        const b64 = `data:${imageFile.mimetype || "image/jpeg"};base64,${imageFile.buffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          resource_type: "image",
          folder: "marketing_posters",
        });
        imageUrl = uploadRes.secure_url || uploadRes.url || imageUrl;
        thumbnailUrl = uploadRes.secure_url || uploadRes.url || thumbnailUrl;
      } catch (uploadErr) {
        console.warn("[Cloudinary] Poster upload warning:", uploadErr.message);
      }
    }

    // Handle optional 9:16 story image file upload
    const storyFile = req.files?.storyImage?.[0];
    if (storyFile && storyFile.buffer) {
      try {
        const b64 = `data:${storyFile.mimetype || "image/jpeg"};base64,${storyFile.buffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          resource_type: "image",
          folder: "marketing_posters",
        });
        storyImageUrl = uploadRes.secure_url || uploadRes.url || storyImageUrl;
      } catch (storyErr) {
        console.warn("[Cloudinary] Story poster upload warning:", storyErr.message);
      }
    }

    if (!imageUrl || !imageUrl.trim()) {
      return res.status(400).json({ message: "Poster image URL or uploaded file is required." });
    }

    if (typeof brandingConfig === "string") {
      try {
        brandingConfig = JSON.parse(brandingConfig);
      } catch (_) {
        brandingConfig = {};
      }
    }

    if (typeof brandingPositions === "string") {
      try {
        brandingPositions = JSON.parse(brandingPositions);
      } catch (_) {
        brandingPositions = null;
      }
    }

    let canvasData = req.body.canvasData;
    if (typeof canvasData === "string") {
      try {
        canvasData = JSON.parse(canvasData);
      } catch (_) {}
    }

    const template = await MarketingTemplate.create({
      title: title.trim(),
      category,
      aspectRatio,
      imageUrl: imageUrl.trim(),
      storyImageUrl: storyImageUrl ? storyImageUrl.trim() : "",
      thumbnailUrl: thumbnailUrl ? thumbnailUrl.trim() : imageUrl.trim(),
      brandingConfig: brandingConfig || {},
      ...(brandingPositions ? { brandingPositions } : {}),
      canvasData: canvasData || null,
      isActive: isActive === true || isActive === "true",
      priority: parseInt(priority, 10) || 0,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
      defaultShareCaption: defaultShareCaption || "Warm wishes from {instituteName}! Contact us at {phone}.",
      createdBy: req.user?.email || "super_admin",
    });

    return res.status(201).json({
      success: true,
      message: "Marketing poster template created successfully.",
      template,
    });
  } catch (error) {
    console.error("createTemplateAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateTemplateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    let {
      title,
      category,
      aspectRatio,
      imageUrl,
      storyImageUrl,
      thumbnailUrl,
      brandingConfig,
      isActive,
      priority,
      startDate,
      endDate,
      defaultShareCaption,
    } = req.body;

    const template = await MarketingTemplate.findById(id);
    if (!template) {
      return res.status(404).json({ message: "Marketing template not found." });
    }

    const imageFile = req.file || req.files?.image?.[0] || req.files?.templateFile?.[0];
    if (imageFile && imageFile.buffer) {
      try {
        const b64 = `data:${imageFile.mimetype || "image/jpeg"};base64,${imageFile.buffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          resource_type: "image",
          folder: "marketing_posters",
        });
        imageUrl = uploadRes.secure_url || uploadRes.url || imageUrl;
      } catch (uploadErr) {
        console.warn("[Cloudinary] Poster update upload warning:", uploadErr.message);
      }
    }

    const storyFile = req.files?.storyImage?.[0];
    if (storyFile && storyFile.buffer) {
      try {
        const b64 = `data:${storyFile.mimetype || "image/jpeg"};base64,${storyFile.buffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          resource_type: "image",
          folder: "marketing_posters",
        });
        storyImageUrl = uploadRes.secure_url || uploadRes.url || storyImageUrl;
      } catch (storyErr) {
        console.warn("[Cloudinary] Story poster update upload warning:", storyErr.message);
      }
    }

    if (title !== undefined) template.title = title.trim();
    if (category !== undefined) template.category = category;
    if (aspectRatio !== undefined) template.aspectRatio = aspectRatio;
    if (imageUrl !== undefined) {
      template.imageUrl = imageUrl.trim();
      if (!thumbnailUrl) template.thumbnailUrl = imageUrl.trim();
    }
    if (storyImageUrl !== undefined) template.storyImageUrl = storyImageUrl.trim();
    if (thumbnailUrl !== undefined) template.thumbnailUrl = thumbnailUrl.trim();

    if (brandingConfig !== undefined) {
      if (typeof brandingConfig === "string") {
        try {
          brandingConfig = JSON.parse(brandingConfig);
        } catch (_) {}
      }
      template.brandingConfig = { ...template.brandingConfig, ...brandingConfig };
    }

    if (req.body.brandingPositions !== undefined) {
      let bPositions = req.body.brandingPositions;
      if (typeof bPositions === "string") {
        try {
          bPositions = JSON.parse(bPositions);
        } catch (_) {}
      }
      template.brandingPositions = bPositions;
    }

    if (req.body.canvasData !== undefined) {
      let cData = req.body.canvasData;
      if (typeof cData === "string") {
        try {
          cData = JSON.parse(cData);
        } catch (_) {}
      }
      template.canvasData = cData;
    }

    if (isActive !== undefined) template.isActive = isActive === true || isActive === "true";
    if (priority !== undefined) template.priority = parseInt(priority, 10) || 0;
    if (startDate !== undefined) template.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) template.endDate = endDate ? new Date(endDate) : null;
    if (defaultShareCaption !== undefined) template.defaultShareCaption = defaultShareCaption;

    await template.save();

    return res.json({
      success: true,
      message: "Marketing poster template updated successfully.",
      template,
    });
  } catch (error) {
    console.error("updateTemplateAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteTemplateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const template = await MarketingTemplate.findByIdAndDelete(id);
    if (!template) {
      return res.status(404).json({ message: "Marketing template not found." });
    }

    return res.json({
      success: true,
      message: "Marketing template deleted successfully.",
    });
  } catch (error) {
    console.error("deleteTemplateAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getMarketingStatsAdmin = async (req, res) => {
  try {
    await ensureSeedTemplates();

    const [totalTemplates, activeTemplates, allTemplates] = await Promise.all([
      MarketingTemplate.countDocuments(),
      MarketingTemplate.countDocuments({ isActive: true }),
      MarketingTemplate.find().select("stats category priority title").lean(),
    ]);

    let totalShares = 0;
    let totalDownloads = 0;
    let totalViews = 0;
    const categoryBreakdown = {};

    for (const t of allTemplates) {
      totalShares += t.stats?.shares || 0;
      totalDownloads += t.stats?.downloads || 0;
      totalViews += t.stats?.views || 0;
      const cat = t.category || "other";
      categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
    }

    const topShared = [...allTemplates]
      .sort((a, b) => ((b.stats?.shares || 0) + (b.stats?.downloads || 0)) - ((a.stats?.shares || 0) + (a.stats?.downloads || 0)))
      .slice(0, 5);

    return res.json({
      success: true,
      stats: {
        totalTemplates,
        activeTemplates,
        totalShares,
        totalDownloads,
        totalViews,
        categoryBreakdown,
        topShared,
      },
    });
  } catch (error) {
    console.error("getMarketingStatsAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * AI Auto-Detect & Clean Branding Zones
 * Analyzes uploaded image with Gemini Vision to detect existing Logo, Institute Name, Phone, and Address,
 * inpaints/removes the old elements using Sharp, and returns cleaned image URL with dynamic field coordinates.
 */
export const aiDetectAndCleanBrandingAdmin = async (req, res) => {
  try {
    let imageBuffer = null;
    let mimeType = "image/jpeg";
    let originalUrl = "";

    // 1. Get image from file or body
    const imageFile = req.file || req.files?.image?.[0];
    if (imageFile && imageFile.buffer) {
      imageBuffer = imageFile.buffer;
      mimeType = imageFile.mimetype || "image/jpeg";
    } else if (req.body.imageBase64) {
      const match = req.body.imageBase64.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        imageBuffer = Buffer.from(match[2], "base64");
      } else {
        imageBuffer = Buffer.from(req.body.imageBase64, "base64");
      }
    } else if (req.body.imageUrl) {
      originalUrl = req.body.imageUrl;
      const resp = await axios.get(originalUrl, { responseType: "arraybuffer", timeout: 15000 });
      imageBuffer = Buffer.from(resp.data);
      mimeType = resp.headers["content-type"] || "image/jpeg";
    }

    if (!imageBuffer) {
      return res.status(400).json({ success: false, message: "No image provided for AI analysis." });
    }

    // 2. Upload original to Cloudinary if not already a Cloudinary/remote URL
    if (!originalUrl) {
      try {
        const origB64 = `data:${mimeType};base64,${imageBuffer.toString("base64")}`;
        const up = await cloudinary.uploader.upload(origB64, {
          resource_type: "image",
          folder: "marketing_posters_ai_original",
        });
        originalUrl = up.secure_url || up.url;
      } catch (e) {
        console.warn("[Cloudinary] original upload failed, continuing:", e.message);
      }
    }

    // 3. Call Gemini Vision to detect existing branding elements & coordinates
    const prompt = `You are an expert graphic designer and computer vision AI specialized in marketing flyers, posters, and educational banners.
Analyze this marketing poster / pamphlet.
Your task is to detect any existing branding or contact details on this poster that should be removed and replaced with dynamic fields for coaching institutes:
1. "logo": Existing emblem, crest, institute logo or mascot graphic.
2. "instituteName": Existing institute/academy title, tuition name, or brand headline.
3. "phone": Existing phone number, mobile number, "Call: ...", WhatsApp number, etc.
4. "address": Existing physical address, branch location, city, website, or social handles at the bottom.

For each detected element:
- State if it is found (true/false)
- What text is written there
- The bounding box in exact percentage (0 to 100) of the total image dimensions:
  - x: left edge percentage (0-100)
  - y: top edge percentage (0-100)
  - width: width percentage (0-100)
  - height: height percentage (0-100)
- The dominant background color directly behind or surrounding this text (Hex code, e.g. "#1E1B4B" or "#FFFFFF")
- The text color (Hex code) and estimated font size in pt/px.

Respond ONLY with a valid JSON object matching this exact structure:
{
  "detected": {
    "logo": { "found": boolean, "text": string, "x": number, "y": number, "width": number, "height": number, "fillColor": string },
    "instituteName": { "found": boolean, "text": string, "x": number, "y": number, "width": number, "height": number, "fontSize": number, "color": string, "fillColor": string },
    "phone": { "found": boolean, "text": string, "x": number, "y": number, "width": number, "height": number, "fontSize": number, "color": string, "fillColor": string },
    "address": { "found": boolean, "text": string, "x": number, "y": number, "width": number, "height": number, "fontSize": number, "color": string, "fillColor": string }
  },
  "suggestedBrandingPositions": {
    "square": {
      "logo": { "x": number, "y": number, "width": number, "height": number, "isVisible": boolean },
      "instituteName": { "x": number, "y": number, "fontSize": number, "color": string, "isVisible": boolean },
      "phone": { "x": number, "y": number, "fontSize": number, "color": string, "isVisible": boolean },
      "address": { "x": number, "y": number, "fontSize": number, "color": string, "isVisible": boolean }
    },
    "story": {
      "logo": { "x": number, "y": number, "width": number, "height": number, "isVisible": boolean },
      "instituteName": { "x": number, "y": number, "fontSize": number, "color": string, "isVisible": boolean },
      "phone": { "x": number, "y": number, "fontSize": number, "color": string, "isVisible": boolean },
      "address": { "x": number, "y": number, "fontSize": number, "color": string, "isVisible": boolean }
    }
  },
  "inpaintBoxes": [
    { "label": string, "x": number, "y": number, "width": number, "height": number, "fillColor": string }
  ]
}`;

    let aiResult = null;
    try {
      const geminiResp = await callGeminiRaw({
        prompt,
        imageBase64: imageBuffer.toString("base64"),
        imageMimeType: mimeType,
        temperature: 0.1,
      });

      aiResult = extractJsonFromText(geminiResp);
    } catch (aiErr) {
      console.warn("[AI Vision] Gemini detect failed:", aiErr.message);
    }

    // Default fallback positions if AI unavailable or no branding found
    const fallbackPositions = {
      square: {
        logo: { x: 6, y: 6, width: 18, height: 18, isVisible: true },
        instituteName: { x: 26, y: 8, fontSize: 18, color: "#FFFFFF", isVisible: true },
        phone: { x: 6, y: 88, fontSize: 14, color: "#F59E0B", isVisible: true },
        address: { x: 6, y: 93, fontSize: 12, color: "#E2E8F0", isVisible: true },
      },
      story: {
        logo: { x: 6, y: 5, width: 18, height: 12, isVisible: true },
        instituteName: { x: 26, y: 6, fontSize: 20, color: "#FFFFFF", isVisible: true },
        phone: { x: 6, y: 90, fontSize: 15, color: "#F59E0B", isVisible: true },
        address: { x: 6, y: 94, fontSize: 12, color: "#E2E8F0", isVisible: true },
      },
    };

    const finalPositions = aiResult?.suggestedBrandingPositions || fallbackPositions;
    const detected = aiResult?.detected || {};
    const inpaintBoxes = aiResult?.inpaintBoxes || [];

    // Also populate inpaintBoxes from detected if empty
    if (inpaintBoxes.length === 0) {
      for (const [key, val] of Object.entries(detected)) {
        if (val && val.found) {
          inpaintBoxes.push({
            label: key,
            x: val.x,
            y: val.y,
            width: val.width,
            height: val.height,
            fillColor: val.fillColor || "#0F172A",
          });
        }
      }
    }

    // 4. Inpaint / Clean the image using sharp
    let cleanedBuffer = imageBuffer;
    let cleanedImageUrl = originalUrl;

    if (inpaintBoxes.length > 0) {
      try {
        const metadata = await sharp(imageBuffer).metadata();
        const imgW = metadata.width || 1080;
        const imgH = metadata.height || 1080;

        // Composite inpaint patches over each detected box
        const compositeOverlays = inpaintBoxes.map((box) => {
          const left = Math.max(0, Math.round(((box.x - 0.5) / 100) * imgW));
          const top = Math.max(0, Math.round(((box.y - 0.5) / 100) * imgH));
          const w = Math.max(4, Math.min(imgW - left, Math.round(((box.width + 1.2) / 100) * imgW)));
          const h = Math.max(4, Math.min(imgH - top, Math.round(((box.height + 1.2) / 100) * imgH)));
          const fill = box.fillColor && box.fillColor.startsWith("#") ? box.fillColor : "#0F172A";

          // Generate an SVG patch with subtle corner radius
          const svgRect = Buffer.from(
            `<svg width="${w}" height="${h}">
              <rect width="${w}" height="${h}" rx="6" ry="6" fill="${fill}" />
            </svg>`
          );

          return {
            input: svgRect,
            top,
            left,
          };
        });

        cleanedBuffer = await sharp(imageBuffer).composite(compositeOverlays).toBuffer();

        // Upload cleaned buffer to Cloudinary
        const cleanedB64 = `data:${mimeType};base64,${cleanedBuffer.toString("base64")}`;
        const upClean = await cloudinary.uploader.upload(cleanedB64, {
          resource_type: "image",
          folder: "marketing_posters_ai_cleaned",
        });
        cleanedImageUrl = upClean.secure_url || upClean.url || originalUrl;
      } catch (inpaintErr) {
        console.warn("[Sharp inpaint error]:", inpaintErr.message);
      }
    }

    return res.json({
      success: true,
      cleanedImageUrl,
      originalImageUrl: originalUrl || cleanedImageUrl,
      detected,
      inpaintBoxes,
      brandingPositions: finalPositions,
      message: `AI detected and cleaned ${inpaintBoxes.length} branding zones (logo, phone, institute name, address).`,
    });
  } catch (error) {
    console.error("aiDetectAndCleanBrandingAdmin error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
