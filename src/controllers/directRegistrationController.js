import crypto from "crypto";
import bcrypt from "bcryptjs";
import DirectRegistration from "../models/DirectRegistration.js";
import User from "../models/User.js";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Note from "../models/Note.js";
import Notice from "../models/Notice.js";
import SystemSetting from "../models/SystemSetting.js";
import { sendSMSOTP } from "../utils/smsHelper.js";
import { sendMessage } from "../services/whatsappService.js";
import redisClient from "../config/redis.js";
import { clearCachePattern } from "../utils/cache.js";
import {
  supabase,
  readFallbackData,
  writeFallbackData,
  readInstitutesMetadata,
  writeInstitutesMetadata,
} from "../utils/supabaseModel.js";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "classtech_default_jwt_secret_key_2026";

// In-memory OTP store & rate limiting fallback
const memoryOtpStore = new Map(); // phone -> { otp, attempts, ip, createdAt }
const ipOtpTracker = new Map(); // ip -> [timestamps]
const phoneCooldownTracker = new Map(); // phone -> timestamp

const getClientIp = (req) => {
  const xForwardedFor = req.headers["x-forwarded-for"];
  if (xForwardedFor) {
    return xForwardedFor.split(",")[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || "127.0.0.1";
};

// Check and record IP rate limit (max 3 OTP requests per 10 minutes)
const checkIpRateLimit = async (ip) => {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 minutes
  const maxAttempts = 3;

  if (redisClient && redisClient.isReady) {
    const key = `reg_otp_ip:${ip}`;
    try {
      const current = await redisClient.incr(key);
      if (current === 1) {
        await redisClient.expire(key, 600); // 10 minutes
      }
      if (current > maxAttempts) {
        return false;
      }
      return true;
    } catch (_) {}
  }

  // In-memory fallback
  const timestamps = (ipOtpTracker.get(ip) || []).filter((t) => now - t < windowMs);
  if (timestamps.length >= maxAttempts) {
    return false;
  }
  timestamps.push(now);
  ipOtpTracker.set(ip, timestamps);
  return true;
};

// Helper to fetch global trial defaults
export const getGlobalTrialDefaults = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "direct_registration_defaults" });
    if (setting && setting.value) {
      let val = setting.value;
      if (typeof val === "string") {
        try {
          val = JSON.parse(val);
        } catch (_) {}
      }
      return {
        trialDays: Number(val.trialDays || 7),
        wpBalance: Number(val.wpBalance ?? 10.0),
        aiBalance: Number(val.aiBalance ?? 50.0),
        aiEnabled: val.aiEnabled !== undefined ? Boolean(val.aiEnabled) : true,
        aiStudentEnabled: val.aiStudentEnabled !== undefined ? Boolean(val.aiStudentEnabled) : false,
        recordedLecturesFeatureEnabled: val.recordedLecturesFeatureEnabled !== undefined ? Boolean(val.recordedLecturesFeatureEnabled) : true,
        releaseVideosFeatureEnabled: val.releaseVideosFeatureEnabled !== undefined ? Boolean(val.releaseVideosFeatureEnabled) : true,
        quizFeatureEnabled: val.quizFeatureEnabled !== undefined ? Boolean(val.quizFeatureEnabled) : true,
        testSeriesFeatureEnabled: val.testSeriesFeatureEnabled !== undefined ? Boolean(val.testSeriesFeatureEnabled) : true,
        brandingEnabled: val.brandingEnabled !== undefined ? Boolean(val.brandingEnabled) : true,
        maxVideoStorageGb: Number(val.maxVideoStorageGb ?? 5),
        features: Array.isArray(val.features) && val.features.length > 0
          ? val.features
          : [
              "attendance",
              "notes",
              "marks",
              "tests",
              "notices",
              "whatsapp",
              "finances",
              "homework",
              "quizzes",
              "leads",
              "recorded_lectures",
              "release_videos",
              "test_series",
            ],
      };
    }
  } catch (_) {}

  return {
    trialDays: 7,
    wpBalance: 10.0,
    aiBalance: 50.0,
    aiEnabled: true,
    aiStudentEnabled: false,
    recordedLecturesFeatureEnabled: true,
    releaseVideosFeatureEnabled: true,
    quizFeatureEnabled: true,
    testSeriesFeatureEnabled: true,
    brandingEnabled: true,
    maxVideoStorageGb: 5,
    features: [
      "attendance",
      "notes",
      "marks",
      "tests",
      "notices",
      "whatsapp",
      "finances",
      "homework",
      "quizzes",
      "leads",
      "recorded_lectures",
      "release_videos",
      "test_series",
    ],
  };
};

/**
 * Send OTP via Hanu OTP API with IP & phone rate limiting
 */
