import path from "path";
import fs from "fs";
import axios from "axios";
import cloudinary from "../utils/cloudinary.js";
import {
  callGeminiRaw,
  extractJsonFromText,
  getAiGlobalSettings,
} from "./aiService.js";
import { validateCanonicalTemplate } from "../utils/templateEngine.js";
import AiUsageLog from "../models/AiUsageLog.js";

/**
 * Aspect ratio dimension mapping (canonical 1080p system)
 */
export const RATIO_DIMENSIONS = {
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
};

/**
 * 20 Professional Poster Visual Styles (from poster-generator skill)
 */
export const POSTER_STYLES = {
  "swiss-editorial": {
    name: "Swiss Editorial",
    vibe: "Clean typographic grid, asymmetric structure, high contrast sans-serif, bold color blocking",
    promptModifier: "clean Swiss design editorial grid, asymmetric balance, bold high-contrast color blocking, clean architectural aesthetic, ultra-clean commercial poster art",
    preferredFonts: ["Inter", "Helvetica", "Arial"],
    accentColor: "#DC2626",
    cardBg: "rgba(255, 255, 255, 0.95)",
    textColor: "#0F172A",
  },
  "luxury-minimal": {
    name: "Luxury Minimal",
    vibe: "Muted dark tones, gold & champagne warm lighting, generous whitespace, refined elegance",
    promptModifier: "luxury high-end aesthetic, deep rich velvet dark background, champagne gold warm ambient lighting, delicate floating golden dust particles, cinematic premium atmosphere",
    preferredFonts: ["Cinzel", "Playfair Display", "serif"],
    accentColor: "#F59E0B",
    cardBg: "rgba(15, 23, 42, 0.85)",
    textColor: "#FFFFFF",
  },
  "cinematic-key-art": {
    name: "Cinematic Key Art",
    vibe: "Dramatic ambient lighting, deep atmospheric shadows, cinematic depth, volumetric light beams",
    promptModifier: "cinematic lighting, dramatic ambient depth, volumetric light beams, epic commercial key visual scale, rich color grading, high aesthetic impact",
    preferredFonts: ["Inter", "Montserrat", "sans-serif"],
    accentColor: "#38BDF8",
    cardBg: "rgba(11, 19, 43, 0.82)",
    textColor: "#FFFFFF",
  },
  "art-deco-luxe": {
    name: "Art Deco Luxe",
    vibe: "Symmetrical geometry, fine golden accents, opulent celebration, rich dark emerald or burgundy backdrop",
    promptModifier: "luxurious Art Deco celebration, glowing golden motifs and warm candlelight, ornate gold lines, deep royal burgundy and dark emerald ambient gradient, radiant festive illumination",
    preferredFonts: ["Playfair Display", "serif"],
    accentColor: "#F59E0B",
    cardBg: "rgba(24, 24, 27, 0.85)",
    textColor: "#FEF3C7",
  },
  "futurist-gradient": {
    name: "Futurist Gradient",
    vibe: "Luminescent neon glows, cyan/violet/magenta gradients, sleek dark glassmorphism, high-tech modern energy",
    promptModifier: "futuristic sleek gradient atmosphere, glowing mesh light waves, deep indigo and electric cyan tones, 4k digital aesthetic, high-tech modernity",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#06B6D4",
    cardBg: "rgba(15, 23, 42, 0.78)",
    textColor: "#FFFFFF",
  },
  "pop-commercial": {
    name: "Pop Commercial",
    vibe: "Bright punchy pop colors, playful sticker-like badges, rounded soft cards, cheerful energetic commercial appeal",
    promptModifier: "vibrant dynamic commercial artwork, high energy cheerful gradient, bright playful geometric elements, sunny joyful vibe, bold commercial appeal",
    preferredFonts: ["Inter", "Poppins", "sans-serif"],
    accentColor: "#EA580C",
    cardBg: "rgba(255, 255, 255, 0.96)",
    textColor: "#0F172A",
  },
  "neo-brutalist": {
    name: "Neo Brutalist",
    vibe: "Raw shapes, heavy solid black borders, vibrant solid color blocks, unapologetic modern contrast",
    promptModifier: "neo-brutalist bold high-contrast poster artwork, solid geometric framing, crisp bold edges, vibrant modern pop, graphic design poster",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#FACC15",
    cardBg: "#FFFFFF",
    textColor: "#000000",
  },
  "bauhaus-modular": {
    name: "Bauhaus Modular",
    vibe: "Primary geometric shapes: circle, square, triangle; functional grid, primary red/blue/yellow + black/white",
    promptModifier: "bauhaus modern artistic poster visual, bold primary geometric elements, clean cream paper texture, architectural balance, modernist graphic design",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#2563EB",
    cardBg: "rgba(255, 255, 255, 0.94)",
    textColor: "#111827",
  },
  "glassmorphism-ui": {
    name: "Glassmorphism UI",
    vibe: "Translucent frosted glass cards, soft blurred refraction, luminous ambient backdrops, modern digital sheen",
    promptModifier: "soft colorful ambient sphere gradient background, fluid organic color transitions, dreamy modern glow, frosted glass aesthetic",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#6366F1",
    cardBg: "rgba(255, 255, 255, 0.85)",
    textColor: "#0F172A",
  },
  "organic-craft": {
    name: "Organic Craft",
    vibe: "Earthy warm tones, terracotta, sage green, handcrafted motifs, natural warmth and authenticity",
    promptModifier: "warm earthy textured poster aesthetic, terracotta and sage organic gradients, gentle craft atmosphere, natural paper texture, handcrafted elegance",
    preferredFonts: ["serif"],
    accentColor: "#C2410C",
    cardBg: "rgba(254, 252, 246, 0.92)",
    textColor: "#292524",
  },
  "constructivist-impact": {
    name: "Constructivist Impact",
    vibe: "Dynamic diagonal energy, heavy crimson red and black geometric composition, monumental visual impact",
    promptModifier: "constructivist dynamic diagonal energy, heavy crimson red and black geometric composition, monumental visual impact, bold graphic poster",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#DC2626",
    cardBg: "rgba(255, 255, 255, 0.92)",
    textColor: "#000000",
  },
  "data-editorial": {
    name: "Data Editorial",
    vibe: "Precision data editorial grid, subtle fine technological lines, dark navy background with laser-sharp cyan highlights",
    promptModifier: "precision data editorial grid, subtle fine technological lines, dark navy background with laser-sharp cyan highlights, intellectual clean aesthetic",
    preferredFonts: ["Inter", "monospace"],
    accentColor: "#38BDF8",
    cardBg: "rgba(15, 23, 42, 0.88)",
    textColor: "#FFFFFF",
  },
  "editorial-collage": {
    name: "Editorial Collage",
    vibe: "Editorial mixed-media magazine aesthetic, layered textured paper framing, soft neutral gradients",
    promptModifier: "editorial mixed-media magazine aesthetic, layered textured paper framing, soft neutral gradients, artistic high fashion look",
    preferredFonts: ["Playfair Display", "serif"],
    accentColor: "#D97706",
    cardBg: "rgba(255, 255, 255, 0.95)",
    textColor: "#1E293B",
  },
  "japanese-ma": {
    name: "Japanese Ma",
    vibe: "Negative space mastery, quiet balanced composition, zen minimalism, refined harmony",
    promptModifier: "japanese zen negative space, subtle warm stone texture, peaceful minimalist composition, generous breathing space, soft natural light",
    preferredFonts: ["sans-serif"],
    accentColor: "#B91C1C",
    cardBg: "rgba(250, 250, 249, 0.95)",
    textColor: "#1C1917",
  },
  "monochrome-typographic": {
    name: "Monochrome Typographic",
    vibe: "Striking high contrast black and charcoal monochrome background, architectural studio spotlight, silver nuances",
    promptModifier: "striking high contrast black and charcoal monochrome background, architectural studio spotlight, silver and white nuances, bold graphic art",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#FFFFFF",
    cardBg: "rgba(24, 24, 27, 0.9)",
    textColor: "#FFFFFF",
  },
  "risograph-zine": {
    name: "Risograph Zine",
    vibe: "Vibrant risograph dual-tone ink print texture, warm halftone dots, teal and fluorescent coral ink blend",
    promptModifier: "vibrant risograph dual-tone ink print texture, warm halftone dots, teal and fluorescent coral ink blend, indie creative print feel",
    preferredFonts: ["sans-serif"],
    accentColor: "#F43F5E",
    cardBg: "rgba(255, 255, 255, 0.92)",
    textColor: "#1E1B4B",
  },
  "surreal-3d-editorial": {
    name: "Surreal 3D Editorial",
    vibe: "Surreal 3D abstract floating sculptural geometric spheres, soft directional studio lighting, jewel tones",
    promptModifier: "surreal 3D abstract floating sculptural geometric spheres, soft directional studio lighting, pastel and deep jewel tones, creative dreamscape",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#8B5CF6",
    cardBg: "rgba(15, 23, 42, 0.8)",
    textColor: "#FFFFFF",
  },
  "retro-futurism": {
    name: "Retro Futurism",
    vibe: "Retro futurism 80s synthwave perspective grid, glowing sunset horizon, deep purple and chrome cyan lighting",
    promptModifier: "retro futurism 80s synthwave perspective grid, glowing sunset horizon, deep purple and chrome cyan lighting, nostalgic electronic warmth",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#EC4899",
    cardBg: "rgba(15, 23, 42, 0.85)",
    textColor: "#FFFFFF",
  },
  "botanical-premium": {
    name: "Botanical Premium",
    vibe: "Lush deep forest green botanical backdrop, elegant golden leaf filigree, natural organic luxury",
    promptModifier: "lush deep forest green botanical backdrop, elegant golden leaf filigree, natural organic luxury, soft warm lighting",
    preferredFonts: ["Playfair Display", "serif"],
    accentColor: "#F59E0B",
    cardBg: "rgba(20, 30, 25, 0.88)",
    textColor: "#F0FDF4",
  },
  "hyperreal-product": {
    name: "Hyperreal Product",
    vibe: "Crisp studio stage podium, immaculate directional lighting, subtle reflection, pristine clean commercial atmosphere",
    promptModifier: "crisp studio stage podium, immaculate directional lighting, subtle reflection, pristine clean commercial atmosphere, ultra-high resolution",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#2563EB",
    cardBg: "rgba(255, 255, 255, 0.95)",
    textColor: "#0F172A",
  },
};

