import aiTutorService from "../services/aiTutorService.js";
import { recordStudentActivity } from "../services/streakService.js";

export async function getConfig(req, res) {
  try {
    const userId = req.user?.id || req.query.userId || req.headers["x-user-id"];
    const studentId = req.query.studentId || req.user?.studentId;
    const config = await aiTutorService.getTutorConfig(userId, studentId);
    return res.json({ success: true, ...config });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export async function startSession(req, res) {
  try {
    const userId = req.user?.id || req.body.userId || req.headers["x-user-id"] || "guest_student";
    const studentId = req.body.studentId || req.user?.studentId;
    const { tutorId, subject, chapter, teachingMode, language } = req.body;

    const session = await aiTutorService.startTutorSession({
      userId,
      studentId,
      tutorId,
      subject,
      chapter,
      teachingMode,
      language,
    });

    // Credit student streak task for voice tutor activity
    const activeStudentId = studentId || userId;
    if (activeStudentId && activeStudentId !== "guest_student") {
      recordStudentActivity(activeStudentId, { voiceTutorInteractions: 1 }).catch(() => {});
    }

    return res.json({ success: true, session });
  } catch (error) {
    return res.status(error.status || 500).json({
      success: false,
      message: error.message,
      quotaExhausted: error.quotaExhausted || false,
    });
  }
}

export async function interact(req, res) {
  try {
    const { sessionId } = req.params;
    const { userSpeech, isInterruption } = req.body;

    if (!userSpeech || !userSpeech.trim()) {
      return res.status(400).json({ success: false, message: "userSpeech is required" });
    }

    const response = await aiTutorService.interactWithTutor({
      sessionId,
      userSpeech: userSpeech.trim(),
      isInterruption: isInterruption === true,
    });

    // Credit student streak task for voice tutor activity
    const activeStudentId = req.user?.studentId || req.user?.id || req.body?.studentId || req.body?.userId;
    if (activeStudentId && activeStudentId !== "guest_student") {
      recordStudentActivity(activeStudentId, { voiceTutorInteractions: 1 }).catch(() => {});
    }

    return res.json({ success: true, ...response });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export async function endSession(req, res) {
  try {
    const { sessionId } = req.params;
    const { durationSeconds } = req.body;

    const result = await aiTutorService.endTutorSession({
      sessionId,
      durationSeconds: parseInt(durationSeconds || 60, 10),
    });

    return res.json({ success: true, ...result });
  } catch (error) {
    return res.status(error.status || 500).json({ success: false, message: error.message });
  }
}

export default {
  getConfig,
  startSession,
  interact,
  endSession,
};
