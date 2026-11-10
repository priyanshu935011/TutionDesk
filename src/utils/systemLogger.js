import SystemLog from "../models/SystemLog.js";
import { sendMessage } from "../services/whatsappService.js";
import crypto from "crypto";
import { maskEmail, maskIp, maskPhone, sanitizeObjectForLog } from "./piiSanitizer.js";

// In-memory log cache store for instant access & fallback
export const inMemoryLogs = [];

/**
 * Utility to log system failures and errors with masked user context (DPDP Rule 6 PII sanitization).
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
  }

  const maskedEmail = email ? maskEmail(email) : "N/A";
  const maskedPhone = phone ? maskPhone(phone) : "N/A";
  const safeName = name ? `${String(name).trim().charAt(0)}***` : "User";
  role = role || (req?.originalUrl?.includes("/student") ? "student" : req?.originalUrl?.includes("/teacher") ? "teacher" : req?.originalUrl?.includes("/admin") ? "super_admin" : "user");
  instName = instName || "General System";

  const sanitizedMessage = sanitizeObjectForLog(String(message || "Unknown error occurred"));
  const cleanMeta = sanitizeObjectForLog({
    ...metadata,
    path: req?.originalUrl || req?.path || undefined,
    method: req?.method || undefined,
    ip: metadata?.ip ? maskIp(metadata.ip) : req?.ip ? maskIp(req.ip) : undefined,
    timestamp: new Date().toISOString(),
  });

  const logId = crypto.randomUUID();
  const newLog = {
    _id: logId,
    id: logId,
    level,
    category,
    message: sanitizedMessage,
    userName: safeName,
    userEmail: maskedEmail,
    userPhone: maskedPhone,
    userRole: role,
    instituteName: instName,
    metadata: cleanMeta,
    isRead: false,
    createdAt: new Date().toISOString(),
  };

  // Add to in-memory audit store
  inMemoryLogs.unshift(newLog);
  if (inMemoryLogs.length > 200) inMemoryLogs.pop();

  // Save to Database
  try {
    const savedDoc = await SystemLog.create(newLog);
    if (savedDoc && (savedDoc._id || savedDoc.id)) {
      newLog._id = String(savedDoc._id || savedDoc.id);
      newLog.id = newLog._id;
    }
  } catch (err) {
    console.error("SystemLog DB Save Error:", err.message);
  }

  // Dispatch strictly PII-free operational error alert (never include raw user phone, email, or name)
  try {
    const statusCode = metadata?.statusCode || 500;
    const reqPath = (req?.originalUrl || req?.path || metadata?.path || "").toLowerCase();
    const categoryLower = String(category || "").toLowerCase();
    const msgLower = String(sanitizedMessage || "").toLowerCase();

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

    const shouldSendWhatsapp =
      !isLoginOrAuth &&
      !isClientSideOrNonCritical &&
      (statusCode >= 500 || level === "critical" || level === "fatal" || categoryLower.includes("unhandled"));

    const alertPhone = process.env.ALERT_PHONE || "";
    if (shouldSendWhatsapp && alertPhone) {
      const timeStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
      const methodPath = req?.method && (req?.originalUrl || req?.path)
        ? `${req.method} ${req.originalUrl || req.path}`
        : "N/A";
      const actorRef = req?.user?._id || req?.student?._id || "anonymous";
      const sanitizedErrorDetails = `Role: ${role} | Ref: ${String(actorRef).slice(-8)} | Error: ${String(sanitizedMessage).substring(0, 260)}`;

      const whatsappMessage =
        `⚠️ *SYSTEM ERROR ALERT (PII-Redacted)*\n\n` +
        `📌 *Endpoint:* ${methodPath}\n` +
        `🛡️ *Role:* ${role} (Ref: ${String(actorRef).slice(-8)})\n` +
        `🏢 *Institute:* ${instName}\n` +
        `🚨 *Error:* ${sanitizedMessage}\n` +
        `⏰ *Time:* ${timeStr}`;

      const templateConfig = process.env.META_ERROR_TEMPLATE_NAME
        ? {
            templateName: process.env.META_ERROR_TEMPLATE_NAME,
            parameters: [methodPath, sanitizedErrorDetails, timeStr],
          }
        : null;

      sendMessage("admin_test", alertPhone, whatsappMessage, "error_alert", templateConfig).catch((err) => {
        console.warn("Failed to dispatch WhatsApp error alert:", err.message);
      });
    }
  } catch (err) {
    console.warn("Error triggering WhatsApp error alert:", err.message);
  }

  console.warn(`[SystemErrorLog] ${category}: ${sanitizedMessage} (${role})`);
  return newLog;
};

