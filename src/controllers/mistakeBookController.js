import {
  getMistakeDashboardOverview,
  ingestMistake,
  generateAiRootCauseAnalysis,
  generateAiTwinQuestion,
  extractQuestionFromImage,
  recordRetestAttempt,
  getDueRetestQuiz,
} from "../services/mistakeBookService.js";
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
 * GET /api/mistake-book/dashboard
 */
export const getDashboard = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);
    const { subject, reasonTag, status, isDueOnly, isStarredOnly, search, page, limit } = req.query;

    const data = await getMistakeDashboardOverview({
      userId,
      instituteId,
      subject,
      reasonTag,
      status,
      isDueOnly: isDueOnly === "true",
      isStarredOnly: isStarredOnly === "true",
      search,
      page,
      limit,
    });

    return res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[MistakeBook] getDashboard error:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to load mistake book dashboard",
    });
  }
};

/**
 * GET /api/mistake-book/items/:id
 */
export const getMistakeById = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;

    const { data, error } = await supabase
      .from("student_mistakes")
      .select("*")
      .eq("id", id)
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return res.status(404).json({ success: false, message: "Mistake not found" });
    }

    // Also fetch retest history
    const { data: history } = await supabase
      .from("mistake_retest_logs")
      .select("*")
      .eq("mistake_id", id)
      .order("attempted_at", { ascending: false });

    return res.json({
      success: true,
      data: {
        ...data,
        retestHistory: history || [],
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/mistake-book/items (Manual Add)
 */
export const createMistake = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);

    const result = await ingestMistake({
      ...req.body,
      userId,
      instituteId,
      sourceChannel: req.body.sourceChannel || "manual",
    });

    return res.status(201).json({
      success: true,
      data: result,
      message: "Mistake saved successfully",
    });
  } catch (error) {
    console.error("[MistakeBook] createMistake error:", error);
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * PUT /api/mistake-book/items/:id (Update Notes, Tags, Star)
 */
export const updateMistake = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;
    const { studentNotes, mistakeReasonTag, isStarred, isArchived, subject, chapter, topic } = req.body;

    const updates = { updated_at: new Date().toISOString() };
    if (studentNotes !== undefined) updates.student_notes = studentNotes;
    if (mistakeReasonTag !== undefined) updates.mistake_reason_tag = mistakeReasonTag;
    if (isStarred !== undefined) updates.is_starred = Boolean(isStarred);
    if (isArchived !== undefined) updates.is_archived = Boolean(isArchived);
    if (subject !== undefined) updates.subject = subject;
    if (chapter !== undefined) updates.chapter = chapter;
    if (topic !== undefined) updates.topic = topic;

    const { data, error } = await supabase
      .from("student_mistakes")
      .update(updates)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();

    if (error) throw error;

    return res.json({
      success: true,
      data,
      message: "Mistake updated successfully",
    });
  } catch (error) {
    return res.status(400).json({ success: false, message: error.message });
  }
};

/**
 * DELETE /api/mistake-book/items/:id
 */
export const deleteMistake = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const { id } = req.params;

    await supabase
      .from("student_mistakes")
      .delete()
      .eq("id", id)
      .eq("user_id", userId);

    return res.json({ success: true, message: "Mistake deleted" });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/mistake-book/items/:id/root-cause
 */
export const getRootCause = async (req, res) => {
  try {
    const { id } = req.params;
    const { questionText, options, studentAnswer, correctAnswer, subject, topic } = req.body;

    const analysis = await generateAiRootCauseAnalysis({
      questionText,
      options,
      studentAnswer,
      correctAnswer,
      subject,
      topic,
    });

    // Optionally persist into mistake record
    if (id && id !== "temp") {
      await supabase
        .from("student_mistakes")
        .update({
          ai_root_cause: analysis.rootCause,
          ai_micro_concept: analysis.microConcept,
          mistake_reason_tag: analysis.suggestedTag || "conceptual",
        })
        .eq("id", id);
    }

    return res.json({ success: true, data: analysis });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/mistake-book/items/:id/twin-question
 */
export const getTwinQuestion = async (req, res) => {
  try {
    const { id } = req.params;
    const { questionText, options, correctAnswer, subject, topic, difficulty } = req.body;

    const twin = await generateAiTwinQuestion({
      mistakeId: id,
      questionText,
      options,
      correctAnswer,
      subject,
      topic,
      difficulty,
    });

    return res.json({ success: true, data: twin });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/mistake-book/ocr-snap (Offline Snap & Solve)
 */
export const ocrSnapMistake = async (req, res) => {
  try {
    const { imageBase64, mimeType, studentNotes } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ success: false, message: "Image data is required" });
    }

    const extracted = await extractQuestionFromImage({
      imageBase64,
      mimeType: mimeType || "image/jpeg",
      studentNotes,
    });

    return res.json({ success: true, data: extracted });
  } catch (error) {
    console.error("[MistakeBook] ocrSnapMistake error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /api/mistake-book/retest/quiz
 */
export const getRetestQuiz = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const instituteId = getInstituteIdFromReq(req);
    const { subject, limit } = req.query;

    const quiz = await getDueRetestQuiz({
      userId,
      instituteId,
      subject: subject || "all",
      limit: Number(limit) || 10,
    });

    return res.json({ success: true, data: quiz });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /api/mistake-book/retest/submit
 */
export const submitRetest = async (req, res) => {
  try {
    const userId = getUserIdFromReq(req);
    const {
      mistakeId,
      selectedAnswer,
      isCorrect,
      timeTakenSeconds,
      wasTwinQuestion,
      twinQuestionData,
      feedbackNotes,
    } = req.body;

    if (!mistakeId) {
      return res.status(400).json({ success: false, message: "mistakeId is required" });
    }

    const result = await recordRetestAttempt({
      userId,
      mistakeId,
      selectedAnswer,
      isCorrect,
      timeTakenSeconds,
      wasTwinQuestion,
      twinQuestionData,
      feedbackNotes,
    });

    return res.json({ success: true, data: result });
  } catch (error) {
    console.error("[MistakeBook] submitRetest error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
