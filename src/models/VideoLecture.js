import mongoose from "../utils/supabaseModel.js";

const videoLectureSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
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
    bunnyVideoId: {
      type: String,
      required: true,
      trim: true,
    },
    videoUrl: {
      type: String,
      default: "",
      trim: true,
    },
    hlsUrl: {
      type: String,
      default: "",
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      default: "",
      trim: true,
    },
    durationSeconds: {
      type: Number,
      default: 0,
    },
    fileSizeBytes: {
      type: Number,
      default: 0,
    },
    targetType: {
      type: String,
      enum: ["all", "batch", "student"],
      default: "batch",
    },
    batches: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Batch",
      },
    ],
    students: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
      },
    ],
    expiryType: {
      type: String,
      enum: ["none", "date", "preset"],
      default: "none",
    },
    expiryDate: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "expired", "processing"],
      default: "active",
    },
    viewCount: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const VideoLecture = mongoose.model("VideoLecture", videoLectureSchema);

export default VideoLecture;
