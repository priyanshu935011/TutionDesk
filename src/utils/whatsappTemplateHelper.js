import SystemSetting from "../models/SystemSetting.js";

// Defaults
export const DEFAULT_CREDENTIALS_TEMPLATE = `Welcome to {institute_name}! 🎓

Here are your login credentials for Classtech Student Portal:

👤 *Student Name:* {student_name}
🆔 *Login ID / Enrollment No:* {enrollment_number}
🔑 *Password:* {password}
🔗 *Login Link:* {login_url}

Please keep your password safe and log in to access your attendance, tests, and study notes.`;

export const DEFAULT_ABSENT_TEMPLATE = `Dear Parent, this is to inform you that your child {studentName} was absent for class on {date} at {instituteName}. Please contact us if you have any questions.`;

export const DEFAULT_FEE_REMINDER_TEMPLATE = `Dear {parentName}, this is a friendly reminder that INR {pendingAmount} is outstanding for student {studentName}'s tuition fee at {instituteName}. Due date: {dueDate}. Thank you!`;

export const DEFAULT_TEST_MARKS_TEMPLATE = `Dear Parent, test results for {studentName} have been published for {testName} at {instituteName}.
Score: {marksObtained} / {totalMarks} ({percentage}%).
Status/Remarks: {remarks}`;

export const DEFAULT_HELLO_WORLD_TEMPLATE = `Welcome and congratulations!! This message demonstrates your ability to send a WhatsApp message notification from the Cloud API, hosted by Meta. Thank you for taking the time to test with us.`;

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

export const getGlobalTemplates = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "whatsapp_global_templates" });
    const stored = setting?.value || {};
    return {
      credentials: stored.credentials || DEFAULT_CREDENTIALS_TEMPLATE,
      absent: stored.absent || DEFAULT_ABSENT_TEMPLATE,
      feeReminder: stored.feeReminder || DEFAULT_FEE_REMINDER_TEMPLATE,
      testMarks: stored.testMarks || DEFAULT_TEST_MARKS_TEMPLATE,
      helloWorld: stored.helloWorld || DEFAULT_HELLO_WORLD_TEMPLATE,
    };
  } catch (err) {
    console.error("Error fetching whatsapp_global_templates from DB:", err.message);
    return {
      credentials: DEFAULT_CREDENTIALS_TEMPLATE,
      absent: DEFAULT_ABSENT_TEMPLATE,
      feeReminder: DEFAULT_FEE_REMINDER_TEMPLATE,
      testMarks: DEFAULT_TEST_MARKS_TEMPLATE,
      helloWorld: DEFAULT_HELLO_WORLD_TEMPLATE,
    };
  }
};

export const formatCredentialsMessage = ({
  template,
  studentName = "",
  enrollmentNumber = "",
  password = "",
  phone = "",
  instituteName = "Classtech",
  loginUrl = "",
}) => {
  const tpl = template || DEFAULT_CREDENTIALS_TEMPLATE;
  const baseUrl = loginUrl || process.env.FRONTEND_URL || "https://classtech.vercel.app/student/login";

  return tpl
    .replace(/\{student_name\}/gi, studentName)
    .replace(/\{enrollment_number\}/gi, enrollmentNumber)
    .replace(/\{password\}/gi, password)
    .replace(/\{phone\}/gi, phone)
    .replace(/\{institute_name\}/gi, instituteName)
    .replace(/\{login_url\}/gi, baseUrl);
};

export const formatAbsentMessage = ({
  template,
  studentName = "",
  date = "",
  instituteName = "Classtech",
}) => {
  const tpl = template || DEFAULT_ABSENT_TEMPLATE;
  return tpl
    .replace(/\{studentName\}/gi, studentName)
    .replace(/\{date\}/gi, date)
    .replace(/\{instituteName\}/gi, instituteName);
};

export const formatFeeReminderMessage = ({
  template,
  studentName = "",
  parentName = "Parent",
  pendingAmount = "0",
  dueDate = "",
  instituteName = "Classtech",
}) => {
  const tpl = template || DEFAULT_FEE_REMINDER_TEMPLATE;
  return tpl
    .replace(/\{studentName\}/gi, studentName)
    .replace(/\{parentName\}/gi, parentName)
    .replace(/\{pendingAmount\}/gi, pendingAmount)
    .replace(/\{dueDate\}/gi, dueDate)
    .replace(/\{instituteName\}/gi, instituteName);
};

export const formatTestMarksMessage = ({
  template,
  studentName = "",
  testName = "",
  marksObtained = "0",
  totalMarks = "0",
  percentage = "0",
  remarks = "",
  instituteName = "Classtech",
}) => {
  const tpl = template || DEFAULT_TEST_MARKS_TEMPLATE;
  return tpl
    .replace(/\{studentName\}/gi, studentName)
    .replace(/\{testName\}/gi, testName)
    .replace(/\{marksObtained\}/gi, marksObtained)
    .replace(/\{totalMarks\}/gi, totalMarks)
    .replace(/\{percentage\}/gi, percentage)
    .replace(/\{remarks\}/gi, remarks)
    .replace(/\{instituteName\}/gi, instituteName);
};
