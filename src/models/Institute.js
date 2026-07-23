import mongoose from "../utils/supabaseModel.js";

const instituteSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    ownerName: {
      type: String,
      required: true,
      trim: true,
    },
    adminEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    adminPhone: {
      type: String,
      trim: true,
      default: "",
    },
    subscriptionPlan: {
      type: String,
      enum: ["trial", "monthly", "quarterly", "half_yearly", "yearly"],
      required: true,
    },
    subscriptionAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    trialDays: {
      type: Number,
      min: 1,
      default: 14,
    },
    subscriptionStart: {
      type: Date,
      required: true,
    },
    subscriptionEnd: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "suspended"],
      default: "active",
    },
    adminUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    tuitionType: {
      type: String,
      enum: ["institution", "solo"],
      default: "solo",
    },
    isDemoAccount: {
      type: Boolean,
      default: false,
    },
    quizFeatureEnabled: {
      type: Boolean,
      default: true,
    },
    allowedFeatures: {
      type: [String],
      default: ["attendance", "notes", "marks", "tests", "whatsapp"],
    },
    whatsappSettings: {
      absentAlertsEnabled: {
        type: Boolean,
        default: false,
      },
      feeRemindersEnabled: {
        type: Boolean,
        default: false,
      },
      customMessageTemplate: {
        type: String,
        default: "Dear Parent, your child {studentName} was marked absent on {date}.",
      },
    },
    websiteConfig: {
      enabled: {
        type: Boolean,
        default: false,
      },
      slug: {
        type: String,
        trim: true,
        default: "",
      },
      headline: {
        type: String,
        trim: true,
        default: "",
      },
      subheadline: {
        type: String,
        trim: true,
        default: "",
      },
      aboutText: {
        type: String,
        trim: true,
        default: "",
      },
      bannerUrl: {
        type: String,
        trim: true,
        default: "",
      },
      contactAddress: {
        type: String,
        trim: true,
        default: "",
      },
      contactPhone: {
        type: String,
        trim: true,
        default: "",
      },
      netlifySiteId: {
        type: String,
        trim: true,
        default: "",
      },
      netlifySubdomain: {
        type: String,
        trim: true,
        default: "",
      },
      publishedUrl: {
        type: String,
        trim: true,
        default: "",
      },
      lastDeployedAt: {
        type: Date,
        default: null,
      },
    },
    subscriptionHistory: {
      type: [
        {
          plan: {
            type: String,
            enum: ["trial", "monthly", "quarterly", "half_yearly", "yearly"],
            required: true,
          },
          amount: {
            type: Number,
            required: true,
            min: 0,
          },
          startDate: {
            type: Date,
            required: true,
          },
          endDate: {
            type: Date,
            required: true,
          },
          trialDays: {
            type: Number,
            default: 14,
          },
          note: {
            type: String,
            trim: true,
            default: "",
          },
          createdAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

const Institute = mongoose.model("Institute", instituteSchema);

export default Institute;
