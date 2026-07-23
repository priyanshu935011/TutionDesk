import mongoose from "../utils/supabaseModel.js";

const systemLogSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      enum: ["error", "warning", "failed"],
      default: "error",
    },
    category: {
      type: String,
      required: true,
      trim: true,
      default: "System Error",
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    userName: {
      type: String,
      default: "Unknown",
    },
    userEmail: {
      type: String,
      default: "N/A",
    },
    userPhone: {
      type: String,
      default: "N/A",
    },
    userRole: {
      type: String,
      default: "user",
    },
    instituteName: {
      type: String,
      default: "General System",
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

const SystemLog = mongoose.model("SystemLog", systemLogSchema);

export default SystemLog;
