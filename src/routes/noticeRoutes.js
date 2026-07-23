import express from "express";
import protect from "../middleware/authMiddleware.js";
import {
  createNotice,
  getNotices,
  getStudentNotices,
  deleteNotice,
} from "../controllers/noticeController.js";

const router = express.Router();

router.use(protect);

router.get("/", getNotices);
router.post("/", createNotice);
router.get("/student", getStudentNotices);
router.delete("/:id", deleteNotice);

export default router;
