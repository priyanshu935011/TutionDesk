import mongoose from "../utils/supabaseModel.js";

const studentStreakSchema = new mongoose.Schema(
  {
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
      unique: true,
      index: true,
    },
    currentStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastActiveDateIST: {
      type: String, // e.g. "2026-11-24" in Asia/Kolkata timezone
      default: "",
    },
    activityHistory: [
      {
        dateIST: {
          type: String, // "YYYY-MM-DD"
          required: true,
        },
        isStreakMarked: {
          type: Boolean,
          default: false,
        },
        completedTasks: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "StreakTask",
          },
        ],
        taskMetrics: {
          classesAttended: { type: Number, default: 0 },
          questionsSolved: { type: Number, default: 0 },
          testsCompleted: { type: Number, default: 0 },
          videosWatched: { type: Number, default: 0 },
          doubtsAsked: { type: Number, default: 0 },
          doubtsSolved: { type: Number, default: 0 },
          revisionCardsReviewed: { type: Number, default: 0 },
          voiceTutorInteractions: { type: Number, default: 0 },
        },
      },
    ],
    unlockedBadges: [
      {
        badgeId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Badge",
          required: true,
        },
        unlockedAt: {
          type: Date,
          default: Date.now,
        },
        criteriaValueAtUnlock: {
          type: Number,
          default: 0,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

studentStreakSchema.index({ "activityHistory.dateIST": 1 });

const StudentStreak = mongoose.models?.StudentStreak || mongoose.model("StudentStreak", studentStreakSchema);

export default StudentStreak;
