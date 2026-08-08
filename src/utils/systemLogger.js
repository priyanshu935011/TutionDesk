import SystemLog from "../models/SystemLog.js";

// In-memory log cache store for instant access & fallback
export const inMemoryLogs = [];

/**
 * Utility to log system failures and errors with student/teacher user context
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
    name = name || user.name;
    email = email || user.email;
    phone = phone || user.phone;
    role = role || user.role;
  }

  if (req && req.user) {
    name = name || req.user.name;
    email = email || req.user.email;
    phone = phone || req.user.phone;
    role = role || req.user.role;
  }

  const newLog = {
    _id: "log-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
    level,
    category,
    message: message || "Unknown error occurred",
    userName: name || "Anonymous User",
    userEmail: email || "N/A",
    userPhone: phone || "N/A",
    userRole: role || "user",
    instituteName: instName || "System Wide",
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

  try {
    await SystemLog.create(newLog);
  } catch (err) {}

  console.warn(`[SystemErrorLog] ${category}: ${message} (${name} | ${email} | ${phone})`);
  return newLog;
};
