import http from "http";
import https from "https";
import { PDFDocument, rgb, degrees, StandardFonts } from "pdf-lib";

const sanitizeFilename = (value) =>
  String(value || "note")
    .trim()
    .replace(/[^\w.-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

const getRemoteClient = (url) => {
  const parsedUrl = new URL(url);
  return parsedUrl.protocol === "http:" ? http : https;
};

export const buildAttachmentHeader = (filename) => {
  const safeName = sanitizeFilename(filename);
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
};

/**
 * Adds an elegant, high-clarity "ClassTech" watermark to every page of the given PDF buffer.
 */
export const addClassTechWatermark = async (pdfBuffer) => {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();

      // 1. Large prominent diagonal ClassTech watermark across center
      const wmText = "ClassTech";
      const fontSize = Math.max(38, Math.min(width, height) * 0.12);
      const textWidth = boldFont.widthOfTextAtSize(wmText, fontSize);
      const textHeight = boldFont.heightAtSize(fontSize);

      page.drawText(wmText, {
        x: (width - textWidth) / 2,
        y: (height - textHeight) / 2,
        size: fontSize,
        font: boldFont,
        color: rgb(0.2, 0.22, 0.3),
        opacity: 0.16,
        rotate: degrees(35),
      });

      // 2. Top-right subtle brand header
      const topTag = "ClassTech Smart Learning";
      const topTagWidth = regularFont.widthOfTextAtSize(topTag, 8.5);
      page.drawText(topTag, {
        x: width - topTagWidth - 24,
        y: height - 20,
        size: 8.5,
        font: regularFont,
        color: rgb(0.35, 0.35, 0.45),
        opacity: 0.7,
      });

      // 3. Bottom footer watermark
      const footerText = "ClassTech Official Study Material • All Rights Reserved";
      const footerWidth = regularFont.widthOfTextAtSize(footerText, 8.5);
      page.drawText(footerText, {
        x: (width - footerWidth) / 2,
        y: 14,
        size: 8.5,
        font: regularFont,
        color: rgb(0.35, 0.35, 0.45),
        opacity: 0.7,
      });
    }

    const watermarkedBytes = await pdfDoc.save();
    return Buffer.from(watermarkedBytes);
  } catch (err) {
    console.error("addClassTechWatermark error:", err);
    return pdfBuffer;
  }
};

