import mongoose from "../utils/supabaseModel.js";

const instituteVideoStorageSchema = new mongoose.Schema(
  {
    institute: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      required: true,
      unique: true,
    },
    storageLimitBytes: {
      type: Number,
      default: 53687091200, // 50 GB default
    },
    usedStorageBytes: {
      type: Number,
      default: 0,
    },
    reservedStorageBytes: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true,
  }
);

const InstituteVideoStorage = mongoose.model("InstituteVideoStorage", instituteVideoStorageSchema);

export default InstituteVideoStorage;
