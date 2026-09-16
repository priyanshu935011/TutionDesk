import mongoose from "../utils/supabaseModel.js";

const videoPlaylistItemSchema = new mongoose.Schema(
  {
    playlist: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoPlaylist",
      required: true,
    },
    video: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoLecture",
      required: true,
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

const VideoPlaylistItem = mongoose.model("VideoPlaylistItem", videoPlaylistItemSchema);

export default VideoPlaylistItem;
