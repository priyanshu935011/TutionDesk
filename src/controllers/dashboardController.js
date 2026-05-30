import Student from "../models/Student.js";
import Batch from "../models/Batch.js";

export const getDashboard = async (req, res) => {
  try {
    const [students, totalBatches] = await Promise.all([
      Student.find({ user: req.user._id }).populate("batch", "name"),
      Batch.countDocuments({ user: req.user._id }),
    ]);

    const summary = students.reduce(
      (totals, student) => {
        totals.totalStudents += 1;
        totals.totalFeesCollected += student.paidAmount;
        totals.totalPendingFees += student.pendingAmount;
        if (student.pendingAmount > 0) {
          totals.pendingStudents += 1;
        }
        totals.totalAttendanceMarked += student.attendanceRecords.length;
        totals.totalPresent += student.attendanceRecords.filter(
          (record) => record.status === "present"
        ).length;
        return totals;
      },
      {
        totalStudents: 0,
        totalFeesCollected: 0,
        totalPendingFees: 0,
        pendingStudents: 0,
        totalAttendanceMarked: 0,
        totalPresent: 0,
      }
    );

    summary.totalBatches = totalBatches;
    summary.attendanceRate = summary.totalAttendanceMarked
      ? Math.round((summary.totalPresent / summary.totalAttendanceMarked) * 100)
      : 0;

    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ message: "Could not load dashboard" });
  }
};
