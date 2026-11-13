import mongoose from "mongoose";
import MarketingTemplate from "../models/MarketingTemplate.js";
import Institute from "../models/Institute.js";
import cloudinary from "../utils/cloudinary.js";

// Starter presets seeded if no templates exist
const DEFAULT_SEED_TEMPLATES = [
  {
    title: "Diwali Mahotsav Greetings",
    category: "festival",
    aspectRatio: "1:1",
    imageUrl: "https://images.unsplash.com/photo-1605647540924-852290f6b0d5?auto=format&fit=crop&w=1200&q=80",
    thumbnailUrl: "https://images.unsplash.com/photo-1605647540924-852290f6b0d5?auto=format&fit=crop&w=400&q=80",
    priority: 10,
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
    const count = await MarketingTemplate.countDocuments();
    if (count === 0) {
      await MarketingTemplate.insertMany(DEFAULT_SEED_TEMPLATES);
      console.log("[Marketing] Seeded initial default marketing templates.");
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

    const query = { isActive: true };

    if (category && category !== "all") {
      query.category = category;
    }
    if (aspectRatio && aspectRatio !== "all") {
      query.aspectRatio = aspectRatio;
    }
    if (search && search.trim()) {
      query.title = { $regex: search.trim(), $options: "i" };
    }

    // Date range filter: include if startDate <= now and (endDate >= now or endDate is null)
    query.$and = [
      {
        $or: [
          { startDate: null },
          { startDate: { $lte: now } },
        ],
      },
      {
        $or: [
          { endDate: null },
          { endDate: { $gte: now } },
        ],
      },
    ];

    const templates = await MarketingTemplate.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

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
        { id: "all", label: "All Posters", icon: "fi-rr-apps" },
        { id: "festival", label: "Festivals & Wishes", icon: "fi-rr-party-horn" },
        { id: "admission", label: "Admissions Open", icon: "fi-rr-graduation-cap" },
        { id: "achievement", label: "Toppers & Results", icon: "fi-rr-trophy" },
        { id: "quote", label: "Daily Quotes", icon: "fi-rr-comment-quote" },
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
    const query = {};

    if (category && category !== "all") {
      query.category = category;
    }
    if (search && search.trim()) {
      query.title = { $regex: search.trim(), $options: "i" };
    }

    const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
    const [templates, total] = await Promise.all([
      MarketingTemplate.find(query).sort({ priority: -1, createdAt: -1 }).skip(skip).limit(parseInt(limit, 10)).lean(),
      MarketingTemplate.countDocuments(query),
    ]);

    return res.json({
      success: true,
      templates,
      total,
      page: parseInt(page, 10),
      totalPages: Math.ceil(total / parseInt(limit, 10)) || 1,
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

    const template = await MarketingTemplate.create({
      title: title.trim(),
      category,
      aspectRatio,
      imageUrl: imageUrl.trim(),
      storyImageUrl: storyImageUrl ? storyImageUrl.trim() : "",
      thumbnailUrl: thumbnailUrl ? thumbnailUrl.trim() : imageUrl.trim(),
      brandingConfig: brandingConfig || {},
      ...(brandingPositions ? { brandingPositions } : {}),
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
