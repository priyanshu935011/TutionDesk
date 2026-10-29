import express from "express";
import protect from "../middleware/authMiddleware.js";
import {
  getAiStatus,
  chatWithAi,
  confirmAiAction,
  parsePrompt,
} from "../controllers/aiController.js";

const router = express.Router();

router.use(protect);

router.get("/status", getAiStatus);
router.post("/chat", chatWithAi);
router.post("/confirm-action", confirmAiAction);
router.post("/parse-prompt", parsePrompt);

export default router;
