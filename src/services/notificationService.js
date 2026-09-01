import Notification from "../models/Notification.js";

/**
 * Creates and dispatches notifications for students without duplication.
 * @param {Object} params
 * @param {String|Array<String>} params.studentIds - Target student ID or array of student IDs
 * @param {String} [params.instituteId] - Institute ID
 * @param {String} params.title - Notification Title
 * @param {String} params.message - Notification Message Body
 * @param {String} [params.type] - Type ('attendance', 'marks', 'video', 'notes', 'fee_paid', 'fee_reminder', 'notice')
 * @param {Object} [params.data] - Additional metadata payload
 */
export const sendStudentNotification = async ({
  studentIds,
  instituteId,
  title,
  message,
  type = "general",
  data = {},
}) => {
  try {
    if (!studentIds) return;
    const targets = Array.isArray(studentIds) ? studentIds : [studentIds];
    const validTargets = targets.map((id) => String(id)).filter((id) => id && id !== "null" && id !== "undefined");

    if (validTargets.length === 0) return;

    const nowIso = new Date().toISOString();
    const { supabase: sb } = await import("../utils/supabase.js");

    const supabasePayloads = validTargets.map((stId) => ({
      student_id: String(stId),
      institute_id: instituteId ? String(instituteId) : null,
      title: title.trim(),
      message: message.trim(),
      type,
      data: data ? JSON.stringify(data) : "{}",
      is_read: false,
      created_at: nowIso,
    }));

    // Primary: Insert into Supabase notifications table directly
    let inserted = false;
    try {
      const { error } = await sb.from("notifications").insert(supabasePayloads);
      if (!error) {
        inserted = true;
      }
    } catch (sbErr) {
      console.error("Supabase notifications insert error:", sbErr.message);
    }

    // Fallback: If Supabase direct insert failed, save to MongoDB model
    if (!inserted) {
      try {
        const notificationDocs = validTargets.map((stId) => ({
          student: stId,
          institute: instituteId || null,
          title: title.trim(),
          message: message.trim(),
          type,
          data,
          isRead: false,
          createdAt: new Date(),
        }));
        await Notification.insertMany(notificationDocs);
      } catch (mErr) {
        console.error("Mongo notifications fallback error:", mErr.message);
      }
    }

    // Fetch FCM Tokens for target students & send Push Notification to device status bar
    try {
      const Student = (await import("../models/Student.js")).default;
      const { sendFcmPushNotification } = await import("./fcmService.js");

      let fcmTokens = [];
      try {
        const { data: stRows } = await sb
          .from("students")
          .select("fcm_token")
          .in("id", validTargets);
        if (stRows && stRows.length > 0) {
          fcmTokens = stRows.map((r) => r.fcm_token).filter(Boolean);
        }
      } catch (_) {}

      if (fcmTokens.length === 0) {
        const mongoStudents = await Student.find({ _id: { $in: validTargets } }).select("fcmToken");
        fcmTokens = mongoStudents.map((s) => s.fcmToken).filter(Boolean);
      }

      if (fcmTokens.length > 0) {
        await sendFcmPushNotification({
          fcmTokens,
          title: title.trim(),
          body: message.trim(),
          data: { type, ...data },
        });
      }
    } catch (fcmErr) {
      console.error("FCM dispatch error in notificationService:", fcmErr.message);
    }
  } catch (err) {
    console.error("sendStudentNotification error:", err.message);
  }
};