export const sendRegistrationOtp = async (req, res) => {
  try {
    const { phone } = req.body;
    const cleanPhone = (phone || "").toString().replace(/\D/g, "").slice(-10);

    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 10-digit mobile number.",
      });
    }

    // Check if an account already exists for this phone number
    const existingUser = await User.findOne({ phone: cleanPhone });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        isExistingUser: true,
        message: "An account with this mobile number already exists. Please log in directly.",
      });
    }

    const existingInst = await Institute.findOne({ adminPhone: cleanPhone });
    if (existingInst && existingInst.adminUser) {
      const adminUser = await User.findById(existingInst.adminUser).catch(() => null);
      if (adminUser) {
        return res.status(400).json({
          success: false,
          isExistingUser: true,
          message: "An academy is already registered with this mobile number. Please log in directly.",
        });
      }
    }

    const existingTrial = await DirectRegistration.findOne({ phone: cleanPhone });
    if (existingTrial) {
      return res.status(400).json({
        success: false,
        isExistingUser: true,
        message: "An account has already been registered with this mobile number. Please log in directly.",
      });
    }

    const clientIp = getClientIp(req);

    // 1. IP-based rate limiting (Max 3 OTP requests per 10 mins)
    const isAllowed = await checkIpRateLimit(clientIp);
    if (!isAllowed) {
      return res.status(429).json({
        success: false,
        message:
          "Too many OTP requests from this network. Please wait 10 minutes before trying again.",
        rateLimited: true,
      });
    }

    // 2. Cooldown check per phone number (60 seconds)
    const lastSent = phoneCooldownTracker.get(cleanPhone) || 0;
    const timeSinceLast = Date.now() - lastSent;
    if (timeSinceLast < 60000) {
      const waitSec = Math.ceil((60000 - timeSinceLast) / 1000);
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSec} seconds before requesting a new verification code.`,
        cooldownSeconds: waitSec,
      });
    }

    // 3. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // 4. Store OTP in Redis and/or memory (5 minutes expiry)
    const otpPayload = {
      otp,
      ip: clientIp,
      attempts: 0,
      createdAt: Date.now(),
    };

    if (redisClient && redisClient.isReady) {
      try {
        await redisClient.set(`reg_otp:${cleanPhone}`, JSON.stringify(otpPayload), {
          EX: 300, // 5 minutes
        });
      } catch (_) {}
    }
    memoryOtpStore.set(cleanPhone, otpPayload);
    phoneCooldownTracker.set(cleanPhone, Date.now());

    // 5. Dispatch SMS OTP via TextBee SMS Gateway
    try {
      await sendSMSOTP(cleanPhone, otp);
      console.log(`[DirectRegistration] TextBee SMS OTP sent successfully to ${cleanPhone}`);
    } catch (smsErr) {
      console.error("[DirectRegistration] Failed to send TextBee SMS OTP:", smsErr.message);
      return res.status(500).json({
        success: false,
        message: smsErr.message || "Could not deliver verification SMS. Please check the number.",
      });
    }

    return res.json({
      success: true,
      message: "Verification code sent successfully via SMS.",
      phone: cleanPhone,
      expiresIn: 300,
    });
  } catch (error) {
    console.error("[sendRegistrationOtp] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to send verification code. Please try again later.",
    });
  }
};

/**
 * Verify OTP, create 7-day trial direct registration, and open educator account
 */
export const verifyOtpAndRegister = async (req, res) => {
  let instId = null;
  let isNewRegistration = false;
  try {
    const { phone, otp, name, instituteName, fcmToken } = req.body;
    const cleanPhone = (phone || "").toString().replace(/\D/g, "").slice(-10);

    if (!cleanPhone || cleanPhone.length !== 10) {
      return res.status(400).json({ success: false, message: "Valid 10-digit mobile number required." });
    }
    if (!otp || String(otp).trim().length < 4) {
      return res.status(400).json({ success: false, message: "Please enter the 6-digit verification code." });
    }

    // 1. Retrieve OTP from Redis / Memory
    let storedOtpData = null;
    if (redisClient && redisClient.isReady) {
      try {
        const raw = await redisClient.get(`reg_otp:${cleanPhone}`);
        if (raw) storedOtpData = JSON.parse(raw);
      } catch (_) {}
    }
    if (!storedOtpData) {
      storedOtpData = memoryOtpStore.get(cleanPhone);
    }

    if (!storedOtpData) {
      return res.status(400).json({
        success: false,
        message: "Verification code has expired or was not requested. Please request a new code.",
      });
    }

    // Check attempts limit (max 5 incorrect attempts)
    if (storedOtpData.attempts >= 5) {
      memoryOtpStore.delete(cleanPhone);
      if (redisClient && redisClient.isReady) {
        redisClient.del(`reg_otp:${cleanPhone}`).catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: "Too many incorrect attempts. Please request a new verification code.",
      });
    }

    // Verify OTP value
    if (String(storedOtpData.otp).trim() !== String(otp).trim()) {
      storedOtpData.attempts = (storedOtpData.attempts || 0) + 1;
      memoryOtpStore.set(cleanPhone, storedOtpData);
      if (redisClient && redisClient.isReady) {
        redisClient
          .set(`reg_otp:${cleanPhone}`, JSON.stringify(storedOtpData), { EX: 300 })
          .catch(() => {});
      }
      return res.status(400).json({
        success: false,
        message: "Incorrect verification code. Please check and try again.",
      });
    }

    // Invalidate used OTP
    memoryOtpStore.delete(cleanPhone);
    if (redisClient && redisClient.isReady) {
      redisClient.del(`reg_otp:${cleanPhone}`).catch(() => {});
    }

    const clientIp = getClientIp(req);
    const defaults = await getGlobalTrialDefaults();

    // 2. Check if user or institute already exists
    const existingUser = await User.findOne({ phone: cleanPhone });
    let institute = await Institute.findOne({ adminPhone: cleanPhone });

    if (existingUser && institute) {
      return res.status(400).json({
        success: false,
        isExistingUser: true,
        message: "This mobile number is already registered. Please log in directly.",
      });
    }

    const trialEnds = new Date(Date.now() + defaults.trialDays * 24 * 60 * 60 * 1000);
    const regName = (name || "Educator").trim();
    const regInstName = (
      instituteName || (name ? `${name.trim()}'s Classes` : "My Academy")
    ).trim();

    const allFeatures = defaults.features && defaults.features.length > 0
      ? defaults.features
      : [
          "attendance", "notes", "marks", "tests", "notices", "whatsapp",
          "finances", "homework", "quizzes", "leads",
          "recorded_lectures", "release_videos", "test_series"
        ];

    instId = institute ? String(institute._id || institute.id) : crypto.randomUUID();

    // 3. Create or update Institute record in institutes table
    const instPayload = {
      id: instId,
      name: regInstName,
      owner_name: regName,
      admin_email: `${cleanPhone}@direct.classtech.in`,
      admin_phone: cleanPhone,
      subscription_plan: "trial",
      subscription_amount: 0,
      trial_days: Number(defaults.trialDays || 7),
      subscription_start: new Date().toISOString(),
      subscription_end: trialEnds.toISOString(),
      status: "active",
      tuition_type: "solo",
      allowed_features: allFeatures,
      wallet_balance: Number(defaults.wpBalance ?? 10.0),
      ai_wallet_balance: Number(defaults.aiBalance ?? 50.0),
      quiz_feature_enabled: defaults.quizFeatureEnabled !== false,
      ai_enabled: defaults.aiEnabled !== false,
      ai_student_enabled: Boolean(defaults.aiStudentEnabled),
      recorded_lectures_feature_enabled: defaults.recordedLecturesFeatureEnabled !== false,
      release_videos_feature_enabled: defaults.releaseVideosFeatureEnabled !== false,
      test_series_feature_enabled: defaults.testSeriesFeatureEnabled !== false,
      max_video_storage_gb: Number(defaults.maxVideoStorageGb || 5),
      branding_enabled: defaults.brandingEnabled !== false,
      created_by_name: "direct_registration",
      registration_source: "direct",
      is_direct_registration: true,
    };

    try {
      await supabase.from("institutes").upsert(instPayload, { onConflict: "id" });
    } catch (upsertErr) {
      console.warn("[DirectRegistration] institutes upsert warning:", upsertErr.message);
    }

    // Save in institutes metadata
    const metadata = readInstitutesMetadata();
    metadata[instId] = {
      ...(metadata[instId] || {}),
      registrationSource: "direct",
      isDirectRegistration: true,
      walletBalance: Number(defaults.wpBalance ?? 10.0),
      aiWalletBalance: Number(defaults.aiBalance ?? 50.0),
      aiEnabled: defaults.aiEnabled !== false,
      aiStudentEnabled: Boolean(defaults.aiStudentEnabled),
      quizFeatureEnabled: defaults.quizFeatureEnabled !== false,
      testSeriesFeatureEnabled: defaults.testSeriesFeatureEnabled !== false,
      recordedLecturesFeatureEnabled: defaults.recordedLecturesFeatureEnabled !== false,
      releaseVideosFeatureEnabled: defaults.releaseVideosFeatureEnabled !== false,
      brandingEnabled: defaults.brandingEnabled !== false,
      maxVideoStorageGb: Number(defaults.maxVideoStorageGb || 5),
      allowedFeatures: allFeatures,
      createdByName: "direct_registration",
    };
    writeInstitutesMetadata(metadata);

    if (!institute) {
      institute = await Institute.findById(instId).catch(() => null);
    }

    // 4. Dispatch WhatsApp Notification to 9934597030 on every new registration
    try {
      const timeStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      const alertPhone = "9934597030";
      const trialDateFormatted = new Date(trialEnds).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });

      const wpMessage =
        `🎉 *NEW EDUCATOR APP REGISTRATION*\n\n` +
        `👤 *Educator:* ${regName}\n` +
        `📱 *Phone:* ${cleanPhone}\n` +
        `🏫 *Academy:* ${regInstName}\n` +
        `⏳ *Trial Plan:* 7 Days (Until ${trialDateFormatted})\n` +
        `🌐 *IP:* ${clientIp}\n` +
        `⏰ *Time:* ${timeStr}\n\n` +
        `_Login to Super Admin to configure trial features & balances._`;

      const templateConfig = process.env.META_REGISTRATION_TEMPLATE_NAME
        ? {
            templateName: process.env.META_REGISTRATION_TEMPLATE_NAME,
            parameters: [regName, cleanPhone, regInstName, timeStr],
          }
        : null;

      sendMessage("admin_test", alertPhone, wpMessage, "custom", templateConfig).catch((err) => {
        console.warn("[DirectRegistration] WhatsApp alert to 9934597030 warning:", err.message);
      });
    } catch (wpErr) {
      console.warn("[DirectRegistration] WhatsApp alert exception:", wpErr.message);
    }

    // 5. Ensure matching User exists pointing to the valid institute ID
    isNewRegistration = false;
    let user = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: `${cleanPhone}@direct.classtech.in` }],
    });

    if (!user) {
      isNewRegistration = true;
      const dummyPassword = crypto.randomBytes(16).toString("hex");
      const hashedPassword = await bcrypt.hash(dummyPassword, 10);
      try {
        user = await User.create({
          name: regName,
          phone: cleanPhone,
          email: `${cleanPhone}@direct.classtech.in`,
          password: hashedPassword,
          role: "institute_admin",
          institute: instId,
          institute_id: instId,
          isTrialRegistration: true,
          aiAccessEnabled: allFeatures.includes("ai"),
        });
      } catch (userCreateErr) {
        console.warn("[DirectRegistration] User.create with institute failed, retrying directly:", userCreateErr.message);
        const newUserId = crypto.randomUUID();
        const directUserPayload = {
          id: newUserId,
          name: regName,
          phone: cleanPhone,
          email: `${cleanPhone}@direct.classtech.in`,
          password_hash: hashedPassword,
          role: "institute_admin",
          institute_id: instId,
        };
        try {
          await supabase.from("users").insert(directUserPayload);
        } catch (_) {}
        user = await User.findById(newUserId).catch(() => ({
          _id: newUserId,
          id: newUserId,
          name: regName,
          email: `${cleanPhone}@direct.classtech.in`,
          phone: cleanPhone,
          role: "institute_admin",
          institute: instId,
        }));
      }
    } else {
      user.name = regName;
      user.institute = instId;
      user.institute_id = instId;
      user.isTrialRegistration = true;
      user.aiAccessEnabled = allFeatures.includes("ai");
      try {
        await user.save();
      } catch (_) {
        try {
          await supabase.from("users").update({ institute_id: instId }).eq("id", String(user._id || user.id));
        } catch (_) {}
      }
    }

    if (institute && user && (!institute.adminUser || String(institute.adminUser) !== String(user._id || user.id))) {
      institute.adminUser = user._id || user.id;
      try {
        await institute.save();
      } catch (_) {}
      try {
        await supabase.from("institutes").update({ admin_user: String(user._id || user.id) }).eq("id", instId);
      } catch (_) {}
    }

    // 6. Generate Session and JWT Token
    const sessionId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 11);
    if (user.save) {
      user.currentSessionId = sessionId;
      user.lastActiveAt = new Date();
      await user.save().catch(() => {});
    }

    const userId = String(user._id || user.id);

    if (redisClient && redisClient.isReady) {
      try {
        await redisClient.set(`active_session:user:${userId}`, sessionId);
      } catch (_) {}
    }

    const token = jwt.sign(
      {
        id: userId,
        email: user.email,
        name: user.name,
        role: user.role,
        institute: instId,
        isDirectTrial: true,
        sessionId,
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    // Calculate trial days left
    const now = Date.now();
    const trialEndMs = trialEnds.getTime();
    const daysLeft = Math.max(0, Math.ceil((trialEndMs - now) / (1000 * 60 * 60 * 24)));
    const isExpired = daysLeft <= 0;

    const institutePayload = {
      id: instId,
      _id: instId,
      name: regInstName,
      subscriptionPlan: "trial",
      trialDays: defaults.trialDays || 7,
      subscriptionStart: new Date(),
      subscriptionEnd: trialEnds,
      status: "active",
      tuitionType: "solo",
      allowedFeatures: allFeatures,
      walletBalance: Number(defaults.wpBalance ?? 10.0),
      aiBalance: Number(defaults.aiBalance ?? 50.0),
      quizFeatureEnabled: defaults.quizFeatureEnabled !== false,
      recordedLecturesFeatureEnabled: defaults.recordedLecturesFeatureEnabled !== false,
      releaseVideosFeatureEnabled: defaults.releaseVideosFeatureEnabled !== false,
      aiEnabled: defaults.aiEnabled !== false,
      aiStudentEnabled: Boolean(defaults.aiStudentEnabled),
      testSeriesFeatureEnabled: defaults.testSeriesFeatureEnabled !== false,
      maxVideoStorageGb: Number(defaults.maxVideoStorageGb || 5),
      isDirectTrial: true,
      trialDaysLeft: daysLeft,
      brandingEnabled: defaults.brandingEnabled !== false,
      logoUrl: null,
      themeColor: "#4C3FBE",
      registrationSource: "direct",
      isDirectRegistration: true,
    };

    return res.status(isNewRegistration ? 201 : 200).json({
      success: true,
      message: isNewRegistration
        ? "Account created successfully! Your 7-day free trial is now active."
        : "Welcome back! Login successful.",
      token,
      user: {
        id: userId,
        _id: userId,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        institute: institutePayload,
      },
      trial: {
        endsAt: trialEnds,
        daysLeft,
        isExpired,
      },
    });
  } catch (error) {
    console.error("[verifyOtpAndRegister] Error:", error);
    if (isNewRegistration && instId) {
      try {
        await Institute.findByIdAndDelete(instId);
        await supabase.from("institutes").delete().eq("id", instId);
        const metadata = readInstitutesMetadata();
        if (metadata[instId]) {
          delete metadata[instId];
          writeInstitutesMetadata(metadata);
        }
      } catch (_) {}
    }
    return res.status(500).json({
      success: false,
      message: "Verification failed: " + error.message,
    });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SUPER ADMIN CONTROLLER METHODS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sync earlier local fallback registrations to Supabase PostgreSQL table
 */
export const syncFallbackRecordsToSupabase = async () => {
  let synced = 0;
  try {
    const fallbackList = readFallbackData("direct_registrations") || [];
    if (Array.isArray(fallbackList) && fallbackList.length > 0) {
      for (const item of fallbackList) {
        if (!item || !item.phone) continue;
        const cleanPhone = String(item.phone).trim();
        const { data: existing } = await supabase
          .from("direct_registrations")
          .select("id")
          .eq("phone", cleanPhone)
          .maybeSingle();

        if (!existing) {
          const payload = {
            id: item.id || item._id || crypto.randomUUID(),
            phone: cleanPhone,
            name: item.name || "Educator",
            institute_name: item.instituteName || item.institute_name || "My Academy",
            trial_ends_at: item.trialEndsAt || item.trial_ends_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            status: item.status || "trial_active",
            features: Array.isArray(item.features)
              ? item.features
              : ["attendance", "notes", "marks", "tests", "whatsapp", "finances", "ai", "homework", "quizzes"],
            wp_balance: Number(item.wpBalance ?? item.wp_balance ?? 10.0),
            ai_balance: Number(item.aiBalance ?? item.ai_balance ?? 50.0),
            storage_used_bytes: Number(item.storageUsedBytes ?? item.storage_used_bytes ?? 0),
            ai_enabled: item.aiEnabled !== undefined ? Boolean(item.aiEnabled) : (item.ai_enabled !== undefined ? Boolean(item.ai_enabled) : true),
            ai_student_enabled: Boolean(item.aiStudentEnabled ?? item.ai_student_enabled),
            recorded_lectures_feature_enabled: item.recordedLecturesFeatureEnabled !== undefined ? Boolean(item.recordedLecturesFeatureEnabled) : (item.recorded_lectures_feature_enabled !== undefined ? Boolean(item.recorded_lectures_feature_enabled) : true),
            release_videos_feature_enabled: item.releaseVideosFeatureEnabled !== undefined ? Boolean(item.releaseVideosFeatureEnabled) : (item.release_videos_feature_enabled !== undefined ? Boolean(item.release_videos_feature_enabled) : true),
            quiz_feature_enabled: item.quizFeatureEnabled !== undefined ? Boolean(item.quizFeatureEnabled) : (item.quiz_feature_enabled !== undefined ? Boolean(item.quiz_feature_enabled) : true),
            test_series_feature_enabled: Boolean(item.testSeriesFeatureEnabled ?? item.test_series_feature_enabled),
            branding_enabled: item.brandingEnabled !== undefined ? Boolean(item.brandingEnabled) : (item.branding_enabled !== undefined ? Boolean(item.branding_enabled) : true),
            max_video_storage_gb: Number(item.maxVideoStorageGb ?? item.max_video_storage_gb ?? 5),
            ip_address: item.ipAddress || item.ip_address || null,
            fcm_token: Array.isArray(item.fcmToken) ? item.fcmToken : [],
            last_active_at: item.lastActiveAt || item.last_active_at || new Date(),
            created_at: item.createdAt || item.created_at || new Date(),
            updated_at: new Date(),
          };
          const { error: insErr } = await supabase.from("direct_registrations").insert(payload);
          if (!insErr) synced++;
        }
      }
    }
  } catch (err) {
    console.warn("[DirectRegistration] syncFallbackRecordsToSupabase warning:", err.message);
  }
  return synced;
};

/**
 * Super Admin manual trigger to sync fallback registrations into Supabase
 */
export const syncAdminDirectRegistrations = async (req, res) => {
  try {
    const syncedCount = await syncFallbackRecordsToSupabase();
    return res.json({
      success: true,
      message: `Database synchronization complete. ${syncedCount} record(s) synced to Supabase.`,
      syncedCount,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Get all direct registrations with pagination, search, status filter
 */
export const getAdminDirectRegistrations = async (req, res) => {
  try {
    const { search = "", status = "", page = 1, limit = 50 } = req.query;

    const institutes = await Institute.find({
      $or: [
        { registrationSource: "direct" },
        { isDirectRegistration: true },
        { createdByName: "direct_registration" },
      ],
    }).sort({ createdAt: -1 });

    const now = Date.now();

    // Map each institute to registration format
    let formatted = institutes.map((r) => {
      const doc = r.toObject ? r.toObject() : r;
      const trialEndMs = new Date(doc.subscriptionEnd || doc.trialEndsAt || now).getTime();
      const daysLeft = Math.max(0, Math.ceil((trialEndMs - now) / (1000 * 60 * 60 * 24)));
      const isConverted = doc.subscriptionPlan !== "trial";
      const isExpired = !isConverted && (doc.status === "expired" || trialEndMs < now);
      const isSuspended = doc.status === "suspended";
      const computedStatus = isConverted
        ? "converted"
        : isSuspended
        ? "suspended"
        : isExpired
        ? "expired"
        : "trial_active";

      return {
        ...doc,
        id: doc._id || doc.id,
        _id: doc._id || doc.id,
        phone: doc.adminPhone || doc.phone || "",
        name: doc.ownerName || doc.name || "Educator",
        instituteName: doc.name || doc.instituteName || "My Academy",
        trialEndsAt: doc.subscriptionEnd || doc.trialEndsAt,
        status: computedStatus,
        features: doc.allowedFeatures || doc.features || [],
        wpBalance: Number(doc.walletBalance ?? doc.wpBalance ?? 0),
        aiBalance: Number(doc.aiWalletBalance ?? doc.aiBalance ?? 0),
        aiEnabled: doc.aiEnabled !== false && doc.ai_enabled !== false,
        aiStudentEnabled: Boolean(doc.aiStudentEnabled ?? doc.ai_student_enabled),
        recordedLecturesFeatureEnabled:
          doc.recordedLecturesFeatureEnabled !== false &&
          doc.recorded_lectures_feature_enabled !== false,
        releaseVideosFeatureEnabled:
          doc.releaseVideosFeatureEnabled !== false &&
          doc.release_videos_feature_enabled !== false,
        quizFeatureEnabled:
          doc.quizFeatureEnabled !== false && doc.quiz_feature_enabled !== false,
        testSeriesFeatureEnabled: Boolean(
          doc.testSeriesFeatureEnabled ?? doc.test_series_feature_enabled
        ),
        brandingEnabled:
          doc.brandingEnabled !== false && doc.branding_enabled !== false,
        maxVideoStorageGb: Number(
          doc.maxVideoStorageGb ?? doc.max_video_storage_gb ?? 5
        ),
        daysLeft,
        isExpired,
        notes: doc.adminNotes || doc.notes || "",
      };
    });

    // Apply search filter in memory
    if (search && search.trim()) {
      const term = search.trim().toLowerCase();
      formatted = formatted.filter(
        (item) =>
          (item.name || "").toLowerCase().includes(term) ||
          (item.phone || "").toLowerCase().includes(term) ||
          (item.instituteName || "").toLowerCase().includes(term)
      );
    }

    // Counters for stats
    const total = formatted.length;
    const activeCount = formatted.filter(
      (r) => r.status === "trial_active" && !r.isExpired
    ).length;
    const expiredCount = formatted.filter(
      (r) => r.status === "expired" || r.isExpired
    ).length;
    const convertedCount = formatted.filter((r) => r.status === "converted").length;

    // Apply status filter
    if (status && status !== "all") {
      formatted = formatted.filter((r) => r.status === status);
    }

    // Pagination
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;
    const paginated = formatted.slice(skip, skip + limitNum);

    return res.json({
      success: true,
      registrations: paginated,
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        totalPages: Math.ceil(total / limitNum) || 1,
      },
      stats: {
        total,
        activeTrials: activeCount,
        expiredTrials: expiredCount,
        converted: convertedCount,
      },
    });
  } catch (error) {
    console.error("[getAdminDirectRegistrations] Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not fetch direct registrations." });
  }
};

/**
 * Update a direct registration's features, balances, trial end date, status
 */
export const updateAdminDirectRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      features,
      wpBalance,
      aiBalance,
      status,
      extendDays,
      notes,
      instituteName,
      name,
      aiEnabled,
      aiStudentEnabled,
      recordedLecturesFeatureEnabled,
      releaseVideosFeatureEnabled,
      quizFeatureEnabled,
      testSeriesFeatureEnabled,
      brandingEnabled,
      maxVideoStorageGb,
    } = req.body;

    let institute = await Institute.findById(id);
    if (!institute) {
      institute = await Institute.findOne({
        $or: [{ _id: id }, { id }, { adminPhone: id }],
      });
    }

    if (!institute) {
      return res
        .status(404)
        .json({ success: false, message: "Registration institute not found" });
    }

    if (name !== undefined && String(name).trim()) {
      institute.ownerName = String(name).trim();
    }
    if (instituteName !== undefined && String(instituteName).trim()) {
      institute.name = String(instituteName).trim();
    }
    if (features !== undefined && Array.isArray(features)) {
      institute.allowedFeatures = features;
    }
    if (wpBalance !== undefined) {
      institute.walletBalance = Math.max(0, Number(wpBalance || 0));
    }
    if (aiBalance !== undefined) {
      institute.aiWalletBalance = Math.max(0, Number(aiBalance || 0));
    }
    if (aiEnabled !== undefined) {
      institute.aiEnabled = Boolean(aiEnabled);
      institute.ai_enabled = Boolean(aiEnabled);
    }
    if (aiStudentEnabled !== undefined) {
      institute.aiStudentEnabled = Boolean(aiStudentEnabled);
      institute.ai_student_enabled = Boolean(aiStudentEnabled);
    }
    if (recordedLecturesFeatureEnabled !== undefined) {
      institute.recordedLecturesFeatureEnabled = Boolean(recordedLecturesFeatureEnabled);
      institute.recorded_lectures_feature_enabled = Boolean(recordedLecturesFeatureEnabled);
    }
    if (releaseVideosFeatureEnabled !== undefined) {
      institute.releaseVideosFeatureEnabled = Boolean(releaseVideosFeatureEnabled);
      institute.release_videos_feature_enabled = Boolean(releaseVideosFeatureEnabled);
    }
    if (quizFeatureEnabled !== undefined) {
      institute.quizFeatureEnabled = Boolean(quizFeatureEnabled);
      institute.quiz_feature_enabled = Boolean(quizFeatureEnabled);
    }
    if (testSeriesFeatureEnabled !== undefined) {
      institute.testSeriesFeatureEnabled = Boolean(testSeriesFeatureEnabled);
      institute.test_series_feature_enabled = Boolean(testSeriesFeatureEnabled);
    }
    if (brandingEnabled !== undefined) {
      institute.brandingEnabled = Boolean(brandingEnabled);
      institute.branding_enabled = Boolean(brandingEnabled);
    }
    if (maxVideoStorageGb !== undefined) {
      institute.maxVideoStorageGb = Math.max(1, Number(maxVideoStorageGb || 5));
      institute.max_video_storage_gb = institute.maxVideoStorageGb;
    }
    if (
      status &&
      ["trial_active", "expired", "converted", "suspended", "active"].includes(status)
    ) {
      if (status === "trial_active") {
        institute.status = "active";
        institute.subscriptionPlan = "trial";
      } else if (status === "suspended") {
        institute.status = "suspended";
      } else if (status === "expired") {
        institute.status = "expired";
      } else if (status === "converted") {
        institute.subscriptionPlan = "monthly";
        institute.status = "active";
      }
    }
    if (notes !== undefined) {
      institute.adminNotes = String(notes || "").trim();
    }

    // Extend trial by X days if requested
    if (extendDays && !isNaN(Number(extendDays)) && Number(extendDays) > 0) {
      const currentEnd = new Date(institute.subscriptionEnd);
      const baseDate = currentEnd.getTime() > Date.now() ? currentEnd : new Date();
      institute.subscriptionEnd = new Date(
        baseDate.getTime() + Number(extendDays) * 24 * 60 * 60 * 1000
      );
      if (institute.status === "expired") {
        institute.status = "active";
      }
    }

    await institute.save();

    // Also update public.institutes in PostgreSQL directly
    const instId = String(institute._id || institute.id);
    const instUpdate = {
      name: institute.name,
      owner_name: institute.ownerName,
      allowed_features: institute.allowedFeatures,
      wallet_balance: institute.walletBalance,
      ai_wallet_balance: institute.aiWalletBalance,
      quiz_feature_enabled: institute.quizFeatureEnabled,
      recorded_lectures_feature_enabled: institute.recordedLecturesFeatureEnabled,
      release_videos_feature_enabled: institute.releaseVideosFeatureEnabled,
      test_series_feature_enabled: institute.testSeriesFeatureEnabled,
      ai_enabled: institute.aiEnabled,
      ai_student_enabled: institute.aiStudentEnabled,
      branding_enabled: institute.brandingEnabled,
      max_video_storage_gb: institute.maxVideoStorageGb,
      subscription_end: new Date(institute.subscriptionEnd).toISOString(),
      status: institute.status,
    };
    try {
      await supabase.from("institutes").update(instUpdate).eq("id", instId);
    } catch (_) {}

    // Save in metadata
    const metadata = readInstitutesMetadata();
    metadata[instId] = {
      ...(metadata[instId] || {}),
      registrationSource: "direct",
      isDirectRegistration: true,
      walletBalance: institute.walletBalance,
      aiWalletBalance: institute.aiWalletBalance,
      quizFeatureEnabled: institute.quizFeatureEnabled,
      testSeriesFeatureEnabled: institute.testSeriesFeatureEnabled,
      recordedLecturesFeatureEnabled: institute.recordedLecturesFeatureEnabled,
      releaseVideosFeatureEnabled: institute.releaseVideosFeatureEnabled,
      aiEnabled: institute.aiEnabled,
      aiStudentEnabled: institute.aiStudentEnabled,
      brandingEnabled: institute.brandingEnabled,
      maxVideoStorageGb: institute.maxVideoStorageGb,
      allowedFeatures: institute.allowedFeatures,
    };
    writeInstitutesMetadata(metadata);

    // Sync User AI access
    const cleanPhone = String(institute.adminPhone || "").trim();
    try {
      await User.updateMany(
        { $or: [{ institute: instId }, { phone: cleanPhone }] },
        { aiAccessEnabled: institute.aiEnabled !== false }
      );
    } catch (_) {}

    return res.json({
      success: true,
      message: "Direct registration updated successfully!",
      registration: {
        ...(institute.toObject ? institute.toObject() : institute),
        id: instId,
        phone: institute.adminPhone,
        name: institute.ownerName,
        instituteName: institute.name,
        trialEndsAt: institute.subscriptionEnd,
        features: institute.allowedFeatures,
        wpBalance: institute.walletBalance,
        aiBalance: institute.aiWalletBalance,
        status:
          institute.subscriptionPlan === "trial"
            ? new Date(institute.subscriptionEnd) < new Date()
              ? "expired"
              : "trial_active"
            : "converted",
      },
    });
  } catch (error) {
    console.error("[updateAdminDirectRegistration] Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not update registration: " + error.message });
  }
};

