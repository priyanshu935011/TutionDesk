import express from "express";
import protect from "../middleware/authMiddleware.js";
import protectStudent from "../middleware/studentAuthMiddleware.js";
import {
  createNotice,
  getNotices,
  getStudentNotices,
  deleteNotice,
} from "../controllers/noticeController.js";

const router = express.Router();

// Teacher / Admin routes
router.get("/", protect, getNotices);
router.post("/", protect, createNotice);
router.delete("/:id", protect, deleteNotice);

// Student route
router.get("/student", protectStudent, getStudentNotices);

export default router;
