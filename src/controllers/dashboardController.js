import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";

export const getDashboard = async (req, res) => {
  try {
    const rawInst = req.user.institute;
    const instIdStr = rawInst?._id ? String(rawInst._id) : (rawInst ? String(rawInst) : null);

    let institute = null;
    if (instIdStr) {
      institute = await Institute.findById(instIdStr)
        .select(
          "name status subscriptionPlan subscriptionEnd adminUser tuitionType quizFeatureEnabled brandingEnabled themeColor logoUrl allowedFeatures whatsappSettings"
        );
    }

    const adminUserId = rawInst?.adminUser ? String(rawInst.adminUser) : null;
    const ownerId = req.user.role === "teacher" 
      ? (adminUserId || instIdStr || req.user._id)
      : (instIdStr || req.user._id);

    const allBatches = await Batch.find({ user: ownerId }).select("_id status");
    const activeBatches = allBatches.filter((b) => b.status !== "archived");
    const activeBatchIds = new Set(activeBatches.map((b) => String(b._id)));
    const activeBatchCount = activeBatches.length;

    const studentQuery = { user: ownerId, isArchived: { $ne: true } };

    const [rawStudents] = await Promise.all([
      Student.find(studentQuery).populate("batch", "name"),
    ]);

    const students = rawStudents.filter((student) => {
      if (student.isArchived) return false;
      const studentBatchIds = [];
      if (student.batch) studentBatchIds.push(String(student.batch._id || student.batch));
      if (Array.isArray(student.batches)) student.batches.forEach((b) => studentBatchIds.push(String(b._id || b)));
      if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => studentBatchIds.push(String(b)));
      if (studentBatchIds.length === 0) return true;
      return studentBatchIds.some((bId) => activeBatchIds.has(bId));
    });

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();

    const summary = students.reduce(
      (totals, student) => {
        totals.totalStudents += 1;
        
        // Sum payments for the current month only
        const currentMonthPaid = (student.paymentHistory || []).reduce((sum, p) => {
          const pDate = new Date(p.paymentDate || p.payment_date);
          if (pDate.getMonth() === currentMonth && pDate.getFullYear() === currentYear) {
            return sum + p.amount;
          }
          return sum;
        }, 0);
        totals.totalFeesCollected += currentMonthPaid;

        // Pending fees: if the student has a pending balance
        // AND either their due date falls in the current month or earlier, or no due date is set
        let isDueThisMonthOrEarlier = false;
        const rawDueDate = student.dueDate || student.due_date;
        if (rawDueDate) {
          const dDate = new Date(rawDueDate);
          isDueThisMonthOrEarlier = (dDate.getFullYear() < currentYear) || 
                                    (dDate.getFullYear() === currentYear && dDate.getMonth() <= currentMonth);
        } else {
          isDueThisMonthOrEarlier = (student.pendingAmount || 0) > 0;
        }

        if (isDueThisMonthOrEarlier && (student.pendingAmount || 0) > 0) {
          totals.totalPendingFees += (student.pendingAmount || 0);
          totals.pendingStudents += 1;
        }

        const attendance = student.attendanceRecords || [];
        totals.totalAttendanceMarked += attendance.length;
        totals.totalPresent += attendance.filter(
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

    return res.json({
      summary,
      institute: institute || {},
      user: {
        role: req.user.role,
      },
    });
  } catch (error) {
    console.error("getDashboard error:", error);
    return res.status(500).json({ message: "Could not load dashboard", error: error.message });
  }
};
