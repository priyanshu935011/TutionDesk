import Batch from "../models/Batch.js";
import User from "../models/User.js";
import Institute from "../models/Institute.js";
import { supabase, readUserMetadata } from "../utils/supabaseModel.js";
import { sendUserNotification } from "./notificationService.js";

// In-memory set to prevent duplicate reminders on the same calendar day
// Key format: `${batchId}:${todayIST}`
const sentRemindersCache = new Set();
let lastCleanedDate = "";

/**
 * Parses time strings like "4:00 PM", "04:30 pm", "16:00", "06:30" to minutes from midnight
 */
export const parseTimeToMinutes = (timeStr) => {
  if (!timeStr || typeof timeStr !== "string") return null;
  const clean = timeStr.trim();
  if (!clean) return null;

  // 12-hour format with AM/PM (e.g. "4:00 PM", "04:30 pm", "11:15 AM")
  const ampmMatch = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)$/i);
  if (ampmMatch) {
    let hours = parseInt(ampmMatch[1], 10);
    const minutes = parseInt(ampmMatch[2], 10);
    const period = ampmMatch[3].toUpperCase();
    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;
    return hours * 60 + minutes;
  }

  // 24-hour format or un-suffixed format (e.g. "16:00", "04:00", "05:30")
  const h24Match = clean.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (h24Match) {
    let hours = parseInt(h24Match[1], 10);
    const minutes = parseInt(h24Match[2], 10);
    // Tuition classes between 1:00 and 6:59 without AM/PM are afternoon/evening classes (PM)
    if (hours >= 1 && hours <= 6) {
      hours += 12;
    }
    return hours * 60 + minutes;
  }

  return null;
};

/**
 * Returns current date, minutes from midnight, and day name in Indian Standard Time (IST)
 */
export const getISTDetails = () => {
  const now = new Date();
  const istString = now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" });
  const istDate = new Date(istString);

  const year = istDate.getFullYear();
  const month = String(istDate.getMonth() + 1).padStart(2, "0");
  const date = String(istDate.getDate()).padStart(2, "0");
  const todayIST = `${year}-${month}-${date}`;

  const hours = istDate.getHours();
  const minutes = istDate.getMinutes();
  const currentMinutes = hours * 60 + minutes;

  const dayNamesShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dayNamesLong = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const dayShort = dayNamesShort[istDate.getDay()];
  const dayLong = dayNamesLong[istDate.getDay()];

  return { todayIST, currentMinutes, dayShort, dayLong };
};

/**
 * Checks if a batch is scheduled to run on the given IST day of the week
 */
export const isBatchScheduledToday = (batch, dayShort, dayLong) => {
  const rawDays = batch.scheduleDays || batch.schedule_days;
  if (!rawDays || !Array.isArray(rawDays) || rawDays.length === 0) {
    // If no scheduleDays specified, assume it runs every active day
    return true;
  }
  return rawDays.some((d) => {
    const dStr = String(d || "").trim().toLowerCase();
    return dStr === dayShort.toLowerCase() || dStr === dayLong.toLowerCase();
  });
};

/**
 * Checks whether attendance has already been recorded for this batch on today's date
 */
export const isAttendanceMarkedForToday = async (batchId, todayIST) => {
  try {
    if (supabase) {
      // 1. Check aggregated batch attendance records
      const { data: bRec } = await supabase
        .from("batch_attendance_records")
        .select("id, attendance_map")
        .eq("batch_id", String(batchId))
        .eq("date", todayIST)
        .maybeSingle();

      if (bRec && bRec.attendance_map && Object.keys(bRec.attendance_map).length > 0) {
        return true;
      }

      // 2. Check individual attendance records
      const { data: attRows } = await supabase
        .from("attendance")
        .select("id")
        .eq("batch_id", String(batchId))
        .eq("date", todayIST)
        .limit(1);

      if (attRows && attRows.length > 0) {
        return true;
      }
    }
  } catch (err) {
    console.warn("[AttendanceReminder] Error querying attendance status:", err.message);
  }
  return false;
};

/**
 * Resolves all recipient user IDs for a batch:
 * - All teachers to whom the batch is assigned (via batch.teacher or teacher.assignedBatches)
 * - The institute admin user
 */
export const resolveBatchRecipients = async (batch, allTeachers, userMeta) => {
  const recipientIds = new Set();
  const bIdStr = String(batch._id || batch.id);

  // 1. Primary teacher on the batch
  if (batch.teacher) {
    const tId = String(batch.teacher._id || batch.teacher.id || batch.teacher);
    if (tId && tId !== "null" && tId !== "undefined") {
      recipientIds.add(tId);
    }
  }

  // 2. All teachers with this batch in assignedBatches
  for (const t of allTeachers) {
    const tId = String(t._id || t.id);
    const meta = userMeta[tId] || {};
    const assigned = Array.isArray(t.assignedBatches) && t.assignedBatches.length > 0
      ? t.assignedBatches
      : (Array.isArray(meta.assignedBatches) ? meta.assignedBatches : []);

    if (assigned.some((b) => String(b._id || b.id || b) === bIdStr)) {
      recipientIds.add(tId);
    }
  }

  // 3. Institute Admin
  const instOwnerId = batch.user ? String(batch.user._id || batch.user.id || batch.user) : null;
  if (instOwnerId) {
    recipientIds.add(instOwnerId);
  }

  // Also check if batch.user points to an Institute doc with adminUser
  try {
    if (instOwnerId) {
      const instDoc = await Institute.findById(instOwnerId).select("adminUser");
      if (instDoc && instDoc.adminUser) {
        recipientIds.add(String(instDoc.adminUser));
      }
    }
  } catch (_) {}

  return Array.from(recipientIds).filter(Boolean);
};

