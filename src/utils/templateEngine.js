/**
 * CLASSTECH MARKETING STUDIO V2.0 - CANONICAL TEMPLATE ENGINE
 * Shared schema validation, coordinate specifications, and dynamic placeholder resolver.
 */

export const CANONICAL_PRESETS = {
  "1:1": { width: 1080, height: 1080, label: "Square (1:1)", aspectRatio: "1:1" },
  "4:5": { width: 1080, height: 1350, label: "Portrait / Feed (4:5)", aspectRatio: "4:5" },
  "9:16": { width: 1080, height: 1920, label: "Story / Status (9:16)", aspectRatio: "9:16" },
  "16:9": { width: 1920, height: 1080, label: "Landscape / Banner (16:9)", aspectRatio: "16:9" },
};

export const DEFAULT_PLACEHOLDER_DEFAULTS = {
  "institute.name": "Premier Coaching Institute",
  "institute.tagline": "Empowering Future Achievers",
  "institute.logo": "https://assets.classtech.in/defaults/institute-logo.png",
  "institute.phone": "+91 98765 43210",
  "institute.alternatePhone": "+91 91234 56789",
  "institute.email": "contact@institute.com",
  "institute.website": "www.classtech.in",
  "institute.address": "Main Road, Near Central Library",
  "institute.city": "New Delhi",
  "institute.state": "Delhi",
  "institute.primaryColor": "#2563EB",
  "institute.secondaryColor": "#1E40AF",
  "institute.accentColor": "#F59E0B",
  "campaign.headline": "ADMISSIONS OPEN FOR NEW BATCH",
  "campaign.subheadline": "Limited Seats Available — Enroll Today",
  "campaign.batchName": "Target Batch 2026-27",
  "campaign.startDate": "Starting Next Monday",
  "campaign.offer": "Special 20% Early Bird Scholarship",
  "campaign.cta": "Call Now to Book a Free Demo Class",
  "faculty.name": "Senior Academic Mentor",
  "faculty.subject": "Physics & Mathematics",
  "faculty.experience": "12+ Years Teaching Experience",
  "faculty.photo": "https://assets.classtech.in/defaults/faculty-avatar.png",
  "student.name": "Topper Student",
  "student.score": "99.4% Percentile",
  "student.rank": "AIR 45",
  "student.exam": "NEET / JEE Main",
  "student.photo": "https://assets.classtech.in/defaults/student-avatar.png",
  "current_year": new Date().getFullYear().toString(),
  "next_year": (new Date().getFullYear() + 1).toString(),
};

/**
 * Validates and normalizes canonical template JSON
 */
export function validateCanonicalTemplate(template) {
  if (!template || typeof template !== "object") {
    throw new Error("Template must be a valid JSON object");
  }

  const canvas = template.canvas || {};
  const width = Number(canvas.width) || 1080;
  const height = Number(canvas.height) || 1080;
  const aspectRatio = template.aspectRatio || canvas.aspectRatio || (width === 1080 && height === 1350 ? "4:5" : width === 1080 && height === 1920 ? "9:16" : width === 1920 ? "16:9" : "1:1");

  const elements = Array.isArray(template.elements) ? template.elements : [];
  const seenIds = new Set();

  const validatedElements = elements.map((elem, idx) => {
    let id = elem.id || `elem_${idx + 1}_${Date.now()}`;
    if (seenIds.has(id)) {
      id = `${id}_${idx}`;
    }
    seenIds.add(id);

    return {
      id: String(id),
      type: elem.type || "text",
      name: elem.name || `Layer ${idx + 1}`,
      x: Math.round(Number(elem.x) || 0),
      y: Math.round(Number(elem.y) || 0),
      width: Math.max(1, Math.round(Number(elem.width) || 100)),
      height: Math.max(1, Math.round(Number(elem.height) || 100)),
      rotation: Number(elem.rotation) || 0,
      opacity: typeof elem.opacity === "number" ? Math.min(1, Math.max(0, elem.opacity)) : 1,
      zIndex: typeof elem.zIndex === "number" ? elem.zIndex : idx,
      isLocked: Boolean(elem.isLocked || elem.locked),
      isEditable: elem.isEditable !== undefined ? Boolean(elem.isEditable) : true,
      isVisible: elem.isVisible !== undefined ? Boolean(elem.isVisible) : true,
      placeholder: elem.placeholder ? String(elem.placeholder).trim() : null,
      content: elem.content !== undefined ? elem.content : "",
      styling: {
        fontFamily: elem.styling?.fontFamily || "Inter",
        fontSize: Number(elem.styling?.fontSize) || 32,
        fontWeight: elem.styling?.fontWeight || "600",
        fontStyle: elem.styling?.fontStyle || "normal",
        color: elem.styling?.color || "#1E293B",
        textAlign: elem.styling?.textAlign || "left",
        lineHeight: Number(elem.styling?.lineHeight) || 1.3,
        letterSpacing: Number(elem.styling?.letterSpacing) || 0,
        textTransform: elem.styling?.textTransform || "none",
        backgroundColor: elem.styling?.backgroundColor || "transparent",
        borderColor: elem.styling?.borderColor || "transparent",
        borderWidth: Number(elem.styling?.borderWidth) || 0,
        borderRadius: Number(elem.styling?.borderRadius) || 0,
        boxShadow: elem.styling?.boxShadow || "none",
        objectFit: elem.styling?.objectFit || "cover",
        ...elem.styling,
      },
      constraints: {
        maxCharacters: Number(elem.constraints?.maxCharacters) || 500,
        allowFontChange: elem.constraints?.allowFontChange !== false,
        allowColorChange: elem.constraints?.allowColorChange !== false,
        allowReplaceImage: elem.constraints?.allowReplaceImage !== false,
        hideIfEmpty: Boolean(elem.constraints?.hideIfEmpty),
        ...elem.constraints,
      },
    };
  });

  // Sort elements by zIndex ascending
  validatedElements.sort((a, b) => a.zIndex - b.zIndex);

  return {
    schemaVersion: "2.0",
    id: template.id || undefined,
    name: template.name || "Untitled Marketing Creative",
    category: template.category || "admissions",
    aspectRatio,
    canvas: {
      width,
      height,
      backgroundColor: canvas.backgroundColor || "#FFFFFF",
      backgroundImageUrl: canvas.backgroundImageUrl || "",
      backgroundFit: canvas.backgroundFit || "cover",
    },
    elements: validatedElements,
    brandingPositions: template.brandingPositions || null,
    metadata: template.metadata || {},
  };
}

