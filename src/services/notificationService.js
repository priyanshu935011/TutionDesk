import Notification from "../models/Notification.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import { sendFcmPushNotification } from "./fcmService.js";
import { parseFcmTokens } from "../utils/fcmTokenHelper.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Creates and dispatches push notifications & in-app notifications for students without duplication.
 * @param {Object} params
 * @param {String|Array<String>} params.studentIds - Target student ID or array of student IDs
 * @param {String} [params.instituteId] - Institute ID
 * @param {String} params.title - Notification Title
 * @param {String} params.message - Notification Message Body
 * @param {String} [params.type] - Type ('attendance', 'marks', 'video', 'notes', 'fee_paid', 'fee_reminder', 'notice', 'announcement')
 * @param {String} [params.imageUrl] - Optional banner image URL
 * @param {String} [params.actionUrl] - Deep link / screen route
 * @param {Object} [params.data] - Additional metadata payload
 */
export const sendStudentNotification = async ({
  studentIds,
  instituteId,
  title,
  message,
  type = "general",
  imageUrl = "",
  actionUrl = "",
  data = {},
}) => {
  try {
    if (!studentIds) return;
    const targets = Array.isArray(studentIds) ? studentIds : [studentIds];
    const validTargets = targets
      .map((id) => (typeof id === "object" ? String(id?._id || id?.id || "") : String(id)))
      .filter((id) => id && id !== "null" && id !== "undefined");

    if (validTargets.length === 0) return;

    const cleanTitle = String(title || "").trim();
    const cleanMessage = String(message || "").trim();
    const nowIso = new Date().toISOString();

    // 1. Save in-app notification to Supabase or MongoDB
    try {
      const { supabase: sb } = await import("../utils/supabase.js");
      const supabasePayloads = validTargets.map((stId) => ({
        student_id: String(stId),
        institute_id: instituteId ? String(instituteId) : null,
        title: cleanTitle,
        message: cleanMessage,
        type,
        data: data ? JSON.stringify(data) : "{}",
        is_read: false,
        created_at: nowIso,
      }));

      let inserted = false;
      if (sb) {
        try {
          const { error } = await sb.from("notifications").insert(supabasePayloads);
          if (!error) {
            inserted = true;
          }
        } catch (_) {}
      }

      if (!inserted) {
        const notificationDocs = validTargets.map((stId) => ({
          student: stId,
          institute: instituteId || null,
          title: cleanTitle,
          message: cleanMessage,
          type,
          data,
          isRead: false,
          createdAt: new Date(),
        }));
        await Notification.insertMany(notificationDocs).catch(() => {});
      }
    } catch (saveErr) {
      console.warn("Notification in-app save warning:", saveErr.message);
    }

    // 2. Fetch FCM Tokens for device push notification
    const tokenSet = new Set();

    // A. Query MongoDB Student model
    try {
      const validMongoIds = validTargets.filter((id) => mongoose.Types.ObjectId.isValid(id));
      const orConditions = [];
      if (validMongoIds.length > 0) {
        orConditions.push({ _id: { $in: validMongoIds } });
      }
      orConditions.push({ id: { $in: validTargets } });
      orConditions.push({ enrollmentNumber: { $in: validTargets } });

      const mongoStudents = await Student.find({ $or: orConditions })
        .select("fcmToken fcmTokens")
        .lean();

      for (const st of mongoStudents) {
        parseFcmTokens(st.fcmTokens).forEach((t) => tokenSet.add(t));
        parseFcmTokens(st.fcmToken).forEach((t) => tokenSet.add(t));
      }
    } catch (mErr) {
      console.warn("MongoDB student FCM token fetch warning:", mErr.message);
    }

    // B. Query Supabase students table
    try {
      const { supabase: sb } = await import("../utils/supabase.js");
      if (sb) {
        const validUuids = validTargets.filter((id) => UUID_REGEX.test(id));
        if (validUuids.length > 0) {
          const { data: sbRows } = await sb
            .from("students")
            .select("fcm_token")
            .in("id", validUuids);
          if (Array.isArray(sbRows)) {
            for (const r of sbRows) {
              parseFcmTokens(r.fcm_token).forEach((t) => tokenSet.add(t));
            }
          }
        }
        const nonUuids = validTargets.filter((id) => !UUID_REGEX.test(id) && typeof id === "string" && id.length > 2);
        if (nonUuids.length > 0) {
          const { data: sbByEnr } = await sb
            .from("students")
            .select("fcm_token")
            .in("enrollment_number", nonUuids);
          if (Array.isArray(sbByEnr)) {
            for (const r of sbByEnr) {
              parseFcmTokens(r.fcm_token).forEach((t) => tokenSet.add(t));
            }
          }
        }
      }
    } catch (_) {}

    const allTokens = Array.from(tokenSet);
    if (allTokens.length > 0) {
      await sendFcmPushNotification({
        fcmTokens: allTokens,
        title: cleanTitle,
        body: cleanMessage,
        imageUrl: imageUrl ? String(imageUrl).trim() : "",
        actionUrl: actionUrl ? String(actionUrl).trim() : "",
        data: {
          type,
          instituteId: instituteId ? String(instituteId) : "",
          ...data,
        },
        priority: "high",
      });
    }
  } catch (err) {
    console.error("sendStudentNotification error:", err.message);
  }
};

