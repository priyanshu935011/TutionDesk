import mongoose from "../utils/supabaseModel.js";

const activityLogSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      index: true,
    },
    instituteId: {
      type: String,
      index: true,
    },
    userName: {
      type: String,
      default: "",
    },
    userRole: {
      type: String,
      default: "teacher",
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    category: {
      type: String,
      default: "general", // 'student' | 'attendance' | 'payment' | 'staff' | 'academic' | 'general'
      index: true,
    },
    title: {
      type: String,
      default: "",
    },
    details: {
      type: String,
      default: "",
    },
    studentId: {
      type: String,
      default: "",
    },
    studentName: {
      type: String,
      default: "",
    },
    batchId: {
      type: String,
      default: "",
    },
    batchName: {
      type: String,
      default: "",
    },
    amount: {
      type: Number,
      default: 0,
    },
    metadata: {
      type: Object,
      default: {},
    },
    ip: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const ActivityLog = mongoose.model("ActivityLog", activityLogSchema);
export default ActivityLog;
