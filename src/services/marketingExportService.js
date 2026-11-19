/**
 * CLASSTECH MARKETING STUDIO V2.0 - HIGH-DPI EXPORT ENGINE
 * Sharp + Skia/SVG Compositing + PDFKit (True 300 DPI PNG, JPG, Printable A4 PDF)
 */

import fs from "fs";
import path from "path";
import axios from "axios";
import sharp from "sharp";
import PDFDocument from "pdfkit";
import cloudinary from "../utils/cloudinary.js";
import MarketingExport from "../models/MarketingExport.js";
import InstituteMarketingDesign from "../models/InstituteMarketingDesign.js";
import { validateCanonicalTemplate } from "../utils/templateEngine.js";

// Ensure local export directory exists for local backups
const EXPORTS_DIR = path.join(process.cwd(), "uploads", "marketing_exports");
if (!fs.existsSync(EXPORTS_DIR)) {
  try {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
  } catch (_) {}
}

/**
 * Escapes XML/SVG special characters
 */
function escapeXml(unsafe) {
  if (typeof unsafe !== "string") return String(unsafe || "");
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Wraps text into lines that fit within a max pixel width (approximate character metric)
 */
function wrapSvgText(text, fontSize, maxWidth) {
  if (!text) return [];
  const lines = [];
  const rawParagraphs = String(text).split("\n");
  const approxCharWidth = fontSize * 0.55;
  const maxCharsPerLine = Math.max(1, Math.floor(maxWidth / approxCharWidth));

  for (const para of rawParagraphs) {
    const words = para.split(" ");
    let currentLine = "";

    for (const word of words) {
      if ((currentLine + " " + word).trim().length <= maxCharsPerLine) {
        currentLine = (currentLine + " " + word).trim();
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

/**
 * Fetches an image URL into a Buffer with safe fallback
 */
async function fetchImageBuffer(url) {
  if (!url || typeof url !== "string") return null;

  // Handle data URI
  if (url.startsWith("data:")) {
    const matches = url.match(/^data:([^;]+);base64,(.*)$/);
    if (matches && matches[2]) {
      return Buffer.from(matches[2], "base64");
    }
  }

  // Handle local file
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    if (fs.existsSync(url)) {
      return fs.readFileSync(url);
    }
  }

  // Handle remote HTTP URL
  try {
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 8000,
    });
    return Buffer.from(response.data);
  } catch (err) {
    console.warn(`[ExportEngine] Failed to fetch image ${url}:`, err.message);
    return null;
  }
}

/**
 * Renders a canonical design JSON into a 300 DPI Buffer
 */
export async function renderDesignToBuffer({ designJson, format = "png", resolutionDpi = 300, printScale = 1.0 }) {
  const template = validateCanonicalTemplate(designJson);
  const canvasWidth = Math.round((template.canvas.width || 1080) * printScale);
  const canvasHeight = Math.round((template.canvas.height || 1080) * printScale);
  const scale = canvasWidth / (template.canvas.width || 1080);

  // 1. Prepare Base Canvas Buffer
  let baseBuffer = null;
  if (template.canvas.backgroundImageUrl) {
    const bgImgBuffer = await fetchImageBuffer(template.canvas.backgroundImageUrl);
    if (bgImgBuffer) {
      baseBuffer = await sharp(bgImgBuffer)
        .resize(canvasWidth, canvasHeight, { fit: "cover" })
        .png()
        .toBuffer();
    }
  }

  if (!baseBuffer) {
    const bgColor = template.canvas.backgroundColor || "#FFFFFF";
    const bgSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${canvasWidth}" height="${canvasHeight}" fill="${escapeXml(bgColor)}" />
    </svg>`;
    baseBuffer = await sharp(Buffer.from(bgSvg)).png().toBuffer();
  }

  // 2. Prepare Compositing Layers (Images, Shapes, Text)
  const composites = [];
  const svgElements = [];

  const sortedElements = [...template.elements].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));

  for (const elem of sortedElements) {
    if (elem.isVisible === false) continue;

    const elemX = Math.round(elem.x * scale);
    const elemY = Math.round(elem.y * scale);
    const elemWidth = Math.max(1, Math.round(elem.width * scale));
    const elemHeight = Math.max(1, Math.round(elem.height * scale));
    const opacity = typeof elem.opacity === "number" ? elem.opacity : 1;

    if (elem.type === "image") {
      const imgBuffer = await fetchImageBuffer(elem.content);
      if (imgBuffer) {
        try {
          const fitMode = elem.styling?.objectFit === "contain" ? "contain" : "cover";
          let processedImg = sharp(imgBuffer).resize(elemWidth, elemHeight, {
            fit: fitMode,
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          });

          // Optional rounded corners
          const borderRadius = Math.round((elem.styling?.borderRadius || 0) * scale);
          if (borderRadius > 0) {
            const maskSvg = `<svg width="${elemWidth}" height="${elemHeight}">
              <rect x="0" y="0" width="${elemWidth}" height="${elemHeight}" rx="${borderRadius}" ry="${borderRadius}" fill="#fff" />
            </svg>`;
            processedImg = processedImg.composite([{
              input: Buffer.from(maskSvg),
              blend: "dest-in",
            }]);
          }

          const resizedBuffer = await processedImg.png().toBuffer();
          composites.push({
            input: resizedBuffer,
            left: Math.max(0, elemX),
            top: Math.max(0, elemY),
          });
        } catch (imgProcErr) {
          console.warn("[ExportEngine] Image layer processing error:", imgProcErr.message);
        }
      }
    } else if (elem.type === "shape") {
      const bg = elem.styling?.backgroundColor || "#2563EB";
      const border = elem.styling?.borderColor || "transparent";
      const borderWidth = Math.round((elem.styling?.borderWidth || 0) * scale);
      const borderRadius = Math.round((elem.styling?.borderRadius || 0) * scale);

      svgElements.push(`
        <rect
          x="${elemX}"
          y="${elemY}"
          width="${elemWidth}"
          height="${elemHeight}"
          rx="${borderRadius}"
          ry="${borderRadius}"
          fill="${escapeXml(bg)}"
          stroke="${escapeXml(border)}"
          stroke-width="${borderWidth}"
          opacity="${opacity}"
        />
      `);
    } else if (elem.type === "text") {
      const fontSize = Math.round((elem.styling?.fontSize || 32) * scale);
      const fontFamily = escapeXml(elem.styling?.fontFamily || "Inter, Roboto, sans-serif");
      const fontWeight = elem.styling?.fontWeight || "600";
      const fontStyle = elem.styling?.fontStyle || "normal";
      const color = escapeXml(elem.styling?.color || "#1E293B");
      const textAlign = elem.styling?.textAlign || "left";
      const lineHeight = fontSize * (elem.styling?.lineHeight || 1.3);

      const lines = wrapSvgText(elem.content, fontSize, elemWidth);

      let textAnchor = "start";
      let textX = elemX;
      if (textAlign === "center") {
        textAnchor = "middle";
        textX = elemX + elemWidth / 2;
      } else if (textAlign === "right") {
        textAnchor = "end";
        textX = elemX + elemWidth;
      }

      const tspanLines = lines
        .map((line, i) => {
          const dy = i === 0 ? fontSize : lineHeight;
          return `<tspan x="${textX}" dy="${dy}">${escapeXml(line)}</tspan>`;
        })
        .join("");

      svgElements.push(`
        <text
          x="${textX}"
          y="${elemY}"
          font-family="${fontFamily}"
          font-size="${fontSize}px"
          font-weight="${fontWeight}"
          font-style="${fontStyle}"
          fill="${color}"
          text-anchor="${textAnchor}"
          opacity="${opacity}"
        >
          ${tspanLines}
        </text>
      `);
    }
  }

  // 3. Composite SVG overlay onto base
  if (svgElements.length > 0) {
    const fullSvg = `<svg width="${canvasWidth}" height="${canvasHeight}" xmlns="http://www.w3.org/2000/svg">
      ${svgElements.join("\n")}
    </svg>`;
    composites.push({
      input: Buffer.from(fullSvg),
      left: 0,
      top: 0,
    });
  }

  let finalImage = sharp(baseBuffer);
  if (composites.length > 0) {
    finalImage = finalImage.composite(composites);
  }

  // 4. Output according to requested format
  if (format === "jpg" || format === "jpeg") {
    return await finalImage
      .jpeg({ quality: 95 })
      .withMetadata({ density: resolutionDpi })
      .toBuffer();
  }

  if (format === "pdf") {
    // Render high-res PNG first, then encapsulate into PDFKit A4 document
    const rasterBuffer = await finalImage
      .png()
      .withMetadata({ density: resolutionDpi })
      .toBuffer();

    return await createA4PdfBuffer(rasterBuffer, canvasWidth, canvasHeight);
  }

  // Default: PNG 300 DPI
  return await finalImage
    .png()
    .withMetadata({ density: resolutionDpi })
    .toBuffer();
}

/**
 * Encapsulates an image buffer into an A4 Printable PDF (595.28 x 841.89 points)
 */
function createA4PdfBuffer(imageBuffer, imgWidth, imgHeight) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({
        size: "A4",
        margin: 28.35, // ~10mm printable margins
      });

      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err) => reject(err));

      const pageWidth = doc.page.width - 2 * doc.page.margins.left;
      const pageHeight = doc.page.height - 2 * doc.page.margins.top;

      // Calculate fitted aspect ratio on A4
      const imgAspect = imgWidth / imgHeight;
      const pageAspect = pageWidth / pageHeight;

      let drawWidth, drawHeight;
      if (imgAspect > pageAspect) {
        drawWidth = pageWidth;
        drawHeight = pageWidth / imgAspect;
      } else {
        drawHeight = pageHeight;
        drawWidth = pageHeight * imgAspect;
      }

      const drawX = doc.page.margins.left + (pageWidth - drawWidth) / 2;
      const drawY = doc.page.margins.top + (pageHeight - drawHeight) / 2;

      doc.image(imageBuffer, drawX, drawY, {
        width: drawWidth,
        height: drawHeight,
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Background Export Worker: Processes an export job asynchronously
 */
export async function processExportJob(exportId) {
  try {
    const exportRecord = await MarketingExport.findById(exportId);
    if (!exportRecord) {
      console.error(`[ExportEngine] Export job ${exportId} not found`);
      return;
    }

    const design = await InstituteMarketingDesign.findById(exportRecord.design_id);
    if (!design) {
      await MarketingExport.findByIdAndUpdate(exportId, {
        status: "failed",
        error_message: "Associated marketing design not found.",
      });
      return;
    }

    const renderedBuffer = await renderDesignToBuffer({
      designJson: design.design_json,
      format: exportRecord.format || "png",
      resolutionDpi: exportRecord.resolution_dpi || 300,
      printScale: 1.0,
    });

    const fileExt = exportRecord.format === "pdf" ? "pdf" : exportRecord.format === "jpg" ? "jpg" : "png";
    const filename = `mkt_export_${exportId}_${Date.now()}.${fileExt}`;
    const localFilePath = path.join(EXPORTS_DIR, filename);

    // Save local copy
    fs.writeFileSync(localFilePath, renderedBuffer);

    let publicUrl = `/uploads/marketing_exports/${filename}`;

    // Upload to Cloudinary if configured
    try {
      if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
        const b64 = `data:${fileExt === "pdf" ? "application/pdf" : `image/${fileExt}`};base64,${renderedBuffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          resource_type: fileExt === "pdf" ? "raw" : "image",
          folder: "marketing_exports",
          public_id: `export_${exportId}`,
        });
        publicUrl = uploadRes.secure_url || uploadRes.url || publicUrl;
      }
    } catch (cErr) {
      console.warn("[ExportEngine] Cloudinary upload notice (fallback to local serving):", cErr.message);
    }

    // Update Export record to 'ready'
    await MarketingExport.findByIdAndUpdate(exportId, {
      status: "ready",
      storage_path: localFilePath,
      public_url: publicUrl,
      file_size: renderedBuffer.length,
    });

    // Update design last_exported_at
    await InstituteMarketingDesign.findByIdAndUpdate(design._id || design.id, {
      status: "exported",
      last_exported_at: new Date(),
    });

    console.log(`[ExportEngine] Successfully rendered export ${exportId} (${fileExt.toUpperCase()}, ${renderedBuffer.length} bytes)`);
  } catch (error) {
    console.error(`[ExportEngine] Failed processing export ${exportId}:`, error);
    try {
      await MarketingExport.findByIdAndUpdate(exportId, {
        status: "failed",
        error_message: error.message || "Unknown error during rendering",
      });
    } catch (_) {}
  }
}