/**
 * Convert a trial registration into a full official Institute
 */
export const convertTrialToInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const { subscriptionPlan = "monthly", subscriptionAmount = 0 } = req.body;

    let institute = await Institute.findById(id);
    if (!institute) {
      institute = await Institute.findOne({
        $or: [{ _id: id }, { id }, { adminPhone: id }],
      });
    }

    if (!institute) {
      return res.status(404).json({ success: false, message: "Registration not found" });
    }

    institute.subscriptionPlan = subscriptionPlan;
    institute.subscriptionAmount = Number(subscriptionAmount || 0);
    institute.subscriptionStart = new Date();
    institute.subscriptionEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days active
    institute.status = "active";
    institute.registrationSource = "admin";
    institute.isDirectRegistration = false;
    await institute.save();

    const instId = String(institute._id || institute.id);
    await supabase
      .from("institutes")
      .update({
        subscription_plan: subscriptionPlan,
        subscription_amount: Number(subscriptionAmount || 0),
        subscription_start: new Date().toISOString(),
        subscription_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: "active",
        created_by_name: "admin",
      })
      .eq("id", instId)
      .catch(() => {});

    const metadata = readInstitutesMetadata();
    metadata[instId] = {
      ...(metadata[instId] || {}),
      registrationSource: "admin",
      isDirectRegistration: false,
    };
    writeInstitutesMetadata(metadata);

    return res.json({
      success: true,
      message: `Educator successfully converted to official Institute: "${institute.name}"!`,
      institute,
    });
  } catch (error) {
    console.error("[convertTrialToInstitute] Error:", error);
    return res
      .status(500)
      .json({ success: false, message: "Could not convert registration: " + error.message });
  }
};

