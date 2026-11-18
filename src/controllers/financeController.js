import InstituteExpense from "../models/InstituteExpense.js";
import InstituteIncome from "../models/InstituteIncome.js";
import StaffSalary from "../models/StaffSalary.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import { readUserMetadata } from "../utils/supabaseModel.js";
import { isReceptionist, getTodayISTDateString } from "../utils/staffPermissionHelper.js";

// Helper to get current Indian YYYY-MM
export const getCurrentMonthKey = () => {
  return getTodayISTDateString().substring(0, 7);
};

export const getFinanceAnalytics = async (req, res) => {
  try {
    if (req.user.role === "teacher" || isReceptionist(req.user)) {
      return res.status(403).json({ message: "Access denied. Staff members cannot view finances." });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    const ownerId = instituteId;
    const userIds = [
      ownerId,
      req.user._id,
      req.user.institute?._id,
      req.user.institute,
      req.user.institute?.adminUser,
    ].filter(Boolean);

    const monthKey = req.query.month ? String(req.query.month).trim() : getCurrentMonthKey();

    // 1. Fetch Students and their payments for this month
    const students = await Student.find({
      user: { $in: userIds },
      isArchived: { $ne: true },
    }).populate("batch", "name");

    const studentPayments = [];
    let totalStudentFees = 0;

    for (const student of students) {
      const sObj = student.toObject ? student.toObject() : student;
      const history = Array.isArray(sObj.paymentHistory) ? sObj.paymentHistory : [];
      const batchName = sObj.batch?.name || sObj.batchName || "Unassigned";

      for (const p of history) {
        const rawDate = p.paymentDate || p.date || p.createdAt || "";
        const dateStr = String(rawDate);
        if (dateStr.startsWith(monthKey)) {
          const amt = Number(p.amount || 0);
          totalStudentFees += amt;
          studentPayments.push({
            id: p._id || p.id || `${sObj._id}_${dateStr}_${amt}`,
            studentId: sObj._id || sObj.id,
            studentName: sObj.name,
            batchName: batchName,
            amount: amt,
            paymentDate: dateStr.split("T")[0],
            paymentMode: p.mode || p.paymentMode || "Cash",
            receiptNumber: p.receiptNumber || p.receipt_number || "",
            notes: p.notes || "",
          });
        }
      }
    }

    // Sort student payments by date descending
    studentPayments.sort((a, b) => (b.paymentDate || "").localeCompare(a.paymentDate || ""));

    // 2. Fetch Extra Incomes for this month
    const extraIncomesDocs = await InstituteIncome.find({
      institute: instituteId,
      monthKey: monthKey,
    }).sort({ date: -1 });

    const extraIncomes = extraIncomesDocs.map((doc) => {
      const obj = doc.toObject ? doc.toObject() : doc;
      return {
        _id: obj._id || obj.id,
        id: obj._id || obj.id,
        title: obj.title,
        amount: Number(obj.amount || 0),
        source: obj.source || "Other",
        date: obj.date,
        monthKey: obj.monthKey,
        notes: obj.notes || "",
      };
    });

    const totalExtraIncome = extraIncomes.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalIncome = totalStudentFees + totalExtraIncome;

    // 3. Fetch Staff Members & Salary Disbursements for this month
    const staffMembers = await User.find({
      institute: instituteId,
      role: { $in: ["teacher", "receptionist"] },
    }).select("name email phone role salary staffRole assignedBatches createdAt");

    const userMeta = readUserMetadata();
    const salaryDocs = await StaffSalary.find({
      institute: instituteId,
      monthKey: monthKey,
    });

    const salaryMap = new Map();
    for (const sal of salaryDocs) {
      const sObj = sal.toObject ? sal.toObject() : sal;
      salaryMap.set(String(sObj.staff), sObj);
    }

    let totalSalaryDisbursed = 0;
    let totalSalaryPending = 0;

    const staffSalaries = staffMembers.map((staff) => {
      const sId = String(staff._id || staff.id);
      const meta = userMeta[sId] || {};
      const baseSalary = Number(staff.salary !== undefined ? staff.salary : (meta.salary || 0));
      const staffRole = staff.staffRole || meta.staffRole || "Teacher";

      const disbRecord = salaryMap.get(sId);
      const isDisbursed = !!disbRecord && disbRecord.status === "disbursed";
      const disbursedAmount = isDisbursed ? Number(disbRecord.amount || baseSalary) : 0;

      if (isDisbursed) {
        totalSalaryDisbursed += disbursedAmount;
      } else {
        totalSalaryPending += baseSalary;
      }

      return {
        staffId: sId,
        name: staff.name,
        email: staff.email,
        phone: staff.phone,
        role: staffRole,
        baseSalary: baseSalary,
        isDisbursed: isDisbursed,
        disbursedAmount: disbursedAmount,
        disbursedAt: disbRecord?.disbursedAt || null,
        paymentMode: disbRecord?.paymentMode || "Cash",
        notes: disbRecord?.notes || "",
        disbursementId: disbRecord?._id || disbRecord?.id || null,
      };
    });

    // 4. Fetch Extra Expenses for this month
    const extraExpensesDocs = await InstituteExpense.find({
      institute: instituteId,
      monthKey: monthKey,
    }).sort({ date: -1 });

    const extraExpenses = extraExpensesDocs.map((doc) => {
      const obj = doc.toObject ? doc.toObject() : doc;
      return {
        _id: obj._id || obj.id,
        id: obj._id || obj.id,
        title: obj.title,
        amount: Number(obj.amount || 0),
        category: obj.category || "General",
        date: obj.date,
        monthKey: obj.monthKey,
        notes: obj.notes || "",
      };
    });

    const totalOtherExpenses = extraExpenses.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    const totalExpenses = totalSalaryDisbursed + totalOtherExpenses;
    const netProfit = totalIncome - totalExpenses;

    return res.json({
      month: monthKey,
      summary: {
        totalIncome,
        studentFeesIncome: totalStudentFees,
        extraIncome: totalExtraIncome,
        totalExpenses,
        salaryExpenses: totalSalaryDisbursed,
        otherExpenses: totalOtherExpenses,
        netProfit,
        pendingSalaries: totalSalaryPending,
      },
      studentPayments,
      extraIncomes,
      staffSalaries,
      extraExpenses,
    });
  } catch (error) {
    console.error("getFinanceAnalytics error:", error);
    return res.status(500).json({ message: "Could not fetch financial analytics" });
  }
};

export const addExpense = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied." });
    }

    const { title, amount, category, date, notes } = req.body;
    if (!title || amount === undefined) {
      return res.status(400).json({ message: "Expense title and amount are required." });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    const targetDate = date ? String(date).split("T")[0] : new Date().toISOString().split("T")[0];
    const monthKey = targetDate.slice(0, 7);

    const expense = await InstituteExpense.create({
      institute: instituteId,
      title: title.trim(),
      amount: Number(amount),
      category: category ? String(category).trim() : "General",
      date: targetDate,
      monthKey: monthKey,
      notes: notes ? String(notes).trim() : "",
      createdBy: req.user._id,
    });

    return res.status(201).json(expense);
  } catch (error) {
    console.error("addExpense error:", error);
    return res.status(500).json({ message: "Could not add expense." });
  }
};

