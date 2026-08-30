import mongoose from "../utils/supabaseModel.js";

const videoWatchLogSchema = new mongoose.Schema(
  {
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoLecture",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    watchTimeSeconds: {
      type: Number,
      default: 0,
    },
    totalDurationSeconds: {
      type: Number,
      default: 0,
    },
    watchPercentage: {
      type: Number,
      default: 0,
    },
    lastWatchedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

const VideoWatchLog = mongoose.model("VideoWatchLog", videoWatchLogSchema);

export default VideoWatchLog;
