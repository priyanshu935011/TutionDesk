import mongoose from "../utils/supabaseModel.js";

const agentStateConfigSchema = new mongoose.Schema(
  {
    agentId: {
      type: String,
      required: true,
      unique: true,
    },
    name: {
      type: String,
      required: true,
    },
    isRunning: {
      type: Boolean,
      default: false,
    },
    config: {
      type: Object,
      default: () => ({
        intervalSeconds: 45,
        rateLimitPerHour: 15,
        maxConsecutiveErrors: 3,
        preferredModel: "gemini-3.8-flash",
        categories: [
          "Class 10",
          "Class 11",
          "Class 12",
          "JEE Main & Advanced",
          "NEET",
          "CUET",
          "Bank & SSC",
          "Foundation",
          "Olympiad",
        ],
        questionsCount: 15,
      }),
    },
    state: {
      type: Object,
      default: () => ({
        currentCategory: "JEE Main & Advanced",
        currentSubject: "Physics",
        currentTopic: "Electrostatics",
        currentDifficulty: "Medium",
        totalGenerated: 0,
        totalApproved: 0,
        lastGeneratedTitle: "",
      }),
    },
    logs: {
      type: Array,
      default: () => [],
    },
    lastRunAt: {
      type: Date,
      default: null,
    },
    nextRunAt: {
      type: Date,
      default: null,
    },
    runsThisHour: {
      type: Number,
      default: 0,
    },
    hourWindowStart: {
      type: Date,
      default: () => new Date(),
    },
    consecutiveErrors: {
      type: Number,
      default: 0,
    },
    circuitBreakerTripped: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const AgentStateConfig = mongoose.model(
  "AgentStateConfig",
  agentStateConfigSchema
);

export default AgentStateConfig;
