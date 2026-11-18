import ActivityLog from "../models/ActivityLog.js";
import { supabase } from "./supabase.js";

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

export const logInstituteActivity = async ({
  instituteId,
  userId = null,
  userName = "",
  userRole = "teacher",
  action,
  category = "general",
  title = "",
  details = "",
  studentId = "",
  studentName = "",
  batchId = "",
  batchName = "",
  amount = 0,
  metadata = {},
  ip = "",
}) => {
  if (!instituteId && !userId) return;
  try {
    const instIdStr = String(instituteId || "").trim();
    const entry = {
      institute: instIdStr || null,
      instituteId: instIdStr || null,
      user: userId || null,
      userName: String(userName || "").trim(),
      userRole: String(userRole || "teacher").trim(),
      action: String(action || "GENERAL_ACTION").trim(),
      category: String(category || "general").trim(),
      title: String(title || action || "Activity").trim(),
      details: typeof details === "object" ? JSON.stringify(details) : String(details || ""),
      studentId: String(studentId || ""),
      studentName: String(studentName || ""),
      batchId: String(batchId || ""),
      batchName: String(batchName || ""),
      amount: Number(amount || 0),
      metadata: typeof metadata === "object" ? metadata : {},
      ip: String(ip || ""),
    };

    await ActivityLog.create(entry);

    // Also async log to supabase if available
    setImmediate(async () => {
      try {
        await supabase.from("activity_logs").insert({
          institute_id: instIdStr,
          user_id: userId ? String(userId) : null,
          user_name: entry.userName,
          user_role: entry.userRole,
          action: entry.action,
          category: entry.category,
          title: entry.title,
          details: entry.details,
          metadata: {
            ...entry.metadata,
            studentId,
            studentName,
            batchId,
            batchName,
            amount,
          },
          created_at: new Date().toISOString(),
        });
      } catch (_) {}
    });
  } catch (err) {
    console.error("Failed to write institute activity log:", err);
  }
};