/**
 * Creates and dispatches push notifications for staff/teachers/admins.
 */
export const sendUserNotification = async ({
  userIds,
  title,
  message,
  type = "general",
  imageUrl = "",
  actionUrl = "",
  data = {},
}) => {
  try {
    if (!userIds) return;
    const targets = Array.isArray(userIds) ? userIds : [userIds];
    const validTargets = targets
      .map((id) => (typeof id === "object" ? String(id?._id || id?.id || "") : String(id)))
      .filter((id) => id && id !== "null" && id !== "undefined");

    if (validTargets.length === 0) return;

    const cleanTitle = String(title || "").trim();
    const cleanMessage = String(message || "").trim();
    const tokenSet = new Set();

    // Query MongoDB User model
    try {
      const validMongoIds = validTargets.filter((id) => mongoose.Types.ObjectId.isValid(id));
      const orConditions = [];
      if (validMongoIds.length > 0) {
        orConditions.push({ _id: { $in: validMongoIds } });
      }
      orConditions.push({ id: { $in: validTargets } });
      orConditions.push({ email: { $in: validTargets } });

      const mongoUsers = await User.find({ $or: orConditions })
        .select("fcmToken fcmTokens")
        .lean();

      for (const u of mongoUsers) {
        parseFcmTokens(u.fcmTokens).forEach((t) => tokenSet.add(t));
        parseFcmTokens(u.fcmToken).forEach((t) => tokenSet.add(t));
      }
    } catch (uErr) {
      console.warn("MongoDB user FCM token fetch warning:", uErr.message);
    }

    // Query Supabase users table
    try {
      const { supabase: sb } = await import("../utils/supabase.js");
      if (sb) {
        const validUuids = validTargets.filter((id) => UUID_REGEX.test(id));
        if (validUuids.length > 0) {
          const { data: sbRows } = await sb
            .from("users")
            .select("fcm_token")
            .in("id", validUuids);
          if (Array.isArray(sbRows)) {
            for (const r of sbRows) {
              parseFcmTokens(r.fcm_token).forEach((t) => tokenSet.add(t));
            }
          }
        }
      }
    } catch (_) {}

    const allTokens = Array.from(tokenSet);
    if (allTokens.length > 0) {
      await sendFcmPushNotification({
        fcmTokens: allTokens,
        title: cleanTitle,
        body: cleanMessage,
        imageUrl: imageUrl ? String(imageUrl).trim() : "",
        actionUrl: actionUrl ? String(actionUrl).trim() : "",
        data: {
          type,
          ...data,
        },
        priority: "high",
      });
    }
  } catch (err) {
    console.error("sendUserNotification error:", err.message);
  }
};
