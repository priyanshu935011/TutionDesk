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
      enum: ["trial", "monthly", "quarterly", "half_yearly", "yearly", "custom", "lifetime"],
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
      default: ["attendance", "notes", "marks", "tests", "whatsapp", "leads"],
    },
    flexibleDueDate: {
      type: Boolean,
      default: false,
    },
    maxLeadFileSizeMb: {
      type: Number,
      default: 10,
    },
    studentCustomFields: {
      type: Array,
      default: [],
    },
    studentPortalEnabled: {
      type: Boolean,
      default: true,
    },
    leadApiKey: {
      type: String,
      default: "",
      trim: true,
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
      feeReminderTemplate: {
        type: String,
        default: "Dear {parentName}, this is a friendly reminder that INR {pendingAmount} is outstanding for student {studentName}'s tuition fee. Due date: {dueDate}. Thank you!",
      },
      feeReminderDaysBefore: {
        type: Number,
        default: 3,
      },
      sendCredentialsEnabled: {
        type: Boolean,
        default: false,
      }
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
            enum: ["trial", "monthly", "quarterly", "half_yearly", "yearly", "custom", "lifetime"],
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
