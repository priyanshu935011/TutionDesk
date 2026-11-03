import mongoose from "../utils/supabaseModel.js";

const directRegistrationSchema = new mongoose.Schema(
  {
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      default: "Educator",
      trim: true,
    },
    instituteName: {
      type: String,
      default: "My Academy",
      trim: true,
    },
    trialEndsAt: {
      type: Date,
      default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7-day trial
    },
    status: {
      type: String,
      enum: ["trial_active", "expired", "converted", "suspended"],
      default: "trial_active",
    },
    features: {
      type: [String],
      default: [
        "attendance",
        "notes",
        "marks",
        "tests",
        "whatsapp",
        "finances",
        "ai",
        "homework",
        "quizzes",
      ],
    },
    wpBalance: {
      type: Number,
      default: 10.0,
    },
    aiBalance: {
      type: Number,
      default: 50.0,
    },
    storageLimitMb: {
      type: Number,
      default: 500,
    },
    storageUsedBytes: {
      type: Number,
      default: 0,
    },
    ipAddress: {
      type: String,
      default: "",
    },
    fcmToken: {
      type: String,
      default: "[]",
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    convertedToInstituteId: {
      type: String,
      default: null,
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const DirectRegistration = mongoose.model("DirectRegistration", directRegistrationSchema);

export default DirectRegistration;
