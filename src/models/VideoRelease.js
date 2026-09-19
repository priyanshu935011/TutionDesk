import mongoose from "../utils/supabaseModel.js";

const videoReleaseSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.Mixed,
      ref: "Institute",
    },
    institute_id: {
      type: String,
    },
    teacher: {
      type: mongoose.Schema.Types.Mixed,
      ref: "User",
    },
    teacher_id: {
      type: String,
    },
    video: {
      type: mongoose.Schema.Types.Mixed,
      ref: "VideoLecture",
    },
    video_id: {
      type: String,
    },
    startsAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      default: null, // null = never expires
    },
    status: {
      type: String,
      enum: ["ACTIVE", "REVOKED", "EXPIRED"],
      default: "ACTIVE",
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const VideoRelease = mongoose.model("VideoRelease", videoReleaseSchema);

export default VideoRelease;
