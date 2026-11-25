import express from "express";
import {
  getConfig,
  startSession,
  interact,
  endSession,
} from "../controllers/aiTutorController.js";

const router = express.Router();

router.get("/config", getConfig);
router.get("/entitlements", getConfig);
router.post("/sessions", startSession);
router.post("/sessions/:sessionId/interact", interact);
router.post("/sessions/:sessionId/end", endSession);

export default router;
