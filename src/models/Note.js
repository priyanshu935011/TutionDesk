import mongoose from "../utils/supabaseModel.js";

const noteSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    pdfUrl: {
      type: String,
      required: true,
      trim: true,
    },
    pdfPublicId: {
      type: String,
      required: true,
      trim: true,
    },
    targetType: {
      type: String,
      enum: ["batch", "student"],
      default: "batch",
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      default: null,
    },
    students: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Student",
      },
    ],
  },
  { timestamps: true }
);

const Note = mongoose.model("Note", noteSchema);

export default Note;
