import mongoose from "../utils/supabaseModel.js";

const consentRecordSchema = new mongoose.Schema(
  {
    principalType: {
      type: String,
      enum: ["user", "student", "parent", "lead", "contact"],
      required: true,
    },
    principalId: {
      type: String,
      default: "",
    },
    identifierHash: {
      type: String,
      default: "",
    },
    instituteId: {
      type: String,
      default: "",
    },
    purpose: {
      type: String,
      required: true,
    },
    granted: {
      type: Boolean,
      required: true,
      default: true,
    },
    noticeVersion: {
      type: String,
      default: "2026.11-v1",
    },
    language: {
      type: String,
      default: "en",
    },
    method: {
      type: String,
      default: "checkbox_web",
    },
    parentIdentifier: {
      type: String,
      default: "",
    },
    grantedAt: {
      type: Date,
      default: Date.now,
    },
    withdrawnAt: {
      type: Date,
      default: null,
    },
    ipMasked: {
      type: String,
      default: "",
    },
    userAgent: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const ConsentRecord = mongoose.model("ConsentRecord", consentRecordSchema);
export default ConsentRecord;
