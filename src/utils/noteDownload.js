import http from "http";
import https from "https";

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

const buildAttachmentHeader = (filename) => {
  const safeName = sanitizeFilename(filename);
  return `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`;
};

export const streamRemoteFileAsAttachment = ({
  res,
  url,
  filename,
}) =>
  new Promise((resolve, reject) => {
    if (!url) {
      reject(new Error("Missing remote file URL"));
      return;
    }

    let remoteRequest;

    try {
      const client = getRemoteClient(url);
      remoteRequest = client.get(url, (remoteResponse) => {
        const statusCode = remoteResponse.statusCode || 500;

        if (statusCode < 200 || statusCode >= 300) {
          remoteResponse.resume();

          if (!res.headersSent) {
            res.status(502).json({ message: "Could not fetch remote note file" });
          }

          reject(new Error(`Failed to fetch remote file: ${statusCode}`));
          return;
        }

        const contentType =
          remoteResponse.headers["content-type"] || "application/pdf";
        const contentLength = remoteResponse.headers["content-length"];

        res.setHeader("Content-Type", contentType);
        res.setHeader("Content-Disposition", buildAttachmentHeader(filename));
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
    } catch (error) {
      reject(error);
      return;
    }

    remoteRequest.on("error", (error) => {
      if (!res.headersSent) {
        res.status(502).json({ message: "Could not fetch remote note file" });
      }
      reject(error);
    });
  });

export const buildNoteDownloadFilename = (note) => {
  const baseName = sanitizeFilename(note?.title || "note");
  return baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;
};
