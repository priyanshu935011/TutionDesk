import mongoose from "../utils/supabaseModel.js";

const marketingMediaSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },
    filename: {
      type: String,
      default: "media_file",
    },
    mimeType: {
      type: String,
      default: "image/png",
    },
    sizeBytes: {
      type: Number,
      default: 0,
    },
    width: {
      type: Number,
      default: null,
    },
    height: {
      type: Number,
      default: null,
    },
    createdBy: {
      type: String,
      default: "super_admin",
    },
  },
  { timestamps: true }
);

const MarketingMedia = mongoose.model("MarketingMedia", marketingMediaSchema);
export default MarketingMedia;
