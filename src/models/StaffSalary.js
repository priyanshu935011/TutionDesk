import mongoose from "../utils/supabaseModel.js";

const staffSalarySchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    staff: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    staffName: {
      type: String,
      default: "",
    },
    monthKey: {
      type: String, // 'YYYY-MM'
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    status: {
      type: String,
      enum: ["disbursed", "pending"],
      default: "disbursed",
    },
    disbursedAt: {
      type: Date,
      default: Date.now,
    },
    paymentMode: {
      type: String,
      default: "Cash",
    },
    notes: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

const StaffSalary = mongoose.model("StaffSalary", staffSalarySchema);

export default StaffSalary;
