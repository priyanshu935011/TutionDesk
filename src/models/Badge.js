import mongoose from "../utils/supabaseModel.js";

const badgeSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    symbol: {
      type: String,
      default: "fa-award",
      trim: true,
    },
    fontAwesomeCode: {
      type: String,
      default: "fa-award",
      trim: true,
    },
    backgroundColor: {
      type: String,
      default: "#8B5CF6",
      trim: true,
    },
    criteriaType: {
      type: String,
      required: true,
      enum: [
        "streak_days",
        "classes_attended",
        "questions_solved",
        "tests_completed",
        "score_percentage",
        "revision_cards",
        "voice_tutor",
        "doubt_solver",
        "doubts_solved",
        "custom",
      ],
      default: "streak_days",
    },
    targetValue: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    badgeTier: {
      type: String,
      default: "Gold",
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

badgeSchema.index({ isActive: 1, sortOrder: 1 });

const Badge = mongoose.models?.Badge || mongoose.model("Badge", badgeSchema);

export default Badge;