/**
 * Main engine: Scans all active batches, finds any in-progress class at or past midpoint
 * with unrecorded attendance, and dispatches push notifications to teachers and institute admin.
 */
export const checkPendingBatchAttendanceReminders = async () => {
  try {
    const { todayIST, currentMinutes, dayShort, dayLong } = getISTDetails();

    // Auto-clean stale cache entries from previous days
    if (lastCleanedDate !== todayIST) {
      sentRemindersCache.clear();
      lastCleanedDate = todayIST;
    }

    // 1. Fetch active batches
    const batches = await Batch.find({ status: { $ne: "archived" } })
      .select("_id id name scheduleDays startTime endTime teacher user lastAttendanceReminderDate");

    if (!batches || batches.length === 0) {
      return { totalBatches: 0, remindersSent: 0 };
    }

    // 2. Pre-fetch teachers and metadata once
    const teachers = await User.find({ role: "teacher" })
      .select("_id id name email phone assignedBatches institute");
    const userMeta = readUserMetadata();

    let remindersSentCount = 0;

    for (const batch of batches) {
      const bId = String(batch._id || batch.id);
      const reminderKey = `${bId}:${todayIST}`;

      // Skip if already sent today (check in-memory cache OR DB field)
      if (
        sentRemindersCache.has(reminderKey) ||
        batch.lastAttendanceReminderDate === todayIST ||
        batch.last_attendance_reminder_date === todayIST
      ) {
        sentRemindersCache.add(reminderKey);
        continue;
      }

      // Skip if not scheduled for today
      if (!isBatchScheduledToday(batch, dayShort, dayLong)) {
        continue;
      }

      const startMinutes = parseTimeToMinutes(batch.startTime);
      const endMinutes = parseTimeToMinutes(batch.endTime);

      // Skip invalid or unconfigured times
      if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes) {
        continue;
      }

      const duration = endMinutes - startMinutes;
      if (duration < 15) {
        continue;
      }

      // Calculate class midpoint: e.g. 4:00 PM (960m) - 5:00 PM (1020m) -> midpoint = 4:30 PM (990m)
      const midpointMinutes = startMinutes + Math.floor(duration / 2);

      // Never send reminder once class has concluded for the day
      if (currentMinutes >= endMinutes) {
        sentRemindersCache.add(reminderKey);
        continue;
      }

      // Trigger condition: Current IST time is strictly between class midpoint and before class ends (in the middle of class)
      const isMidClassOngoing = currentMinutes >= midpointMinutes && currentMinutes < endMinutes;

      if (!isMidClassOngoing) {
        continue;
      }

      // Check if attendance was already recorded today
      const alreadyMarked = await isAttendanceMarkedForToday(bId, todayIST);
      if (alreadyMarked) {
        // Attendance was taken, so no reminder needed; mark as processed
        sentRemindersCache.add(reminderKey);
        continue;
      }

      // Resolve teachers assigned and institute admin
      const recipientIds = await resolveBatchRecipients(batch, teachers, userMeta);
      if (recipientIds.length === 0) {
        continue;
      }

      const timingLabel = `${batch.startTime || ""} - ${batch.endTime || ""}`.trim();

      // Mark as sent immediately in memory and DB to prevent duplicate sends across workers/restarts
      sentRemindersCache.add(reminderKey);
      await Batch.updateOne(
        { _id: batch._id || batch.id },
        { $set: { lastAttendanceReminderDate: todayIST } }
      ).catch(() => {});
      if (supabase) {
        try {
          await supabase
            .from("batches")
            .update({ last_attendance_reminder_date: todayIST })
            .eq("id", bId);
        } catch (_) {}
      }

      // Dispatch push notification to all assigned teachers AND the institute
      await sendUserNotification({
        userIds: recipientIds,
        title: `📋 Attendance Reminder: ${batch.name}`,
        message: `Attendance for ${batch.name} (${timingLabel}) has not been marked yet. Please take attendance now.`,
        type: "attendance_reminder",
        actionUrl: `/attendance?batchId=${bId}`,
        tag: `att_rem_${bId}`,
        data: {
          type: "attendance_reminder",
          batchId: bId,
          batchName: batch.name,
          timing: timingLabel,
          tag: `att_rem_${bId}`,
        },
      });

      remindersSentCount++;
      console.log(`[AttendanceReminder] Sent mid-class attendance reminder for "${batch.name}" to ${recipientIds.length} recipient(s).`);
    }

    return { totalBatches: batches.length, remindersSent: remindersSentCount };
  } catch (error) {
    console.error("[AttendanceReminder] checkPendingBatchAttendanceReminders error:", error);
    return { error: error.message };
  }
};

let schedulerInterval = null;

/**
 * Starts periodic background checker (runs every 3 minutes)
 */
export const startAttendanceReminderScheduler = () => {
  if (schedulerInterval) return;

  console.log("[AttendanceReminder] Background attendance reminder scheduler started (interval: 3 mins).");
  // Run initial check after 15 seconds
  setTimeout(() => {
    checkPendingBatchAttendanceReminders().catch(() => {});
  }, 15000);

  // Recurring check every 3 minutes
  schedulerInterval = setInterval(() => {
    checkPendingBatchAttendanceReminders().catch(() => {});
  }, 3 * 60 * 1000);
};

export const stopAttendanceReminderScheduler = () => {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
};
