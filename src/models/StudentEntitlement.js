import mongoose from "../utils/supabaseModel.js";

const studentEntitlementSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    studentType: {
      type: String,
      enum: ["independent_direct", "institute_enrolled", "archived_alumni"],
      default: "independent_direct",
    },
    tier: {
      type: String,
      enum: ["free", "pro", "premium", "elite"],
      default: "free",
    },
    activePackage: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "StudentPackage",
    },
    packageExpiresAt: {
      type: Date,
      default: null,
    },
    focusCoins: {
      type: Number,
      default: 50, // Starting welcome coins
      min: 0,
    },
    studyStreakDays: {
      type: Number,
      default: 1,
    },
    lastActiveDate: {
      type: String, // YYYY-MM-DD
      default: () => new Date().toISOString().split("T")[0],
    },
    featureOverrides: {
      type: Map,
      of: new mongoose.Schema(
        {
          enabled: { type: Boolean, default: true },
          customDailyLimit: { type: Number, default: -1 }, // -1 means default
          customExpiresAt: { type: Date, default: null },
        },
        { _id: false }
      ),
      default: {},
    },
    archivedFromInstitute: {
      type: String,
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const StudentEntitlement = mongoose.model(
  "StudentEntitlement",
  studentEntitlementSchema,
  "student_entitlements"
);
export default StudentEntitlement;
