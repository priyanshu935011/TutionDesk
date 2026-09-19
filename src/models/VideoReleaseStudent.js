import mongoose from "../utils/supabaseModel.js";

const videoReleaseStudentSchema = new mongoose.Schema(
  {
    release: {
      type: mongoose.Schema.Types.Mixed,
      ref: "VideoRelease",
    },
    release_id: {
      type: String,
    },
    student: {
      type: mongoose.Schema.Types.Mixed,
      ref: "Student",
    },
    student_id: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

const VideoReleaseStudent = mongoose.model("VideoReleaseStudent", videoReleaseStudentSchema);

export default VideoReleaseStudent;
