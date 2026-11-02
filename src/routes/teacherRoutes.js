import express from "express";
import multer from "multer";
import {
  createTestResult,
  createTestResultsBulk,
  getNotes,
  getTeacherDashboard,
  getInstituteFeatures,
  getTestResults,
  downloadNote,
  viewNote,
  uploadNote,
  updateNote,
  deleteNote,
  createHiredTeacher,
  getHiredTeachers,
  getHiredTeacherActivity,
  toggleTeacherAiAccess,
  deleteHiredTeacher,
  updateHiredTeacher,
  uploadBrandingLogo,
  updateBrandingSettings,
  updateInstituteUpi,
  parseUpiQr,
  updateTestResult,
  deleteTestResult,
  updateGroupedTestResults,
  deleteGroupedTestResults,
  sendNoteWhatsApp,
  sendTestResultWhatsApp,
  getOutstandingStudents,
  getQuickSummary,
  getWhatsappLogs,
} from "../controllers/teacherController.js";
import {
  markStaffAttendance,
  getStaffAttendanceHistory,
  getMyStaffAttendance,
} from "../controllers/staffAttendanceController.js";
import {
  getFinanceAnalytics,
  addExpense,
  deleteExpense,
  addIncome,
  deleteIncome,
  disburseStaffSalary,
  deleteStaffSalaryDisbursement,
} from "../controllers/financeController.js";
import { registerUserFcmToken } from "../controllers/pushNotificationController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/notes/:id/view", viewNote);
router.get("/notes/:id/download", downloadNote);

router.use(protect);

// FCM Token Registration for Teachers / Staff
router.post("/fcm-token", registerUserFcmToken);

router.get("/dashboard", getTeacherDashboard);
router.get("/institute-features", getInstituteFeatures);
router.get("/quick-summary", getQuickSummary);
router.get("/whatsapp-logs", getWhatsappLogs);
router.get("/outstanding-students", getOutstandingStudents);

router.route("/notes")
  .get(getNotes)
  .post(upload.single("file"), uploadNote);

router.route("/notes/:id")
  .put(upload.single("file"), updateNote)
  .delete(deleteNote);

router.post("/notes/:id/send-whatsapp", sendNoteWhatsApp);

router.route("/test-results")
  .get(getTestResults)
  .post(createTestResult);

router.post("/test-results/bulk", createTestResultsBulk);
router.post("/test-results/:id/send-whatsapp", sendTestResultWhatsApp);

router.route("/test-results/:id")
  .put(updateTestResult)
  .delete(deleteTestResult);

router.put("/test-results-grouped", updateGroupedTestResults);
router.delete("/test-results-grouped", deleteGroupedTestResults);

// Hired Teachers
router.route("/hired-teachers")
  .post(createHiredTeacher)
  .get(getHiredTeachers);

router.route("/hired-teachers/:id")
  .put(updateHiredTeacher)
  .delete(deleteHiredTeacher);

router.get("/hired-teachers/:id/activity", getHiredTeacherActivity);
router.patch("/hired-teachers/:id/ai-access", toggleTeacherAiAccess);
router.put("/hired-teachers/:id/ai-access", toggleTeacherAiAccess);

// Staff Attendance
router.post("/staff-attendance", markStaffAttendance);
router.get("/staff-attendance/my-attendance", getMyStaffAttendance);
router.get("/staff-attendance/:staffId", getStaffAttendanceHistory);

// Finance & Analytics
router.get("/finance-analytics", getFinanceAnalytics);
router.post("/finance/expenses", addExpense);
router.delete("/finance/expenses/:id", deleteExpense);
router.post("/finance/incomes", addIncome);
router.delete("/finance/incomes/:id", deleteIncome);
router.post("/finance/disburse-salary", disburseStaffSalary);
router.delete("/finance/disburse-salary/:staffId/:monthKey", deleteStaffSalaryDisbursement);

// Branding & UPI endpoints
router.post("/branding/logo", upload.single("logo"), uploadBrandingLogo);
router.put("/branding", updateBrandingSettings);
router.put("/upi", updateInstituteUpi);
router.post("/upi/parse-qr", upload.single("image"), parseUpiQr);

export default router;
