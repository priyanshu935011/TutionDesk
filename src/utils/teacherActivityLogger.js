import User from "../models/User.js";
import { readUserMetadata, writeUserMetadata, toValidUUID } from "./supabaseModel.js";
import { supabase } from "./supabase.js";

/**
 * Log an activity for a hired teacher or receptionist.
 * Uses atomic MongoDB operations ($push with $slice) to prevent race conditions
 * and document locking.
 * 
 * @param {string} teacherId - The user ID of the staff member
 * @param {Object} activityData - { type, title, details, batchId, batchName }
 */
export async function logTeacherActivity(teacherId, { type, title, details = "", batchId = null, batchName = null }) {
  if (!teacherId) return;
  try {
    const cleanId = String(teacherId).trim();
    const activityItem = {
      id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      type: type || "general",
      title: title || "Activity performed",
      details: details || "",
      batchId: batchId ? String(batchId) : null,
      batchName: batchName ? String(batchName) : null,
      createdAt: new Date().toISOString(),
    };

    // Atomic update to MongoDB without locking or clobbering concurrent activities
    await User.findByIdAndUpdate(cleanId, {
      $push: {
        activity: {
          $each: [activityItem],
          $position: 0,
          $slice: 200,
        },
      },
    });

    // Asynchronous non-blocking background synchronization
    setImmediate(async () => {
      try {
        const uUuid = toValidUUID(cleanId);
        await supabase
          .from("users")
          .update({ activity: [activityItem] })
          .or(`id.eq.${cleanId},id.eq.${uUuid}`);
      } catch (_) {}

      try {
        const meta = readUserMetadata();
        const existing = Array.isArray(meta[cleanId]?.activity) ? meta[cleanId].activity : [];
        meta[cleanId] = {
          ...(meta[cleanId] || {}),
          activity: [activityItem, ...existing].slice(0, 200),
        };
        writeUserMetadata(meta);
      } catch (_) {}
    });
  } catch (err) {
    console.error("logTeacherActivity error:", err.message);
  }
}
