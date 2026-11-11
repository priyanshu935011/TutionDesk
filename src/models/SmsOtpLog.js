import mongoose from "../utils/supabaseModel.js";

const smsOtpLogSchema = new mongoose.Schema(
  {
    phoneMasked: {
      type: String,
      default: "",
    },
    provider: {
      type: String,
      default: "textbee",
    },
    status: {
      type: String,
      default: "sent",
      index: true,
    },
  },
  { timestamps: true }
);

const SmsOtpLog = mongoose.model("SmsOtpLog", smsOtpLogSchema);

export default SmsOtpLog;
