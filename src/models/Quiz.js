import mongoose from "../utils/supabaseModel.js";

const quizOptionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { _id: false }
);

const quizQuestionSchema = new mongoose.Schema(
  {
    text: {
      type: String,
      required: true,
      trim: true,
    },
    options: {
      type: [quizOptionSchema],
      validate: [(value) => value.length >= 2, "Each question must have at least 2 options"],
    },
    correctOptionIndex: {
      type: Number,
      required: true,
      min: 0,
    },
  },
  { _id: false }
);

const quizSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    batches: {
      type: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Batch",
        },
      ],
      default: [],
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    durationSeconds: {
      type: Number,
      required: true,
      min: 5,
    },
    restSeconds: {
      type: Number,
      default: 10,
      min: 0,
    },
    negativeMarkingEnabled: {
      type: Boolean,
      default: false,
    },
    negativeMarkPerWrong: {
      type: Number,
      default: 0,
      min: 0,
    },
    pointsPerCorrect: {
      type: Number,
      default: 10,
      min: 1,
    },
    questions: {
      type: [quizQuestionSchema],
      validate: [(value) => value.length > 0, "Quiz must include at least one question"],
    },
    status: {
      type: String,
      enum: ["draft", "live", "completed", "archived"],
      default: "draft",
    },
    liveSessionId: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const Quiz = mongoose.model("Quiz", quizSchema);

export default Quiz;
