import mongoose from "../utils/supabaseModel.js";

const marketingTemplateVersionSchema = new mongoose.Schema(
  {
    template_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketingTemplateV2",
      required: true,
    },
    version_number: {
      type: Number,
      required: true,
    },
    template_json: {
      type: Object,
      required: true,
    },
    preview_url: {
      type: String,
      default: "",
    },
    publication_status: {
      type: String,
      enum: ["draft", "published", "archived"],
      default: "published",
    },
    change_summary: {
      type: String,
      default: "",
    },
    published_by: {
      type: String,
      default: "super_admin",
    },
    published_at: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
    tableName: "marketing_template_versions",
  }
);

const MarketingTemplateVersion = mongoose.model(
  "MarketingTemplateVersion",
  marketingTemplateVersionSchema,
  "marketing_template_versions"
);

export default MarketingTemplateVersion;
