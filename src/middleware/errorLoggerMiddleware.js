import { logSystemError } from "../utils/systemLogger.js";
import { captureException } from "../utils/telemetry.js";

/**
 * Middleware to automatically intercept API error responses (4xx and 5xx) across all routes,
 * log them into the database, and send instant WhatsApp alerts.
 */
export const errorLoggerMiddleware = (req, res, next) => {
  const originalJson = res.json;
  const originalSend = res.send;

  const captureApiError = (body) => {
    if (res.statusCode >= 400 && !res.locals.errorLogged) {
      // Ignore routine unauthenticated 401 pings (e.g. auth status check on startup when not logged in)
      const isRoutineAuthPing =
        res.statusCode === 401 &&
        !req.headers.authorization &&
        (req.path === "/auth/me" || req.path === "/api/auth/me" || req.path === "/student/auth/me");

      if (!isRoutineAuthPing) {
        res.locals.errorLogged = true;

        let errorMessage = `API Error ${res.statusCode}`;
        if (typeof body === "object" && body !== null) {
          errorMessage = body.message || body.error || body.msg || JSON.stringify(body);
        } else if (typeof body === "string") {
          errorMessage = body;
        }

        if (res.statusCode >= 500) {
          captureException(new Error(errorMessage), {
            user: req.user ? { id: req.user._id || req.user.id, email: req.user.email } : null,
            extra: {
              statusCode: res.statusCode,
              method: req.method,
              path: req.originalUrl || req.url,
            },
          });
        }

        logSystemError({
          level: res.statusCode >= 500 ? "error" : "warning",
          category: `API Error (${res.statusCode})`,
          message: `${req.method} ${req.originalUrl || req.url} - ${errorMessage}`,
          req,
          metadata: {
            statusCode: res.statusCode,
            method: req.method,
            path: req.originalUrl || req.url,
            query: req.query,
            ip: req.ip,
          },
        }).catch((err) => console.error("errorLoggerMiddleware log error:", err.message));
      }
    }
  };

  res.json = function (body) {
    captureApiError(body);
    return originalJson.apply(this, arguments);
  };

  res.send = function (body) {
    captureApiError(body);
    return originalSend.apply(this, arguments);
  };

  next();
};

/**
 * Express global error handling middleware for uncaught exceptions or next(err) calls
 */
export const globalErrorHandler = (err, req, res, next) => {
  console.error("Uncaught API Exception:", err);

  captureException(err, {
    user: req.user ? { id: req.user._id || req.user.id, email: req.user.email } : null,
    extra: {
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: err.status || err.statusCode || 500,
    },
  });

  if (!res.locals.errorLogged) {
    res.locals.errorLogged = true;

    logSystemError({
      level: "error",
      category: "Unhandled Exception",
      message: `${req.method} ${req.originalUrl || req.url} - ${err.message || String(err)}`,
      req,
      metadata: {
        stack: err.stack,
        statusCode: err.status || err.statusCode || 500,
      },
    }).catch((logErr) => console.error("globalErrorHandler log error:", logErr.message));
  }

  const statusCode = err.status || err.statusCode || 500;
  if (!res.headersSent) {
    res.status(statusCode).json({
      message: err.message || "An unexpected system error occurred.",
    });
  }
};
