import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import redisClient from "../config/redis.js";
import { sendResetEmail, sendDemoRequestEmail, sendOTPEmail } from "../utils/mailer.js";
import { sendSMSOTP } from "../utils/smsHelper.js";

const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "admin@classtech.com").toLowerCase();
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Admin@12345!";

const JWT_SECRET = process.env.JWT_SECRET || "classtech_default_jwt_secret_key_2026";

const generateToken = (payload) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: "30d" });

const buildInstituteState = async (user) => {
  if (!user.institute) {
    return null;
  }

  const institute = await Institute.findById(user.institute).select(
    "name subscriptionPlan subscriptionAmount trialDays subscriptionStart subscriptionEnd status tuitionType quizFeatureEnabled brandingEnabled logoUrl themeColor allowedFeatures whatsappSettings studentCustomFields"
  );

  if (!institute) {
    return null;
  }

  return {
    id: institute._id,
    name: institute.name,
    subscriptionPlan: institute.subscriptionPlan,
    subscriptionAmount: institute.subscriptionAmount,
    trialDays: institute.trialDays,
    subscriptionStart: institute.subscriptionStart,
    subscriptionEnd: institute.subscriptionEnd,
    status: institute.status,
    tuitionType: institute.tuitionType || "solo",
    quizFeatureEnabled: institute.quizFeatureEnabled !== false,
    brandingEnabled: institute.brandingEnabled !== false,
    logoUrl: institute.logoUrl || null,
    themeColor: institute.themeColor || "#4C3FBE",
    allowedFeatures: institute.allowedFeatures || ["attendance", "notes", "marks", "tests", "whatsapp"],
    whatsappSettings: institute.whatsappSettings || { absentAlertsEnabled: false, feeRemindersEnabled: false, customMessageTemplate: "" },
    studentCustomFields: institute.studentCustomFields || [],
  };
};

