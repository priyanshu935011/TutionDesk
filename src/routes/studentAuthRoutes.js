import express from "express";
import multer from "multer";
import {
  studentLogin,
  forgotStudentPassword,
  resetStudentPassword,
  updateStudentProfile,
  uploadStudentProfilePicture,
} from "../controllers/studentAuthController.js";
import protectStudent from "../middleware/studentAuthMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.post("/login", studentLogin);
router.post("/forgot-password", forgotStudentPassword);
router.post("/reset-password", resetStudentPassword);
router.put("/profile", protectStudent, updateStudentProfile);
router.post("/profile-picture", protectStudent, upload.single("image"), uploadStudentProfilePicture);

export default router;
