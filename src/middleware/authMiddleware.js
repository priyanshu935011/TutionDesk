import jwt from "jsonwebtoken";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import UptimeEvent from "../models/UptimeEvent.js";

const protect = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role === "super_admin" || decoded.id === "super-admin") {
      req.user = {
        _id: null,
        email: decoded.email,
        role: "super_admin",
        institute: null,
      };
      return next();
    }

    req.user = await User.findById(decoded.id).select("-password");

    if (!req.user) {
      return res.status(401).json({ message: "User not found" });
    }

    if (req.user.role !== "super_admin" && req.user.institute) {
      const institute = await Institute.findById(req.user.institute).select(
        "status subscriptionEnd"
      );

      if (institute) {
        const isExpired =
          institute.status !== "active" ||
          new Date(institute.subscriptionEnd).getTime() < Date.now();

        if (isExpired) {
          return res.status(403).json({
            message:
              "Your subscription has expired. Please renew to access the institute features.",
            subscriptionExpired: true,
          });
        }

        req.user.institute = institute;
      }
    }

    next();
  } catch (error) {
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
