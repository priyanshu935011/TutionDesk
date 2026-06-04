import express from "express";
import {
  studentLogin,
  forgotStudentPassword,
  resetStudentPassword,
} from "../controllers/studentAuthController.js";

const router = express.Router();

router.post("/login", studentLogin);
router.post("/forgot-password", forgotStudentPassword);
router.post("/reset-password", resetStudentPassword);

export default router;
