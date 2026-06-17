import express from "express";
import {
  loginUser,
  changeUserPassword,
  forgotUserPassword,
  resetUserPassword,
} from "../controllers/authController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/login", loginUser);
router.post("/change-password", protect, changeUserPassword);
router.post("/forgot-password", forgotUserPassword);
router.post("/reset-password", resetUserPassword);

export default router;
