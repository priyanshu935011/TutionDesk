import mongoose from "mongoose";
import PushNotificationLog from "../models/PushNotificationLog.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import Institute from "../models/Institute.js";
import Notification from "../models/Notification.js";
import {
  sendFcmPushNotification,
  testFcmCredentials,
  getFcmSettingsHelper,
} from "../services/fcmService.js";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Broadcast Push Notification from Super Admin Studio
 */
export const sendBroadcastNotification = async (req, res) => {
  try {
    const {
      title,
      body,
      imageUrl = "",
      actionUrl = "",
      templateType = "custom",
      targetAudience = "all",
      filters = {},
      data = {},
      priority = "high",
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Notification title is required" });
    }
    if (!body || !body.trim()) {
      return res.status(400).json({ message: "Notification body is required" });
    }

    const cleanTitle = title.trim();
    const cleanBody = body.trim();
    const cleanImage = imageUrl ? String(imageUrl).trim() : "";
    const cleanAction = actionUrl ? String(actionUrl).trim() : "";

    const tokenSet = new Set();
    const inAppStudentIds = new Set();
    const inAppUserIds = new Set();

    const {
      instituteIds = [],
      studentIds = [],
      criteria = {},
    } = filters;

    // Helper to extract tokens from a list of docs
    const collectFromDocs = (docs) => {
      for (const doc of docs) {
        if (doc.fcmToken && String(doc.fcmToken).trim().length > 10) {
          tokenSet.add(String(doc.fcmToken).trim());
        }
        if (Array.isArray(doc.fcmTokens)) {
          doc.fcmTokens.forEach((t) => {
            if (t && String(t).trim().length > 10) tokenSet.add(String(t).trim());
          });
        }
      }
    };

    // 1. Resolve Student Recipients
    const shouldIncludeStudents =
      targetAudience === "all" ||
      targetAudience === "students" ||
      targetAudience === "specific_students" ||
      (targetAudience === "specific_institutes" && instituteIds.length > 0) ||
      targetAudience === "criteria";

    if (shouldIncludeStudents) {
      const studentQuery = {};

      if (targetAudience === "specific_students" && studentIds.length > 0) {
        const validIds = studentIds.filter((id) => mongoose.Types.ObjectId.isValid(id) || UUID_REGEX.test(id));
        studentQuery.$or = [
          { _id: { $in: validIds } },
          { id: { $in: studentIds } },
          { enrollmentNumber: { $in: studentIds } },
        ];
      } else if (targetAudience === "specific_institutes" && instituteIds.length > 0) {
        studentQuery.institute = { $in: instituteIds };
      } else if (targetAudience === "criteria") {
        if (criteria.hasPendingFees === true) {
          studentQuery.pendingAmount = { $gt: Number(criteria.minFeeAmount || 0) };
        }
        if (criteria.instituteId) {
          studentQuery.institute = criteria.instituteId;
        }
        if (criteria.batchId) {
          studentQuery.$or = [{ batch: criteria.batchId }, { batches: criteria.batchId }];
        }
      }

      try {
        const targetStudents = await Student.find(studentQuery)
          .select("_id fcmToken fcmTokens institute")
          .lean();

        collectFromDocs(targetStudents);
        targetStudents.forEach((s) => inAppStudentIds.add(String(s._id)));
      } catch (stErr) {
        console.warn("Error resolving students for push broadcast:", stErr.message);
      }

      // Supabase fallback query if token set still empty or small
      try {
        const { supabase: sb } = await import("../utils/supabase.js");
        if (sb) {
          const { data: sbStudents } = await sb
            .from("students")
            .select("id, fcm_token")
            .not("fcm_token", "is", null);
          if (Array.isArray(sbStudents)) {
            sbStudents.forEach((r) => {
              if (r.fcm_token && String(r.fcm_token).trim().length > 10) {
                tokenSet.add(String(r.fcm_token).trim());
              }
            });
          }
        }
      } catch (_) {}
    }

    // 2. Resolve Teachers / Institutes Recipients
    const shouldIncludeUsers =
      targetAudience === "all" ||
      targetAudience === "teachers" ||
      targetAudience === "institutes" ||
      (targetAudience === "specific_institutes" && instituteIds.length > 0);

    if (shouldIncludeUsers) {
      const userQuery = {};

      if (targetAudience === "teachers") {
        userQuery.role = "teacher";
      } else if (targetAudience === "institutes") {
        userQuery.role = "institute_admin";
      } else if (targetAudience === "all") {
        userQuery.role = { $in: ["teacher", "institute_admin"] };
      }

      if (instituteIds.length > 0) {
        userQuery.$or = [{ institute: { $in: instituteIds } }, { _id: { $in: instituteIds } }];
      }

      try {
        const targetUsers = await User.find(userQuery)
          .select("_id fcmToken fcmTokens role")
          .lean();

        collectFromDocs(targetUsers);
        targetUsers.forEach((u) => inAppUserIds.add(String(u._id)));
      } catch (uErr) {
        console.warn("Error resolving users for push broadcast:", uErr.message);
      }

      // Supabase users fallback
      try {
        const { supabase: sb } = await import("../utils/supabase.js");
        if (sb) {
          const { data: sbUsers } = await sb
            .from("users")
            .select("id, fcm_token")
            .not("fcm_token", "is", null);
          if (Array.isArray(sbUsers)) {
            sbUsers.forEach((r) => {
              if (r.fcm_token && String(r.fcm_token).trim().length > 10) {
                tokenSet.add(String(r.fcm_token).trim());
              }
            });
          }
        }
      } catch (_) {}
    }

    const uniqueTokens = Array.from(tokenSet);

    // 3. Dispatch FCM Push Notifications
    let dispatchResult = { targetCount: uniqueTokens.length, successCount: 0, failureCount: 0 };
    if (uniqueTokens.length > 0) {
      dispatchResult = await sendFcmPushNotification({
        fcmTokens: uniqueTokens,
        title: cleanTitle,
        body: cleanBody,
        imageUrl: cleanImage,
        actionUrl: cleanAction,
        priority,
        data: {
          templateType,
          targetAudience,
          ...data,
        },
      });
    }

    // 4. Save In-App Notifications for target students
    if (inAppStudentIds.size > 0) {
      setImmediate(async () => {
        try {
          const studentIdsList = Array.from(inAppStudentIds);
          const notificationDocs = studentIdsList.slice(0, 1000).map((sId) => ({
            student: sId,
            title: cleanTitle,
            message: cleanBody,
            type: templateType === "announcement" ? "announcement" : "general",
            data: { imageUrl: cleanImage, actionUrl: cleanAction, ...data },
            isRead: false,
            createdAt: new Date(),
          }));
          await Notification.insertMany(notificationDocs, { ordered: false }).catch(() => {});
        } catch (_) {}
      });
    }

    // 5. Record Log Entry
    const isSuccess = dispatchResult.successCount > 0;
    const isPartial = isSuccess && dispatchResult.failureCount > 0;
    const finalStatus = isPartial ? "partial" : isSuccess ? "sent" : dispatchResult.targetCount === 0 ? "sent" : "failed";

    const logEntry = await PushNotificationLog.create({
      title: cleanTitle,
      body: cleanBody,
      imageUrl: cleanImage,
      actionUrl: cleanAction,
      templateType,
      targetAudience,
      filters,
      data,
      priority,
      targetCount: dispatchResult.targetCount,
      successCount: dispatchResult.successCount,
      failureCount: dispatchResult.failureCount,
      status: finalStatus,
      sentBy: req.user?._id || null,
      sentByName: req.user?.name || "Super Admin",
    });

    return res.status(200).json({
      success: true,
      message:
        dispatchResult.targetCount === 0
          ? "Broadcast registered, but no registered device tokens found for target audience."
          : `Broadcast dispatched to ${dispatchResult.successCount} of ${dispatchResult.targetCount} devices successfully!`,
      stats: dispatchResult,
      log: logEntry,
    });
  } catch (error) {
    console.error("sendBroadcastNotification error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to broadcast push notification",
    });
  }
};