/**
 * Intelligent Master Poster Visual Prompt Builder (adhering to poster-generator skill)
 * Crafts a complete graphic poster key visual prompt for Google Gemini in ONE unified step.
 */
export function buildMasterPosterVisualPrompt({
  prompt = "",
  category = "admissions",
  visualStyle = "auto",
  themeColor = "#1E3A8A",
  aspectRatio = "1:1",
}) {
  const p = prompt.toLowerCase();

  // 1. Resolve Style & Theme Color
  let resolvedStyle = visualStyle;
  let dominantColor = themeColor;
  let titleText = "Admissions Open";
  let promptBody = "";

  if (p.includes("christmas") || p.includes("xmas") || p.includes("holiday")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "luxury-minimal";
    dominantColor = "#1A0F2E";
    titleText = "Merry Christmas";
    promptBody = `A stunning commercial graphic poster key visual for Christmas holiday celebration. Top features lush hanging green pine tree garland branches decorated with shiny golden jingle bells, red satin ribbons, and hanging festive Christmas stockings filled with gingerbread man and candy canes. Center has elegant glowing artistic calligraphy lettering Merry Christmas against a deep violet and royal navy starry night sky with sparkling golden star dust. Bottom features a delightful stylized 3D Santa Claus in a flying red rocket sleigh with gifts and a cute penguin companion zooming over purple clouds with a flying elf. Top header area and bottom footer area have clean designated open space for institute branding. High-end commercial poster artwork, 4k resolution, ultra crisp.`;
  } else if (p.includes("diwali") || p.includes("deepawali")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "art-deco-luxe";
    dominantColor = "#4A041E";
    titleText = "Happy Diwali";
    promptBody = `A magnificent festive commercial graphic poster key visual for Diwali celebration. Top features strings of warm glowing fairy lights, traditional marigold flower toran garland, and ornate hanging golden lanterns. Center features radiant artistic festive calligraphy lettering Happy Diwali with glowing golden diya flames, sparkling light rays, and celebratory warmth. Bottom features glowing traditional clay diyas with golden flames, intricate colorful floral rangoli on marble, and ambient fireworks sparkles. Deep royal burgundy and navy gradient backdrop. Top header and bottom footer areas have clean designated open space for branding. High commercial graphic poster, 4k.`;
  } else if (p.includes("new year")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "luxury-minimal";
    dominantColor = "#0B132B";
    titleText = "Happy New Year 2026";
    promptBody = `A spectacular commercial graphic poster key visual for New Year celebration. Top features shimmering golden celebration streamers, sparkling champagne bubbles, and festive golden confetti. Center features gleaming 3D metallic golden typography Happy New Year 2026 with radiant lens flares and celebratory sparkles. Bottom features magnificent midnight fireworks illumination over an inspiring skyline and celebratory 3D elements. Deep obsidian and midnight blue background with golden bokeh. Top and bottom areas have clean space for branding. 4k resolution.`;
  } else if (p.includes("holi")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "pop-commercial";
    dominantColor = "#7C2D12";
    titleText = "Happy Holi";
    promptBody = `A joyful and energetic commercial graphic poster key visual for Holi festival. Dynamic explosion of vibrant organic powder colors in mid-air in vivid magenta, sunny yellow, cyan, and royal purple. Center features playful artistic festive lettering Happy Holi surrounded by water splash droplets and color bursts. Bottom features traditional brass bowls filled with vibrant gulal powder and festive energy. Clean open space at top and bottom for branding. High commercial photography and digital art, 4k.`;
  } else if (p.includes("eid")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "luxury-minimal";
    dominantColor = "#064E3B";
    titleText = "Eid Mubarak";
    promptBody = `An elegant and serene commercial graphic poster key visual for Eid Mubarak celebration. Top features delicate glowing ornate Islamic arabesque patterns and hanging golden crescent lanterns. Center features radiant calligraphy lettering Eid Mubarak with gentle warm starlight. Bottom features an illuminated golden crescent moon, serene mosque silhouette with glowing domes and minarets in a deep emerald night sky. Clean space at top and bottom for branding. 4k luxury aesthetic.`;
  } else if (p.includes("jee") || p.includes("neet") || p.includes("iit") || p.includes("dropper") || p.includes("repeater")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "futurist-gradient";
    dominantColor = "#0F172A";
    titleText = "Target JEE & NEET 2026-27";
    promptBody = `A powerful commercial graphic poster key visual for coaching institute admissions. Top features modern high-tech geometric framing with subtle glowing cyan accents. Center features prominent bold 3D typography TARGET JEE & NEET ADMISSIONS OPEN with radiant rim lighting and futuristic glow. Bottom features an inspiring 3D student standing victoriously with books, glowing atomic orbits, DNA double helix, and laboratory telescope motifs. Deep indigo and royal blue background. Clean header and footer space for branding. High-end commercial art, 4k.`;
  } else if (p.includes("scholarship") || p.includes("stse") || p.includes("talent") || p.includes("award") || p.includes("olympiad")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "cinematic-key-art";
    dominantColor = "#1E3A8A";
    titleText = "National Scholarship Exam";
    promptBody = `A triumphant commercial graphic poster key visual for Scholarship and Talent Exam. Top features golden victory laurel branches, celebration ribbons, and bright spotlight rays. Center features gleaming 3D golden typography SCHOLARSHIP EXAM WIN UP TO 100% SCHOLARSHIP with sparkling light rays. Bottom features a gleaming golden victory trophy cup, achievement medals, and celebratory confetti particles on a winner podium. Deep sapphire blue and gold background. Clean space for branding at top and bottom. 4k commercial grade.`;
  } else if (p.includes("crash course") || p.includes("board") || p.includes("class 10") || p.includes("class 12")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "swiss-editorial";
    dominantColor = "#0F172A";
    titleText = "Board Exam Booster";
    promptBody = `An impactful commercial graphic poster key visual for Academic Board Exam Crash Course. Top features clean modern architectural header framing. Center features bold high-contrast typography BOARD EXAM CRASH COURSE SCORE 95%+ with energetic highlight accents. Bottom features a vibrant 3D educational composition with stack of premium books, target bullseye with dart, stopwatch, and graduation cap. Deep modern slate and royal blue aesthetic. Clean branding space at top and bottom. 4k.`;
  } else if (p.includes("result") || p.includes("topper") || p.includes("rank") || p.includes("congratulation")) {
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "luxury-minimal";
    dominantColor = "#2E1065";
    titleText = "Congratulations Toppers";
    promptBody = `A grand celebratory commercial poster key visual honoring Top Rankers and Results. Top features a shower of golden confetti and champion banners. Center features glowing celebratory typography CONGRATULATIONS TO OUR TOPPERS with radiant golden sparkles. Bottom features a golden champion podium with giant shiny stars, victory laurel wreaths, and triumphant 3D student character holding a certificate. Deep imperial purple and gold atmosphere. Clean space for branding at top and bottom. 4k.`;
  } else {
    // General creative prompt
    resolvedStyle = visualStyle !== "auto" ? visualStyle : "cinematic-key-art";
    dominantColor = themeColor || "#1E3A8A";
    titleText = prompt.substring(0, 40);
    const styleObj = POSTER_STYLES[resolvedStyle] || POSTER_STYLES["cinematic-key-art"];
    promptBody = `High-end commercial graphic poster key visual for: ${prompt}. Category: ${category}. Top features elegant decorative framing and ambient lighting. Center features bold, stylish artistic typography lettering expressing the main theme with celebratory depth and sparkling highlights. Bottom features rich 3D thematic illustrations and commercial graphic art representing the subject. Style: ${styleObj.name}, ${styleObj.promptModifier}. Reserved clean designated open space at top header and bottom footer for dynamic institute branding overlays. 4k ultra-high resolution, commercial advertising grade.`;
  }

  const finalStyle = POSTER_STYLES[resolvedStyle] || POSTER_STYLES["cinematic-key-art"];

  return {
    masterPrompt: promptBody,
    styleKey: resolvedStyle,
    styleConfig: finalStyle,
    dominantColor,
    titleText,
  };
}

