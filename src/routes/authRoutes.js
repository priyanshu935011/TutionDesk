import express from "express";
import {
  loginUser,
  changeUserPassword,
  forgotUserPassword,
  resetUserPassword,
  bookDemo,
} from "../controllers/authController.js";
import protect from "../middleware/authMiddleware.js";
const router = express.Router();

router.post("/login", loginUser);
router.post("/change-password", protect, changeUserPassword);
router.post("/forgot-password", forgotUserPassword);
router.post("/reset-password", resetUserPassword);
router.post("/book-demo", bookDemo);

export default router;
