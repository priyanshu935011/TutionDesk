import Student from "../models/Student.js";
import Batch from "../models/Batch.js";

export const getDashboard = async (req, res) => {
  try {
    // NOTE: 'status' is NOT a real DB column — it's stored in local batches_metadata.json.
    // DB-level filters on 'status' get silently stripped. Fetch all and filter in-memory.
    const allBatches = await Batch.find({ user: req.user._id }).select("_id status");
    const archivedBatchIds = allBatches.filter((b) => b.status === "archived").map((b) => b._id);
    const activeBatchCount = allBatches.filter((b) => b.status !== "archived").length;

    const studentQuery = { user: req.user._id };
    if (archivedBatchIds.length > 0) {
      studentQuery.batch = { $nin: archivedBatchIds };
    }

    const [students] = await Promise.all([
      Student.find(studentQuery).populate("batch", "name"),
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

    summary.totalBatches = activeBatchCount;
    summary.attendanceRate = summary.totalAttendanceMarked
      ? Math.round((summary.totalPresent / summary.totalAttendanceMarked) * 100)
      : 0;

    return res.json(summary);
  } catch (error) {
    return res.status(500).json({ message: "Could not load dashboard" });
  }
};
