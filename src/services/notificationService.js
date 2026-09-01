import Notification from "../models/Notification.js";

/**
 * Creates and dispatches notifications for students.
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

    // Use Supabase direct insert to ensure real-time table sync
    try {
      const { supabase: sb } = await import("../utils/supabase.js");
      const supabasePayloads = notificationDocs.map((doc) => ({
        student_id: String(doc.student),
        institute_id: doc.institute ? String(doc.institute) : null,
        title: doc.title,
        message: doc.message,
        type: doc.type,
        data: doc.data ? JSON.stringify(doc.data) : "{}",
        is_read: false,
        created_at: new Date().toISOString(),
      }));

      await sb.from("notifications").insert(supabasePayloads);
    } catch (sbErr) {
      console.error("Supabase notifications insert error:", sbErr.message);
    }

    // Also persist via Notification model for MongoDB fallback
    try {
      await Notification.insertMany(notificationDocs);
    } catch (mErr) {
      // Ignore if Supabase model handled it
    }
  } catch (err) {
    console.error("sendStudentNotification error:", err.message);
  }
};
