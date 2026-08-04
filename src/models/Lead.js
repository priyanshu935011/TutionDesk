import mongoose from "../utils/supabaseModel.js";

const leadSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    name: {
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
    course: {
      type: String,
      trim: true,
      default: "",
    },
    message: {
      type: String,
      trim: true,
      default: "",
    },
    source: {
      type: String,
      trim: true,
      default: "Website",
    },
    status: {
      type: String,
      enum: ["new", "contacted", "demo_scheduled", "enrolled", "rejected"],
      default: "new",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    leadFormId: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const Lead = mongoose.model("Lead", leadSchema);

export default Lead;
