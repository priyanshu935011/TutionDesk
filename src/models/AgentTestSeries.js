import mongoose from "../utils/supabaseModel.js";

const agentQuestionSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
  },
  type: {
    type: String,
    enum: ["single_choice", "multiple_choice", "boolean", "image_based"],
    default: "single_choice",
  },
  question: {
    type: String,
    required: true,
  },
  questionImageUrl: {
    type: String,
    default: "",
  },
  options: [
    {
      id: { type: String, required: true },
      text: { type: String, default: "" },
      imageUrl: { type: String, default: "" },
    },
  ],
  correctAnswers: {
    type: [String],
    default: [],
  },
  marks: {
    type: Number,
    default: 4,
  },
  negativeMarks: {
    type: Number,
    default: 1,
  },
  explanation: {
    type: String,
    default: "",
  },
});

const agentTestSeriesSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      default: "General",
      trim: true,
    },
    subject: {
      type: String,
      default: "General",
      trim: true,
    },
    topic: {
      type: String,
      default: "General",
      trim: true,
    },
    difficulty: {
      type: String,
      enum: ["Easy", "Medium", "Hard"],
      default: "Medium",
    },
    durationMinutes: {
      type: Number,
      default: 60,
    },
    totalMarks: {
      type: Number,
      default: 100,
    },
    passingMarks: {
      type: Number,
      default: 40,
    },
    instructions: {
      type: String,
      default: "",
    },
    questions: [agentQuestionSchema],
    sourceInfo: {
      type: Object,
      default: () => ({}),
    },
    status: {
      type: String,
      enum: ["pending_review", "approved", "rejected"],
      default: "pending_review",
    },
    promotedTestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestSeries",
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },
    reviewedBy: {
      type: String,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const AgentTestSeries = mongoose.model("AgentTestSeries", agentTestSeriesSchema);

export default AgentTestSeries;
