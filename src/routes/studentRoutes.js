import express from "express";
import {
  addPayment,
  bulkCreateStudents,
  createStudent,
  deleteStudent,
  getStudentById,
  getStudents,
  markAttendance,
  markBatchAttendance,
  updateStudent,
  sendStudentCredentialsWhatsApp,
} from "../controllers/studentController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.post("/bulk", bulkCreateStudents);
router.post("/batch-attendance", markBatchAttendance);
router.route("/").get(getStudents).post(createStudent);
router.get("/:id", getStudentById);
router.post("/:id/send-credentials-whatsapp", sendStudentCredentialsWhatsApp);
router.post("/:id/payments", addPayment);
router.post("/:id/attendance", markAttendance);
router.route("/:id").put(updateStudent).delete(deleteStudent);

export default router;
