import express from "express";
import protect from "../middleware/authMiddleware.js";
import {
  getAiStatus,
  chatWithAi,
  confirmAiAction,
  parsePrompt,
  getAiUsageHistory,
  createTestSeriesFromPdf,
} from "../controllers/aiController.js";

const router = express.Router();

router.use(protect);

router.get("/status", getAiStatus);
router.get("/usage-history", getAiUsageHistory);
router.post("/chat", chatWithAi);
router.post("/confirm-action", confirmAiAction);
router.post("/parse-prompt", parsePrompt);
router.post("/test-series-from-pdf", createTestSeriesFromPdf);

export default router;
