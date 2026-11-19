import mongoose from "../utils/supabaseModel.js";

const focusSessionSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    subject: {
      type: String,
      default: "Self Study",
    },
    targetMinutes: {
      type: Number,
      required: true,
      default: 25,
    },
    completedMinutes: {
      type: Number,
      default: 0,
    },
    coinsEarned: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["completed", "interrupted"],
      default: "completed",
    },
    dateString: {
      type: String, // YYYY-MM-DD
      default: () => new Date().toISOString().split("T")[0],
      index: true,
    },
  },
  { timestamps: true }
);

const FocusSession = mongoose.model("FocusSession", focusSessionSchema, "focus_sessions");
export default FocusSession;
