import express from "express";
import { loginUser, changeUserPassword } from "../controllers/authController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.post("/login", loginUser);
router.post("/change-password", protect, changeUserPassword);

export default router;
