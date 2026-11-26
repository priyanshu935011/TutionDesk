import mongoose from "../utils/supabaseModel.js";

const studentPackageSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      trim: true,
    },
    tier: {
      type: String,
      trim: true,
    },
    badge_text: {
      type: String,
      trim: true,
    },
    ai_flashcards_limit: {
      type: Number,
      default: 25,
    },
    name: {
      type: String,
      trim: true,
    },
    slug: {
      type: String,
      trim: true,
    },
    badge: {
      type: String,
      default: "Popular",
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    discountedPrice: {
      type: Number,
      min: 0,
      default: 0,
    },
    billingCycle: {
      type: String,
      enum: ["monthly", "quarterly", "yearly", "lifetime", "free"],
      default: "monthly",
    },
    quotas: {
      aiDoubtsDailyLimit: {
        type: Number,
        default: 5, // 5 for free, 100 for pro
      },
      mistakeBookMaxEntries: {
        type: Number,
        default: 50, // 50 for free, 2000 for pro
      },
      focusModeMaxDailyMinutes: {
        type: Number,
        default: 60, // 60 for free, -1 for unlimited
      },
      testSeriesAccess: {
        type: String,
        enum: ["none", "preview", "all"],
        default: "preview",
      },
      digitalNotesAccess: {
        type: String,
        enum: ["none", "preview", "all"],
        default: "preview",
      },
      maxFreeMockTests: {
        type: Number,
        default: 3,
      },
      aiFlashcardsLimit: {
        type: Number,
        default: 25, // Editable by admin per tier
      },
      careerAssessmentAttemptsLimit: {
        type: Number,
        default: 1, // 1 for free, -1 for unlimited
      },
    },
    features: {
      aiTutor: { type: Boolean, default: true },
      aiMistakeBook: { type: Boolean, default: true },
      aiRevision: { type: Boolean, default: true },
      aiCareerGuidance: { type: Boolean, default: true },
      gamifiedFocusMode: { type: Boolean, default: true },
      interactivePyqBank: { type: Boolean, default: true },
      virtualStudyRooms: { type: Boolean, default: true },
      parentSnapshot: { type: Boolean, default: true },
      adFree: { type: Boolean, default: false },
    },
    includedNoteIds: [{ type: String }],
    includedTestSeriesIds: [{ type: String }],
    priority: {
      type: Number,
      default: 1,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: String,
      default: "super_admin",
    },
  },
  { timestamps: true }
);

const StudentPackage = mongoose.model("StudentPackage", studentPackageSchema, "student_packages");
export default StudentPackage;
