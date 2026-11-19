import express from "express";
import protect, { optionalAuth } from "../middleware/authMiddleware.js";
import superAdminOnly from "../middleware/superAdminMiddleware.js";
import {
  sendDirectStudentOtp,
  verifyDirectStudentOtp,
  solveStudentDoubtWithAi,
  getStudentMistakes,
  logMistakeToBook,
  generateMistakesRetest,
  resolveMistakeItem,
  generateAiRevisionPack,
  getAiCareerGuidance,
  completeFocusSession,
  getVirtualStudyRooms,
  getPyqQuestions,
  generateParentSnapshotToken,
  viewParentSnapshot,
  getStorePackages,
  createPackageOrder,
  verifyAndUnlockPackage,
  transitionArchivedStudent,
  getAdminStudentPackages,
  createOrUpdateStudentPackage,
  setStudentFeatureOverride,
} from "../controllers/studentD2cController.js";

const router = express.Router();

// 1. Direct Student OTP Auth
router.post("/auth/send-otp", sendDirectStudentOtp);
router.post("/auth/verify-otp", verifyDirectStudentOtp);

// 2. Multimodal AI Doubt Solver
router.post("/ai/solve-doubt", optionalAuth, solveStudentDoubtWithAi);

// 3. AI Mistake Book
router.get("/mistakes", optionalAuth, getStudentMistakes);
router.post("/mistakes/log", optionalAuth, logMistakeToBook);
router.post("/mistakes/retest", optionalAuth, generateMistakesRetest);
router.patch("/mistakes/:id/resolve", optionalAuth, resolveMistakeItem);

// 4. AI Revision & Spaced Repetition
router.post("/ai/generate-revision", optionalAuth, generateAiRevisionPack);

// 5. AI Career & Stream Guidance
router.post("/ai/career-guidance", optionalAuth, getAiCareerGuidance);

// 6. Gamified Focus Mode
router.post("/focus/complete", optionalAuth, completeFocusSession);

// 7. Virtual Study Rooms
router.get("/study-rooms", optionalAuth, getVirtualStudyRooms);

// 8. Interactive PYQ Bank
router.get("/pyqs", optionalAuth, getPyqQuestions);

// 9. Parent Progress Snapshot
router.post("/parent-snapshot/generate", optionalAuth, generateParentSnapshotToken);
router.get("/parent-snapshot/view/:token", viewParentSnapshot);

// 10. In-Dashboard Store & Native Cashfree Checkout
router.get("/store/packages", getStorePackages);
router.post("/store/create-order", optionalAuth, createPackageOrder);
router.post("/store/verify-payment", optionalAuth, verifyAndUnlockPackage);

// 11. Institute Archive Transition
router.post("/archive-transition", transitionArchivedStudent);

// 12. Super Admin Package & Feature Manager
router.get("/admin/packages", protect, superAdminOnly, getAdminStudentPackages);
router.post("/admin/packages", protect, superAdminOnly, createOrUpdateStudentPackage);
router.put("/admin/packages/:id", protect, superAdminOnly, createOrUpdateStudentPackage);
router.post("/admin/student-override", protect, superAdminOnly, setStudentFeatureOverride);

export default router;