/**
 * Backward compatibility resolver for thematic visual subject
 */
export function resolveThematicVisualSubject(prompt = "", category = "admissions") {
  const resolved = buildMasterPosterVisualPrompt({ prompt, category });
  return {
    style: resolved.styleKey,
    themeColor: resolved.dominantColor,
    imagePrompt: resolved.masterPrompt,
  };
}

/**
 * Helper to log AI usage for Super Admin marketing generation
 */
async function recordMarketingAiUsage({ taskType, prompt, metadata = {}, user = null }) {
  try {
    await AiUsageLog.create({
      institute: "super_admin",
      taskType: `marketing_studio_${taskType}`,
      creditsDeducted: 0,
      cost: 0,
      userId: user?._id || user?.id || "super_admin",
      userName: user?.name || "Super Admin",
      userRole: "super_admin",
      actionType: "MARKETING_AI",
      remarks: `Marketing Studio AI: ${taskType}`,
      metadata: {
        feature: "marketing_studio",
        prompt: (prompt || "").substring(0, 300),
        ...metadata,
      },
    });
  } catch (err) {
    console.warn("[marketingAiService] Failed to record usage log:", err.message);
  }
}

/**
 * 1. Single-Step Master Poster Generation via Google Generative AI (Imagen/Gemini 2.5 Flash Image)
 * Adheres strictly to the Poster Generator Skill:
 * - Direct one-step generation of complete commercial poster artwork
 * - Uploads to Cloudinary
 * - Stamps clean dynamic branding overlays ({institute.logo}, {institute.name}, {institute.phone}, {institute.address})
 * - Eliminates cluttered wireframe boxes, card grids, and dashboard shapes
 */
