import ActivityLog from "../models/ActivityLog.js";

export const logActivity = async (userId, action, details, ip = "") => {
  try {
    await ActivityLog.create({
      user: userId,
      action,
      details: typeof details === "object" ? JSON.stringify(details) : String(details),
      ip: String(ip || ""),
    });
  } catch (err) {
    console.error("Failed to write activity log:", err);
  }
};
