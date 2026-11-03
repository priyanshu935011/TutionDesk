import crypto from "crypto";
import bcrypt from "bcryptjs";
import DirectRegistration from "../models/DirectRegistration.js";
import User from "../models/User.js";
import Institute from "../models/Institute.js";
import SystemSetting from "../models/SystemSetting.js";
import { sendSMSOTP } from "../utils/smsHelper.js";
import { sendMessage } from "../services/whatsappService.js";
import redisClient from "../config/redis.js";
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
        storageLimitMb: Number(val.storageLimitMb ?? 500),
        features: Array.isArray(val.features)
          ? val.features
          : [
              "attendance",
              "notes",
              "marks",
              "tests",
              "whatsapp",
              "finances",
              "ai",
              "homework",
              "quizzes",
            ],
      };
    }
  } catch (_) {}

  return {
    trialDays: 7,
    wpBalance: 10.0,
    aiBalance: 50.0,
    storageLimitMb: 500,
    features: [
      "attendance",
      "notes",
      "marks",
      "tests",
      "whatsapp",
      "finances",
      "ai",
      "homework",
      "quizzes",
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
    if (existingInst) {
      return res.status(400).json({
        success: false,
        isExistingUser: true,
        message: "An academy is already registered with this mobile number. Please log in directly.",
      });
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

    // 5. Dispatch SMS OTP via Hanu OTP API
    try {
      await sendSMSOTP(cleanPhone, otp);
      console.log(`[DirectRegistration] Hanu OTP sent successfully to ${cleanPhone}`);
    } catch (smsErr) {
      console.error("[DirectRegistration] Failed to send Hanu OTP:", smsErr.message);
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

    // 2. Check if user already exists
    const existingUser = await User.findOne({ phone: cleanPhone });
    const existingInst = await Institute.findOne({ adminPhone: cleanPhone });
    let registration = await DirectRegistration.findOne({ phone: cleanPhone });

    if (existingUser || existingInst || registration) {
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

    const fcmList = fcmToken ? [fcmToken] : [];

    registration = await DirectRegistration.create({
      phone: cleanPhone,
      name: regName,
      instituteName: regInstName,
      trialEndsAt: trialEnds,
      status: "trial_active",
      features: defaults.features,
      wpBalance: defaults.wpBalance,
      aiBalance: defaults.aiBalance,
      storageLimitMb: defaults.storageLimitMb,
      storageUsedBytes: 0,
      ipAddress: clientIp,
      fcmToken: JSON.stringify(fcmList),
      lastActiveAt: new Date(),
    });

    // 3. Dispatch WhatsApp Notification to 9934597030 on every new registration
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

      const templateConfig = {
        templateName: process.env.META_REGISTRATION_TEMPLATE_NAME || "app_educator_registration",
        parameters: [regName, cleanPhone, regInstName, timeStr],
      };

      sendMessage("admin_test", alertPhone, wpMessage, "custom", templateConfig).catch((err) => {
        console.warn("[DirectRegistration] WhatsApp alert to 9934597030 warning:", err.message);
      });
    } catch (wpErr) {
      console.warn("[DirectRegistration] WhatsApp alert exception:", wpErr.message);
    }

    const regId = String(registration._id || registration.id);

    // 4. Ensure matching User exists in User model (Without adding to institutes table)
    let user = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: `${cleanPhone}@direct.classtech.in` }],
    });

    if (!user) {
      const dummyPassword = crypto.randomBytes(16).toString("hex");
      const hashedPassword = await bcrypt.hash(dummyPassword, 10);
      user = await User.create({
        name: registration.name,
        phone: cleanPhone,
        email: `${cleanPhone}@direct.classtech.in`,
        password: hashedPassword,
        role: "institute_admin",
        institute: regId,
        isTrialRegistration: true,
        trialRegistrationId: regId,
        aiAccessEnabled: (registration.features || []).includes("ai"),
      });
    } else {
      user.name = registration.name;
      user.institute = regId;
      user.isTrialRegistration = true;
      user.trialRegistrationId = regId;
      user.aiAccessEnabled = (registration.features || []).includes("ai");
      await user.save().catch(() => {});
    }

    // 5. Generate Session and JWT Token
    const sessionId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 11);
    user.currentSessionId = sessionId;
    user.lastActiveAt = new Date();
    await user.save().catch(() => {});

    if (redisClient && redisClient.isReady) {
      try {
        await redisClient.set(`active_session:user:${user._id}`, sessionId);
      } catch (_) {}
    }

    const token = jwt.sign(
      {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        institute: regId,
        isDirectTrial: true,
        sessionId,
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    // Calculate trial days left
    const now = Date.now();
    const trialEndMs = new Date(registration.trialEndsAt).getTime();
    const daysLeft = Math.max(0, Math.ceil((trialEndMs - now) / (1000 * 60 * 60 * 24)));
    const isExpired = registration.status === "expired" || trialEndMs < now;

    const institutePayload = {
      id: regId,
      _id: regId,
      name: registration.instituteName,
      subscriptionPlan: "7-day-trial",
      trialDays: 7,
      subscriptionStart: registration.createdAt,
      subscriptionEnd: registration.trialEndsAt,
      status: registration.status,
      tuitionType: "solo",
      allowedFeatures: registration.features || [
        "attendance",
        "notes",
        "marks",
        "tests",
        "whatsapp",
        "finances",
        "ai",
        "homework",
        "quizzes",
      ],
      walletBalance: Number(registration.wpBalance || 0),
      aiBalance: Number(registration.aiBalance || 0),
      storageLimitMb: Number(registration.storageLimitMb || 500),
      isDirectTrial: true,
      trialDaysLeft: daysLeft,
      brandingEnabled: true,
      logoUrl: null,
      themeColor: "#4C3FBE",
    };

    return res.status(isNewRegistration ? 201 : 200).json({
      success: true,
      message: isNewRegistration
        ? "Account created successfully! Your 7-day free trial is now active."
        : "Welcome back! Login successful.",
      token,
      user: {
        id: user._id,
        _id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        institute: institutePayload,
      },
      trial: {
        endsAt: registration.trialEndsAt,
        daysLeft,
        isExpired,
      },
    });
  } catch (error) {
    console.error("[verifyOtpAndRegister] Error:", error);
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
 * Get all direct registrations with pagination, search, status filter
 */
export const getAdminDirectRegistrations = async (req, res) => {
  try {
    const { search = "", status = "", page = 1, limit = 50 } = req.query;

    const query = {};
    if (status && status !== "all") {
      query.status = status;
    }

    if (search && search.trim()) {
      const term = search.trim();
      query.$or = [
        { name: { $regex: term, $options: "i" } },
        { phone: { $regex: term, $options: "i" } },
        { instituteName: { $regex: term, $options: "i" } },
      ];
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const [total, registrations] = await Promise.all([
      DirectRegistration.countDocuments(query),
      DirectRegistration.find(query).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
    ]);

    const now = Date.now();
    const formatted = registrations.map((r) => {
      const doc = r.toObject ? r.toObject() : r;
      const trialEndMs = new Date(doc.trialEndsAt).getTime();
      const daysLeft = Math.max(0, Math.ceil((trialEndMs - now) / (1000 * 60 * 60 * 24)));
      const isExpired = doc.status === "expired" || trialEndMs < now;

      return {
        ...doc,
        id: doc._id || doc.id,
        daysLeft,
        isExpired,
      };
    });

    // Summary counters
    const [activeCount, expiredCount, convertedCount] = await Promise.all([
      DirectRegistration.countDocuments({ status: "trial_active", trialEndsAt: { $gte: new Date() } }),
      DirectRegistration.countDocuments({
        $or: [{ status: "expired" }, { trialEndsAt: { $lt: new Date() } }],
      }),
      DirectRegistration.countDocuments({ status: "converted" }),
    ]);

    return res.json({
      success: true,
      registrations: formatted,
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
    return res.status(500).json({ success: false, message: "Could not fetch direct registrations." });
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
      storageLimitMb,
      status,
      extendDays,
      notes,
      instituteName,
    } = req.body;

    const registration = await DirectRegistration.findById(id);
    if (!registration) {
      return res.status(404).json({ success: false, message: "Registration not found" });
    }

    if (features !== undefined && Array.isArray(features)) {
      registration.features = features;
    }
    if (wpBalance !== undefined) {
      registration.wpBalance = Math.max(0, Number(wpBalance || 0));
    }
    if (aiBalance !== undefined) {
      registration.aiBalance = Math.max(0, Number(aiBalance || 0));
    }
    if (storageLimitMb !== undefined) {
      registration.storageLimitMb = Math.max(0, Number(storageLimitMb || 500));
    }
    if (status && ["trial_active", "expired", "converted", "suspended"].includes(status)) {
      registration.status = status;
    }
    if (notes !== undefined) {
      registration.notes = String(notes || "").trim();
    }
    if (instituteName !== undefined && instituteName.trim()) {
      registration.instituteName = instituteName.trim();
    }

    // Extend trial by X days if requested
    if (extendDays && !isNaN(Number(extendDays)) && Number(extendDays) > 0) {
      const currentEnd = new Date(registration.trialEndsAt);
      const baseDate = currentEnd.getTime() > Date.now() ? currentEnd : new Date();
      registration.trialEndsAt = new Date(baseDate.getTime() + Number(extendDays) * 24 * 60 * 60 * 1000);
      if (registration.status === "expired") {
        registration.status = "trial_active";
      }
    }

    await registration.save();

    // Also sync User if AI access toggled
    try {
      const regId = String(registration._id || registration.id);
      await User.updateMany(
        { $or: [{ institute: regId }, { trialRegistrationId: regId }] },
        { aiAccessEnabled: (registration.features || []).includes("ai") }
      );
    } catch (_) {}

    return res.json({
      success: true,
      message: "Registration updated successfully!",
      registration,
    });
  } catch (error) {
    console.error("[updateAdminDirectRegistration] Error:", error);
    return res.status(500).json({ success: false, message: "Could not update registration: " + error.message });
  }
};

/**
 * Convert a trial registration into a full official Institute
 */
export const convertTrialToInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const { subscriptionPlan = "monthly", subscriptionAmount = 0 } = req.body;

    const registration = await DirectRegistration.findById(id);
    if (!registration) {
      return res.status(404).json({ success: false, message: "Registration not found" });
    }

    const cleanPhone = registration.phone;
    let user = await User.findOne({
      $or: [{ phone: cleanPhone }, { email: `${cleanPhone}@direct.classtech.in` }],
    });

    // Create Institute in institutes table
    const newInstitute = await Institute.create({
      name: registration.instituteName || "My Academy",
      adminUser: user ? user._id : null,
      adminEmail: user?.email || `${cleanPhone}@classtech.in`,
      adminPhone: cleanPhone,
      subscriptionPlan,
      subscriptionAmount: Number(subscriptionAmount || 0),
      subscriptionStart: new Date(),
      subscriptionEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days active
      status: "active",
      allowedFeatures: registration.features || [
        "attendance",
        "notes",
        "marks",
        "tests",
        "whatsapp",
        "finances",
        "ai",
      ],
      walletBalance: registration.wpBalance || 10.0,
      aiWalletBalance: registration.aiBalance || 50.0,
      storageLimitMb: registration.storageLimitMb || 500,
      tuitionType: "solo",
    });

    const newInstId = String(newInstitute._id || newInstitute.id);

    // Update DirectRegistration status
    registration.status = "converted";
    registration.convertedToInstituteId = newInstId;
    await registration.save();

    // Update User
    if (user) {
      user.institute = newInstId;
      user.isTrialRegistration = false;
      await user.save();
    }

    return res.json({
      success: true,
      message: `Educator successfully converted to official Institute: "${newInstitute.name}"!`,
      institute: newInstitute,
      registration,
    });
  } catch (error) {
    console.error("[convertTrialToInstitute] Error:", error);
    return res.status(500).json({ success: false, message: "Could not convert registration: " + error.message });
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
    const { trialDays, wpBalance, aiBalance, storageLimitMb, features } = req.body;

    const payload = {
      trialDays: Number(trialDays || 7),
      wpBalance: Number(wpBalance ?? 10.0),
      aiBalance: Number(aiBalance ?? 50.0),
      storageLimitMb: Number(storageLimitMb ?? 500),
      features: Array.isArray(features)
        ? features
        : [
            "attendance",
            "notes",
            "marks",
            "tests",
            "whatsapp",
            "finances",
            "ai",
            "homework",
            "quizzes",
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
