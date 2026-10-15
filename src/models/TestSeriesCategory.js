import mongoose from "../utils/supabaseModel.js";

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
  },
  { timestamps: true }
);

const TestSeriesCategory = mongoose.model(
  "TestSeriesCategory",
  testSeriesCategorySchema
);

export default TestSeriesCategory;
