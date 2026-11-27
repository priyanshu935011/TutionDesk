import {
  solveDoubtWithAi,
  askDoubtFollowup,
  getStudentDoubtHistory,
  toggleDoubtStar,
  saveDoubtToMistakeNotebook,
} from "../services/doubtSolverService.js";
import { recordStudentActivity } from "../services/streakService.js";
import { supabase } from "../utils/supabase.js";

function getUserIdFromReq(req) {
  return (
    req.student?._id ||
    req.student?.id ||
    req.studentId ||
    req.user?.studentId ||
    req.user?._id ||
    req.user?.id ||
    req.headers["x-student-id"] ||
    req.headers["x-user-id"] ||
    req.query?.studentId ||
    req.body?.studentId ||
    "guest_student"
  ).toString();
}

function getInstituteIdFromReq(req) {
  return req.user?.institute || req.user?.instituteId || null;
}

/**
 * POST /api/doubts/solve
 */
export const solveDoubt = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);
    const { questionText, imageBase64, mimeType, subject, gradeLevel, studentNotes } = req.body;

    const result = await solveDoubtWithAi({
      userId,
      instituteId,
      questionText,
      imageBase64,
      mimeType,
      subject,
      gradeLevel,
      studentNotes,
    });

    // Credit student streak & doubt solver metric
    if (userId && userId !== "guest_student") {
      recordStudentActivity(userId, { doubtsSolved: 1, doubtsAsked: 1 }).catch(() => {});
    }

    return res.status(201).json({
      success: true,
      data: result,
      message: "Doubt solved successfully",
    });
  } catch (error) {
    console.error("[DoubtController] solveDoubt error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to solve doubt",
    });
  }
};

/**
 * GET /api/doubts/history
 */
export const getHistory = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);
    const { subject, isStarredOnly, search, page, limit } = req.query;

    const history = await getStudentDoubtHistory({
      userId,
      instituteId,
      subject,
      isStarredOnly: isStarredOnly === "true",
      search,
      page,
      limit,
    });

    return res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error("[DoubtController] getHistory error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch doubt history",
    });
  }
};

/**
 * GET /api/doubts/:id
 */
export const getDoubtDetail = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;

    const { data, error } = await supabase
      .from("student_doubts")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Doubt not found" });
    }

    return res.json({ success: true, data });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/doubts/:id/followup
 */
export const followupDoubt = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);
    const { id } = req.params;
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: "Message is required" });
    }

    const result = await askDoubtFollowup({
      userId,
      instituteId,
      doubtId: id,
      userMessage: message.trim(),
    });

    return res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error("[DoubtController] followupDoubt error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to process follow-up",
    });
  }
};

/**
 * POST /api/doubts/:id/toggle-star
 */
export const toggleStar = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;

    const result = await toggleDoubtStar({ userId, doubtId: id });
    return res.json({ success: true, data: result });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/doubts/:id/convert-to-mistake
 */
export const convertToMistake = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);
    const { id } = req.params;
    const { studentNotes, mistakeReasonTag } = req.body;

    const result = await saveDoubtToMistakeNotebook({
      userId,
      instituteId,
      doubtId: id,
      studentNotes,
      mistakeReasonTag,
    });

    return res.json({
      success: true,
      data: result,
      message: "Doubt added to Mistake Notebook successfully",
    });
  } catch (error) {
    console.error("[DoubtController] convertToMistake error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to add doubt to Mistake Notebook",
    });
  }
};

/**
 * DELETE /api/doubts/:id
 */
export const deleteDoubt = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;

    await supabase
      .from("student_doubts")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    return res.json({ success: true, message: "Doubt deleted successfully" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
