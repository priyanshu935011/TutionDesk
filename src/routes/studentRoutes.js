import express from "express";
import {
  addPayment,
  createStudent,
  deleteStudent,
  getStudentById,
  getStudents,
  markAttendance,
  updateStudent,
} from "../controllers/studentController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.use(protect);
router.route("/").get(getStudents).post(createStudent);
router.get("/:id", getStudentById);
router.post("/:id/payments", addPayment);
router.post("/:id/attendance", markAttendance);
router.route("/:id").put(updateStudent).delete(deleteStudent);

export default router;
