import mongoose from "../utils/supabaseModel.js";

const salesLeadSchema = new mongoose.Schema(
  {
    coachingName: {
      type: String,
      required: true,
      trim: true,
    },
    contactPerson: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    state: {
      type: String,
      trim: true,
      default: "",
    },
    district: {
      type: String,
      trim: true,
      default: "",
    },
    city: {
      type: String,
      trim: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    studentCapacity: {
      type: String,
      trim: true,
      default: "",
    },
    planInterest: {
      type: String,
      trim: true,
      default: "Yearly Subscription",
    },
    status: {
      type: String,
      enum: ["new", "contacted", "interested", "demo_scheduled", "follow_up", "converted", "lost"],
      default: "new",
    },
    source: {
      type: String,
      default: "Self-Added",
    },
    salesPerson: {
      type: String,
      default: null,
    },
    salesPersonName: {
      type: String,
      default: "",
    },
    addedBy: {
      type: String,
      default: null,
    },
    addedByName: {
      type: String,
      default: "",
    },
    googleBusinessLink: {
      type: String,
      trim: true,
      default: "",
    },
    nextFollowUpDate: {
      type: Date,
      default: null,
    },
    notes: {
      type: String,
      default: "",
    },
    callLogs: {
      type: Array,
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const SalesLead = mongoose.model("SalesLead", salesLeadSchema);

export default SalesLead;