/**
 * Fetch Sent Push Notification History (Paginated)
 */
export const getPushNotificationHistory = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 15));
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      PushNotificationLog.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      PushNotificationLog.countDocuments(),
    ]);

    return res.json({
      success: true,
      logs,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    console.error("getPushNotificationHistory error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch push history" });
  }
};

/**
 * Get Device Stats & FCM Credentials Health
 */
export const getPushNotificationStats = async (req, res) => {
  try {
    const [
      studentTokensCount,
      userTokensCount,
      totalBroadcasts,
      aggregateStats,
      fcmConfig,
    ] = await Promise.all([
      Student.countDocuments({
        $or: [
          { fcmToken: { $exists: true, $ne: null, $ne: "" } },
          { "fcmTokens.0": { $exists: true } },
        ],
      }),
      User.countDocuments({
        $or: [
          { fcmToken: { $exists: true, $ne: null, $ne: "" } },
          { "fcmTokens.0": { $exists: true } },
        ],
      }),
      PushNotificationLog.countDocuments(),
      PushNotificationLog.aggregate([
        {
          $group: {
            _id: null,
            totalSuccess: { $sum: "$successCount" },
            totalFailed: { $sum: "$failureCount" },
            totalTargets: { $sum: "$targetCount" },
          },
        },
      ]),
      getFcmSettingsHelper(),
    ]);

    const aggregates = aggregateStats[0] || {
      totalSuccess: 0,
      totalFailed: 0,
      totalTargets: 0,
    };

    const hasV1Credentials = Boolean(
      fcmConfig.projectId && fcmConfig.clientEmail && fcmConfig.privateKey
    );
    const hasLegacyKey = Boolean(fcmConfig.serverKey);

    return res.json({
      success: true,
      stats: {
        registeredStudents: studentTokensCount,
        registeredUsers: userTokensCount,
        totalRegisteredDevices: studentTokensCount + userTokensCount,
        totalBroadcasts,
        totalDelivered: aggregates.totalSuccess,
        totalFailed: aggregates.totalFailed,
      },
      fcmConfig: {
        enabled: fcmConfig.enabled,
        hasV1Credentials,
        hasLegacyKey,
        projectId: fcmConfig.projectId || "",
        clientEmail: fcmConfig.clientEmail || "",
        configured: (hasV1Credentials || hasLegacyKey) && fcmConfig.enabled,
        mode: hasV1Credentials ? "HTTP v1 (OAuth2 Service Account)" : hasLegacyKey ? "Legacy Server Key" : "Not Configured",
      },
    });
  } catch (error) {
    console.error("getPushNotificationStats error:", error);
    return res.status(500).json({ success: false, message: "Could not fetch stats" });
  }
};

