import mongoose from "../utils/supabaseModel.js";

const videoUploadSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    teacher: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoLecture",
      required: true,
    },
    originalFileName: {
      type: String,
      required: true,
    },
    fileSizeBytes: {
      type: Number,
      required: true,
    },
    uploadStatus: {
      type: String,
      enum: ["INITIATED", "UPLOADING", "COMPLETED", "FAILED", "CANCELLED"],
      default: "INITIATED",
    },
    uploadProgress: {
      type: Number,
      default: 0,
    },
    uploadSessionId: {
      type: String,
      default: "",
    },
    reservationBytes: {
      type: Number,
      default: 0,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
    errorCode: {
      type: String,
      default: "",
    },
    errorMessage: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const VideoUpload = mongoose.model("VideoUpload", videoUploadSchema);

export default VideoUpload;
