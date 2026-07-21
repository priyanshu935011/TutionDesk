import mongoose from "../utils/supabaseModel.js";

const quizAnswerSchema = new mongoose.Schema(
  {
    questionIndex: {
      type: Number,
      required: true,
    },
    selectedOptionIndex: {
      type: Number,
      required: true,
    },
    isCorrect: {
      type: Boolean,
      required: true,
    },
    respondedAt: {
      type: Date,
      required: true,
    },
    responseTimeMs: {
      type: Number,
      required: true,
      min: 0,
    },
    pointsAwarded: {
      type: Number,
      default: 0,
    },
  },
  { _id: false }
);

const quizAttemptSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    quiz: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Quiz",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    liveSessionId: {
      type: String,
      required: true,
    },
    answers: {
      type: [quizAnswerSchema],
      default: [],
    },
    score: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      required: true,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

quizAttemptSchema.index({ quiz: 1, student: 1, liveSessionId: 1 }, { unique: true });

const QuizAttempt = mongoose.model("QuizAttempt", quizAttemptSchema);

export default QuizAttempt;
