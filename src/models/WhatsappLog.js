import mongoose from "../utils/supabaseModel.js";

const whatsappLogSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    to: {
      type: String,
      required: true,
    },
    messageText: {
      type: String,
      required: true,
    },
    msgType: {
      type: String,
      enum: ["absent_alert", "fee_reminder", "test_mark", "custom"],
      default: "custom",
    },
    status: {
      type: String,
      enum: ["sent", "failed"],
      default: "sent",
    },
    cost: {
      type: Number,
      default: 0,
    },
    error: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const WhatsappLog = mongoose.model("WhatsappLog", whatsappLogSchema);
export default WhatsappLog;
