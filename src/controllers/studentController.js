import Student from "../models/Student.js";
import Batch from "../models/Batch.js";

const allowedFeeTypes = ["monthly", "full_course", "partial"];

const getPaidAmount = (paymentHistory = []) =>
  paymentHistory.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

const validatePayments = (totalFees, paymentHistory) => {
  const paidAmount = getPaidAmount(paymentHistory);

  if (paidAmount > totalFees) {
    return "Paid amount cannot be more than total fees";
  }

  const invalidPayment = paymentHistory.find(
    (payment) =>
      !payment.paymentDate ||
      !allowedFeeTypes.includes(payment.paymentType) ||
      Number(payment.amount) < 0
  );

  if (invalidPayment) {
    return "Each payment must have amount, payment date, and a valid payment type";
  }

  return null;
};

const validateAttendance = (attendanceRecords = []) => {
  const invalidAttendance = attendanceRecords.find(
    (record) =>
      !record.date || !["present", "absent"].includes(record.status)
  );

  if (invalidAttendance) {
    return "Attendance records must include date and valid status";
  }

  return null;
};

const populateStudent = (query) =>
  query.populate("batch", "name scheduleDays startTime endTime");

const addOneMonth = (dateValue) => {
  const date = new Date(dateValue);
  date.setMonth(date.getMonth() + 1);
  return date;
};

const resolveDueDate = ({ feePlanType, joinedOn, dueDate }) => {
  if (feePlanType === "monthly") {
    return addOneMonth(joinedOn);
  }

  if (feePlanType === "full_course") {
    return null;
  }

  return dueDate ? new Date(dueDate) : null;
};

const generateEnrollmentNumber = async (userId) => {
  const latestStudent = await Student.findOne({})
    .sort({ createdAt: -1 })
    .select("enrollmentNumber");

  const maxNumber = Number(
    String(latestStudent?.enrollmentNumber || "")
      .replace(/\D/g, "")
      .trim()
  );

  const nextNumber = Number.isFinite(maxNumber) && maxNumber > 0 ? maxNumber + 1 : 1;

  return `ENR${String(nextNumber).padStart(4, "0")}`;
};

export const getStudents = async (req, res) => {
  try {
    const students = await populateStudent(
      Student.find({ user: req.user._id }).sort({
        createdAt: -1,
      })
    );
    return res.json(students);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch students" });
  }
};

export const getStudentById = async (req, res) => {
  try {
    const student = await populateStudent(
      Student.findOne({ _id: req.params.id, user: req.user._id })
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    return res.json(student);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch student" });
  }
};

export const createStudent = async (req, res) => {
  try {
    const {
      name,
      phone,
      parentName,
      parentPhone,
      email,
      address,
      batch,
      joinedOn,
      totalFees,
      feePlanType,
      dueDate,
      paymentHistory = [],
      attendanceRecords = [],
    } = req.body;

    if (
      !name ||
      !phone ||
      !parentName ||
      !batch ||
      !joinedOn ||
      totalFees === undefined ||
      !feePlanType
    ) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const total = Number(totalFees);
    const amountError = validatePayments(total, paymentHistory);
    const attendanceError = validateAttendance(attendanceRecords);

    if (amountError) {
      return res.status(400).json({ message: amountError });
    }

    if (attendanceError) {
      return res.status(400).json({ message: attendanceError });
    }

    if (!allowedFeeTypes.includes(feePlanType)) {
      return res.status(400).json({ message: "Invalid fee plan type" });
    }

    if (feePlanType === "partial" && !dueDate) {
      return res.status(400).json({ message: "Due date is required for partial fee plan" });
    }

    const batchExists = await Batch.findOne({ _id: batch, user: req.user._id });

    if (!batchExists) {
      return res.status(400).json({ message: "Selected batch does not exist" });
    }

    const student = await Student.create({
      user: req.user._id,
      name,
      phone,
      parentName,
      parentPhone,
      email,
      address,
      enrollmentNumber: await generateEnrollmentNumber(req.user._id),
      batch,
      joinedOn,
      totalFees: total,
      feePlanType,
      dueDate: resolveDueDate({ feePlanType, joinedOn, dueDate }),
      paymentHistory,
      attendanceRecords,
    });

    const populatedStudent = await populateStudent(Student.findById(student._id));

    return res.status(201).json(populatedStudent);
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.enrollmentNumber) {
      return res.status(409).json({
        message:
          "Enrollment number already exists. Please try again once to generate the next sequence.",
      });
    }

    return res.status(500).json({ message: "Could not create student" });
  }
};

