import {
  saveAssessmentDraft,
  getStudentAssessment,
  generateRecommendations,
  getOrGenerateCareerRoadmap,
  toggleRoadmapMilestone,
  askCareerCounsellor,
  compareTwoCareers,
  getCatalog,
  getCareerById,
  CAREER_MAP,
} from "../services/careerService.js";
import { getOrCreateStudentEntitlement } from "../services/studentEntitlementService.js";
import Student from "../models/Student.js";

// Helper to extract student/user ID from authenticated request
function getUserIdFromReq(req) {
  return String(
    req.user?.studentId ||
    req.user?.id ||
    req.user?._id ||
    req.student?.id ||
    req.student?._id ||
    req.body.userId ||
    req.query.userId ||
    "guest_learner"
  );
}

// Helper to check if student has active ClassTech Premium
async function checkIsStudentPremium(userId) {
  try {
    const entitlement = await getOrCreateStudentEntitlement(userId);
    return (entitlement?.tier || "").toLowerCase() === "premium";
  } catch (_) {
    return false;
  }
}

// ============================================================================
// 1. ASSESSMENT CONTROLLER
// ============================================================================

export const getAssessment = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const assessment = await getStudentAssessment(userId);
    const isPremium = await checkIsStudentPremium(userId);

    return res.json({
      success: true,
      assessment: assessment || null,
      hasAssessment: !!assessment,
      isPremium,
    });
  } catch (error) {
    console.error("[CareerController] getAssessment error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const saveAssessment = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const data = req.body;

    const saved = await saveAssessmentDraft(userId, data);
    return res.json({
      success: true,
      message: "Assessment progress saved successfully.",
      assessment: saved,
    });
  } catch (error) {
    console.error("[CareerController] saveAssessment error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const completeAssessment = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const data = req.body;

    // Save final state as completed
    const saved = await saveAssessmentDraft(userId, { ...data, isCompleted: true });
    const isPremium = await checkIsStudentPremium(userId);

    // Generate recommendations immediately
    const recommendations = await generateRecommendations(userId, saved.id, isPremium);

    return res.json({
      success: true,
      message: "Career Assessment completed successfully! Your recommendations are ready.",
      assessment: saved,
      recommendations,
      isPremium,
    });
  } catch (error) {
    console.error("[CareerController] completeAssessment error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 2. RECOMMENDATIONS CONTROLLER
// ============================================================================

export const getRecommendations = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { assessmentId } = req.query;
    const isPremium = await checkIsStudentPremium(userId);

    const data = await generateRecommendations(userId, assessmentId || null, isPremium);

    return res.json({
      success: true,
      ...data,
    });
  } catch (error) {
    console.error("[CareerController] getRecommendations error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 3. ROADMAP CONTROLLER (Premium Gated)
// ============================================================================

export const getRoadmap = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { targetCareerId = "ai_ml_engineer" } = req.query;
    const isPremium = await checkIsStudentPremium(userId);

    const targetCareer = CAREER_MAP.get(targetCareerId) || CAREER_MAP.get("ai_ml_engineer");

    if (!isPremium) {
      // Free users receive an attractive locked preview
      return res.json({
        success: true,
        isPremium: false,
        isLocked: true,
        message: "Personalized 5-Phase Roadmaps are exclusively available with ClassTech Premium.",
        targetCareer: {
          id: targetCareer.id,
          name: targetCareer.career_name,
          category: targetCareer.category,
        },
        previewPhases: [
          { phaseNumber: 1, phaseTitle: "Phase 1: Academic Foundation & Core Concepts", locked: false, sampleTasks: ["Master High-Yield Fundamentals"] },
          { phaseNumber: 2, phaseTitle: "Phase 2: Core Skills & Problem-Solving", locked: true },
          { phaseNumber: 3, phaseTitle: "Phase 3: Competitive Exams & Higher Education Radar", locked: true },
          { phaseNumber: 4, phaseTitle: "Phase 4: Practical Mastery & Specialization", locked: true },
          { phaseNumber: 5, phaseTitle: "Phase 5: Career Launch & Industry Readiness", locked: true },
        ],
      });
    }

    const data = await getOrGenerateCareerRoadmap(userId, targetCareerId, true);
    return res.json(data);
  } catch (error) {
    console.error("[CareerController] getRoadmap error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const toggleMilestone = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { milestoneId } = req.params;
    const { roadmapId, isCompleted } = req.body;

    if (!roadmapId || !milestoneId) {
      return res.status(400).json({ success: false, message: "roadmapId and milestoneId are required." });
    }

    const updated = await toggleRoadmapMilestone(userId, roadmapId, milestoneId, isCompleted);
    return res.json({
      success: true,
      message: "Milestone status updated.",
      roadmap: updated,
    });
  } catch (error) {
    console.error("[CareerController] toggleMilestone error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 4. AI CAREER COUNSELLOR CHAT CONTROLLER
// ============================================================================

export const chatWithCounsellor = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { message, sessionId } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Please provide a valid career question." });
    }

    const result = await askCareerCounsellor(userId, message.trim(), sessionId || null);
    return res.json(result);
  } catch (error) {
    console.error("[CareerController] chatWithCounsellor error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to consult AI counselor." });
  }
};

// ============================================================================
// 5. CAREER COMPARISON CONTROLLER
// ============================================================================

export const compareCareers = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { careerId1, careerId2 } = req.body;

    if (!careerId1 || !careerId2) {
      return res.status(400).json({ success: false, message: "Two career IDs are required for comparison." });
    }

    const isPremium = await checkIsStudentPremium(userId);
    const comparisonResult = compareTwoCareers(careerId1, careerId2, isPremium);

    return res.json(comparisonResult);
  } catch (error) {
    console.error("[CareerController] compareCareers error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 6. CAREER CATALOG CONTROLLER
// ============================================================================

export const getCatalogList = async (req, res) => {
  try {
    const { category, search } = req.query;
    const catalog = getCatalog(category || "All", search || "");
    return res.json(catalog);
  } catch (error) {
    console.error("[CareerController] getCatalogList error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getCareerDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const career = getCareerById(id);

    if (!career) {
      return res.status(404).json({ success: false, message: "Career path not found in catalog." });
    }

    const userId = getUserIdFromReq(req);
    const isPremium = await checkIsStudentPremium(userId);

    return res.json({
      success: true,
      career,
      isPremium,
    });
  } catch (error) {
    console.error("[CareerController] getCareerDetails error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 7. COLLEGE & ENTRANCE EXAM RADAR (Premium Gated)
// ============================================================================

export const getCollegesAndExams = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { careerId = "ai_ml_engineer" } = req.query;
    const isPremium = await checkIsStudentPremium(userId);

    const career = CAREER_MAP.get(careerId) || CAREER_MAP.get("ai_ml_engineer");

    if (!isPremium) {
      return res.json({
        success: true,
        isPremium: false,
        isLocked: true,
        careerName: career.career_name,
        previewExams: (career.top_exams || []).slice(0, 1),
        previewColleges: (career.top_colleges || []).slice(0, 1),
        message: "Unlock complete college cutoffs, entrance exam timelines, and fee intelligence with ClassTech Premium.",
      });
    }

    return res.json({
      success: true,
      isPremium: true,
      isLocked: false,
      careerName: career.career_name,
      exams: career.top_exams || [],
      colleges: career.top_colleges || [],
      qualifications: career.qualifications || [],
      salaryInsights: career.salary_insights || {},
    });
  } catch (error) {
    console.error("[CareerController] getCollegesAndExams error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
