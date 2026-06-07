import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    paymentDate: {
      type: Date,
      required: true,
    },
    paymentType: {
      type: String,
      enum: ["monthly", "full_course", "partial"],
      required: true,
    },
    note: {
      type: String,
      trim: true,
      default: "",
    },
  },
  { _id: true }
);

const attendanceSchema = new mongoose.Schema(
  {
    date: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["present", "absent"],
      required: true,
    },
  },
  { _id: true }
);

const studentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    parentName: {
      type: String,
      required: true,
      trim: true,
    },
    parentPhone: {
      type: String,
      trim: true,
      default: "",
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
    },
    address: {
      type: String,
      trim: true,
      default: "",
    },
    enrollmentNumber: {
      type: String,
      required: true,
      trim: true,
    },
    batch: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Batch",
      required: true,
    },
    joinedOn: {
      type: Date,
      required: true,
    },
    dueDate: {
      type: Date,
      default: null,
    },
    totalFees: {
      type: Number,
      required: true,
      min: 0,
    },
    feePlanType: {
      type: String,
      enum: ["monthly", "full_course", "partial"],
      required: true,
    },
    paymentHistory: {
      type: [paymentSchema],
      default: [],
    },
    attendanceRecords: {
      type: [attendanceSchema],
      default: [],
    },
    password: {
      type: String,
      default: "",
    },
    lastActiveAt: {
      type: Date,
      default: null,
    },
    currentSessionId: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        const paidAmount = (ret.paymentHistory || []).reduce(
          (sum, payment) => sum + payment.amount,
          0
        );
        const totalFees = Number(ret.totalFees || 0);
        const attendanceRecords = ret.attendanceRecords || [];
        const presentCount = attendanceRecords.filter(
          (record) => record.status === "present"
        ).length;

        ret.paidAmount = paidAmount;
        ret.pendingAmount = totalFees - paidAmount;
        ret.attendanceSummary = {
          total: attendanceRecords.length,
          present: presentCount,
          absent: attendanceRecords.length - presentCount,
        };

        return ret;
      },
    },
  }
);

studentSchema.virtual("paidAmount").get(function getPaidAmount() {
  return (this.paymentHistory || []).reduce((sum, payment) => sum + payment.amount, 0);
});

studentSchema.virtual("pendingAmount").get(function getPendingAmount() {
  return Number(this.totalFees || 0) - this.paidAmount;
});

const Student = mongoose.model("Student", studentSchema);

export default Student;
