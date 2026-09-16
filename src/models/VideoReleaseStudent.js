import mongoose from "../utils/supabaseModel.js";

const videoReleaseStudentSchema = new mongoose.Schema(
  {
    release: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoRelease",
      required: true,
    },
    student: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
  },
  {
    timestamps: true,
  }
);

const VideoReleaseStudent = mongoose.model("VideoReleaseStudent", videoReleaseStudentSchema);

export default VideoReleaseStudent;
