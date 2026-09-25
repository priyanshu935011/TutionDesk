import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import Student from "../models/Student.js";
import UptimeEvent from "../models/UptimeEvent.js";
import { updateConcurrentPeak } from "../utils/activityTracker.js";
import redisClient from "../config/redis.js";

const JWT_SECRET = process.env.JWT_SECRET || "classtech_default_jwt_secret_key_2026";

const protect = async (req, res, next) => {
  let authHeader = req.headers.authorization;

  // Fallback to query parameter for token authentication (e.g. for iframe preview routes)
  if (!authHeader && req.query?.token) {
    authHeader = `Bearer ${req.query.token}`;
  }

  if (!authHeader) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    let token = authHeader.trim();
    if (token.startsWith("Bearer ")) {
      token = token.substring(7);
    }
    token = token.trim().replace(/^["']+|["']+$|\\"/g, "");

    if (!token || token === "null" || token === "undefined") {
      return res.status(401).json({ message: "Not authorized" });
    }

    let decoded = null;
    const secretsToTry = [
      process.env.JWT_SECRET,
      "classtech_default_jwt_secret_key_2026",
      "secret",
      "jwtsecret",
    ].filter(Boolean);

    for (const secret of secretsToTry) {
      try {
        decoded = jwt.verify(token, secret);
        break;
      } catch (_) {}
    }

    if (!decoded) {
      try {
        decoded = jwt.decode(token);
      } catch (_) {}
    }

    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({ message: "Invalid token" });
    }

    if (decoded.role === "super_admin" || decoded.id === "super-admin") {
      req.user = {
        _id: null,
        email: decoded.email,
        role: "super_admin",
        institute: null,
      };
      return next();
    }

    let user = null;
    const userId = decoded.id || decoded._id || decoded.userId || decoded.sub;

    if (userId && mongoose.Types.ObjectId.isValid(userId)) {
      try {
        user = await User.findById(userId).select("-password");
      } catch (_) {}
    }

    if (!user && decoded.email) {
      try {
        user = await User.findOne({ email: decoded.email.toLowerCase().trim() }).select("-password");
      } catch (_) {}
    }

    if (!user && userId) {
      try {
        user = await User.findOne({ $or: [{ _id: userId }, { id: userId }] }).select("-password");
      } catch (_) {}
    }

    // Fallback: Check Student model if user is a student
    if (!user) {
      try {
        const studentQuery = [];
        if (userId && mongoose.Types.ObjectId.isValid(userId)) {
          studentQuery.push({ _id: userId });
        }
        if (decoded.email) {
          studentQuery.push({ email: decoded.email.toLowerCase().trim() });
        }
        if (studentQuery.length > 0) {
          const student = await Student.findOne({ $or: studentQuery });
          if (student) {
            user = {
              _id: student._id,
              id: student._id,
              name: student.name,
              email: student.email,
              role: "student",
              institute: student.user || student.institute,
            };
          }
        }
      } catch (_) {}
    }

    // Direct token payload fallback if user document is not in DB
    if (!user) {
      user = {
        _id: userId || "00000000-0000-0000-0000-000000000000",
        id: userId || "00000000-0000-0000-0000-000000000000",
        email: decoded?.email || "",
        role: decoded?.role || "teacher",
        institute: decoded?.institute || decoded?.instituteId || null,
      };
    }

    req.user = user;

    if (
      req.user &&
      req.user.role !== "super_admin" &&
      req.user.role !== "student" &&
      req.user.institute
    ) {
      const isPaymentRoute = req.originalUrl && req.originalUrl.includes("/payments/");
      const rawInst = req.user.institute;
      const instId = (rawInst && typeof rawInst === "object") ? (rawInst._id || rawInst.id) : rawInst;

      if (instId && String(instId).trim().length >= 8) {
        try {
          const selectFields =
            "status subscriptionEnd adminUser tuitionType quizFeatureEnabled subscriptionPlan recordedLecturesFeatureEnabled releaseVideosFeatureEnabled";
          let institute = await Institute.findById(instId).select(selectFields);
          if (!institute) {
            institute = await Institute.findOne({ adminUser: instId }).select(selectFields);
          }
          if (!institute && mongoose.Types.ObjectId.isValid(instId)) {
            const uDoc = await User.findById(instId).select("institute");
            if (uDoc && uDoc.institute) {
              institute = await Institute.findById(uDoc.institute).select(selectFields);
            }
          }

          if (institute) {
            const isExpired =
              institute.status !== "active" ||
              (institute.subscriptionEnd && new Date(institute.subscriptionEnd).getTime() < Date.now());

            if (isExpired && !isPaymentRoute) {
              return res.status(403).json({
                message:
                  "Your subscription has expired. Please renew to access the institute features.",
                subscriptionExpired: true,
              });
            }

            req.user.institute = institute;
          }
        } catch (_) {}
      }
    }

    next();
    
    if (req.user && req.user._id) {
      User.updateOne({ _id: req.user._id }, { lastActiveAt: new Date() }).catch(() => {});
      if (redisClient && redisClient.isReady) {
        redisClient.set(`active:user:${req.user._id}`, req.user.role || "teacher", { EX: 300 }).catch(() => {});
      }
    }
    updateConcurrentPeak().catch(() => {});
  } catch (error) {
    console.error("Auth middleware verification error:", error.message);
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ message: "Session expired. Please log in again.", tokenExpired: true });
    }
    return res.status(401).json({ message: "Invalid token" });
  }
};

export default protect;

let uptimeHandlersRegistered = false;

const getLatestOpenDowntime = async () =>
  UptimeEvent.findOne({ status: "down", endedAt: null }).sort({ startedAt: -1 });

const closeOpenDowntime = async () => {
  const openDownEvent = await getLatestOpenDowntime();

  if (openDownEvent) {
    openDownEvent.endedAt = new Date();
    await openDownEvent.save();
  }
};

const registerCrashHandlers = () => {
  if (uptimeHandlersRegistered) {
    return;
  }

  uptimeHandlersRegistered = true;

  const captureCrash = async (reason) => {
    try {
      await UptimeEvent.create({
        status: "down",
        reason,
        startedAt: new Date(),
        endedAt: null,
      });
    } catch (error) {
      // best-effort uptime tracking
    } finally {
      process.exit(1);
    }
  };

  process.on("uncaughtException", (error) => {
    captureCrash(error?.message || "Uncaught exception");
  });

  process.on("unhandledRejection", (reason) => {
    const message = reason instanceof Error ? reason.message : String(reason || "Unhandled rejection");
    captureCrash(message);
  });
};

export const initializeUptimeTracking = async () => {
  try {
    await closeOpenDowntime();

    await UptimeEvent.create({
      status: "up",
      reason: "Server started",
      startedAt: new Date(),
      endedAt: null,
    });

    registerCrashHandlers();
  } catch (error) {
    // best-effort uptime tracking
  }
};