/**
 * Permanently delete an app trial registration and all associated records
 * (User, Institute, Batches, Students, Notes, Notices, Redis sessions, Fallback JSON)
 */
export const deleteAdminDirectRegistration = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ success: false, message: "Registration ID or phone is required" });
    }

    const targetParam = String(id).trim();

    // 1. Try finding in DirectRegistration model
    let registration = null;
    try {
      registration = await DirectRegistration.findById(targetParam);
    } catch (_) {}

    if (!registration) {
      try {
        registration = await DirectRegistration.findOne({
          $or: [{ _id: targetParam }, { id: targetParam }, { phone: targetParam }],
        });
      } catch (_) {}
    }

    // 2. Also check raw fallback array
    const fallbackList = readFallbackData("direct_registrations") || [];
    const fallbackItem = Array.isArray(fallbackList)
      ? fallbackList.find(
          (item) =>
            item &&
            (String(item.id || item._id) === targetParam ||
              String(item.phone) === targetParam)
        )
      : null;

    // 3. Check directly in Supabase table direct_registrations
    let sbItem = null;
    try {
      const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(targetParam);
      let sbQuery = supabase.from("direct_registrations").select("*");
      if (isUuid) {
        sbQuery = sbQuery.or(`id.eq.${targetParam},phone.eq.${targetParam}`);
      } else {
        sbQuery = sbQuery.eq("phone", targetParam);
      }
      const { data: sbRows } = await sbQuery.limit(1);
      if (sbRows && sbRows.length > 0) {
        sbItem = sbRows[0];
      }
    } catch (_) {}

    // Extract identifiers
    const regId = String(
      registration?._id || registration?.id || sbItem?.id || fallbackItem?._id || fallbackItem?.id || targetParam
    );
    const cleanPhone = String(
      registration?.phone ||
      sbItem?.phone ||
      fallbackItem?.phone ||
      (targetParam.match(/^\d{10}$/) ? targetParam : "")
    ).trim();
    const educatorName = registration?.name || sbItem?.name || fallbackItem?.name || "Educator";
    const convertedInstId =
      registration?.convertedToInstituteId ||
      fallbackItem?.convertedToInstituteId ||
      sbItem?.converted_to_institute_id
        ? String(
            registration?.convertedToInstituteId ||
            fallbackItem?.convertedToInstituteId ||
            sbItem?.converted_to_institute_id
          )
        : null;

    // 4. Locate all related user records
    const userQuery = [];
    if (cleanPhone) {
      userQuery.push({ phone: cleanPhone });
      userQuery.push({ email: `${cleanPhone}@direct.classtech.in` });
    }
    if (regId) {
      userQuery.push({ institute: regId });
    }
    if (convertedInstId) {
      userQuery.push({ institute: convertedInstId });
    }

    let users = [];
    if (userQuery.length > 0) {
      try {
        users = await User.find({ $or: userQuery });
      } catch (_) {}
    }
    const userIds = users.map((u) => String(u._id || u.id)).filter(Boolean);

    // 5. Locate all related institute records
    const instituteQuery = [];
    if (regId) {
      instituteQuery.push({ _id: regId }, { id: regId });
    }
    if (cleanPhone) {
      instituteQuery.push({ adminPhone: cleanPhone });
    }
    if (convertedInstId) {
      instituteQuery.push({ _id: convertedInstId }, { id: convertedInstId });
    }
    if (userIds.length > 0) {
      instituteQuery.push({ adminUser: { $in: userIds } });
    }

    let institutes = [];
    if (instituteQuery.length > 0) {
      try {
        institutes = await Institute.find({ $or: instituteQuery });
      } catch (_) {}
    }
    const instIds = Array.from(
      new Set([
        regId,
        ...(convertedInstId ? [convertedInstId] : []),
        ...institutes.map((i) => String(i._id || i.id)).filter(Boolean),
      ])
    );

    // 6. Delete dependent child records (students, batches, notes, notices)
    const entityFilter = [];
    if (userIds.length > 0) {
      entityFilter.push({ user: { $in: userIds } });
    }
    if (instIds.length > 0) {
      entityFilter.push({ institute: { $in: instIds } });
      entityFilter.push({ institute_id: { $in: instIds } });
    }

    if (entityFilter.length > 0) {
      await Promise.allSettled([
        Student.deleteMany({ $or: entityFilter }).catch(() => {}),
        Batch.deleteMany({ $or: entityFilter }).catch(() => {}),
        Note.deleteMany({ $or: entityFilter }).catch(() => {}),
        Notice.deleteMany({ $or: entityFilter }).catch(() => {}),
      ]);
    }

    // 7. Delete Users
    if (userIds.length > 0) {
      for (const uid of userIds) {
        await User.findByIdAndDelete(uid).catch(() => {});
      }
      await User.deleteMany({ _id: { $in: userIds } }).catch(() => {});
    }
    if (cleanPhone) {
      await User.deleteMany({ phone: cleanPhone }).catch(() => {});
      try {
        await supabase.from("users").delete().eq("phone", cleanPhone);
      } catch (_) {}
    }
    if (instIds.length > 0) {
      await User.deleteMany({
        $or: [{ institute: { $in: instIds } }, { institute_id: { $in: instIds } }],
      }).catch(() => {});
    }

    // 8. Delete Institute(s)
    if (instIds.length > 0) {
      for (const iid of instIds) {
        await Institute.findByIdAndDelete(iid).catch(() => {});
      }
      await Institute.deleteMany({
        $or: [{ _id: { $in: instIds } }, { id: { $in: instIds } }],
      }).catch(() => {});
    }
    if (cleanPhone) {
      await Institute.deleteMany({ adminPhone: cleanPhone }).catch(() => {});
      try {
        await supabase.from("institutes").delete().eq("admin_phone", cleanPhone);
      } catch (_) {}
    }

    // 9. Delete Direct Registration from Supabase database table directly
    try {
      if (regId && /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(regId)) {
        await supabase.from("direct_registrations").delete().eq("id", regId);
      }
      if (cleanPhone) {
        await supabase.from("direct_registrations").delete().eq("phone", cleanPhone);
      }
      if (targetParam && targetParam !== regId) {
        await supabase.from("direct_registrations").delete().eq("phone", targetParam);
      }
    } catch (_) {}

    // Model deleteOne
    await DirectRegistration.deleteOne({
      $or: [{ _id: regId }, { id: regId }, ...(cleanPhone ? [{ phone: cleanPhone }] : [])],
    }).catch(() => {});

    // 10. Remove from local fallback array if present (handles earlier accounts stored in JSON)
    try {
      const currentFallback = readFallbackData("direct_registrations") || [];
      if (Array.isArray(currentFallback)) {
        const updatedFallback = currentFallback.filter((item) => {
          if (!item) return false;
          const iId = String(item.id || item._id);
          const iPhone = String(item.phone || "");
          if (iId === regId || iId === targetParam) return false;
          if (cleanPhone && iPhone === cleanPhone) return false;
          if (iPhone === targetParam) return false;
          return true;
        });
        writeFallbackData("direct_registrations", updatedFallback);
      }
    } catch (_) {}

    // 11. Invalidate sessions and OTP trackers in Redis and memory
    try {
      if (cleanPhone) {
        memoryOtpStore.delete(cleanPhone);
        phoneCooldownTracker.delete(cleanPhone);
      }

      if (redisClient && redisClient.isReady) {
        for (const uid of userIds) {
          await redisClient.del(`active_session:user:${uid}`).catch(() => {});
        }
        if (cleanPhone) {
          await redisClient.del(`otp:reg:${cleanPhone}`).catch(() => {});
          await redisClient.del(`otp_count:reg:${cleanPhone}`).catch(() => {});
        }
      }
    } catch (_) {}

    // 12. Clear Cache Patterns
    try {
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("student:dashboard:*");
      await clearCachePattern("institute:*");
      await clearCachePattern("admin:*");
    } catch (_) {}

    return res.json({
      success: true,
      message: `Account ${cleanPhone ? `for +91 ${cleanPhone}` : `(${targetParam})`} deleted successfully.`,
      deleted: {
        registrationId: regId,
        phone: cleanPhone || targetParam,
        usersDeleted: userIds.length,
        institutesDeleted: instIds.length,
      },
    });
  } catch (error) {
    console.error("[deleteAdminDirectRegistration] Error:", error);
    return res.status(500).json({
      success: false,
      message: "Could not delete trial registration: " + error.message,
    });
  }
};

