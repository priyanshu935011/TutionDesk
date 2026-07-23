import SystemLog from "../models/SystemLog.js";

// In-memory log cache store for instant access & fallback
export const inMemoryLogs = [
  {
    _id: "log-1",
    level: "error",
    category: "WhatsApp Failure",
    message: "Failed to deliver absence WhatsApp alert: WhatsApp gateway session disconnected.",
    userName: "Saksham Thapa",
    userEmail: "saksham.thapa@gmail.com",
    userPhone: "9031285632",
    userRole: "student",
    instituteName: "Tiwari & son's Academy",
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    _id: "log-2",
    level: "warning",
    category: "Authentication Failed",
    message: "Invalid password provided during login attempt (4 consecutive attempts).",
    userName: "Vikash Sir",
    userEmail: "jhamlal2003@gmail.com",
    userPhone: "7319721155",
    userRole: "teacher",
    instituteName: "Tiwari & son's Academy",
    createdAt: new Date(Date.now() - 45 * 60 * 1000).toISOString(),
  },
  {
    _id: "log-3",
    level: "error",
    category: "WhatsApp Broadcast Failed",
    message: "Test marks report card broadcast failed: Target phone number not on WhatsApp network.",
    userName: "Om Sharma",
    userEmail: "sanjay69kumar191919@gmail.com",
    userPhone: "98353054",
    userRole: "student",
    instituteName: "Tiwari & son's Academy",
    createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  },
  {
    _id: "log-4",
    level: "failed",
    category: "Payment Failure",
    message: "Fee collection entry failed: Payment token validation mismatch.",
    userName: "Arnav Aaryan",
    userEmail: "arnavaryan11245@gmail.com",
    userPhone: "9304163669",
    userRole: "student",
    instituteName: "Tiwari & son's Academy",
    createdAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  },
  {
    _id: "log-5",
    level: "error",
    category: "Quiz Submission Error",
    message: "Quiz response sync failed: Network timeout during submission.",
    userName: "Pratiksha Thapa",
    userEmail: "priyashailesh1920@gmail.com",
    userPhone: "7061640830",
    userRole: "student",
    instituteName: "Tiwari & son's Academy",
    createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString(),
  },
];

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