export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const normalizedIdentifier = (email || "").toLowerCase().trim();
    const cleanPhone = normalizedIdentifier.replace(/\D/g, "");

    if (
      normalizedIdentifier === SUPER_ADMIN_EMAIL &&
      password === SUPER_ADMIN_PASSWORD
    ) {
      return res.json({
        token: generateToken({
          id: "super-admin",
          email: SUPER_ADMIN_EMAIL,
          role: "super_admin",
        }),
        user: {
          id: "super-admin",
          email: SUPER_ADMIN_EMAIL,
          role: "super_admin",
        },
      });
    }

    let user = null;
    const last10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
    try {
      const emailRegex = new RegExp(`^${normalizedIdentifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
      user = await User.findOne({
        $or: [
          { email: emailRegex },
          { email: normalizedIdentifier },
          { phone: normalizedIdentifier },
          ...(cleanPhone.length >= 7
            ? [
                { phone: cleanPhone },
                { phone: last10 },
                { phone: `+91${last10}` },
                { phone: `91${last10}` },
                { email: `teacher_${last10}@classtech.local` }
              ]
            : [])
        ]
      });
    } catch (err) {
      console.warn("User lookup $or query warning, falling back to email query:", err.message);
      user = await User.findOne({ email: normalizedIdentifier });
    }

    if (!user) {
      return res.status(401).json({ message: "Invalid email/phone or password" });
    }

    const allowedAppRoles = ["institute_admin", "admin", "teacher", "super_admin"];
    if (!allowedAppRoles.includes(user.role?.toLowerCase())) {
      return res.status(403).json({ message: "Access denied. Only Institute Owners and Teachers are permitted to log in." });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const institute = await buildInstituteState(user);

    const sessionId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 11);
    user.currentSessionId = sessionId;
    user.lastActiveAt = new Date();
    await user.save();

    if (redisClient.isReady) {
      try {
        await redisClient.set(`active_session:user:${user._id}`, sessionId);
      } catch (redisError) {
        console.error("Redis set active session error:", redisError);
      }
    }

    return res.json({
      token: generateToken({
        id: user._id,
        email: user.email,
        role: user.role,
        sessionId,
      }),
      user: {
        id: user._id,
        email: user.email,
        role: user.role,
        institute,
      },
    });
  } catch (error) {
    console.error("Login user error:", error);
    return res.status(500).json({ message: "Login failed: " + error.message });
  }
};

export const changeUserPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new passwords are required." });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters long." });
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    return res.json({ message: "Password updated successfully." });
  } catch (error) {
    console.error("Change user password error:", error);
    return res.status(500).json({ message: "Could not change password" });
  }
};

export const forgotUserPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(404).json({ message: "User with this email not found" });
    }

    // Generate JWT reset token valid for 30 minutes
    const resetToken = jwt.sign(
      { id: user._id, type: "user_reset", email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "30m" }
    );

    const clientUrl = process.env.CLIENT_URL || "https://classtech.in";
    const resetLink = `${clientUrl}/teacher/reset-password?token=${resetToken}`;

    // Send email helper
    await sendResetEmail(user.email, user.name || "Educator", resetLink);

    return res.json({ message: "Password reset link has been sent to your email." });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ message: "Could not initiate forgot password flow." });
  }
};

export const resetUserPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: "Reset link has expired or is invalid." });
    }

    if (decoded.type !== "user_reset") {
      return res.status(400).json({ message: "Invalid reset token." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long." });
    }

    const user = await User.findById(decoded.id);
    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    return res.json({ message: "Password has been reset successfully. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Could not reset password." });
  }
};

export const bookDemo = async (req, res) => {
  try {
    const { name, phone, email, instituteName, tuitionType, studentCount, preferredTime, notes } = req.body;

    if (!name || !phone) {
      return res.status(400).json({ message: "Full Name and Phone Number are required." });
    }

    await sendDemoRequestEmail({
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim() : "",
      instituteName: instituteName ? instituteName.trim() : "",
      tuitionType: tuitionType || "Solo / Academy",
      studentCount: studentCount || "1-50",
      preferredTime: preferredTime || "Anytime",
      notes: notes ? notes.trim() : "",
    });

    return res.status(200).json({
      message: "Thank you for booking a free demo! Our team will contact you shortly.",
    });
  } catch (error) {
    console.error("Book demo error:", error);
    return res.status(500).json({ message: "Could not submit demo request. Please try again." });
  }
};

export const appForgotUserPassword = async (req, res) => {
  try {
    const rawIdentifier = (req.body.identifier || req.body.email || req.body.phone || "").toString().trim();
    if (!rawIdentifier) {
      return res.status(400).json({ message: "Email or Phone Number is required." });
    }

    const isEmail = rawIdentifier.includes("@");
    const cleanPhone = rawIdentifier.replace(/\D/g, "");
    const last10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

    let user = null;
    if (isEmail) {
      user = await User.findOne({ email: rawIdentifier.toLowerCase() });
    } else if (cleanPhone.length >= 7) {
      user = await User.findOne({
        $or: [
          { phone: cleanPhone },
          { phone: last10 },
          { phone: `+91${last10}` },
          { phone: `91${last10}` },
          { email: `teacher_${last10}@classtech.local` },
        ],
      });
    }

    if (!user) {
      return res.status(404).json({ message: "Educator account not found for the provided email or phone number." });
    }

    // Generate random 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    // Sign a temporary reset token valid for 10 minutes
    const otpToken = jwt.sign(
      { userId: user._id, email: user.email, phone: user.phone, otpHash },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    const recipientPhone = cleanPhone || user.phone?.trim();

    // 1. If user entered a Phone Number (or input is not email): send OTP via Hanu SMS API
    if (!isEmail && recipientPhone) {
      try {
        await sendSMSOTP(recipientPhone, otp);
        return res.json({
          message: `A 6-digit verification OTP code has been sent via SMS to ${recipientPhone}.`,
          otpToken,
          method: "phone",
          phone: recipientPhone,
        });
      } catch (smsErr) {
        console.error("SMS OTP error:", smsErr.message);
        if (user.email && !user.email.endsWith("@classtech.local")) {
          await sendOTPEmail(user.email, user.name || "Educator", otp);
          return res.json({
            message: `SMS failed (${smsErr.message}). A 6-digit verification OTP code was sent to your email (${user.email}).`,
            otpToken,
            method: "email",
            email: user.email,
          });
        }
        throw smsErr;
      }
    }

    // 2. If user entered an Email address: send OTP via Email
    if (user.email && !user.email.endsWith("@classtech.local")) {
      await sendOTPEmail(user.email, user.name || "Educator", otp);
      return res.json({
        message: "A 6-digit OTP verification code has been sent to your email address.",
        otpToken,
        method: "email",
        email: user.email,
      });
    }

    // Fallback if email input was provided but user has no real email
    if (recipientPhone) {
      await sendSMSOTP(recipientPhone, otp);
      return res.json({
        message: `A 6-digit verification OTP code has been sent via SMS to ${recipientPhone}.`,
        otpToken,
        method: "phone",
        phone: recipientPhone,
      });
    }

    return res.status(400).json({ message: "No valid email or mobile phone number found for this account." });
  } catch (error) {
    console.error("App forgot password error:", error);
    return res.status(500).json({ message: error.message || "Could not send verification OTP. Please try again." });
  }
};

export const appResetUserPassword = async (req, res) => {
  try {
    const { email, identifier, phone, otp, otpToken, password } = req.body;
    const reqTarget = (email || identifier || phone || "").toString().trim().toLowerCase();

    if (!otp || !otpToken || !password) {
      return res.status(400).json({ message: "OTP code, otpToken, and new password are required." });
    }

    let decoded;
    try {
      decoded = jwt.verify(otpToken, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: "Verification session has expired or is invalid." });
    }

    const inputHash = crypto.createHash("sha256").update(String(otp).trim()).digest("hex");
    if (decoded.otpHash !== inputHash) {
      return res.status(400).json({ message: "Incorrect or invalid OTP code." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long." });
    }

    let user = null;
    if (decoded.userId) {
      user = await User.findById(decoded.userId);
    }
    if (!user && reqTarget) {
      const cleanPhone = reqTarget.replace(/\D/g, "");
      const last10 = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;
      user = await User.findOne({
        $or: [
          { email: reqTarget },
          { phone: reqTarget },
          ...(cleanPhone.length >= 7 ? [{ phone: cleanPhone }, { phone: last10 }] : [])
        ]
      });
    }

    if (!user) {
      return res.status(404).json({ message: "User account not found." });
    }

    user.password = await bcrypt.hash(password, 10);
    await user.save();

    return res.json({ message: "Your password has been reset successfully! You can now log in." });
  } catch (error) {
    console.error("App reset password error:", error);
    return res.status(500).json({ message: error.message || "Could not reset password. Please try again." });
  }
};
