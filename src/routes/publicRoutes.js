import express from "express";
import multer from "multer";
import Institute from "../models/Institute.js";
import { generateTuitionHTML } from "../services/netlifyService.js";
import SystemSetting from "../models/SystemSetting.js";
import { getPublicLeadForm, submitPublicLead, uploadLeadFile, getPublicLeadFormByShortId } from "../controllers/leadController.js";
import { getPublicPages, getPublicPageBySlug } from "../controllers/pageController.js";
import { submitContactMessage, getContactDetails } from "../controllers/contactController.js";

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

// GET public website metadata or full HTML for a given tuition slug
router.get("/website/:slug", async (req, res) => {
  try {
    const rawSlug = req.params.slug;
    if (!rawSlug) {
      return res.status(400).json({ message: "Slug is required." });
    }

    const sanitizedSlug = rawSlug.toLowerCase().trim();

    // Query institute by websiteConfig.slug or name match
    const institutes = await Institute.find({});
    const institute = institutes.find(
      (inst) => inst.websiteConfig?.slug?.toLowerCase() === sanitizedSlug || inst.name.toLowerCase().replace(/[^a-z0-9-]/g, "-") === sanitizedSlug
    );

    if (!institute) {
      return res.status(404).json({ message: "Tuition website not found." });
    }

    const config = institute.websiteConfig || {};

    if (req.query.format === "html") {
      const html = generateTuitionHTML({
        instituteName: institute.name,
        ownerName: institute.ownerName,
        slug: config.slug || sanitizedSlug,
        headline: config.headline,
        subheadline: config.subheadline,
        aboutText: config.aboutText,
        bannerUrl: config.bannerUrl,
        logoUrl: institute.logoUrl,
        contactPhone: config.contactPhone || institute.adminPhone,
        adminEmail: institute.adminEmail,
        contactAddress: config.contactAddress,
        clientUrl: process.env.CLIENT_URL || "http://localhost:5173",
      });
      res.setHeader("Content-Type", "text/html");
      return res.send(html);
    }

    return res.json({
      institute: {
        _id: institute._id,
        name: institute.name,
        ownerName: institute.ownerName,
        adminEmail: institute.adminEmail,
        adminPhone: institute.adminPhone,
        logoUrl: institute.logoUrl,
        tuitionType: institute.tuitionType,
      },
      websiteConfig: config,
    });
  } catch (error) {
    console.error("Public website route error:", error);
    return res.status(500).json({ message: "Could not fetch public website." });
  }
});

// Public lead form routes
router.get("/lead-forms/short/:shortId", getPublicLeadFormByShortId);
router.get("/lead-forms/:id", getPublicLeadForm);
router.post("/lead-forms/:id/submit", submitPublicLead);
router.post("/website/upload", upload.single("file"), uploadLeadFile);

// Public custom pages routes
router.get("/pages", getPublicPages);
router.get("/pages/:slug", getPublicPageBySlug);

// Public contact submission
router.post("/contact", submitContactMessage);
router.get("/contact-details", getContactDetails);

// Public AdSense configuration
router.get("/ads-config", async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "ads_settings" });
    if (!setting) {
      return res.json({ enableAds: false, adsenseClientId: "", adsenseCodeSnippet: "" });
    }
    let val = setting.value;
    if (typeof val === "string") {
      try { val = JSON.parse(val); } catch (e) { val = {}; }
    }
    return res.json({
      enableAds: !!val.enableAds,
      adsenseClientId: val.adsenseClientId || "",
      adsenseCodeSnippet: val.adsenseCodeSnippet || "",
    });
  } catch (error) {
    console.error("Public ads-config route error:", error);
    return res.status(500).json({ message: "Could not fetch public ads config." });
  }
});

export default router;
