import mongoose from "../utils/supabaseModel.js";

const marketingCategorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    icon: {
      type: String,
      default: "fi-rr-apps",
    },
    thumbnail_url: {
      type: String,
      default: "",
    },
    display_order: {
      type: Number,
      default: 0,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    tableName: "marketing_categories",
  }
);

const MarketingCategory = mongoose.model(
  "MarketingCategory",
  marketingCategorySchema,
  "marketing_categories"
);

export default MarketingCategory;
