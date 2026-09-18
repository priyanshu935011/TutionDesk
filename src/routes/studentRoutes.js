import express from "express";
import multer from "multer";
import {
  addPayment,
  archiveStudent,
  bulkCreateStudents,
  createStudent,
  deleteStudent,
  getBatchAttendanceByDate,
  getStudentAttendanceById,
  getStudentBasicById,
  getStudentById,
  getStudentPaymentsById,
  getStudentPersonalInfoById,
  getStudents,
  markAttendance,
  markBatchAttendance,
  updateStudent,
  sendStudentCredentialsWhatsApp,
  sendPaymentReceiptWhatsApp,
  sendFeeReminderWhatsApp,
} from "../controllers/studentController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);
router.get("/batch-attendance", getBatchAttendanceByDate);
router.post("/bulk", bulkCreateStudents);
router.post("/batch-attendance", markBatchAttendance);
router.route("/").get(getStudents).post(createStudent);
router.get("/:id/basic", getStudentBasicById);
router.get("/:id/personal-info", getStudentPersonalInfoById);
router.get("/:id/payments", getStudentPaymentsById);
router.get("/:id/attendance", getStudentAttendanceById);
router.get("/:id", getStudentById);
router.put("/:id/archive", archiveStudent);
router.post("/:id/send-credentials-whatsapp", sendStudentCredentialsWhatsApp);
router.post("/:id/send-fee-reminder", sendFeeReminderWhatsApp);
router.post("/:id/payments", addPayment);
router.post("/:id/payments/:paymentId/send-receipt", upload.single("receipt"), sendPaymentReceiptWhatsApp);
router.post("/:id/attendance", markAttendance);
router.route("/:id").put(updateStudent).delete(deleteStudent);

export default router;
