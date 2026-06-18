import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import redisClient from "../config/redis.js";
import { sendResetEmail } from "../utils/mailer.js";

const SUPER_ADMIN_EMAIL = (process.env.SUPER_ADMIN_EMAIL || "admin@tutiondesk.com").toLowerCase();
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || "Admin@12345!";

const generateToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

const buildInstituteState = async (user) => {
  if (!user.institute) {
    return null;
  }

  const institute = await Institute.findById(user.institute).select(
    "name subscriptionPlan subscriptionAmount trialDays subscriptionStart subscriptionEnd status tuitionType quizFeatureEnabled"
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

    const normalizedEmail = email.toLowerCase();

    if (
      normalizedEmail === SUPER_ADMIN_EMAIL &&
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

    const user = await User.findOne({ email: normalizedEmail });

    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const institute = await buildInstituteState(user);

    const sessionId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 11);
    user.currentSessionId = sessionId;
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
    return res.status(500).json({ message: "Login failed" });
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

    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
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
