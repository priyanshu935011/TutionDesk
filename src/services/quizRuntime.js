import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import Student from "../models/Student.js";

let io = null;
const sessions = new Map();

const ensureSession = (sessionId) => sessions.get(sessionId) || null;

const calculateLeaderboard = (session) => {
  const scores = new Map();

  for (const attempt of session.attempts.values()) {
    const total = attempt.answers.reduce((sum, answer) => sum + Number(answer.pointsAwarded || 0), 0);
    scores.set(attempt.studentId, {
      studentId: attempt.studentId,
      studentName: attempt.studentName,
      score: total,
      answers: attempt.answers,
      lastAnswerAt: attempt.lastAnswerAt,
    });
  }

  return [...scores.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return new Date(a.lastAnswerAt || 0).getTime() - new Date(b.lastAnswerAt || 0).getTime();
  });
};

const calculatePoll = (session) => {
  const question = session.quiz.questions[session.currentQuestionIndex];

  if (!question) {
    return {
      totalVotes: 0,
      optionCounts: [],
      optionPercentages: [],
      optionLabels: [],
      voters: [],
    };
  }

  const optionCounts = Array(question.options.length).fill(0);
  const voters = [];

  for (const attempt of session.attempts.values()) {
    const answer = attempt.answers.find(
      (item) => Number(item.questionIndex) === Number(session.currentQuestionIndex)
    );

    if (!answer) {
      continue;
    }

    const selectedIndex = Number(answer.selectedOptionIndex);

    if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && selectedIndex < optionCounts.length) {
      optionCounts[selectedIndex] += 1;
      voters.push({
        studentId: attempt.studentId,
        studentName: attempt.studentName,
        selectedOptionIndex: selectedIndex,
        responseTimeMs: answer.responseTimeMs,
      });
    }
  }

  const totalVotes = optionCounts.reduce((sum, count) => sum + count, 0);
  const optionPercentages = optionCounts.map((count) =>
    totalVotes ? Math.round((count / totalVotes) * 100) : 0
  );

  return {
    totalVotes,
    optionCounts,
    optionPercentages,
    optionLabels: question.options.map((option) => option.text),
    voters,
  };
};

const broadcastState = (session) => {
  emitToRoom(session, "quiz:state", serializeSession(session));
};

const emitToRoom = (session, event, payload) => {
  if (!io || !session) return;
  io.to(session.room).emit(event, payload);
};

const serializeQuestion = (question) => ({
  text: question.text,
  options: question.options.map((option) => option.text),
});

const serializeSession = (session) => ({
  sessionId: session.sessionId,
  quizId: session.quiz._id,
  title: session.quiz.title,
  status: session.status,
  currentQuestionIndex: session.currentQuestionIndex,
  currentQuestion:
    session.status !== "starting" && session.currentQuestionIndex >= 0 && session.currentQuestionIndex < session.quiz.questions.length
      ? serializeQuestion(session.quiz.questions[session.currentQuestionIndex])
      : null,
  questionEndsAt: session.questionEndsAt,
  breakEndsAt: session.breakEndsAt,
  leaderboard: calculateLeaderboard(session),
  totalQuestions: session.quiz.questions.length,
  durationSeconds: session.quiz.durationSeconds,
  restSeconds: session.quiz.restSeconds || 10,
  pointsPerCorrect: session.quiz.pointsPerCorrect || 10,
  poll: calculatePoll(session),
  audienceCount: session.students?.size || 0,
  reveal:
    session.status === "reveal" || session.status === "break" || session.status === "ended"
      ? {
          questionIndex: session.currentQuestionIndex,
          correctOptionIndex: session.reveal?.correctOptionIndex ?? null,
          correctOptionText: session.reveal?.correctOptionText ?? null,
          revealedAt: session.reveal?.revealedAt ?? null,
        }
      : null,
});

