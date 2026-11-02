import mongoose from "../utils/supabaseModel.js";

const instituteIncomeSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
      default: 0,
    },
    source: {
      type: String,
      default: "Other",
      trim: true,
    },
    date: {
      type: String, // 'YYYY-MM-DD'
      required: true,
    },
    monthKey: {
      type: String, // 'YYYY-MM'
      required: true,
      index: true,
    },
    notes: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const InstituteIncome = mongoose.model("InstituteIncome", instituteIncomeSchema);

export default InstituteIncome;