/**
 * Resolves all placeholders for a given institute into a render-ready design.
 * Guarantees zero "undefined" or "null" literal text leakage.
 */
export function resolveTemplatePlaceholders(template, instituteContext = {}) {
  const normalized = validateCanonicalTemplate(template);

  // Flatten institute context into key-value map
  const values = {
    ...DEFAULT_PLACEHOLDER_DEFAULTS,
    "institute.name": instituteContext.name || instituteContext.instituteName || DEFAULT_PLACEHOLDER_DEFAULTS["institute.name"],
    "institute.tagline": instituteContext.tagline || instituteContext.caption || "",
    "institute.logo": instituteContext.logoUrl || instituteContext.logo || DEFAULT_PLACEHOLDER_DEFAULTS["institute.logo"],
    "institute.phone": instituteContext.phone || instituteContext.contactPhone || instituteContext.mobile || DEFAULT_PLACEHOLDER_DEFAULTS["institute.phone"],
    "institute.alternatePhone": instituteContext.alternatePhone || instituteContext.altPhone || "",
    "institute.email": instituteContext.email || instituteContext.contactEmail || "",
    "institute.website": instituteContext.website || "",
    "institute.address": instituteContext.address || instituteContext.fullAddress || DEFAULT_PLACEHOLDER_DEFAULTS["institute.address"],
    "institute.city": instituteContext.city || "",
    "institute.state": instituteContext.state || "",
    "institute.primaryColor": instituteContext.primaryColor || instituteContext.brandColor || "#2563EB",
    "institute.secondaryColor": instituteContext.secondaryColor || "#1E40AF",
    "institute.accentColor": instituteContext.accentColor || "#F59E0B",
    ...instituteContext.customPlaceholders,
  };

  const interpolateString = (str) => {
    if (!str || typeof str !== "string") return str;
    return str.replace(/\{([\w\.]+)\}/g, (match, key) => {
      if (values[key] !== undefined && values[key] !== null) {
        return String(values[key]);
      }
      return match;
    });
  };

  const resolvedElements = normalized.elements.map((elem) => {
    const updated = { ...elem, styling: { ...elem.styling } };

    // Resolve placeholder for content
    if (elem.placeholder && values[elem.placeholder] !== undefined) {
      const resolvedVal = values[elem.placeholder];
      if (resolvedVal === "" && elem.constraints?.hideIfEmpty) {
        updated.isVisible = false;
      } else if (resolvedVal !== "") {
        updated.content = resolvedVal;
      }
    } else if (typeof updated.content === "string") {
      updated.content = interpolateString(updated.content);
    }

    // Color branding placeholders
    if (updated.styling?.color && updated.styling.color.startsWith("{institute.")) {
      const colorKey = updated.styling.color.replace(/[{}]/g, "");
      if (values[colorKey]) {
        updated.styling.color = values[colorKey];
      }
    }
    if (updated.styling?.backgroundColor && updated.styling.backgroundColor.startsWith("{institute.")) {
      const bgKey = updated.styling.backgroundColor.replace(/[{}]/g, "");
      if (values[bgKey]) {
        updated.styling.backgroundColor = values[bgKey];
      }
    }

    return updated;
  });

  return {
    ...normalized,
    elements: resolvedElements,
    resolvedAt: new Date().toISOString(),
    instituteId: instituteContext.id || instituteContext.institute_id || null,
  };
}

/**
 * Migration helper: converts older v1.0 templates with brandingPositions to canonical v2.0
 */
