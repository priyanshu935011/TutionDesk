import mongoose from "../utils/supabaseModel.js";

const testSeriesAttemptSchema = new mongoose.Schema(
  {
    testSeries: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestSeries",
      required: true,
      index: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      index: true,
    },
    studentName: {
      type: String,
      default: "",
    },
    studentEmail: {
      type: String,
      default: "",
    },
    studentPhone: {
      type: String,
      default: "",
    },
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    batchName: {
      type: String,
      default: "",
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    submittedAt: {
      type: Date,
      default: Date.now,
    },
    timeTakenSeconds: {
      type: Number,
      default: 0,
    },
    totalQuestions: {
      type: Number,
      default: 0,
    },
    attemptedQuestions: {
      type: Number,
      default: 0,
    },
    correctAnswersCount: {
      type: Number,
      default: 0,
    },
    wrongAnswersCount: {
      type: Number,
      default: 0,
    },
    unansweredCount: {
      type: Number,
      default: 0,
    },
    score: {
      type: Number,
      default: 0,
    },
    totalMarks: {
      type: Number,
      default: 0,
    },
    percentage: {
      type: Number,
      default: 0,
    },
    isPassed: {
      type: Boolean,
      default: false,
    },
    answers: [
      {
        questionId: { type: String, required: true },
        selectedAnswers: { type: [String], default: [] },
        isCorrect: { type: Boolean, default: false },
        marksObtained: { type: Number, default: 0 },
      },
    ],
  },
  { timestamps: true }
);

const TestSeriesAttempt = mongoose.model("TestSeriesAttempt", testSeriesAttemptSchema);

export default TestSeriesAttempt;
