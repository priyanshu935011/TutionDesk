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
 */
export async function generateMarketingTemplateWithAi({
  prompt,
  category = "admissions",
  aspectRatio = "1:1",
  targetAudience = "students and parents",
  themeColor = "#1E3A8A",
  user = null,
}) {
  if (!prompt || !prompt.trim()) {
    throw new Error("A description or prompt is required for AI template generation.");
  }

  const dims = RATIO_DIMENSIONS[aspectRatio] || RATIO_DIMENSIONS["1:1"];
  const canvasWidth = dims.width;
  const canvasHeight = dims.height;

  const systemInstruction = `You are a Principal Graphic Designer and Art Director specializing in educational marketing for Indian coaching institutes, tuition centres, and test-prep academies.

Your job is to generate a complete, professional, high-converting marketing creative in Canonical V2.0 JSON format.

CANVAS SPECIFICATIONS:
- Width: ${canvasWidth}px
- Height: ${canvasHeight}px
- Aspect Ratio: "${aspectRatio}"
- Primary Theme Color: ${themeColor || "#1E3A8A"}
- Category: "${category}"
- Target Audience: "${targetAudience}"

CRITICAL DESIGN & LAYOUT RULES:
1. CANONICAL COORDINATE GRID:
   - Use absolute pixels based on 0 to ${canvasWidth} (x) and 0 to ${canvasHeight} (y).
   - Elements must NEVER overflow the canvas. Keep safe margins (at least 40px from canvas edges).
   - Ensure clean vertical stacking and visual breathing room.
2. DYNAMIC PLACEHOLDER SYSTEM (MANDATORY FOR INSTITUTE IDENTITY):
   - You MUST include dynamic placeholders so coaching institutes can automatically stamp their brand:
     a) Institute Logo:
        { "id": "elem_institute_logo", "type": "logo", "name": "Institute Logo", "x": 60, "y": 50, "width": 120, "height": 120, "placeholder": "{institute.logo}", "styling": { "borderRadius": 60, "objectFit": "contain" } }
     b) Institute Name:
        { "id": "elem_institute_name", "type": "text", "name": "Institute Name", "x": 200, "y": 80, "width": 800, "height": 60, "placeholder": "{institute.name}", "content": "{institute.name}", "styling": { "fontSize": 34, "fontWeight": "800", "color": "#0F172A", "textAlign": "left" } }
     c) Call to Action Pill / Contact Box at the bottom:
        Shape container: { "id": "elem_cta_box", "type": "shape", "name": "CTA Container", "x": 80, "y": ${canvasHeight - 160}, "width": ${canvasWidth - 160}, "height": 80, "styling": { "backgroundColor": "${themeColor || '#2563EB'}", "borderRadius": 40 } }
     d) Institute Contact Phone:
        { "id": "elem_institute_phone", "type": "text", "name": "Contact Phone", "x": 100, "y": ${canvasHeight - 145}, "width": ${canvasWidth - 200}, "height": 50, "placeholder": "{institute.phone}", "content": "Call: {institute.phone}", "styling": { "fontSize": 28, "fontWeight": "700", "color": "#FFFFFF", "textAlign": "center" } }
     e) Institute Address:
        { "id": "elem_institute_address", "type": "text", "name": "Campus Address", "x": 80, "y": ${canvasHeight - 65}, "width": ${canvasWidth - 160}, "height": 40, "placeholder": "{institute.address}", "content": "{institute.address}", "styling": { "fontSize": 20, "fontWeight": "500", "color": "#64748B", "textAlign": "center" } }
3. VISUAL HIERARCHY & ELEMENTS:
   - Primary Headline: Large, bold, eye-catching (fontSize 48-68px, uppercase, high contrast).
   - Subheadline / Offer Hook: (fontSize 26-34px, fontWeight 600).
   - 2 to 4 Feature Highlights / Key Selling Points: Use rounded cards or pills (type: "shape", backgroundColor: "#F1F5F9" or vibrant accents) with clear text (e.g., "Kota Expert Faculty", "Daily Doubt Counters", "Weekly Ranker Tests", "Scholarships up to 90%").
   - Badges / Urgency Accents (e.g. "LIMITED SEATS", "BATCH COMMENCES JUNE 1ST").
4. COLOR CONTRAST & READABILITY:
   - Always ensure high contrast. If background is light (e.g., #FFFFFF, #F8FAFC), text must be dark (#0F172A, #1E293B).
   - If dark background, text must be white (#FFFFFF) or light (#F1F5F9).
   - Accent colors: Golden Amber (#F59E0B), Crimson (#DC2626), Emerald (#059669), Vibrant Blue (#2563EB).
5. ELEMENT TYPES ALLOWED:
   - "text": requires content, styling (fontSize, fontWeight, color, textAlign, fontFamily).
   - "shape": rounded or sharp rectangle; styling (backgroundColor, borderRadius, borderWidth, borderColor).
   - "circle": circular badge or highlight; styling (backgroundColor, borderRadius).
   - "logo": institute brand logo placeholder.
   - "image": decorative vector or graphic asset.

RETURN STRICTLY A SINGLE VALID JSON OBJECT with this exact structure:
{
  "name": "Catchy Creative Title",
  "category": "${category}",
  "aspectRatio": "${aspectRatio}",
  "canvas": {
    "width": ${canvasWidth},
    "height": ${canvasHeight},
    "backgroundColor": "#FFFFFF",
    "backgroundImageUrl": ""
  },
  "elements": [
    {
      "id": "elem_unique_1",
      "name": "Layer Name",
      "type": "text",
      "x": 80,
      "y": 180,
      "width": 920,
      "height": 90,
      "rotation": 0,
      "opacity": 1,
      "zIndex": 2,
      "isLocked": false,
      "isEditable": true,
      "isVisible": true,
      "placeholder": null,
      "content": "ADMISSIONS OPEN 2026-27",
      "styling": {
        "fontFamily": "Inter",
        "fontSize": 56,
        "fontWeight": "900",
        "color": "#0F172A",
        "textAlign": "center",
        "backgroundColor": "transparent"
      }
    }
  ]
}

DO NOT include any markdown code blocks, explanation, or HTML. ONLY return the raw JSON.`;

  const userPrompt = `Create a complete, stunning, high-converting marketing template based on this instruction:
"${prompt}"

Category: ${category}
Aspect Ratio: ${aspectRatio} (${canvasWidth}x${canvasHeight} px)
Target Audience: ${targetAudience}
Primary Theme Color: ${themeColor || "#1E3A8A"}
Remember to include institute identity placeholders ({institute.logo}, {institute.name}, {institute.phone}, {institute.address}) and compelling educational selling points!`;

  const raw = await callGeminiRaw({
    prompt: userPrompt,
    systemInstruction,
    temperature: 0.3,
  });

  const parsed = extractJsonFromText(raw);
  if (!parsed || !Array.isArray(parsed.elements)) {
    throw new Error("AI returned an unparseable template format. Please try again with a more detailed prompt.");
  }

  // Ensure canvas dimensions match ratio
  if (!parsed.canvas) parsed.canvas = {};
  parsed.canvas.width = canvasWidth;
  parsed.canvas.height = canvasHeight;
  parsed.aspectRatio = aspectRatio;

  // Validate and normalize using canonical template engine
  const validated = validateCanonicalTemplate(parsed);

  await recordMarketingAiUsage({
    taskType: "generate_template",
    prompt,
    metadata: { category, aspectRatio, elementCount: validated.elements.length },
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
      // Try next model if 404 or unsupported
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
    // Local fallback
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
