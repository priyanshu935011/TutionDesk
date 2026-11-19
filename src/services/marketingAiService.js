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
    promptModifier: "clean Swiss style typography grid, asymmetric layout, minimal crisp geometric shapes, elegant whitespace, high contrast, clean architectural vibe, no text",
    preferredFonts: ["Inter", "Helvetica", "Arial"],
    accentColor: "#DC2626",
    cardBg: "rgba(255, 255, 255, 0.95)",
    textColor: "#0F172A",
  },
  "luxury-minimal": {
    name: "Luxury Minimal",
    vibe: "Muted dark tones, gold & champagne warm lighting, generous whitespace, refined elegance",
    promptModifier: "luxury high-end minimalist composition, deep velvet dark background, subtle floating warm golden bokeh lights, delicate gold dust particles, cinematic premium atmosphere, no text",
    preferredFonts: ["Cinzel", "Playfair Display", "serif"],
    accentColor: "#F59E0B",
    cardBg: "rgba(15, 23, 42, 0.85)",
    textColor: "#FFFFFF",
  },
  "cinematic-key-art": {
    name: "Cinematic Key Art",
    vibe: "Dramatic ambient lighting, deep atmospheric shadows, cinematic depth, volumetric light beams",
    promptModifier: "cinematic dramatic lighting, deep atmospheric shadows, volumetric light beams, epic commercial scale key visual, striking ambient depth, no text",
    preferredFonts: ["Inter", "Montserrat", "sans-serif"],
    accentColor: "#38BDF8",
    cardBg: "rgba(11, 19, 43, 0.82)",
    textColor: "#FFFFFF",
  },
  "art-deco-luxe": {
    name: "Art Deco Luxe",
    vibe: "Symmetrical geometry, fine golden accents, opulent celebration, rich dark emerald or burgundy backdrop",
    promptModifier: "luxurious Art Deco festive illumination, glowing golden diyas and warm candlelight, ornamental gold lines, deep royal burgundy and dark emerald ambient gradient, radiant festive celebration, no text",
    preferredFonts: ["Playfair Display", "serif"],
    accentColor: "#F59E0B",
    cardBg: "rgba(24, 24, 27, 0.85)",
    textColor: "#FEF3C7",
  },
  "futurist-gradient": {
    name: "Futurist Gradient",
    vibe: "Luminescent neon glows, cyan/violet/magenta gradients, sleek dark glassmorphism, high-tech modern energy",
    promptModifier: "futuristic sleek gradient background, glowing mesh light waves, deep indigo and electric cyan tones, 4k digital aesthetic, high-tech modernity, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#06B6D4",
    cardBg: "rgba(15, 23, 42, 0.78)",
    textColor: "#FFFFFF",
  },
  "pop-commercial": {
    name: "Pop Commercial",
    vibe: "Bright punchy pop colors, playful sticker-like badges, rounded soft cards, cheerful energetic commercial appeal",
    promptModifier: "vibrant dynamic commercial background, bright playful geometric floats, high energy cheerful gradient, sunny joyful vibe, no text",
    preferredFonts: ["Inter", "Poppins", "sans-serif"],
    accentColor: "#EA580C",
    cardBg: "rgba(255, 255, 255, 0.96)",
    textColor: "#0F172A",
  },
  "neo-brutalist": {
    name: "Neo Brutalist",
    vibe: "Raw shapes, heavy solid black borders, vibrant solid color blocks, unapologetic modern contrast",
    promptModifier: "neo-brutalist bold high-contrast background, solid geometric angular framing, crisp bold edges, vibrant modern pop, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#FACC15",
    cardBg: "#FFFFFF",
    textColor: "#000000",
  },
  "bauhaus-modular": {
    name: "Bauhaus Modular",
    vibe: "Primary geometric shapes: circle, square, triangle; functional grid, primary red/blue/yellow + black/white",
    promptModifier: "bauhaus modern artistic background, bold primary geometric elements, clean cream paper texture, architectural balance, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#2563EB",
    cardBg: "rgba(255, 255, 255, 0.94)",
    textColor: "#111827",
  },
  "glassmorphism-ui": {
    name: "Glassmorphism UI",
    vibe: "Translucent frosted glass cards, soft blurred refraction, luminous ambient backdrops, modern digital sheen",
    promptModifier: "soft colorful ambient sphere gradient background, fluid organic color transitions, dreamy modern glow, frosted glass aesthetic, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#6366F1",
    cardBg: "rgba(255, 255, 255, 0.85)",
    textColor: "#0F172A",
  },
  "organic-craft": {
    name: "Organic Craft",
    vibe: "Earthy warm tones, terracotta, sage green, handcrafted motifs, natural warmth and authenticity",
    promptModifier: "warm earthy textured background, terracotta and sage organic gradients, gentle craft atmosphere, natural paper texture, no text",
    preferredFonts: ["serif"],
    accentColor: "#C2410C",
    cardBg: "rgba(254, 252, 246, 0.92)",
    textColor: "#292524",
  },
  "constructivist-impact": {
    name: "Constructivist Impact",
    vibe: "Dynamic diagonal energy, heavy crimson red and black geometric composition, monumental visual impact",
    promptModifier: "constructivist dynamic diagonal energy, heavy crimson red and black geometric composition, monumental visual impact, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#DC2626",
    cardBg: "rgba(255, 255, 255, 0.92)",
    textColor: "#000000",
  },
  "data-editorial": {
    name: "Data Editorial",
    vibe: "Precision data editorial grid, subtle fine technological lines, dark navy background with laser-sharp cyan highlights",
    promptModifier: "precision data editorial grid, subtle fine technological lines, dark navy background with laser-sharp cyan highlights, intellectual clean aesthetic, no text",
    preferredFonts: ["Inter", "monospace"],
    accentColor: "#38BDF8",
    cardBg: "rgba(15, 23, 42, 0.88)",
    textColor: "#FFFFFF",
  },
  "editorial-collage": {
    name: "Editorial Collage",
    vibe: "Editorial mixed-media magazine aesthetic, layered textured paper framing, soft neutral gradients",
    promptModifier: "editorial mixed-media magazine aesthetic, layered textured paper framing, soft neutral gradients, artistic high fashion look, no text",
    preferredFonts: ["Playfair Display", "serif"],
    accentColor: "#D97706",
    cardBg: "rgba(255, 255, 255, 0.95)",
    textColor: "#1E293B",
  },
  "japanese-ma": {
    name: "Japanese Ma",
    vibe: "Negative space mastery, quiet balanced composition, zen minimalism, refined harmony",
    promptModifier: "japanese zen negative space, subtle warm stone texture, peaceful minimalist composition, generous breathing space, soft natural light, no text",
    preferredFonts: ["sans-serif"],
    accentColor: "#B91C1C",
    cardBg: "rgba(250, 250, 249, 0.95)",
    textColor: "#1C1917",
  },
  "monochrome-typographic": {
    name: "Monochrome Typographic",
    vibe: "Striking high contrast black and charcoal monochrome background, architectural studio spotlight, silver nuances",
    promptModifier: "striking high contrast black and charcoal monochrome background, architectural studio spotlight, silver and white nuances, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#FFFFFF",
    cardBg: "rgba(24, 24, 27, 0.9)",
    textColor: "#FFFFFF",
  },
  "risograph-zine": {
    name: "Risograph Zine",
    vibe: "Vibrant risograph dual-tone ink print texture, warm halftone dots, teal and fluorescent coral ink blend",
    promptModifier: "vibrant risograph dual-tone ink print texture, warm halftone dots, teal and fluorescent coral ink blend, indie creative print feel, no text",
    preferredFonts: ["sans-serif"],
    accentColor: "#F43F5E",
    cardBg: "rgba(255, 255, 255, 0.92)",
    textColor: "#1E1B4B",
  },
  "surreal-3d-editorial": {
    name: "Surreal 3D Editorial",
    vibe: "Surreal 3D abstract floating sculptural geometric spheres, soft directional studio lighting, jewel tones",
    promptModifier: "surreal 3D abstract floating sculptural geometric spheres, soft directional studio lighting, pastel and deep jewel tones, creative dreamscape, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#8B5CF6",
    cardBg: "rgba(15, 23, 42, 0.8)",
    textColor: "#FFFFFF",
  },
  "retro-futurism": {
    name: "Retro Futurism",
    vibe: "Retro futurism 80s synthwave perspective grid, glowing sunset horizon, deep purple and chrome cyan lighting",
    promptModifier: "retro futurism 80s synthwave perspective grid, glowing sunset horizon, deep purple and chrome cyan lighting, nostalgic electronic warmth, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#EC4899",
    cardBg: "rgba(15, 23, 42, 0.85)",
    textColor: "#FFFFFF",
  },
  "botanical-premium": {
    name: "Botanical Premium",
    vibe: "Lush deep forest green botanical backdrop, elegant golden leaf filigree, natural organic luxury",
    promptModifier: "lush deep forest green botanical backdrop, elegant golden leaf filigree, natural organic luxury, soft warm lighting, no text",
    preferredFonts: ["Playfair Display", "serif"],
    accentColor: "#F59E0B",
    cardBg: "rgba(20, 30, 25, 0.88)",
    textColor: "#F0FDF4",
  },
  "hyperreal-product": {
    name: "Hyperreal Product",
    vibe: "Crisp studio stage podium, immaculate directional lighting, subtle reflection, pristine clean commercial atmosphere",
    promptModifier: "crisp studio stage podium, immaculate directional lighting, subtle reflection, pristine clean commercial atmosphere, ultra-high resolution, no text",
    preferredFonts: ["Inter", "sans-serif"],
    accentColor: "#2563EB",
    cardBg: "rgba(255, 255, 255, 0.95)",
    textColor: "#0F172A",
  },
};