export async function generateMarketingTemplateWithAi({
  prompt,
  category = "admissions",
  aspectRatio = "1:1",
  targetAudience = "students and parents",
  themeColor = "#1E3A8A",
  includeImage = true,
  visualStyle = "auto",
  user = null,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("A description or prompt is required for AI template generation.");
  }

  const dims = RATIO_DIMENSIONS[aspectRatio] || RATIO_DIMENSIONS["1:1"];
  const canvasWidth = dims.width;
  const canvasHeight = dims.height;

  // Build the master poster prompt and resolve style
  const { masterPrompt, styleKey, styleConfig, dominantColor } = buildMasterPosterVisualPrompt({
    prompt,
    category,
    visualStyle,
    themeColor,
    aspectRatio,
  });

  const pLower = prompt.toLowerCase();
  const isHolidayOrCelebration =
    pLower.includes("christmas") ||
    pLower.includes("diwali") ||
    pLower.includes("new year") ||
    pLower.includes("holi") ||
    pLower.includes("eid") ||
    pLower.includes("wishes") ||
    pLower.includes("greeting") ||
    pLower.includes("congratulation");

  let uploadedPosterUrl = "";

  // 1. Single-Step Poster Image Generation (When includeImage is enabled)
  if (includeImage) {
    try {
      const imgResult = await generateMarketingBackgroundImage({
        prompt: masterPrompt,
        aspectRatio,
        style: styleKey,
        themeColor: dominantColor,
        isMasterPoster: true,
        user,
      });

      if (imgResult?.url) {
        uploadedPosterUrl = imgResult.url;
      }
    } catch (imgErr) {
      console.warn("[marketingAiService] Poster image generation warning:", imgErr.message);
    }
  }

  // 2. If a complete poster artwork was generated, construct the Canonical V2.0 template directly in ONE STEP
  if (uploadedPosterUrl) {
    // Dynamic coordinate calculations for the chosen aspect ratio
    const logoSize = 100;
    const logoX = Math.round((canvasWidth - logoSize) / 2);
    const logoY = aspectRatio === "9:16" ? 80 : 35;

    const nameWidth = Math.min(canvasWidth - 80, 960);
    const nameHeight = 45;
    const nameX = Math.round((canvasWidth - nameWidth) / 2);
    const nameY = logoY + logoSize + 15;

    const phoneWidth = Math.min(canvasWidth - 80, 960);
    const phoneHeight = 40;
    const phoneX = Math.round((canvasWidth - phoneWidth) / 2);
    const phoneY = canvasHeight - (aspectRatio === "9:16" ? 140 : 100);

    const addrWidth = Math.min(canvasWidth - 80, 960);
    const addrHeight = 35;
    const addrX = Math.round((canvasWidth - addrWidth) / 2);
    const addrY = canvasHeight - (aspectRatio === "9:16" ? 85 : 55);

    const singleStepTemplate = {
      name: `${isHolidayOrCelebration ? "Celebration" : "Marketing"} Poster: ${prompt.substring(0, 32)}`,
      category,
      aspectRatio,
      canvas: {
        width: canvasWidth,
        height: canvasHeight,
        backgroundColor: dominantColor || "#0F172A",
        backgroundImageUrl: uploadedPosterUrl,
      },
      elements: [
        {
          id: "elem_institute_logo",
          type: "logo",
          name: "Institute Logo",
          x: logoX,
          y: logoY,
          width: logoSize,
          height: logoSize,
          rotation: 0,
          opacity: 1,
          zIndex: 10,
          isLocked: false,
          isEditable: true,
          isVisible: true,
          placeholder: "{institute.logo}",
          content: "",
          styling: {
            borderRadius: 50,
            objectFit: "contain",
            backgroundColor: "rgba(255, 255, 255, 0.15)",
            borderColor: "rgba(255, 255, 255, 0.3)",
            borderWidth: 1,
            boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          },
        },
        {
          id: "elem_institute_name",
          type: "text",
          name: "Institute Name",
          x: nameX,
          y: nameY,
          width: nameWidth,
          height: nameHeight,
          rotation: 0,
          opacity: 1,
          zIndex: 11,
          isLocked: false,
          isEditable: true,
          isVisible: true,
          placeholder: "{institute.name}",
          content: isHolidayOrCelebration ? "{institute.name} WISHES YOU" : "{institute.name}",
          styling: {
            fontFamily: "Inter",
            fontSize: 24,
            fontWeight: "800",
            color: "#FFFFFF",
            textAlign: "center",
            letterSpacing: 2,
            textTransform: "uppercase",
            lineHeight: 1.2,
          },
        },
        {
          id: "elem_institute_phone",
          type: "text",
          name: "Contact Phone",
          x: phoneX,
          y: phoneY,
          width: phoneWidth,
          height: phoneHeight,
          rotation: 0,
          opacity: 1,
          zIndex: 12,
          isLocked: false,
          isEditable: true,
          isVisible: true,
          placeholder: "{institute.phone}",
          content: "Call / WhatsApp: {institute.phone}",
          styling: {
            fontFamily: "Inter",
            fontSize: 22,
            fontWeight: "700",
            color: "#FFFFFF",
            textAlign: "center",
            lineHeight: 1.2,
          },
        },
        {
          id: "elem_institute_address",
          type: "text",
          name: "Address & Website",
          x: addrX,
          y: addrY,
          width: addrWidth,
          height: addrHeight,
          rotation: 0,
          opacity: 1,
          zIndex: 13,
          isLocked: false,
          isEditable: true,
          isVisible: true,
          placeholder: "{institute.address}",
          content: "{institute.address} | {institute.website}",
          styling: {
            fontFamily: "Inter",
            fontSize: 16,
            fontWeight: "500",
            color: "rgba(255, 255, 255, 0.85)",
            textAlign: "center",
            lineHeight: 1.2,
          },
        },
      ],
    };

    const validated = validateCanonicalTemplate(singleStepTemplate);

    await recordMarketingAiUsage({
      taskType: "single_step_master_poster",
      prompt,
      metadata: {
        category,
        aspectRatio,
        visualStyle: styleKey,
        hasBackgroundImage: true,
        elementCount: validated.elements.length,
      },
      user,
    });

    return validated;
  }

  // 3. Fallback: If includeImage was false or image model was unavailable,
  // synthesize a clean, spacious typography layout adhering to the Poster Generator Skill (NO wireframe grids or 12 cards).
  const systemInstruction = `You are a Master Graphic Poster Designer adhering to the "Poster Generator" design system (Swiss Editorial & Minimalist).
Design a clean, spacious, high-contrast poster layout for a coaching institute.

CANVAS SPECIFICATIONS:
- Width: ${canvasWidth}px | Height: ${canvasHeight}px
- Aspect Ratio: "${aspectRatio}"
- Category: "${category}"
- Visual Style: "${styleConfig.name}"
- Dominant Accent: "${dominantColor}"

CRITICAL DESIGN RULES:
1. SPATIOUS & ELEGANT:
   - DO NOT create 10-15 cluttered cards, wireframe boxes, or 4-column card grids.
   - Keep it clean, bold, and focused like an authentic print poster.
   - Maximum 4 to 6 elements total: Top Brand Header, 1 Large Bold Headline, 1 Subheadline, 1 Key Callout, and Bottom Contact Bar.
2. DYNAMIC PLACEHOLDERS:
   - Top Logo: { "id": "elem_institute_logo", "type": "logo", "name": "Institute Logo", "x": ${Math.round((canvasWidth - 100) / 2)}, "y": 40, "width": 100, "height": 100, "placeholder": "{institute.logo}", "styling": { "borderRadius": 50 } }
   - Top Institute Name: { "id": "elem_institute_name", "type": "text", "name": "Institute Name", "x": 60, "y": 150, "width": ${canvasWidth - 120}, "height": 45, "placeholder": "{institute.name}", "content": "{institute.name}", "styling": { "fontSize": 26, "fontWeight": "800", "color": "#FFFFFF", "textAlign": "center" } }
   - Bottom Phone: { "id": "elem_institute_phone", "type": "text", "name": "Contact Phone", "x": 60, "y": ${canvasHeight - 110}, "width": ${canvasWidth - 120}, "height": 45, "placeholder": "{institute.phone}", "content": "Call: {institute.phone}", "styling": { "fontSize": 24, "fontWeight": "700", "color": "#FFFFFF", "textAlign": "center" } }
   - Bottom Address: { "id": "elem_institute_address", "type": "text", "name": "Campus Address", "x": 60, "y": ${canvasHeight - 60}, "width": ${canvasWidth - 120}, "height": 35, "placeholder": "{institute.address}", "content": "{institute.address}", "styling": { "fontSize": 18, "fontWeight": "500", "color": "#CBD5E1", "textAlign": "center" } }

OUTPUT FORMAT:
Return strictly a single valid JSON object adhering to Canonical V2.0:
{
  "name": "Creative Poster Title",
  "category": "${category}",
  "aspectRatio": "${aspectRatio}",
  "canvas": {
    "width": ${canvasWidth},
    "height": ${canvasHeight},
    "backgroundColor": "${dominantColor || '#0B1329'}",
    "backgroundImageUrl": ""
  },
  "elements": [ ... ]
}
No markdown, no commentary. Pure JSON only.`;

  const userPrompt = `Create a clean, elegant poster creative based on this instruction:
"${prompt}"
Category: ${category}
Aspect Ratio: ${aspectRatio} (${canvasWidth}x${canvasHeight} px)
Accent Color: ${dominantColor}
Style: ${styleConfig.name}`;

  const raw = await callGeminiRaw({
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.25,
  });

  const parsed = extractJsonFromText(raw);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error("AI returned an unparseable template format. Please try again with a more detailed prompt.");
  }

  if (!parsed.canvas) parsed.canvas = {};
  parsed.canvas.width = canvasWidth;
  parsed.canvas.height = canvasHeight;
  parsed.aspectRatio = aspectRatio;

  const validated = validateCanonicalTemplate(parsed);

  await recordMarketingAiUsage({
    taskType: "generate_vector_template",
    prompt,
    metadata: {
      category,
      aspectRatio,
      visualStyle: styleKey,
      elementCount: validated.elements.length,
    },
    user,
  });

  return validated;
}

