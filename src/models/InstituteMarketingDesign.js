import mongoose from "../utils/supabaseModel.js";

const instituteMarketingDesignSchema = new mongoose.Schema(
  {
    institute_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    template_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketingTemplateV2",
      required: true,
    },
    template_version_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketingTemplateVersion",
      default: null,
    },
    design_name: {
      type: String,
      default: "My Custom Design",
      trim: true,
    },
    design_json: {
      type: Object,
      required: true,
    },
    branding_snapshot: {
      type: Object,
      default: {},
    },
    thumbnail_url: {
      type: String,
      default: "",
    },
    preview_url: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["draft", "saved", "exported", "archived"],
      default: "draft",
    },
    revision_number: {
      type: Number,
      default: 1,
    },
    last_exported_at: {
      type: Date,
      default: null,
    },
    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    updated_by: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
  },
  {
    timestamps: true,
    tableName: "institute_marketing_designs",
  }
);

const InstituteMarketingDesign = mongoose.model(
  "InstituteMarketingDesign",
  instituteMarketingDesignSchema,
  "institute_marketing_designs"
);

export default InstituteMarketingDesign;