const persistAttempt = async (session, studentId, studentName, answer) => {
  let attempt = session.attempts.get(studentId);

  if (!attempt) {
    attempt = {
      studentId,
      studentName,
      answers: [],
      score: 0,
      lastAnswerAt: null,
    };
    session.attempts.set(studentId, attempt);
  }

  attempt.answers.push(answer);
  attempt.score = attempt.answers.reduce((sum, current) => sum + Number(current.pointsAwarded || 0), 0);
  attempt.lastAnswerAt = answer.respondedAt;

  const existing = await QuizAttempt.findOne({
    institute: session.quiz.institute,
    quiz: session.quiz._id,
    student: studentId,
    liveSessionId: session.sessionId,
  });

  if (existing) {
    existing.answers = attempt.answers;
    existing.score = attempt.score;
    existing.completedAt = new Date();
    await existing.save();
  } else {
    await QuizAttempt.create({
      institute: session.quiz.institute,
      quiz: session.quiz._id,
      student: studentId,
      liveSessionId: session.sessionId,
      answers: attempt.answers,
      score: attempt.score,
      startedAt: session.startedAt,
      completedAt: new Date(),
    });
  }
};

const broadcastLeaderboard = (session) => {
  emitToRoom(session, "quiz:leaderboard", {
    sessionId: session.sessionId,
    leaderboard: calculateLeaderboard(session),
    poll: calculatePoll(session),
    status: session.status,
    currentQuestionIndex: session.currentQuestionIndex,
  });
};

const finishQuiz = async (session) => {
  if (!session) return;

  session.status = "ended";
  session.currentQuestionIndex = session.quiz.questions.length;
  if (session.questionTimer) clearTimeout(session.questionTimer);
  if (session.breakTimer) clearTimeout(session.breakTimer);
  session.questionTimer = null;
  session.breakTimer = null;
  if (session.revealTimer) clearTimeout(session.revealTimer);
  session.revealTimer = null;
  session.breakEndsAt = null;
  session.questionEndsAt = null;
  session.reveal = null;
  session.quiz.status = "completed";
  session.quiz.liveSessionId = "";
  await session.quiz.save();
  broadcastState(session);
  broadcastLeaderboard(session);
  emitToRoom(session, "quiz:end", serializeSession(session));
  
  // Keep completed session in memory for 30 minutes to allow final leaderboard views on reload/refreshes.
  setTimeout(() => {
    sessions.delete(session.sessionId);
  }, 30 * 60 * 1000);
};

const beginBreak = (session) => {
  session.status = "break";
  if (!session.breakEndsAt) {
    session.breakEndsAt = Date.now() + (session.quiz.restSeconds || 10) * 1000;
  }
  session.questionEndsAt = null;
  broadcastState(session);
  emitToRoom(session, "quiz:break", serializeSession(session));
  broadcastLeaderboard(session);
};

const beginReveal = (session) => {
  const question = session.quiz.questions[session.currentQuestionIndex];
  session.status = "reveal";
  session.questionEndsAt = null;
  session.reveal = {
    questionIndex: session.currentQuestionIndex,
    correctOptionIndex: question?.correctOptionIndex ?? null,
    correctOptionText: question?.options?.[question?.correctOptionIndex || 0]?.text ?? null,
    revealedAt: new Date(),
  };
  session.breakEndsAt = Date.now() + (session.quiz.restSeconds || 10) * 1000;
  broadcastState(session);
  emitToRoom(session, "quiz:reveal", serializeSession(session));
  broadcastLeaderboard(session);

  const totalRestMs = (session.quiz.restSeconds || 10) * 1000;
  const revealDurationMs = Math.min(2500, Math.max(1200, Math.floor(totalRestMs * 0.25)));
  const remainingBreakMs = Math.max(1000, totalRestMs - revealDurationMs);

  session.revealTimer = setTimeout(() => {
    const nextQuestionIndex = session.currentQuestionIndex + 1;

    if (nextQuestionIndex >= session.quiz.questions.length) {
      finishQuiz(session);
      return;
    }

    beginBreak(session);

    session.breakTimer = setTimeout(() => {
      session.currentQuestionIndex = nextQuestionIndex;
      startQuestion(session);
    }, remainingBreakMs);
  }, revealDurationMs);
};

