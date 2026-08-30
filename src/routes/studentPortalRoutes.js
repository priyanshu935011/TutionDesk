import express from "express";
import multer from "multer";
import {
  downloadStudentNote,
  getStudentPortalData,
  getQuizLeaderboard,
} from "../controllers/studentController.js";
import {
  changeStudentPassword,
  switchProfile,
  updateStudentProfile,
  uploadStudentProfilePicture,
} from "../controllers/studentAuthController.js";
import protectStudent from "../middleware/studentAuthMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protectStudent);

router.get("/dashboard", getStudentPortalData);
router.get("/notes/:id/download", downloadStudentNote);
router.post("/change-password", changeStudentPassword);
router.post("/switch-profile", switchProfile);
router.put("/profile", updateStudentProfile);
router.post("/profile-picture", upload.single("image"), uploadStudentProfilePicture);
router.get("/quizzes/:id/leaderboard", getQuizLeaderboard);

export default router;
