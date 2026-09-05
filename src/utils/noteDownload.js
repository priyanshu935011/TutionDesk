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

export const streamRemoteFileAsAttachment = ({
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

          // Handle 3xx Redirects (301, 302, 307, 308)
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

export const buildNoteDownloadFilename = (note) => {
  const baseName = sanitizeFilename(note?.title || "note");
  return baseName.toLowerCase().endsWith(".pdf") ? baseName : `${baseName}.pdf`;
};
