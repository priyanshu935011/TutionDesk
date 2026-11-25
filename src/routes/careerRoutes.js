import express from "express";
import { optionalAuth } from "../middleware/authMiddleware.js";
import {
  getAssessment,
  saveAssessment,
  completeAssessment,
  getRecommendations,
  getRoadmap,
  toggleMilestone,
  chatWithCounsellor,
  compareCareers,
  getCatalogList,
  getCareerDetails,
  getCollegesAndExams,
} from "../controllers/careerController.js";

const router = express.Router();

// 1. Assessment Routes
router.get("/assessment", optionalAuth, getAssessment);
router.post("/assessment/save", optionalAuth, saveAssessment);
router.post("/assessment/complete", optionalAuth, completeAssessment);

// 2. Recommendations & Matches
router.get("/recommendations", optionalAuth, getRecommendations);

// 3. Personalized Roadmap
router.get("/roadmap", optionalAuth, getRoadmap);
router.patch("/roadmap/milestone/:milestoneId", optionalAuth, toggleMilestone);

// 4. AI Career Counsellor
router.post("/chat", optionalAuth, chatWithCounsellor);

// 5. Career Comparison
router.post("/compare", optionalAuth, compareCareers);

// 6. Career Catalog
router.get("/catalog", optionalAuth, getCatalogList);
router.get("/catalog/:id", optionalAuth, getCareerDetails);

// 7. Colleges & Entrance Exams Radar
router.get("/colleges-exams", optionalAuth, getCollegesAndExams);

export default router;
