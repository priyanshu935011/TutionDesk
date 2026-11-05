import mongoose from "../utils/supabaseModel.js";

const aiUsageLogSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    taskType: {
      type: String,
      default: "query",
    },
    creditsDeducted: {
      type: Number,
      default: 0,
    },
    cost: {
      type: Number,
      default: 0,
    },
    userId: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    userName: {
      type: String,
      default: "",
    },
    userRole: {
      type: String,
      default: "",
    },
    actionType: {
      type: String,
      default: "DEBIT",
    },
    remarks: {
      type: String,
      default: "",
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

const AiUsageLog = mongoose.model("AiUsageLog", aiUsageLogSchema);
export default AiUsageLog;
