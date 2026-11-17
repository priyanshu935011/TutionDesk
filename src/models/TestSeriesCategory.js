import mongoose from "../utils/supabaseModel.js";

const testSeriesSubjectSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  icon: {
    type: String,
    default: "📚",
  },
  topics: {
    type: [String],
    default: [],
  },
});

const testSeriesCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    icon: {
      type: String,
      default: "📝",
    },
    subjects: {
      type: [testSeriesSubjectSchema],
      default: [],
    },
  },
  { timestamps: true }
);

const TestSeriesCategory = mongoose.model(
  "TestSeriesCategory",
  testSeriesCategorySchema
);

export default TestSeriesCategory;