/**
 * Get and update global trial defaults
 */
export const getAdminTrialDefaults = async (req, res) => {
  try {
    const defaults = await getGlobalTrialDefaults();
    return res.json({ success: true, defaults });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAdminTrialDefaults = async (req, res) => {
  try {
    const {
      trialDays,
      wpBalance,
      aiBalance,
      features,
      aiEnabled,
      aiStudentEnabled,
      recordedLecturesFeatureEnabled,
      releaseVideosFeatureEnabled,
      quizFeatureEnabled,
      testSeriesFeatureEnabled,
      brandingEnabled,
      maxVideoStorageGb,
    } = req.body;

    const payload = {
      trialDays: Number(trialDays || 7),
      wpBalance: Number(wpBalance ?? 10.0),
      aiBalance: Number(aiBalance ?? 50.0),
      aiEnabled: aiEnabled !== undefined ? Boolean(aiEnabled) : true,
      aiStudentEnabled: aiStudentEnabled !== undefined ? Boolean(aiStudentEnabled) : false,
      recordedLecturesFeatureEnabled: recordedLecturesFeatureEnabled !== undefined ? Boolean(recordedLecturesFeatureEnabled) : true,
      releaseVideosFeatureEnabled: releaseVideosFeatureEnabled !== undefined ? Boolean(releaseVideosFeatureEnabled) : true,
      quizFeatureEnabled: quizFeatureEnabled !== undefined ? Boolean(quizFeatureEnabled) : true,
      testSeriesFeatureEnabled: testSeriesFeatureEnabled !== undefined ? Boolean(testSeriesFeatureEnabled) : false,
      brandingEnabled: brandingEnabled !== undefined ? Boolean(brandingEnabled) : true,
      maxVideoStorageGb: Number(maxVideoStorageGb ?? 5),
      features: Array.isArray(features)
        ? features
        : [
            "attendance",
            "notes",
            "marks",
            "tests",
            "whatsapp",
            "finances",
            "homework",
          ],
    };

    let setting = await SystemSetting.findOne({ key: "direct_registration_defaults" });
    if (!setting) {
      setting = await SystemSetting.create({
        key: "direct_registration_defaults",
        value: payload,
        description: "Default configuration for direct app educator trial registrations",
      });
    } else {
      setting.value = payload;
      await setting.save();
    }

    return res.json({
      success: true,
      message: "Default trial settings saved successfully!",
      defaults: payload,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
