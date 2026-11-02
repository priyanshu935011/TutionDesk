import mongoose from "../utils/supabaseModel.js";

const staffAttendanceSchema = new mongoose.Schema(
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
    date: {
      type: String, // 'YYYY-MM-DD'
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["present", "absent", "half_day", "leave"],
      default: "present",
    },
    notes: {
      type: String,
      default: "",
    },
    markedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const StaffAttendance = mongoose.model("StaffAttendance", staffAttendanceSchema);

export default StaffAttendance;
