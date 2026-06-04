import express from "express";
import multer from "multer";
import {
  createQuiz,
  createTestResult,
  createTestResultsBulk,
  deleteQuiz,
  getNotes,
  getQuizzes,
  getTeacherDashboard,
  getTestResults,
  startQuizLive,
  updateQuiz,
  downloadNote,
  uploadNote,
  deleteNote,
  createHiredTeacher,
  getHiredTeachers,
  deleteHiredTeacher,
} from "../controllers/teacherController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

router.get("/dashboard", getTeacherDashboard);
router.get("/quizzes", getQuizzes);
router.post("/quizzes", createQuiz);
router.put("/quizzes/:id", updateQuiz);
router.delete("/quizzes/:id", deleteQuiz);
router.post("/quizzes/:id/live", startQuizLive);

router.get("/notes", getNotes);
router.get("/notes/:id/download", downloadNote);
router.post("/notes", upload.single("pdf"), uploadNote);
router.delete("/notes/:id", deleteNote);

router.get("/test-results", getTestResults);
router.post("/test-results", createTestResult);
router.post("/test-results/bulk", createTestResultsBulk);

router.route("/hired-teachers")
  .get(getHiredTeachers)
  .post(createHiredTeacher);
router.delete("/hired-teachers/:id", deleteHiredTeacher);

export default router;
