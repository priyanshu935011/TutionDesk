import mongoose from "../utils/supabaseModel.js";

const instituteTestSeriesAccessSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    testSeries: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TestSeries",
      required: true,
      index: true,
    },
    isEnabled: {
      type: Boolean,
      default: false,
    },
    assignedBatches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Batch",
      },
    ],
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

const InstituteTestSeriesAccess = mongoose.model(
  "InstituteTestSeriesAccess",
  instituteTestSeriesAccessSchema
);

export default InstituteTestSeriesAccess;
