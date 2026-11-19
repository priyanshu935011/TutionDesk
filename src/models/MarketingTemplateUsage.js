import mongoose from "../utils/supabaseModel.js";

const marketingTemplateUsageSchema = new mongoose.Schema(
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
      index: true,
    },
    template_version_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MarketingTemplateVersion",
      default: null,
    },
    design_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InstituteMarketingDesign",
      default: null,
    },
    action: {
      type: String,
      enum: ["view", "select", "edit", "save_draft", "export", "share"],
      required: true,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    tableName: "marketing_template_usage",
  }
);

const MarketingTemplateUsage = mongoose.model(
  "MarketingTemplateUsage",
  marketingTemplateUsageSchema,
  "marketing_template_usage"
);

export default MarketingTemplateUsage;
