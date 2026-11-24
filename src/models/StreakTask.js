import mongoose from "../utils/supabaseModel.js";

const streakTaskSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    subtitle: {
      type: String,
      default: "",
      trim: true,
    },
    taskType: {
      type: String,
      required: true,
      enum: [
        "attend_class",
        "solve_questions",
        "complete_test",
        "watch_video",
        "ask_doubt",
        "custom",
      ],
      default: "complete_test",
    },
    targetCount: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    icon: {
      type: String,
      default: "assignment_outlined",
      trim: true,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    sortOrder: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

streakTaskSchema.index({ isActive: 1, sortOrder: 1 });

const StreakTask = mongoose.models?.StreakTask || mongoose.model("StreakTask", streakTaskSchema);

export default StreakTask;
