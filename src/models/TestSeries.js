import mongoose from "../utils/supabaseModel.js";

const testQuestionSchema = new mongoose.Schema({
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
    default: 0,
  },
  explanation: {
    type: String,
    default: "",
  },
});

const testSeriesSchema = new mongoose.Schema(
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
    folder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestSeriesFolder",
      default: null,
    },
    folderPath: {
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
    isLocked: {
      type: Boolean,
      default: false,
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
    questions: [testQuestionSchema],
    isGlobal: {
      type: Boolean,
      default: true,
    },
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      default: null,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    isPublished: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const TestSeries = mongoose.model("TestSeries", testSeriesSchema);

export default TestSeries;