/**
 * Intelligent Thematic Visual Subject & Style Resolver (from poster-generator skill)
 */
export function resolveThematicVisualSubject(prompt = "", category = "admissions") {
  const p = prompt.toLowerCase();
  
  if (p.includes("diwali") || p.includes("deepawali")) {
    return {
      style: "art-deco-luxe",
      themeColor: "#831843",
      imagePrompt: "Traditional glowing golden clay diyas with warm flickering flames, elegant floral rangoli motifs, warm golden festive bokeh lights, ambient celebration sparkles, rich royal burgundy and deep navy gradient backdrop, radiant celebration lighting, commercial editorial grade, 4k ultra-high resolution, no text, no words, no letters, no typography, clean center area for text",
    };
  }
  if (p.includes("holi")) {
    return {
      style: "pop-commercial",
      themeColor: "#EA580C",
      imagePrompt: "Artistic explosion of vibrant festive organic color powders in mid-air, dynamic celebratory energy, clean joyful aesthetic, high commercial photography, no text, 4k",
    };
  }
  if (p.includes("eid")) {
    return {
      style: "luxury-minimal",
      themeColor: "#065F46",
      imagePrompt: "Illuminated golden crescent moon and subtle ornate lanterns glowing gently in dark emerald sky with soft ambient stars, serene festive celebration, no text, 4k",
    };
  }
  if (p.includes("christmas") || p.includes("new year")) {
    return {
      style: "luxury-minimal",
      themeColor: "#1E3A8A",
      imagePrompt: "Elegant celebration background with subtle golden sparkles, festive ambient light bokeh, deep midnight blue, no text, 4k",
    };
  }
  if (p.includes("jee") || p.includes("neet") || p.includes("iit") || p.includes("dropper") || p.includes("repeater")) {
    return {
      style: "futurist-gradient",
      themeColor: "#1E3A8A",
      imagePrompt: "Inspiring futuristic educational background, glowing abstract geometry, subtle atom and scientific energy waves, deep indigo and electric cyan lighting, sleek modern studio depth of field, no text, 4k",
    };
  }
  if (p.includes("scholarship") || p.includes("stse") || p.includes("talent") || p.includes("topper") || p.includes("result") || p.includes("rank") || p.includes("award")) {
    return {
      style: "cinematic-key-art",
      themeColor: "#1E3A8A",
      imagePrompt: "Gleaming golden victory trophy with sparkling light reflections, triumphant celebratory particles, deep royal navy stage lighting, grand atmospheric depth, no text, 4k",
    };
  }
  if (p.includes("crash course") || p.includes("board") || p.includes("class 10") || p.includes("class 12") || p.includes("exam")) {
    return {
      style: "swiss-editorial",
      themeColor: "#0F172A",
      imagePrompt: "Modern architectural minimalist studio space, crisp angular geometry, bright clean lighting with subtle ambient shadows, premium educational feel, no text, 4k",
    };
  }

  // Default educational key visual
  return {
    style: "cinematic-key-art",
    themeColor: "#1E3A8A",
    imagePrompt: `High-end commercial poster key visual art for educational coaching institute: ${prompt}. Atmospheric lighting, striking aesthetic composition, deep elegant colors, clean space for typography, no text, 4k`,
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
 * 1. Generate a Complete Canonical V2.0 Marketing Template from Natural Language
 * Equipped with the Poster Generator Skill and optional Thematic Image Generation.
 */
export async function generateMarketingTemplateWithAi({
  prompt,
  category = "admissions",
  aspectRatio = "1:1",
  targetAudience = "students and parents",
  themeColor = "#1E3A8A",
  includeImage = false,
  visualStyle = "auto",
  user = null,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("A description or prompt is required for AI template generation.");
  }

  const dims = RATIO_DIMENSIONS[aspectRatio] || RATIO_DIMENSIONS["1:1"];
  const canvasWidth = dims.width;
  const canvasHeight = dims.height;

  // 1. Resolve Visual Style & Thematic Image requirements via Poster Generator Skill
  const thematic = resolveThematicVisualSubject(prompt, category);
  const resolvedStyleKey = visualStyle && visualStyle !== "auto" && POSTER_STYLES[visualStyle]
    ? visualStyle
    : thematic.style;
  const styleConfig = POSTER_STYLES[resolvedStyleKey] || POSTER_STYLES["cinematic-key-art"];
  const activeThemeColor = themeColor || thematic.themeColor || styleConfig.accentColor;

  let generatedBgImageUrl = "";

  // 2. Generate AI Thematic Background Image if requested
  if (includeImage) {
    try {
      const refinedImagePrompt = `${thematic.imagePrompt}. Aesthetic Style: ${styleConfig.name}, ${styleConfig.promptModifier}. Dominant tones: ${activeThemeColor}. Ensure ample clear space for poster typography and badges. Absolutely NO text, words, or letters. High commercial production quality, 4k.`;
      
      const imgResult = await generateMarketingBackgroundImage({
        prompt: refinedImagePrompt,
        aspectRatio,
        style: resolvedStyleKey,
        themeColor: activeThemeColor,
        user,
      });

      if (imgResult?.url) {
        generatedBgImageUrl = imgResult.url;
      }
    } catch (imgErr) {
      console.warn("[marketingAiService] Warning: Image generation fallback triggered:", imgErr.message);
    }
  }

  // 3. Construct System Prompt with Poster Generator Skill rules
  const systemInstruction = `You are an elite Creative Director and Master Poster Graphic Designer adhering to the "Poster Generator" design system.
You specialize in high-converting promotional creatives for coaching institutes, tuition academies, and test-prep centers.

CANVAS SPECIFICATIONS:
- Width: ${canvasWidth}px | Height: ${canvasHeight}px
- Aspect Ratio: "${aspectRatio}"
- Category: "${category}"
- Target Audience: "${targetAudience}"
- Visual Style: "${styleConfig.name}" (${styleConfig.vibe})
- Primary Accent: "${activeThemeColor}"
${generatedBgImageUrl ? `- THEMATIC BACKGROUND VISUAL: "${generatedBgImageUrl}" has been generated and set as the canvas background!` : "- BACKGROUND: Clean solid or vector gradient canvas."}

POSTER GENERATOR DESIGN RULES:
1. CANONICAL COORDINATE GRID:
   - Coordinates (x, y) must strictly be within 0 to ${canvasWidth} (x) and 0 to ${canvasHeight} (y).
   - Safe margins: Leave at least 40px padding from every edge.
   - Hierarchy: Top brand identity bar -> Hero headline -> Key offer / feature cards -> Bottom CTA & contact anchor.
2. BACKGROUND & CONTRAST HARMONY:
   ${generatedBgImageUrl ? `- CRITICAL: Because a vivid background visual is active ("${generatedBgImageUrl}"), you MUST wrap text groups and feature bullet points inside semi-transparent backing container cards (type: "shape", backgroundColor: "${styleConfig.cardBg || 'rgba(15, 23, 42, 0.78)'}", borderRadius: 16) or high-contrast pills so every letter is 100% crisp, legible, and unhindered by the image!
   - Use high-contrast font colors: "${styleConfig.textColor || '#FFFFFF'}" for body copy, and radiant accents like "${styleConfig.accentColor || '#F59E0B'}" for headlines and badges.` : `- Use clean high-contrast color scheme (${styleConfig.textColor || '#0F172A'} on light or #FFFFFF on dark).`}
3. DYNAMIC PLACEHOLDER SYSTEM (MANDATORY FOR INSTITUTE BRANDING):
   - Every template MUST feature dynamic placeholders:
     a) Institute Logo:
        { "id": "elem_institute_logo", "type": "logo", "name": "Institute Logo", "x": 60, "y": 50, "width": 120, "height": 120, "placeholder": "{institute.logo}", "styling": { "borderRadius": 60, "objectFit": "contain" } }
     b) Institute Name:
        { "id": "elem_institute_name", "type": "text", "name": "Institute Name", "x": 200, "y": 75, "width": ${canvasWidth - 280}, "height": 60, "placeholder": "{institute.name}", "content": "{institute.name}", "styling": { "fontSize": 34, "fontWeight": "800", "color": "${styleConfig.textColor || '#FFFFFF'}", "textAlign": "left" } }
     c) Bottom Call to Action Button:
        Shape: { "id": "elem_cta_box", "type": "shape", "name": "CTA Container", "x": 80, "y": ${canvasHeight - 160}, "width": ${canvasWidth - 160}, "height": 80, "styling": { "backgroundColor": "${activeThemeColor || '#2563EB'}", "borderRadius": 40 } }
     d) Institute Contact Phone:
        { "id": "elem_institute_phone", "type": "text", "name": "Contact Phone", "x": 100, "y": ${canvasHeight - 145}, "width": ${canvasWidth - 200}, "height": 50, "placeholder": "{institute.phone}", "content": "Call: {institute.phone}", "styling": { "fontSize": 28, "fontWeight": "700", "color": "#FFFFFF", "textAlign": "center" } }
     e) Institute Address:
        { "id": "elem_institute_address", "type": "text", "name": "Campus Address", "x": 80, "y": ${canvasHeight - 65}, "width": ${canvasWidth - 160}, "height": 40, "placeholder": "{institute.address}", "content": "{institute.address}", "styling": { "fontSize": 20, "fontWeight": "500", "color": "${generatedBgImageUrl ? '#CBD5E1' : '#64748B'}", "textAlign": "center" } }
