import mongoose from "../utils/supabaseModel.js";

const noticeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      default: "",
    },
    noticeType: {
      type: String,
      enum: ["general", "holiday", "reschedule"],
      default: "general",
    },
    targetType: {
      type: String,
      enum: ["all", "batch"],
      default: "all",
    },
    batchIds: {
      type: Array,
      default: [],
    },
    holidayDate: {
      type: Date,
      default: null,
    },
    originalTime: {
      type: String,
      default: "",
    },
    rescheduledDate: {
      type: Date,
      default: null,
    },
    rescheduledTime: {
      type: String,
      default: "",
    },
    sendWhatsApp: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

const Notice = mongoose.model("Notice", noticeSchema);

export default Notice;
