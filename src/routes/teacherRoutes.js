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
  getQuizLeaderboard,
  uploadBrandingLogo,
  updateBrandingSettings,
  updateTestResult,
  deleteTestResult,
  updateGroupedTestResults,
  deleteGroupedTestResults,
} from "../controllers/teacherController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect);

const checkQuizFeature = (req, res, next) => {
  if (req.user?.role !== "super_admin" && req.user?.institute?.quizFeatureEnabled === false) {
    return res.status(403).json({ message: "Quiz feature is disabled for this institute" });
  }
  next();
};

router.get("/dashboard", getTeacherDashboard);
router.get("/quizzes", checkQuizFeature, getQuizzes);
router.post("/quizzes", checkQuizFeature, createQuiz);
router.put("/quizzes/:id", checkQuizFeature, updateQuiz);
router.delete("/quizzes/:id", checkQuizFeature, deleteQuiz);
router.post("/quizzes/:id/live", checkQuizFeature, startQuizLive);
router.get("/quizzes/:id/leaderboard", checkQuizFeature, getQuizLeaderboard);

router.get("/notes", getNotes);
router.get("/notes/:id/download", downloadNote);
router.post("/notes", upload.single("pdf"), uploadNote);
router.delete("/notes/:id", deleteNote);

router.get("/test-results", getTestResults);
router.post("/test-results", createTestResult);
router.post("/test-results/bulk", createTestResultsBulk);
router.put("/test-results/:id", updateTestResult);
router.delete("/test-results/:id", deleteTestResult);
router.post("/test-results/grouped/update", updateGroupedTestResults);
router.post("/test-results/grouped/delete", deleteGroupedTestResults);

router.route("/hired-teachers")
  .get(getHiredTeachers)
  .post(createHiredTeacher);
router.delete("/hired-teachers/:id", deleteHiredTeacher);

// Branding endpoints
router.post("/branding/logo", upload.single("logo"), uploadBrandingLogo);
router.put("/branding", updateBrandingSettings);

export default router;
