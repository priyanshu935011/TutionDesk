import mongoose from "../utils/supabaseModel.js";

const testSeriesFolderSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    parentFolder: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestSeriesFolder",
      default: null,
    },
    category: {
      type: String,
      default: "General",
      trim: true,
    },
    path: {
      type: String,
      default: "",
      trim: true,
    },
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      default: null,
    },
    isGlobal: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

const TestSeriesFolder = mongoose.model("TestSeriesFolder", testSeriesFolderSchema);

export default TestSeriesFolder;