export const streamRemoteFileInline = ({
  res,
  url,
  filename,
  maxRedirects = 5,
}) =>
  new Promise((resolve, reject) => {
    const fetchUrl = (currentUrl, redirectsLeft) => {
      if (redirectsLeft <= 0) {
        if (!res.headersSent) {
          res.status(502).json({ message: "Too many redirects fetching remote note file" });
        }
        reject(new Error("Too many redirects"));
        return;
      }

      let remoteRequest;
      try {
        const client = getRemoteClient(currentUrl);
        remoteRequest = client.get(currentUrl, (remoteResponse) => {
          const statusCode = remoteResponse.statusCode || 500;

          if (statusCode >= 300 && statusCode < 400 && remoteResponse.headers.location) {
            remoteResponse.resume();
            let redirectUrl = remoteResponse.headers.location;
            if (redirectUrl.startsWith("/")) {
              const origin = new URL(currentUrl).origin;
              redirectUrl = `${origin}${redirectUrl}`;
            }
            fetchUrl(redirectUrl, redirectsLeft - 1);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            remoteResponse.resume();
            if (!res.headersSent) {
              res.status(502).json({ message: `Could not fetch remote note file (HTTP ${statusCode})` });
            }
            reject(new Error(`Failed to fetch remote file: ${statusCode}`));
            return;
          }

          res.setHeader("Content-Type", "application/pdf");
          res.setHeader("Content-Disposition", `inline; filename="${sanitizeFilename(filename)}"`);
          res.setHeader("Access-Control-Allow-Origin", "*");

          remoteResponse.on("error", (error) => {
            if (!res.headersSent) {
              res.status(502).json({ message: "Could not fetch remote note file" });
            } else {
              res.destroy(error);
            }
            reject(error);
          });

          res.on("close", () => {
            if (!remoteResponse.destroyed) {
              remoteResponse.destroy();
            }
          });

          remoteResponse.pipe(res);
          remoteResponse.on("end", resolve);
        });

        remoteRequest.on("error", (error) => {
          if (!res.headersSent) {
            res.status(502).json({ message: "Could not fetch remote note file" });
          }
          reject(error);
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(502).json({ message: error.message || "Invalid remote file URL" });
        }
        reject(error);
      }
    };

    fetchUrl(url, maxRedirects);
  });

export const streamRemoteFileAsAttachment = async ({
  res,
  url,
  filename,
  maxRedirects = 5,
}) => {
  // First attempt fast fetch & apply ClassTech watermark
  try {
    const fetchRes = await fetch(url);
    if (fetchRes.ok) {
      const arrayBuffer = await fetchRes.arrayBuffer();
      const originalBuf = Buffer.from(arrayBuffer);
      const watermarked = await addClassTechWatermark(originalBuf);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", buildAttachmentHeader(filename));
      res.setHeader("Content-Length", watermarked.length);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
      res.send(watermarked);
      return;
    }
  } catch (err) {
    console.warn("Fast fetch & watermark fallback to pipe:", err.message);
  }

  // Fallback to streaming if buffer fetch failed
  return new Promise((resolve, reject) => {
    const fetchUrl = (currentUrl, redirectsLeft) => {
      if (redirectsLeft <= 0) {
        if (!res.headersSent) {
          res.status(502).json({ message: "Too many redirects fetching remote note file" });
        }
        reject(new Error("Too many redirects"));
        return;
      }

      let remoteRequest;
      try {
        const client = getRemoteClient(currentUrl);
        remoteRequest = client.get(currentUrl, (remoteResponse) => {
          const statusCode = remoteResponse.statusCode || 500;

          // Handle 3xx Redirects
          if (statusCode >= 300 && statusCode < 400 && remoteResponse.headers.location) {
            remoteResponse.resume();
            let redirectUrl = remoteResponse.headers.location;
            if (redirectUrl.startsWith("/")) {
              const origin = new URL(currentUrl).origin;
              redirectUrl = `${origin}${redirectUrl}`;
            }
            fetchUrl(redirectUrl, redirectsLeft - 1);
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            remoteResponse.resume();
            if (!res.headersSent) {
              res.status(502).json({ message: `Could not fetch remote note file (HTTP ${statusCode})` });
            }
            reject(new Error(`Failed to fetch remote file: ${statusCode}`));
            return;
          }

          const contentType = remoteResponse.headers["content-type"] || "application/pdf";
          const contentLength = remoteResponse.headers["content-length"];

          res.setHeader("Content-Type", contentType);
          res.setHeader("Content-Disposition", buildAttachmentHeader(filename));
          res.setHeader("Access-Control-Allow-Origin", "*");
          res.setHeader("Access-Control-Expose-Headers", "Content-Disposition");
          if (contentLength) {
            res.setHeader("Content-Length", contentLength);
          }

          remoteResponse.on("error", (error) => {
            if (!res.headersSent) {
              res.status(502).json({ message: "Could not fetch remote note file" });
            } else {
              res.destroy(error);
            }
            reject(error);
          });

          res.on("close", () => {
            if (!remoteResponse.destroyed) {
              remoteResponse.destroy();
            }
          });

          remoteResponse.pipe(res);
          remoteResponse.on("end", resolve);
        });

        remoteRequest.on("error", (error) => {
          if (!res.headersSent) {
            res.status(502).json({ message: "Could not fetch remote note file" });
          }
          reject(error);
        });
      } catch (error) {
        if (!res.headersSent) {
          res.status(502).json({ message: error.message || "Invalid remote file URL" });
        }
        reject(error);
      }
    };

    fetchUrl(url, maxRedirects);
  });
};

export const buildNoteDownloadFilename = (note) => {
  let baseName = sanitizeFilename(note?.title || "study_note");
  if (!baseName.toLowerCase().startsWith("classtech")) {
    baseName = `ClassTech_${baseName}`;
  }
  return baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;
};