export function convertV1ToCanonicalV2(v1Template) {
  if (!v1Template) return null;
  if (v1Template.schemaVersion === "2.0" && Array.isArray(v1Template.elements)) {
    return validateCanonicalTemplate(v1Template);
  }

  const canvasWidth = 1080;
  const canvasHeight = v1Template.aspectRatio === "4:5" ? 1350 : v1Template.aspectRatio === "9:16" ? 1920 : 1080;

  const elements = [];
  let zCounter = 0;

  // Background layer
  if (v1Template.imageUrl) {
    elements.push({
      id: "bg_main_image",
      type: "image",
      name: "Background Image",
      x: 0,
      y: 0,
      width: canvasWidth,
      height: canvasHeight,
      rotation: 0,
      opacity: 1,
      zIndex: zCounter++,
      isLocked: true,
      isEditable: false,
      isVisible: true,
      content: v1Template.imageUrl,
      styling: { objectFit: "cover" },
      constraints: { allowReplaceImage: false },
    });
  }

  // Convert brandingPositions (percentages) to 1080p canonical pixels
  const positions = v1Template.brandingPositions?.square || v1Template.brandingPositions?.story || {};

  if (positions.logo && positions.logo.isVisible !== false) {
    elements.push({
      id: "elem_institute_logo",
      type: "image",
      name: "Institute Logo",
      placeholder: "institute.logo",
      x: Math.round(((positions.logo.x ?? 6) / 100) * canvasWidth),
      y: Math.round(((positions.logo.y ?? 6) / 100) * canvasHeight),
      width: Math.round(((positions.logo.width ?? 18) / 100) * canvasWidth),
      height: Math.round(((positions.logo.height ?? 18) / 100) * canvasHeight),
      rotation: 0,
      opacity: 1,
      zIndex: zCounter++,
      isLocked: false,
      isEditable: true,
      isVisible: true,
      content: DEFAULT_PLACEHOLDER_DEFAULTS["institute.logo"],
      styling: { objectFit: "contain", borderRadius: 8 },
      constraints: { allowReplaceImage: true },
    });
  }

  if (positions.instituteName && positions.instituteName.isVisible !== false) {
    elements.push({
      id: "elem_institute_name",
      type: "text",
      name: "Institute Name",
      placeholder: "institute.name",
      x: Math.round(((positions.instituteName.x ?? 26) / 100) * canvasWidth),
      y: Math.round(((positions.instituteName.y ?? 8) / 100) * canvasHeight),
      width: Math.round(0.68 * canvasWidth),
      height: 80,
      rotation: 0,
      opacity: 1,
      zIndex: zCounter++,
      isLocked: false,
      isEditable: true,
      isVisible: true,
      content: DEFAULT_PLACEHOLDER_DEFAULTS["institute.name"],
      styling: {
        fontSize: Math.round((positions.instituteName.fontSize || 18) * 2.2),
        fontWeight: "bold",
        color: positions.instituteName.color || "#FFFFFF",
        textAlign: "left",
      },
      constraints: { maxCharacters: 80 },
    });
  }

  if (positions.phone && positions.phone.isVisible !== false) {
    elements.push({
      id: "elem_institute_phone",
      type: "text",
      name: "Contact Phone",
      placeholder: "institute.phone",
      x: Math.round(((positions.phone.x ?? 6) / 100) * canvasWidth),
      y: Math.round(((positions.phone.y ?? 88) / 100) * canvasHeight),
      width: Math.round(0.45 * canvasWidth),
      height: 50,
      rotation: 0,
      opacity: 1,
      zIndex: zCounter++,
      isLocked: false,
      isEditable: true,
      isVisible: true,
      content: DEFAULT_PLACEHOLDER_DEFAULTS["institute.phone"],
      styling: {
        fontSize: Math.round((positions.phone.fontSize || 14) * 2.2),
        fontWeight: "600",
        color: positions.phone.color || "#F59E0B",
        textAlign: "left",
      },
      constraints: { maxCharacters: 30 },
    });
  }

  if (positions.address && positions.address.isVisible !== false) {
    elements.push({
      id: "elem_institute_address",
      type: "text",
      name: "Institute Address",
      placeholder: "institute.address",
      x: Math.round(((positions.address.x ?? 6) / 100) * canvasWidth),
      y: Math.round(((positions.address.y ?? 93) / 100) * canvasHeight),
      width: Math.round(0.88 * canvasWidth),
      height: 60,
      rotation: 0,
      opacity: 1,
      zIndex: zCounter++,
      isLocked: false,
      isEditable: true,
      isVisible: true,
      content: DEFAULT_PLACEHOLDER_DEFAULTS["institute.address"],
      styling: {
        fontSize: Math.round((positions.address.fontSize || 12) * 2.2),
        fontWeight: "normal",
        color: positions.address.color || "#E2E8F0",
        textAlign: "left",
      },
      constraints: { maxCharacters: 120 },
    });
  }

  return {
    schemaVersion: "2.0",
    id: v1Template._id || v1Template.id,
    name: v1Template.title || "Marketing Poster",
    category: v1Template.category || "admissions",
    aspectRatio: v1Template.aspectRatio || "1:1",
    canvas: {
      width: canvasWidth,
      height: canvasHeight,
      backgroundColor: "#FFFFFF",
      backgroundImageUrl: v1Template.imageUrl || "",
    },
    elements,
  };
}
