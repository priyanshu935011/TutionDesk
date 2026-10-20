import User from "../models/User.js";
import { readUserMetadata, writeUserMetadata, toValidUUID } from "./supabaseModel.js";
import { supabase } from "./supabase.js";

/**
 * Log an activity for a hired teacher.
 * @param {string} teacherId - The user ID of the teacher
 * @param {Object} activityData - { type, title, details, batchId, batchName }
 */
export async function logTeacherActivity(teacherId, { type, title, details = "", batchId = null, batchName = null }) {
  if (!teacherId) return;
  try {
    const cleanId = String(teacherId).trim();
    let teacher = await User.findById(cleanId);
    if (!teacher) {
      teacher = await User.findOne({ _id: cleanId });
    }
    if (!teacher || teacher.role !== "teacher") return;

    const activityItem = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: type || "general", // 'notes', 'test_marks', 'attendance', 'video', 'test_series'
      title: title || "Activity performed",
      details: details || "",
      batchId: batchId ? String(batchId) : null,
      batchName: batchName ? String(batchName) : null,
      createdAt: new Date().toISOString(),
    };

    let list = Array.isArray(teacher.activity) ? teacher.activity : [];
    list = [activityItem, ...list].slice(0, 200);
    teacher.activity = list;

    // Save via User model
    try {
      await teacher.save();
    } catch (saveErr) {
      console.warn("teacher.save() activity warning:", saveErr.message);
    }

    // Try direct update to Supabase users table
    try {
      const uUuid = toValidUUID(cleanId);
      await supabase
        .from("users")
        .update({ activity: list })
        .or(`id.eq.${cleanId},id.eq.${uUuid}`);
    } catch (_) {}

    // Fallback sync to user_metadata.json
    try {
      const meta = readUserMetadata();
      meta[cleanId] = {
        ...(meta[cleanId] || {}),
        activity: list,
      };
      if (teacher._id && String(teacher._id) !== cleanId) {
        meta[String(teacher._id)] = {
          ...(meta[String(teacher._id)] || {}),
          activity: list,
        };
      }
      writeUserMetadata(meta);
    } catch (_) {}
  } catch (err) {
    console.error("logTeacherActivity error:", err.message);
  }
}
