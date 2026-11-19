import mongoose from "../utils/supabaseModel.js";

const studentMistakeBookSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      default: "General",
    },
    chapter: {
      type: String,
      trim: true,
      default: "Core Concepts",
    },
    topic: {
      type: String,
      trim: true,
      default: "",
    },
    questionText: {
      type: String,
      required: true,
    },
    questionImage: {
      type: String,
      default: "",
    },
    options: [
      {
        label: { type: String, default: "" },
        text: { type: String, default: "" },
      },
    ],
    studentAnswer: {
      type: String,
      default: "",
    },
    correctAnswer: {
      type: String,
      required: true,
    },
    explanation: {
      type: String,
      default: "",
    },
    errorTag: {
      type: String,
      enum: ["conceptual_gap", "calculation_slip", "time_pressure", "silly_misread", "unattempted"],
      default: "conceptual_gap",
    },
    aiDiagnosticNote: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["active", "retesting", "mastered"],
      default: "active",
      index: true,
    },
    retestCount: {
      type: Number,
      default: 0,
    },
    lastRetestedAt: {
      type: Date,
      default: null,
    },
    sourceTestTitle: {
      type: String,
      default: "Practice Quiz",
    },
  },
  { timestamps: true }
);

const StudentMistakeBook = mongoose.model(
  "StudentMistakeBook",
  studentMistakeBookSchema,
  "student_mistake_book"
);
export default StudentMistakeBook;