/**
 * 2. Multimodal Vision: Analyze Uploaded Reference Flyer/Poster and Convert to Editable Template
 */
export async function analyzeReferenceFlyer({
  imageBase64,
  imageMimeType = "image/jpeg",
  notes = "",
  category = "admissions",
  targetAspectRatio = "1:1",
  user = null,
}) {
  if (!imageBase64) {
    throw new Error("Image data (base64) is required for flyer analysis.");
  }

  const dims = RATIO_DIMENSIONS[targetAspectRatio] || RATIO_DIMENSIONS["1:1"];
  const canvasWidth = dims.width;
  const canvasHeight = dims.height;

  const systemInstruction = `You are a Master Creative Director and Computer Vision Layout Engineer.
Analyze the attached reference marketing flyer/poster image carefully.

YOUR MISSION:
1. Deconstruct the uploaded flyer's layout into an editable Canonical V2.0 vector layout for coaching institutes.
2. Extract all distinct visual layers:
   - Background color or theme palette.
   - Headers, Main Headlines, Subheadlines, Offer badges, Course lists, and Bullet points.
   - Contact numbers, Call to Action buttons, and Address bars.
   - Decorative shapes, colored cards, dividing lines, or badges.
3. MAP IDENTITY ELEMENTS TO DYNAMIC CANONICAL PLACEHOLDERS:
   - Identify any institute logo -> create an element with "placeholder": "{institute.logo}", "type": "logo"
   - Identify institute/coaching name -> "placeholder": "{institute.name}", "content": "{institute.name}"
   - Identify phone/contact number -> "placeholder": "{institute.phone}", "content": "Call: {institute.phone}"
   - Identify address/location -> "placeholder": "{institute.address}", "content": "{institute.address}"
   - Identify website/tagline if present -> "{institute.website}" or "{institute.tagline}"
4. SCALE COORDINATES:
   - Normalize and scale all detected positions and dimensions to the target canvas: ${canvasWidth}px width by ${canvasHeight}px height.
   - Keep elements cleanly aligned with proper padding and readable font sizes.

RETURN STRICTLY A SINGLE VALID JSON OBJECT with:
{
  "name": "Deconstructed Flyer Title",
  "category": "${category}",
  "aspectRatio": "${targetAspectRatio}",
  "canvas": {
    "width": ${canvasWidth},
    "height": ${canvasHeight},
    "backgroundColor": "#FFFFFF",
    "backgroundImageUrl": ""
  },
  "elements": [ ... ]
}

No markdown tags, no commentary. Pure JSON only.`;

  const prompt = `Deconstruct this attached flyer into an editable Canonical V2.0 template.
Target canvas: ${canvasWidth}x${canvasHeight} (${targetAspectRatio}).
Additional customization notes from user: ${notes || "Preserve original colors and visual structure as closely as possible."}`;

  const raw = await callGeminiRaw({
    prompt,
    systemInstruction,
    imageBase64,
    imageMimeType,
    temperature: 0.2,
  });

  const parsed = extractJsonFromText(raw);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error("Failed to deconstruct flyer image into canonical layers. Please ensure the image is clear and readable.");
  }

  parsed.canvas = parsed.canvas || {};
  parsed.canvas.width = canvasWidth;
  parsed.canvas.height = canvasHeight;
  parsed.aspectRatio = targetAspectRatio;

  const validated = validateCanonicalTemplate(parsed);

  await recordMarketingAiUsage({
    taskType: "flyer_deconstruct",
    prompt: notes,
    metadata: { targetAspectRatio, elementCount: validated.elements.length },
    user,
  });

  return validated;
}

