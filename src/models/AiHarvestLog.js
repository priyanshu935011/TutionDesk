import mongoose from "../utils/supabaseModel.js";

const aiHarvestLogSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      default: null,
      index: true,
    },
    instituteId: {
      type: String,
      default: null,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    userName: {
      type: String,
      default: "User",
    },
    userRole: {
      type: String,
      default: "user",
    },
    taskType: {
      type: String,
      required: true,
      index: true,
    },
    prompt: {
      type: String,
      default: "",
    },
    response: {
      type: String,
      default: "",
    },
    generatedContent: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    creditsDeducted: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

const AiHarvestLog = mongoose.model("AiHarvestLog", aiHarvestLogSchema, "ai_harvest_logs");
export default AiHarvestLog;
