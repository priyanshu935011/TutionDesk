import express from "express";
import {
  downloadStudentNote,
  getStudentPortalData,
  getQuizLeaderboard,
} from "../controllers/studentController.js";
import { changeStudentPassword } from "../controllers/studentAuthController.js";
import protectStudent from "../middleware/studentAuthMiddleware.js";

const router = express.Router();

router.use(protectStudent);

router.get("/dashboard", getStudentPortalData);
router.get("/notes/:id/download", downloadStudentNote);
router.post("/change-password", changeStudentPassword);
router.get("/quizzes/:id/leaderboard", getQuizLeaderboard);

export default router;