/**
 * 3. Generate AI Background / Master Poster Artwork via Google Generative AI + Cloudinary
 */
export async function generateMarketingBackgroundImage({
  prompt,
  aspectRatio = "1:1",
  style = "vector",
  themeColor = "#1E3A8A",
  isMasterPoster = false,
  user = null,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("Prompt is required for image generation.");
  }

  const globalSettings = await getAiGlobalSettings();
  const apiKey = (globalSettings.geminiApiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("Gemini API key is not configured.");
    err.status = 502;
    err.code = "AI_KEY_NOT_CONFIGURED";
    throw err;
  }

  // Refine prompt: if isMasterPoster is true, use prompt directly (already mastercrafted); else refine as background
  const finalPrompt = isMasterPoster
    ? prompt
    : `Minimalist educational marketing background artwork for coaching institute poster. ${prompt}. Style: ${style}, high resolution, professional commercial design, dominant colors: ${themeColor || '#1E3A8A'}, clean abstract geometric composition, modern aesthetic, 4k.`;

  const candidateModels = [
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-image",
    "gemini-3-pro-image",
    "gemini-2.5-flash",
  ];

  let imageBase64 = null;
  let mimeType = "image/png";
  let lastError = null;

  for (const model of candidateModels) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    try {
      const response = await axios.post(
        url,
        {
          contents: [
            {
              parts: [{ text: finalPrompt }],
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
          },
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 45000,
        }
      );

      const parts = response.data?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts) && parts.length > 0) {
        for (const part of parts) {
          if (part.inlineData?.data) {
            imageBase64 = part.inlineData.data;
            mimeType = part.inlineData.mimeType || "image/png";
            break;
          }
        }
      }

      if (imageBase64) break;
    } catch (err) {
      lastError = err;
      const status = err.response?.status;
      const msg = err.response?.data?.error?.message || err.message;
      if (status === 400 || status === 401 || status === 403) {
        throw new Error(`Google AI Authentication failed: ${msg}`);
      }
      continue;
    }
  }

  if (!imageBase64) {
    const errMsg = lastError?.response?.data?.error?.message || lastError?.message || "Image generation did not produce image bytes.";
    throw new Error(`AI Image Generation failed: ${errMsg}`);
  }

  // Upload to Cloudinary
  let publicUrl = "";
  try {
    const dataUri = `data:${mimeType};base64,${imageBase64}`;
    const uploadRes = await cloudinary.uploader.upload(dataUri, {
      resource_type: "image",
      folder: "marketing_studio_assets",
      format: "png",
    });
    publicUrl = uploadRes.secure_url || uploadRes.url;
  } catch (cErr) {
    console.warn("[marketingAiService] Cloudinary upload failed, using local storage fallback:", cErr.message);
    const filename = `ai_poster_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;
    const localDir = path.join(process.cwd(), "uploads", "marketing_assets");
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, filename);
    fs.writeFileSync(localPath, Buffer.from(imageBase64, "base64"));
    publicUrl = `/uploads/marketing_assets/${filename}`;
  }

  await recordMarketingAiUsage({
    taskType: isMasterPoster ? "generate_master_poster_image" : "generate_background_image",
    prompt,
    metadata: { aspectRatio, style, publicUrl },
    user,
  });

  return {
    url: publicUrl,
    prompt,
    aspectRatio,
  };
}

/**
 * 4. Interactive Template Refinement (In-Editor AI Design Assistant)
 */
export async function refineMarketingTemplate({
  currentTemplate,
  userInstruction,
  user = null,
}) {
  if (!currentTemplate || !userInstruction || !userInstruction.trim()) {
    throw new Error("Current template and user instruction are required for design refinement.");
  }

  const systemInstruction = `You are an expert AI Marketing Design Assistant for coaching institute creatives.
You are given an existing Canonical V2.0 template JSON and a user modification instruction.

YOUR TASK:
- Carefully modify the template to fulfill the user's instruction.
- Examples of modifications you should handle:
  * "Make the headline bolder and gold color" -> update styling.fontWeight and styling.color of the main headline.
  * "Change background to dark navy blue" -> update canvas.backgroundColor: "#0B1329" and adjust text colors for contrast.
  * "Translate text to Hindi/Hinglish" -> translate headline, highlights, and CTA into catchy Hinglish.
  * "Add a 20% Early Bird Scholarship badge" -> add a new shape badge element and a text element at a harmonious position.
  * "Move the CTA button to the bottom right" -> adjust x and y coordinates.
- PRESERVE existing dynamic placeholders ({institute.name}, {institute.phone}, {institute.logo}, {institute.address}) unless explicitly asked to remove.
- Keep the canvas dimensions (${currentTemplate.canvas?.width || 1080}x${currentTemplate.canvas?.height || 1080}) unchanged unless ratio change is requested.

RETURN STRICTLY THE UPDATED CANONICAL V2.0 TEMPLATE JSON OBJECT ONLY. No markdown, no explanations.`;

  const prompt = `Current Template JSON:
${JSON.stringify(currentTemplate, null, 2)}

User Instruction:
"${userInstruction}"

Return the complete modified JSON template conforming to Canonical V2.0:`;

  const raw = await callGeminiRaw({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });

  const parsed = extractJsonFromText(raw);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error("Failed to refine template. The AI returned an invalid layout structure.");
  }

  const validated = validateCanonicalTemplate(parsed);

  await recordMarketingAiUsage({
    taskType: "refine_template",
    prompt: userInstruction,
    metadata: { elementCount: validated.elements.length },
    user,
  });

  return validated;
}

/**
 * 5. Multi-Ratio Variation Generator (Translate 1:1 to 9:16 Story, 16:9 Banner, or 4:5 Feed)
 */
export async function generateAspectVariations({
  template,
  targetRatio = "9:16",
  user = null,
}) {
  if (!template) {
    throw new Error("Source template is required to generate variations.");
  }

  const dims = RATIO_DIMENSIONS[targetRatio];
  if (!dims) {
    throw new Error(`Unsupported target aspect ratio: ${targetRatio}. Supported ratios: 1:1, 4:5, 9:16, 16:9.`);
  }

  const targetWidth = dims.width;
  const targetHeight = dims.height;

  const systemInstruction = `You are an expert responsive layout designer for digital advertising.
Adapt the provided Canonical V2.0 marketing template to a new aspect ratio: ${targetRatio} (${targetWidth}x${targetHeight}px).

REFLOW RULES FOR ${targetRatio}:
- Reposition elements gracefully so they do not look stretched or cramped.
- For 9:16 (Story/Vertical): You have much more vertical height (${targetHeight}px). Spread elements out vertically.
- For 16:9 (Landscape/Banner): Wide horizontal space (${targetWidth}px) and less height (${targetHeight}px). Arrange into a two-column or split layout.
- For 4:5 (Instagram Feed): Slightly taller than 1:1.
- Retain all dynamic placeholders ({institute.name}, {institute.phone}, {institute.logo}, {institute.address}) and colors.

RETURN STRICTLY THE UPDATED CANONICAL V2.0 TEMPLATE JSON FOR THE TARGET ASPECT RATIO.`;

  const prompt = `Source Template (${template.aspectRatio || "1:1"}):
${JSON.stringify(template, null, 2)}

Generate the adapted Canonical V2.0 template for aspect ratio ${targetRatio} (${targetWidth}x${targetHeight}px):`;

  const raw = await callGeminiRaw({
    prompt,
    systemInstruction,
    temperature: 0.2,
  });

  const parsed = extractJsonFromText(raw);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error(`Failed to generate ${targetRatio} variation.`);
  }

  parsed.canvas = parsed.canvas || {};
  parsed.canvas.width = targetWidth;
  parsed.canvas.height = targetHeight;
  parsed.aspectRatio = targetRatio;

  const validated = validateCanonicalTemplate(parsed);

  await recordMarketingAiUsage({
    taskType: `variation_${targetRatio}`,
    prompt: `Convert to ${targetRatio}`,
    metadata: { targetRatio, elementCount: validated.elements.length },
    user,
  });

  return validated;
}
