import express from "express";
import protect from "../middleware/authMiddleware.js";
import {
  getAgentStatus,
  startAgent,
  stopAgent,
  triggerStep,
  updateConfig,
  getStagedTests,
  getStagedTestById,
  approveTest,
  rejectTest,
  approveAll,
  deleteStagedTest,
} from "../controllers/agentController.js";

const router = express.Router();

const superAdminOnly = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: "Not authorized" });
  }
  if (
    req.user.role === "super_admin" ||
    req.user.role === "tech_admin" ||
    req.user.isSuperAdmin === true ||
    req.user.isAdmin === true
  ) {
    return next();
  }
  return res.status(403).json({ message: "Access restricted to Super Admin." });
};

// All agent routes are protected and restricted to super admins
router.use(protect, superAdminOnly);

// Agent Telemetry & Control
router.get("/status", getAgentStatus);
router.get("/:agentId/status", getAgentStatus);
router.post("/start", startAgent);
router.post("/stop", stopAgent);
router.post("/step", triggerStep);
router.put("/config", updateConfig);

// Staged Test Series Management
router.get("/tests", getStagedTests);
router.post("/tests/approve-all", approveAll);
router.get("/tests/:id", getStagedTestById);
router.post("/tests/:id/approve", approveTest);
router.post("/tests/:id/reject", rejectTest);
router.delete("/tests/:id", deleteStagedTest);

export default router;
