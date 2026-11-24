import mongoose from "../utils/supabaseModel.js";

const studentPassSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: true,
      index: true,
    },
    passTitle: {
      type: String,
      default: "ClassTech All-Access Pass",
    },
    price: {
      type: Number,
      default: 999,
    },
    validityDays: {
      type: Number,
      default: 365,
    },
    orderId: {
      type: String,
      default: null,
    },
    cfOrderId: {
      type: String,
      default: null,
    },
    paymentId: {
      type: String,
      default: null,
    },
    status: {
      type: String,
      enum: ["active", "expired", "revoked", "cancelled"],
      default: "active",
      index: true,
    },
    validFrom: {
      type: Date,
      default: Date.now,
    },
    validUntil: {
      type: Date,
      required: true,
    },
    claimedProducts: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

studentPassSchema.index({ studentId: 1, status: 1, validUntil: -1 });

const StudentPass = mongoose.model("StudentPass", studentPassSchema, "student_classtech_passes");

export default StudentPass;