const startQuestion = (session) => {
  session.status = "live";
  session.questionEndsAt = Date.now() + session.quiz.durationSeconds * 1000;
  session.breakEndsAt = null;
  session.reveal = null;
  const question = session.quiz.questions[session.currentQuestionIndex];

  broadcastState(session);
  emitToRoom(session, "quiz:question", {
    ...serializeSession(session),
    currentQuestion: serializeQuestion(question),
  });

  session.questionTimer = setTimeout(() => {
    beginReveal(session);
  }, session.quiz.durationSeconds * 1000);
};

export const setSocketServer = (socketIo) => {
  io = socketIo;
};

export const createLiveSession = async (quiz) => {
  // Clean up any existing live/ended session for this institute/teacher to avoid memory leaks or conflicts.
  for (const [sid, sess] of sessions.entries()) {
    if (String(sess.quiz.institute) === String(quiz.institute)) {
      sessions.delete(sid);
    }
  }

  const sessionId = `quiz_${quiz._id}_${Date.now()}`;
  quiz.status = "live";
  quiz.liveSessionId = sessionId;
  await quiz.save();

  const session = {
    sessionId,
    room: `quiz:${sessionId}`,
    quiz,
    status: "starting",
    currentQuestionIndex: 0,
    startedAt: new Date(),
    questionEndsAt: null,
    breakEndsAt: null,
    reveal: null,
    questionTimer: null,
    revealTimer: null,
    breakTimer: null,
    attempts: new Map(),
  };

  sessions.set(sessionId, session);
  return session;
};

export const startLiveQuiz = async (quiz) => {
  const session = await createLiveSession(quiz);
  return serializeSession(session);
};

export const getSessionByQuizId = (quizId) =>
  [...sessions.values()].find((session) => String(session.quiz._id) === String(quizId)) || null;

export const getSessionByInstituteId = (instituteId) =>
  [...sessions.values()].find((session) => String(session.quiz.institute) === String(instituteId)) || null;

export const getPublicLiveState = (instituteId) => {
  const session = getSessionByInstituteId(instituteId);
  return session ? serializeSession(session) : null;
};

const isStudentEligibleForSession = (student, session) => {
  if (!student || !session) {
    return false;
  }

  const quizBatchIds = (session.quiz.batches || []).map((batchId) => String(batchId));

  if (!quizBatchIds.length) {
    return true;
  }

  const studentBatchId = String(student.batch?._id || student.batch?.id || student.batch || "");
  return Boolean(studentBatchId) && quizBatchIds.includes(studentBatchId);
};

export const getLiveStateForStudent = (student) => {
  const session = [...sessions.values()].find((candidate) => isStudentEligibleForSession(student, candidate));
  return session ? serializeSession(session) : null;
};

export const joinStudentLiveRoom = ({ sessionId, studentId, studentName }) => {
  const session = ensureSession(sessionId);
  if (!session) return null;
  if (!session.students) session.students = new Map();
  session.students.set(String(studentId), { studentId, studentName });
  return serializeSession(session);
};

export const joinTeacherLiveRoom = ({ sessionId, teacherId }) => {
  const session = ensureSession(sessionId);
  if (!session) return null;
  session.teacherId = teacherId;
  return serializeSession(session);
};

