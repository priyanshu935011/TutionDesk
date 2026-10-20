import mongoose from "../utils/supabaseModel.js";

const supportFaqSchema = new mongoose.Schema(
  {
    category: {
      type: String,
      required: true,
      trim: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    answer: {
      type: String,
      required: true,
    },
    orderIndex: {
      type: Number,
      default: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

const SupportFaq = mongoose.model("SupportFaq", supportFaqSchema);
export default SupportFaq;
