import mongoose from "../utils/supabaseModel.js";

const marketingAssetSchema = new mongoose.Schema(
  {
    owner_type: {
      type: String,
      enum: ["super_admin", "institute"],
      default: "super_admin",
    },
    owner_id: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    asset_name: {
      type: String,
      required: true,
      trim: true,
    },
    asset_type: {
      type: String,
      enum: ["background", "illustration", "icon", "decoration", "logo", "photo"],
      default: "background",
    },
    storage_path: {
      type: String,
      required: true,
    },
    public_url: {
      type: String,
      required: true,
    },
    mime_type: {
      type: String,
      default: "image/png",
    },
    file_size: {
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
    tags: {
      type: Array,
      default: [],
    },
    metadata: {
      type: Object,
      default: {},
    },
    created_by: {
      type: String,
      default: "system",
    },
  },
  {
    timestamps: true,
    tableName: "marketing_assets",
  }
);

const MarketingAsset = mongoose.model(
  "MarketingAsset",
  marketingAssetSchema,
  "marketing_assets"
);

export default MarketingAsset;
