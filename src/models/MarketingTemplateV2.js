import mongoose from "../utils/supabaseModel.js";

const marketingTemplateV2Schema = new mongoose.Schema(
  {
    category_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketingCategory",
      default: null,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    aspect_ratio: {
      type: String,
      enum: ["1:1", "4:5", "9:16", "16:9"],
      default: "1:1",
    },
    canvas_width: {
      type: Number,
      default: 1080,
    },
    canvas_height: {
      type: Number,
      default: 1080,
    },
    thumbnail_url: {
      type: String,
      default: "",
    },
    preview_url: {
      type: String,
      default: "",
    },
    schema_version: {
      type: String,
      default: "2.0",
    },
    current_version_number: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "published",
    },
    is_featured: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: Number,
      default: 0,
    },
    tags: {
      type: Array,
      default: [],
    },
    target_tiers: {
      type: Array,
      default: ["all"],
    },
    default_share_caption: {
      type: String,
      default: "Warm wishes from {institute.name}! For inquiries, contact: {institute.phone}.",
    },
    created_by: {
      type: String,
      default: "super_admin",
    },
  },
  {
    timestamps: true,
    tableName: "marketing_templates_v2",
  }
);

const MarketingTemplateV2 = mongoose.model(
  "MarketingTemplateV2",
  marketingTemplateV2Schema,
  "marketing_templates_v2"
);

export default MarketingTemplateV2;
