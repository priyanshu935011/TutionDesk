import express from "express";
import protect from "../middleware/authMiddleware.js";
import {
  getAiStatus,
  chatWithAi,
  confirmAiAction,
} from "../controllers/aiController.js";

const router = express.Router();

router.use(protect);

router.get("/status", getAiStatus);
router.post("/chat", chatWithAi);
router.post("/confirm-action", confirmAiAction);

export default router;