4. CONTENT SYNTHESIS:
   - Primary Headline: Bold, impactful (fontSize: 48-64px, uppercase, high contrast).
   - Subheadline / Offer Hook: (e.g. for Diwali: "Celebrate the Festival of Lights with a 25% Scholarship Waiver on All Foundation Batches!").
   - Feature Highlights: 2 to 4 structured badges with rounded shape containers (e.g., "Experienced Kota Faculty", "Small Batch Sizes", "Daily Doubt Counters", "Comprehensive Test Series").

OUTPUT FORMAT:
Strictly return a single valid JSON object adhering to Canonical V2.0:
{
  "name": "Catchy Creative Title",
  "category": "${category}",
  "aspectRatio": "${aspectRatio}",
  "canvas": {
    "width": ${canvasWidth},
    "height": ${canvasHeight},
    "backgroundColor": "${generatedBgImageUrl ? '#0B1329' : '#FFFFFF'}",
    "backgroundImageUrl": "${generatedBgImageUrl}"
  },
  "elements": [
    ...
  ]
}

No markdown tags, no markdown codeblocks, no explanations. Pure JSON only.`;

  const userPrompt = `Create a complete, stunning, professional poster creative based on this instruction:
"${prompt}"

Category: ${category}
Aspect Ratio: ${aspectRatio} (${canvasWidth}x${canvasHeight} px)
Visual Style: ${styleConfig.name}
Thematic Image Attached: ${generatedBgImageUrl ? "YES (Active in background)" : "NO"}
Remember to include institute identity placeholders ({institute.logo}, {institute.name}, {institute.phone}, {institute.address}) and compelling educational selling points!`;

  const raw = await callGeminiRaw({
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.25,
  });

  const parsed = extractJsonFromText(raw);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error("AI returned an unparseable template format. Please try again with a more detailed prompt.");
  }

  // Ensure canvas dimensions & background image URL match
  if (!parsed.canvas) parsed.canvas = {};
  parsed.canvas.width = canvasWidth;
  parsed.canvas.height = canvasHeight;
  parsed.aspectRatio = aspectRatio;
  if (generatedBgImageUrl) {
    parsed.canvas.backgroundImageUrl = generatedBgImageUrl;
  }

  // Validate and normalize using canonical template engine
  const validated = validateCanonicalTemplate(parsed);

  await recordMarketingAiUsage({
    taskType: includeImage ? "generate_template_with_image" : "generate_template",
    prompt,
    metadata: {
      category,
      aspectRatio,
      visualStyle: resolvedStyleKey,
      includeImage,
      hasBackgroundImage: Boolean(generatedBgImageUrl),
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
 * 3. Generate AI Background Artwork / Graphic Asset via Google Generative AI + Cloudinary
 */
export async function generateMarketingBackgroundImage({
  prompt,
  aspectRatio = "1:1",
  style = "vector",
  themeColor = "#1E3A8A",
  user = null,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("Prompt is required for background generation.");
  }

  const globalSettings = await getAiGlobalSettings();
  const apiKey = (globalSettings.geminiApiKey || process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("Gemini API key is not configured.");
    err.status = 502;
    err.code = "AI_KEY_NOT_CONFIGURED";
    throw err;
  }

  // Refine user prompt for premium coaching background art
  const refinedPrompt = `Minimalist premium educational marketing background artwork for coaching institute poster. ${prompt}. Style: ${style}, high resolution, professional commercial design, dominant colors: ${themeColor || '#1E3A8A'}, clean abstract geometric composition, modern aesthetic, NO readable typography, NO text, pristine quality, 4k.`;

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
              parts: [{ text: refinedPrompt }],
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
    const filename = `ai_bg_${Date.now()}_${Math.random().toString(36).substring(2, 8)}.png`;
    const localDir = path.join(process.cwd(), "uploads", "marketing_assets");
    fs.mkdirSync(localDir, { recursive: true });
    const localPath = path.join(localDir, filename);
    fs.writeFileSync(localPath, Buffer.from(imageBase64, "base64"));
    publicUrl = `/uploads/marketing_assets/${filename}`;
  }

  await recordMarketingAiUsage({
    taskType: "generate_background_image",
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
  * "Translate text to Hindi/Hinglish" -> translate headline, highlights, and CTA into catchy Hinglish (e.g. "Admissions Shuru 2026-27! Kota ke top faculty se padhein").
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
- For 9:16 (Story/Vertical): You have much more vertical height (${targetHeight}px). Spread elements out vertically. Increase spacing between hero headline, feature badges, and bottom contact anchor.
- For 16:9 (Landscape/Banner): You have wide horizontal space (${targetWidth}px) and less height (${targetHeight}px). Arrange into a two-column or split layout: Left side = Logo, Headline, Offer hook; Right side = Feature badges, CTA button, Phone.
- For 4:5 (Instagram Feed): Slightly taller than 1:1. Expand feature list and padding.
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
