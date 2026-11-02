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
import protect from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get("/notes/:id/view", viewNote);
router.get("/notes/:id/download", downloadNote);

router.use(protect);

router.get("/dashboard", getTeacherDashboard);
router.get("/sync", getTeacherDashboard);
router.get("/quick-summary", getQuickSummary);
router.get("/outstanding-students", getOutstandingStudents);
router.get("/whatsapp-logs", getWhatsappLogs);

// Direct DB read — no cache/Redis — for always-fresh feature gating
router.get("/features", getInstituteFeatures);

router.get("/notes", getNotes);
router.get("/notes/:id/download", downloadNote);
router.post("/notes", upload.single("pdf"), uploadNote);
router.put("/notes/:id", updateNote);
router.post("/notes/:id/send-whatsapp", sendNoteWhatsApp);
router.delete("/notes/:id", deleteNote);

router.get("/test-results", getTestResults);
router.post("/test-results", createTestResult);
router.post("/test-results/bulk", createTestResultsBulk);
router.put("/test-results/:id", updateTestResult);
router.post("/test-results/:id/send-whatsapp", sendTestResultWhatsApp);
router.delete("/test-results/:id", deleteTestResult);
router.post("/test-results/grouped/update", updateGroupedTestResults);
router.post("/test-results/grouped/delete", deleteGroupedTestResults);

router.route("/hired-teachers")
  .get(getHiredTeachers)
  .post(createHiredTeacher);
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
