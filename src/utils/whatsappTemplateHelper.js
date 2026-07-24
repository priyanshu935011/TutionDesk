import SystemSetting from "../models/SystemSetting.js";

export const DEFAULT_CREDENTIALS_TEMPLATE = `Welcome to {institute_name}! 🎓

Here are your login credentials for TuitionDesk Student Portal:

👤 *Student Name:* {student_name}
🆔 *Login ID / Enrollment No:* {enrollment_number}
🔑 *Password:* {password}
🔗 *Login Link:* {login_url}

Please keep your password safe and log in to access your attendance, tests, and study notes.`;

export const getCredentialsTemplate = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "whatsapp_credentials_template" });
    if (setting && setting.value && typeof setting.value === "string" && setting.value.trim() !== "") {
      return setting.value;
    }
  } catch (err) {
    console.error("Error fetching whatsapp_credentials_template from DB:", err.message);
  }
  return DEFAULT_CREDENTIALS_TEMPLATE;
};

export const formatCredentialsMessage = ({
  template,
  studentName = "",
  enrollmentNumber = "",
  password = "",
  phone = "",
  instituteName = "TuitionDesk",
  loginUrl = "",
}) => {
  const tpl = template || DEFAULT_CREDENTIALS_TEMPLATE;
  const baseUrl = loginUrl || process.env.FRONTEND_URL || "https://tuitiondesk.vercel.app/student/login";

  return tpl
    .replace(/\{student_name\}/gi, studentName)
    .replace(/\{enrollment_number\}/gi, enrollmentNumber)
    .replace(/\{password\}/gi, password)
    .replace(/\{phone\}/gi, phone)
    .replace(/\{institute_name\}/gi, instituteName)
    .replace(/\{login_url\}/gi, baseUrl);
};