export const updateExpense = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied." });
    }

    const { title, amount, category, date, notes } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;

    const expense = await InstituteExpense.findOne({
      _id: req.params.id,
      institute: instituteId,
    });

    if (!expense) {
      return res.status(404).json({ message: "Expense not found." });
    }

    if (title !== undefined) expense.title = title.trim();
    if (amount !== undefined) expense.amount = Number(amount);
    if (category !== undefined) expense.category = String(category).trim();
    if (date !== undefined) {
      const targetDate = String(date).split("T")[0];
      expense.date = targetDate;
      expense.monthKey = targetDate.slice(0, 7);
    }
    if (notes !== undefined) expense.notes = String(notes).trim();

    await expense.save();
    return res.json(expense);
  } catch (error) {
    console.error("updateExpense error:", error);
    return res.status(500).json({ message: "Could not update expense." });
  }
};

export const deleteExpense = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied." });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    await InstituteExpense.findOneAndDelete({
      _id: req.params.id,
      institute: instituteId,
    });

    return res.json({ message: "Expense deleted successfully." });
  } catch (error) {
    console.error("deleteExpense error:", error);
    return res.status(500).json({ message: "Could not delete expense." });
  }
};

export const addIncome = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied." });
    }

    const { title, amount, source, date, notes } = req.body;
    if (!title || amount === undefined) {
      return res.status(400).json({ message: "Income title and amount are required." });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    const targetDate = date ? String(date).split("T")[0] : new Date().toISOString().split("T")[0];
    const monthKey = targetDate.slice(0, 7);

    const income = await InstituteIncome.create({
      institute: instituteId,
      title: title.trim(),
      amount: Number(amount),
      source: source ? String(source).trim() : "Other",
      date: targetDate,
      monthKey: monthKey,
      notes: notes ? String(notes).trim() : "",
      createdBy: req.user._id,
    });

    return res.status(201).json(income);
  } catch (error) {
    console.error("addIncome error:", error);
    return res.status(500).json({ message: "Could not add income." });
  }
};

