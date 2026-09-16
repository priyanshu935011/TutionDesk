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
    playlist: {
      type: String,
      default: "",
      trim: true,
    },
    playlistId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoPlaylist",
      default: null,
    },
    bunnyVideoId: {
      type: String,
      required: true,
      trim: true,
    },
    bunnyLibraryId: {
      type: String,
      default: "",
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
    thumbnailSource: {
      type: String,
      enum: ["bunny", "custom"],
      default: "bunny",
    },
    durationSeconds: {
      type: Number,
      default: 0,
    },
    fileSizeBytes: {
      type: Number,
      default: 0,
    },
    uploadFileName: {
      type: String,
      default: "",
    },
    uploadFileSizeBytes: {
      type: Number,
      default: 0,
    },
    processingProgress: {
      type: Number,
      default: 0,
    },
    storageSizeBytes: {
      type: Number,
      default: 0,
    },
    targetAudienceType: {
      type: String,
      enum: ["none", "all", "batch", "student"],
      default: "none",
    },
    targetAudienceMetadata: {
      type: Object,
      default: {},
    },
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
    archivedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    status: {
      type: String,
      enum: ["UPLOADING", "PROCESSING", "READY", "FAILED", "ARCHIVED", "CANCELLED", "active", "expired"],
      default: "UPLOADING",
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
