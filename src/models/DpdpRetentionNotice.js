import mongoose from "../utils/supabaseModel.js";

// Tracks DPDP Rule 8 mandatory 48-hour advance deletion notices before scheduled erasure.
const dpdpRetentionNoticeSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ["student", "lead", "user"],
      required: true,
    },
    targetId: {
      type: String,
      required: true,
    },
    instituteId: {
      type: String,
      default: "",
    },
    reason: {
      type: String,
      default: "purpose_fulfilled_inactivity",
    },
    contactMasked: {
      type: String,
      default: "",
    },
    noticeSentAt: {
      type: Date,
      default: Date.now,
    },
    scheduledErasureAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["notified", "cancelled", "executed"],
      default: "notified",
    },
    executedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const DpdpRetentionNotice = mongoose.model("DpdpRetentionNotice", dpdpRetentionNoticeSchema);
export default DpdpRetentionNotice;
