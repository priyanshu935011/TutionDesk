import mongoose from "../utils/supabaseModel.js";

const aiDoubtHistorySchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    subject: {
      type: String,
      default: "General",
    },
    questionText: {
      type: String,
      default: "",
    },
    questionImageUrl: {
      type: String,
      default: "",
    },
    conceptIdentified: {
      type: String,
      default: "",
    },
    solutionSteps: [
      {
        stepNumber: { type: Number },
        title: { type: String, default: "" },
        explanation: { type: String, default: "" },
      },
    ],
    finalAnswer: {
      type: String,
      default: "",
    },
    keyTakeaway: {
      type: String,
      default: "",
    },
    practiceQuestions: [
      {
        question: { type: String },
        options: [{ type: String }],
        correctAnswer: { type: String },
        hint: { type: String },
      },
    ],
  },
  { timestamps: true }
);

const AiDoubtHistory = mongoose.model("AiDoubtHistory", aiDoubtHistorySchema, "ai_doubt_history");
export default AiDoubtHistory;
