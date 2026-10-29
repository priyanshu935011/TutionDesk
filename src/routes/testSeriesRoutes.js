import jwt from "jsonwebtoken";
import express from "express";
import multer from "multer";
import protect from "../middleware/authMiddleware.js";
import protectStudent from "../middleware/studentAuthMiddleware.js";
import {
  getCategories,
  createCategory,
  deleteCategory,
  getFolders,
  createFolder,
  updateFolder,
  deleteFolder,
  getTestSeriesList,
  getTestSeriesById,
  createTestSeries,
  updateTestSeries,
  deleteTestSeries,
  assignTestSeries,
  getTestSeriesAnalytics,
  getStudentTests,
  startStudentTest,
  submitStudentTest,
  getStudentAttemptResult,
  convertPdfToTestSeries,
} from "../controllers/testSeriesController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const router = express.Router();

// Middleware to accept either student portal token or general user token
const studentAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.decode(token);
      if (decoded && decoded.role && decoded.role !== "student") {
        return protect(req, res, next);
      }
    } catch (_) {}
  }
  return protectStudent(req, res, next);
};

// ---------------- STUDENT ROUTES ----------------
router.get("/student/my-tests", studentAuth, getStudentTests);
router.get("/student/:id/start", studentAuth, startStudentTest);
router.post("/student/:id/submit", studentAuth, submitStudentTest);
router.get("/student/attempt/:attemptId", studentAuth, getStudentAttemptResult);

// ---------------- COMMON / TEACHER / ADMIN ROUTES ----------------
router.use(protect);

// AI PDF Converter
router.post("/convert-pdf", upload.single("pdfFile"), convertPdfToTestSeries);

// Categories
router.get("/categories", getCategories);
router.post("/categories", createCategory);
router.delete("/categories/:id", deleteCategory);

// Folders
router.get("/folders", getFolders);
router.post("/folders", createFolder);
router.put("/folders/:id", updateFolder);
router.delete("/folders/:id", deleteFolder);

// Test Series CRUD
router.get("/", getTestSeriesList);
router.post("/", createTestSeries);
router.get("/:id", getTestSeriesById);
router.put("/:id", updateTestSeries);
router.delete("/:id", deleteTestSeries);

// Teacher Batch Assignment & Analytics
router.post("/:id/assignment", assignTestSeries);
router.post("/:id/access", assignTestSeries);
router.put("/:id/access", assignTestSeries);
router.get("/:id/analytics", getTestSeriesAnalytics);

export default router;