export const updateStudent = async (req, res) => {
  try {
    const {
      name,
      phone,
      parentName,
      parentPhone,
      email,
      address,
      batch,
      joinedOn,
      totalFees,
      feePlanType,
      dueDate,
      paymentHistory = [],
      attendanceRecords = [],
    } = req.body;
    const total = Number(totalFees);
    const amountError = validatePayments(total, paymentHistory);
    const attendanceError = validateAttendance(attendanceRecords);

    if (amountError) {
      return res.status(400).json({ message: amountError });
    }

    if (attendanceError) {
      return res.status(400).json({ message: attendanceError });
    }

    if (!allowedFeeTypes.includes(feePlanType)) {
      return res.status(400).json({ message: "Invalid fee plan type" });
    }

    if (feePlanType === "partial" && !dueDate) {
      return res.status(400).json({ message: "Due date is required for partial fee plan" });
    }

    const batchExists = await Batch.findOne({ _id: batch, user: req.user._id });

    if (!batchExists) {
      return res.status(400).json({ message: "Selected batch does not exist" });
    }

    const student = await Student.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    student.name = name;
    student.phone = phone;
    student.parentName = parentName;
    student.parentPhone = parentPhone || "";
    student.email = email || "";
    student.address = address || "";
    student.enrollmentNumber = student.enrollmentNumber || (await generateEnrollmentNumber(req.user._id));
    student.batch = batch;
    student.joinedOn = joinedOn;
    student.totalFees = total;
    student.feePlanType = feePlanType;
    student.dueDate = resolveDueDate({ feePlanType, joinedOn, dueDate });
    student.paymentHistory = paymentHistory;
    student.attendanceRecords = attendanceRecords;

    await student.save();

    const populatedStudent = await populateStudent(Student.findById(student._id));

    return res.json(populatedStudent);
  } catch (error) {
    if (error?.code === 11000 && error?.keyPattern?.enrollmentNumber) {
      return res.status(409).json({
        message:
          "Enrollment number already exists. Please try again once to generate the next sequence.",
      });
    }

    return res.status(500).json({ message: "Could not update student" });
  }
};

export const deleteStudent = async (req, res) => {
  try {
    const student = await Student.findOneAndDelete({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    return res.json({ message: "Student deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete student" });
  }
};

export const addPayment = async (req, res) => {
  try {
    const { amount, paymentDate, paymentType, note } = req.body;
    const student = await Student.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    if (
      amount === undefined ||
      !paymentDate ||
      !allowedFeeTypes.includes(paymentType)
    ) {
      return res.status(400).json({ message: "Payment details are required" });
    }

    const nextPaidAmount = student.paidAmount + Number(amount);

    if (nextPaidAmount > student.totalFees) {
      return res.status(400).json({ message: "Paid amount cannot be more than total fees" });
    }

    student.paymentHistory.unshift({
      amount: Number(amount),
      paymentDate,
      paymentType,
      note: note || "",
    });

    await student.save();

    const populatedStudent = await populateStudent(Student.findById(student._id));

    return res.json(populatedStudent);
  } catch (error) {
    return res.status(500).json({ message: "Could not add payment" });
  }
};

export const markAttendance = async (req, res) => {
  try {
    const { date, status } = req.body;
    const student = await Student.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    if (!date || !["present", "absent"].includes(status)) {
      return res.status(400).json({ message: "Date and valid attendance status are required" });
    }

    const targetDay = new Date(date).toDateString();
    const existingRecord = student.attendanceRecords.find(
      (record) => new Date(record.date).toDateString() === targetDay
    );

    if (existingRecord) {
      existingRecord.status = status;
    } else {
      student.attendanceRecords.unshift({ date, status });
    }

    await student.save();

    const populatedStudent = await populateStudent(Student.findById(student._id));

    return res.json(populatedStudent);
  } catch (error) {
    return res.status(500).json({ message: "Could not update attendance" });
  }
};