export const updateIncome = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied." });
    }

    const { title, amount, source, date, notes } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;

    const income = await InstituteIncome.findOne({
      _id: req.params.id,
      institute: instituteId,
    });

    if (!income) {
      return res.status(404).json({ message: "Income not found." });
    }

    if (title !== undefined) income.title = title.trim();
    if (amount !== undefined) income.amount = Number(amount);
    if (source !== undefined) income.source = String(source).trim();
    if (date !== undefined) {
      const targetDate = String(date).split("T")[0];
      income.date = targetDate;
      income.monthKey = targetDate.slice(0, 7);
    }
    if (notes !== undefined) income.notes = String(notes).trim();

    await income.save();
    return res.json(income);
  } catch (error) {
    console.error("updateIncome error:", error);
    return res.status(500).json({ message: "Could not update income." });
  }
};

export const deleteIncome = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied." });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    await InstituteIncome.findOneAndDelete({
      _id: req.params.id,
      institute: instituteId,
    });

    return res.json({ message: "Income deleted successfully." });
  } catch (error) {
    console.error("deleteIncome error:", error);
    return res.status(500).json({ message: "Could not delete income." });
  }
};

export const disburseStaffSalary = async (req, res) => {
  try {
    if (req.user.role === "teacher" || isReceptionist(req.user)) {
      return res.status(403).json({ message: "Access denied. Only institute admins can disburse salary." });
    }

    const { staffId, monthKey, amount, paymentMode, notes } = req.body;
    if (!staffId || !monthKey) {
      return res.status(400).json({ message: "staffId and monthKey are required." });
    }

    const cleanMonthKey = String(monthKey).trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanMonthKey)) {
      return res.status(400).json({ message: "Invalid monthKey. Expected YYYY-MM." });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    // Enforce tenant scoping: staff must belong to this institute
    const staff = await User.findOne({
      _id: staffId,
      institute: instituteId,
      role: { $in: ["teacher", "receptionist"] },
    });
    if (!staff) {
      return res.status(404).json({ message: "Staff member not found in your institute." });
    }

    const effectiveAmount = amount !== undefined ? Number(amount) : Number(staff.salary || 0);
    if (isNaN(effectiveAmount) || effectiveAmount < 0 || !isFinite(effectiveAmount)) {
      return res.status(400).json({ message: "Invalid salary amount. Must be a non-negative number." });
    }

    const record = await StaffSalary.findOneAndUpdate(
      {
        institute: instituteId,
        staff: staffId,
        monthKey: cleanMonthKey,
      },
      {
        institute: instituteId,
        staff: staffId,
        staffName: staff.name,
        monthKey: cleanMonthKey,
        amount: effectiveAmount,
        status: "disbursed",
        disbursedAt: new Date(),
        paymentMode: paymentMode || "Cash",
        notes: notes ? String(notes).trim() : "",
      },
      { upsert: true, new: true }
    );

    return res.json({
      message: "Salary marked as disbursed successfully.",
      record,
    });
  } catch (error) {
    console.error("disburseStaffSalary error:", error);
    return res.status(500).json({ message: "Could not record salary disbursement." });
  }
};

export const deleteStaffSalaryDisbursement = async (req, res) => {
  try {
    if (req.user.role === "teacher" || isReceptionist(req.user)) {
      return res.status(403).json({ message: "Access denied. Only institute admins can modify salary records." });
    }

    const { staffId, monthKey } = req.params;
    const cleanMonthKey = String(monthKey || "").trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(cleanMonthKey)) {
      return res.status(400).json({ message: "Invalid monthKey format. Expected YYYY-MM." });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;

    // Verify staff belongs to this institute
    const staff = await User.findOne({
      _id: staffId,
      institute: instituteId,
    });
    if (!staff) {
      return res.status(404).json({ message: "Staff member not found in your institute." });
    }

    await StaffSalary.findOneAndDelete({
      institute: instituteId,
      staff: staffId,
      monthKey: cleanMonthKey,
    });

    return res.json({ message: "Salary disbursement removed." });
  } catch (error) {
    console.error("deleteStaffSalaryDisbursement error:", error);
    return res.status(500).json({ message: "Could not delete salary disbursement." });
  }
};
