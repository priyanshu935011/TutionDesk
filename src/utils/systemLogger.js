import SystemLog from "../models/SystemLog.js";
import { sendMessage } from "../services/whatsappService.js";

// In-memory log cache store for instant access & fallback
export const inMemoryLogs = [];

/**
 * Utility to log system failures and errors with user context (student, teacher, super admin, tuition admin)
 * automatically saving to database and dispatching WhatsApp alerts to 9934597030.
 */
export const logSystemError = async ({
  level = "error",
  category = "System Error",
  message,
  userName,
  userEmail,
  userPhone,
  userRole,
  instituteName,
  user,
  student,
  teacher,
  req,
  metadata = {},
}) => {
  let name = userName;
  let email = userEmail;
  let phone = userPhone;
  let role = userRole;
  let instName = instituteName;

  if (student) {
    name = name || student.name;
    email = email || student.email;
    phone = phone || student.phone || student.parentPhone;
    role = role || "student";
  }

  if (teacher) {
    name = name || teacher.name;
    email = email || teacher.email;
    phone = phone || teacher.phone;
    role = role || "teacher";
  }

  if (user) {
    name = name || user.name || user.userName;
    email = email || user.email;
    phone = phone || user.phone || user.mobile;
    role = role || user.role;
    instName = instName || (user.institute?.name || user.instituteName);
  }

  if (req) {
    if (req.res && req.res.locals) {
      req.res.locals.errorLogged = true;
    }
    if (req.user) {
      name = name || req.user.name || req.user.userName || req.user.fullName || req.user.username;
      email = email || req.user.email || req.user.userEmail;
      phone = phone || req.user.phone || req.user.userPhone || req.user.mobile || req.user.phoneNumber;
      role = role || req.user.role;
      instName = instName || (req.user.institute?.name || req.user.instituteName);
    }
    if (req.student) {
      name = name || req.student.name;
      email = email || req.student.email;
      phone = phone || req.student.phone || req.student.parentPhone || req.student.mobile;
      role = role || "student";
    }
    if (req.teacher) {
      name = name || req.teacher.name;
      email = email || req.teacher.email;
      phone = phone || req.teacher.phone || req.teacher.mobile;
      role = role || "teacher";
    }
    if (req.body) {
      name = name || req.body.name || req.body.userName || req.body.username || req.body.fullName;
      email = email || req.body.email || req.body.userEmail || req.body.studentEmail || req.body.teacherEmail;
      phone = phone || req.body.phone || req.body.mobile || req.body.userPhone || req.body.parentPhone;
    }
  }

  name = name || "Anonymous User";
  email = email || "N/A";
  phone = phone || "N/A";
  role = role || (req?.originalUrl?.includes("/student") ? "student" : req?.originalUrl?.includes("/teacher") ? "teacher" : req?.originalUrl?.includes("/admin") ? "super_admin" : "user");
  instName = instName || "General System";

  const newLog = {
    _id: "log-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
    level,
    category,
    message: message || "Unknown error occurred",
    userName: name,
    userEmail: email,
    userPhone: phone,
    userRole: role,
    instituteName: instName,
    metadata: {
      ...metadata,
      path: req?.originalUrl || req?.path || undefined,
      method: req?.method || undefined,
      timestamp: new Date().toISOString(),
    },
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  // Add to in-memory audit store
  inMemoryLogs.unshift(newLog);
  if (inMemoryLogs.length > 200) inMemoryLogs.pop();

  // Save to Database
  try {
    await SystemLog.create(newLog);
  } catch (err) {
    console.error("SystemLog DB Save Error:", err.message);
  }

  // Instant WhatsApp alert dispatch to 9934597030 (Only for important/critical 5xx server errors)
  try {
    const statusCode = metadata?.statusCode || 500;
    const reqPath = (req?.originalUrl || req?.path || metadata?.path || "").toLowerCase();
    const categoryLower = String(category || "").toLowerCase();
    const msgLower = String(message || "").toLowerCase();

    // Skip WhatsApp alert for routine login, authentication, password reset, rate-limiting, and 4xx client errors
    const isLoginOrAuth =
      reqPath.includes("/auth") ||
      reqPath.includes("/login") ||
      reqPath.includes("/forgot-password") ||
      categoryLower.includes("auth") ||
      msgLower.includes("token") ||
      msgLower.includes("unauthorized") ||
      msgLower.includes("not found") ||
      msgLower.includes("forgot-password");

    const isClientSideOrNonCritical = statusCode < 500 && statusCode !== 0;

    // Dispatch WhatsApp ONLY for critical/important server errors (500+, unhandled exceptions, DB crashes)
    const shouldSendWhatsapp =
      !isLoginOrAuth &&
      !isClientSideOrNonCritical &&
      (statusCode >= 500 || level === "critical" || level === "fatal" || categoryLower.includes("unhandled"));

    if (shouldSendWhatsapp) {
      const alertPhone = "9934597030";
      const timeStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      const methodPath = req?.method && (req?.originalUrl || req?.path)
        ? `${req.method} ${req.originalUrl || req.path}`
        : "N/A";
      const userSummary = `${name} (${email} / ${phone})`;
      const errorDetails = `${userSummary} [Role: ${role}] | Error: ${String(message || "Unknown error").substring(0, 300)}`;

      const whatsappMessage =
        `⚠️ *IMPORTANT SYSTEM ERROR ALERT*\n\n` +
        `📌 *Endpoint:* ${methodPath}\n` +
        `👤 *User:* ${userSummary}\n` +
        `🛡️ *Role:* ${role}\n` +
        `🏢 *Institute:* ${instName}\n` +
        `🚨 *Error:* ${message || "Unknown error"}\n` +
        `⏰ *Time:* ${timeStr}`;

      const templateConfig = {
        templateName: process.env.META_ERROR_TEMPLATE_NAME || "system_error_alert",
        parameters: [
          methodPath,    // {{1}}
          errorDetails,  // {{2}}
          timeStr,       // {{3}}
        ],
      };

      sendMessage("admin_test", alertPhone, whatsappMessage, "error_alert", templateConfig).catch((err) => {
        console.warn("Failed to dispatch WhatsApp error alert:", err.message);
      });
    }
  } catch (err) {
    console.warn("Error triggering WhatsApp error alert:", err.message);
  }

  console.warn(`[SystemErrorLog] ${category}: ${message} (${name} | ${email} | ${phone})`);
  return newLog;
};
