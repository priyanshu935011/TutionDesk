import mongoose from "../utils/supabaseModel.js";

const marketingExportSchema = new mongoose.Schema(
  {
    institute_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    design_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "InstituteMarketingDesign",
      default: null,
    },
    format: {
      type: String,
      enum: ["png", "jpg", "pdf"],
      default: "png",
    },
    resolution_dpi: {
      type: Number,
      default: 300,
    },
    canvas_preset: {
      type: String,
      default: "1080x1080",
    },
    storage_path: {
      type: String,
      default: "",
    },
    public_url: {
      type: String,
      default: "",
    },
    file_size: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["processing", "ready", "failed"],
      default: "processing",
    },
    error_message: {
      type: String,
      default: "",
    },
    requested_by: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  },
  {
    timestamps: true,
    tableName: "marketing_exports",
  }
);

const MarketingExport = mongoose.model(
  "MarketingExport",
  marketingExportSchema,
  "marketing_exports"
);

export default MarketingExport;
