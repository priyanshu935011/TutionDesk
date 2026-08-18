import mongoose from "../utils/supabaseModel.js";

const testResultSchema = new mongoose.Schema(
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
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    score: {
      type: Number,
      required: true,
    },
    totalMarks: {
      type: Number,
      required: true,
    },
    examDate: {
      type: Date,
      required: true,
    },
    remarks: {
      type: String,
      trim: true,
      default: "",
    },
    subject: {
      type: String,
      required: true,
      trim: true,
      default: "General",
    },
    testType: {
      type: String,
      default: "Unit Test",
      trim: true,
    },
    chapter: {
      type: String,
      default: "",
      trim: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
  },
  { timestamps: true }

);

const TestResult = mongoose.model("TestResult", testResultSchema);

export default TestResult;
