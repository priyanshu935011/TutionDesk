import mongoose from "../utils/supabaseModel.js";

const marketingTemplateSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["festival", "admission", "achievement", "quote", "holiday", "announcement", "poster", "pamphlet", "admission_form"],
      default: "festival",
      index: true,
    },
    aspectRatio: {
      type: String,
      enum: ["1:1", "9:16", "16:9", "4:5"],
      default: "1:1",
    },
    imageUrl: {
      type: String,
      required: true,
      trim: true,
    },
    thumbnailUrl: {
      type: String,
      default: "",
    },
    storyImageUrl: {
      type: String,
      default: "",
    },
    brandingPositions: {
      square: {
        logo: {
          x: { type: Number, default: 6 },
          y: { type: Number, default: 6 },
          width: { type: Number, default: 18 },
          height: { type: Number, default: 18 },
          isVisible: { type: Boolean, default: true },
        },
        instituteName: {
          x: { type: Number, default: 26 },
          y: { type: Number, default: 8 },
          fontSize: { type: Number, default: 18 },
          color: { type: String, default: "#FFFFFF" },
          isVisible: { type: Boolean, default: true },
        },
        phone: {
          x: { type: Number, default: 6 },
          y: { type: Number, default: 88 },
          fontSize: { type: Number, default: 14 },
          color: { type: String, default: "#F59E0B" },
          isVisible: { type: Boolean, default: true },
        },
        address: {
          x: { type: Number, default: 6 },
          y: { type: Number, default: 93 },
          fontSize: { type: Number, default: 12 },
          color: { type: String, default: "#E2E8F0" },
          isVisible: { type: Boolean, default: true },
        },
      },
      story: {
        logo: {
          x: { type: Number, default: 6 },
          y: { type: Number, default: 5 },
          width: { type: Number, default: 18 },
          height: { type: Number, default: 12 },
          isVisible: { type: Boolean, default: true },
        },
        instituteName: {
          x: { type: Number, default: 26 },
          y: { type: Number, default: 6 },
          fontSize: { type: Number, default: 20 },
          color: { type: String, default: "#FFFFFF" },
          isVisible: { type: Boolean, default: true },
        },
        phone: {
          x: { type: Number, default: 6 },
          y: { type: Number, default: 90 },
          fontSize: { type: Number, default: 15 },
          color: { type: String, default: "#F59E0B" },
          isVisible: { type: Boolean, default: true },
        },
        address: {
          x: { type: Number, default: 6 },
          y: { type: Number, default: 94 },
          fontSize: { type: Number, default: 12 },
          color: { type: String, default: "#E2E8F0" },
          isVisible: { type: Boolean, default: true },
        },
      },
    },
    brandingConfig: {
      preset: {
        type: String,
        enum: ["bottom_strip", "card_badge", "floating_minimal", "custom"],
        default: "bottom_strip",
      },
      backgroundColor: {
        type: String,
        default: "#0F172A",
      },
      textColor: {
        type: String,
        default: "#FFFFFF",
      },
      accentColor: {
        type: String,
        default: "#F59E0B",
      },
      showLogo: {
        type: Boolean,
        default: true,
      },
      showInstituteName: {
        type: Boolean,
        default: true,
      },
      showPhone: {
        type: Boolean,
        default: true,
      },
      showAddress: {
        type: Boolean,
        default: true,
      },
      showTagline: {
        type: Boolean,
        default: false,
      },
      customFooterText: {
        type: String,
        default: "",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    priority: {
      type: Number,
      default: 0,
    },
    startDate: {
      type: Date,
      default: null,
    },
    endDate: {
      type: Date,
      default: null,
    },
    targetTiers: {
      type: [String],
      default: ["all"],
    },
    defaultShareCaption: {
      type: String,
      default: "Warm wishes from {instituteName}! For admissions & inquiries, reach us at {phone}.",
    },
    stats: {
      views: { type: Number, default: 0 },
      shares: { type: Number, default: 0 },
      downloads: { type: Number, default: 0 },
    },
    createdBy: {
      type: String,
      default: "super_admin",
    },
    canvasData: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
  },
  { timestamps: true }
);

const MarketingTemplate = mongoose.model("MarketingTemplate", marketingTemplateSchema);

export default MarketingTemplate;