export const submitStudentAnswer = async ({
  sessionId,
  studentId,
  studentName,
  selectedOptionIndex,
  clientAnsweredAt,
}) => {
  const session = ensureSession(sessionId);
  if (!session || session.status !== "live") {
    return { success: false, message: "Live quiz is not active" };
  }

  const questionIndex = session.currentQuestionIndex;
  const question = session.quiz.questions[questionIndex];
  if (!question) {
    return { success: false, message: "Question not available" };
  }

  const existingAttempt = session.attempts.get(String(studentId));
  const alreadyAnswered = existingAttempt?.answers?.some((answer) => answer.questionIndex === questionIndex);
  if (alreadyAnswered) {
    return { success: false, message: "Already answered" };
  }

  const respondedAt = clientAnsweredAt ? new Date(clientAnsweredAt) : new Date();
  const responseTimeMs = Math.max(0, respondedAt.getTime() - session.questionEndsAt + session.quiz.durationSeconds * 1000);
  const isCorrect = Number(selectedOptionIndex) === Number(question.correctOptionIndex);
  let pointsAwarded = 0;

  if (isCorrect) {
    pointsAwarded = Number(session.quiz.pointsPerCorrect || 10);
  } else if (session.quiz.negativeMarkingEnabled) {
    pointsAwarded = -Math.abs(Number(session.quiz.negativeMarkPerWrong || 0));
  }

  await persistAttempt(session, String(studentId), studentName, {
    questionIndex,
    selectedOptionIndex: Number(selectedOptionIndex),
    isCorrect,
    respondedAt,
    responseTimeMs,
    pointsAwarded,
  });

  broadcastState(session);
  broadcastLeaderboard(session);

  return {
    success: true,
    isCorrect,
    responseTimeMs,
    pointsAwarded,
    leaderboard: calculateLeaderboard(session),
  };
};

export const getActiveSessionForTeacher = (instituteId) => {
  const session = getSessionByInstituteId(instituteId);
  return session ? serializeSession(session) : null;
};

export const forceStopLiveQuiz = async (quizId) => {
  const session = getSessionByQuizId(quizId);
  if (!session) return null;
  await finishQuiz(session);
  return true;
};

export const quizRuntimeSocketHandlers = (socket) => {
  socket.on("quiz:join", ({ sessionId, studentId, studentName, role, teacherId }) => {
    const session = ensureSession(sessionId);
    if (!session) {
      socket.emit("quiz:error", { message: "Live quiz session not found" });
      return;
    }

    socket.join(session.room);
    socket.data.sessionId = sessionId;
    socket.data.role = role;

    if (role === "student") {
      socket.data.studentId = studentId;
      joinStudentLiveRoom({ sessionId, studentId, studentName });
    }

    if (role === "teacher") {
      joinTeacherLiveRoom({ sessionId, teacherId });
    }

    broadcastState(session);
    socket.emit("quiz:state", serializeSession(session));
  });

  socket.on("disconnect", () => {
    const { sessionId, studentId, role } = socket.data;
    if (role === "student" && sessionId && studentId) {
      const session = ensureSession(sessionId);
      if (session && session.students) {
        session.students.delete(String(studentId));
        broadcastState(session);
      }
    }
  });

  socket.on("quiz:answer", async (payload, callback) => {
    try {
      const result = await submitStudentAnswer(payload);
      if (typeof callback === "function") {
        callback(result);
      }
    } catch (error) {
      if (typeof callback === "function") {
        callback({ success: false, message: "Could not submit answer" });
      }
    }
  });

  socket.on("quiz:teacher:start", async ({ quizId }, callback) => {
    try {
      const quiz = await Quiz.findById(quizId);
      if (!quiz) {
        callback?.({ success: false, message: "Quiz not found" });
        return;
      }

      const existing = getSessionByQuizId(quizId);
      if (existing) {
        callback?.({ success: false, message: "Quiz is already live" });
        return;
      }

      const state = await startLiveQuiz(quiz);
      callback?.({ success: true, state });
    } catch (error) {
      callback?.({ success: false, message: "Could not start live quiz" });
    }
  });

  socket.on("quiz:teacher:begin", ({ sessionId }, callback) => {
    try {
      const session = ensureSession(sessionId);
      if (!session) {
        callback?.({ success: false, message: "Session not found" });
        return;
      }
      if (session.status !== "starting") {
        callback?.({ success: false, message: "Quiz already started" });
        return;
      }
      startQuestion(session);
      callback?.({ success: true });
    } catch (error) {
      callback?.({ success: false, message: "Could not start quiz" });
    }
  });
};
