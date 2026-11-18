import mongoose from "../utils/supabaseModel.js";

const organizationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    ownerUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    owner_user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    ownerName: {
      type: String,
      default: "",
    },
    adminEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    adminPhone: {
      type: String,
      trim: true,
      default: "",
    },
    planType: {
      type: String,
      enum: ["multi_branch_starter", "multi_branch_pro", "enterprise"],
      default: "multi_branch_pro",
    },
    maxBranches: {
      type: Number,
      default: 10,
    },
    status: {
      type: String,
      enum: ["active", "suspended", "expired"],
      default: "active",
    },
    settings: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true }
);

const Organization = mongoose.model("Organization", organizationSchema, "organizations");

export default Organization;