/**
 * 1-Click Verification Test for FCM
 */
export const testPushNotification = async (req, res) => {
  try {
    const { testToken, overrideConfig } = req.body;

    if (testToken && String(testToken).trim().length > 10) {
      const result = await sendFcmPushNotification({
        fcmTokens: [String(testToken).trim()],
        title: "🔔 Test Push Notification",
        body: "Hello! Firebase Cloud Messaging push notification test was successful.",
        data: { test: "true", timestamp: String(Date.now()) },
      });
      return res.json({
        success: result.successCount > 0,
        result,
        message:
          result.successCount > 0
            ? "Test notification delivered to your test device successfully!"
            : `Delivery failed: ${result.errors?.join(", ") || "Device token unreachable"}`,
      });
    }

    const testResult = await testFcmCredentials(overrideConfig);
    return res.json(testResult);
  } catch (error) {
    console.error("testPushNotification error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Register FCM Token for logged-in User (Teacher, Admin, Institute)
 */
export const registerUserFcmToken = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const { fcmToken } = req.body;
    if (!fcmToken || !String(fcmToken).trim()) {
      return res.status(400).json({ message: "fcmToken is required" });
    }

    const cleanToken = String(fcmToken).trim();

    // 1. Update Mongo User
    await User.findByIdAndUpdate(userId, {
      fcmToken: cleanToken,
      $addToSet: { fcmTokens: cleanToken },
    });

    // 2. Sync to Supabase users table if available
    try {
      const { supabase: sb } = await import("../utils/supabase.js");
      if (sb) {
        await sb
          .from("users")
          .update({ fcm_token: cleanToken })
          .eq("id", String(userId));
      }
    } catch (_) {}

    return res.json({ success: true, message: "User FCM token registered successfully!" });
  } catch (error) {
    console.error("registerUserFcmToken error:", error);
    return res.status(500).json({ success: false, message: "Failed to register user FCM token" });
  }
};
