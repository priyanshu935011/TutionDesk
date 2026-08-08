import mongoose from "../utils/supabaseModel.js";

const cashfreePaymentSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    instituteName: {
      type: String,
      required: true,
    },
    plan: {
      type: String,
      required: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    type: {
      type: String,
      enum: ["one_time", "recurring"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "success", "failed", "cancelled", "refunded"],
      default: "pending",
    },
    cfOrderId: {
      type: String,
      required: true,
      unique: true,
    },
    paymentSessionId: {
      type: String,
    },
    subscriptionId: {
      type: String,
    },
    autoRenew: {
      type: Boolean,
      default: false,
    },
    cfPaymentDetails: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  }
);

const CashfreePayment = mongoose.model("CashfreePayment", cashfreePaymentSchema);

export default CashfreePayment;
