import mongoose from "mongoose";

const systemMetricSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const SystemMetric = mongoose.model("SystemMetric", systemMetricSchema);

export default SystemMetric;
