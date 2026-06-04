import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Institute from "../models/Institute.js";
import Note from "../models/Note.js";
import TestResult from "../models/TestResult.js";
import User from "../models/User.js";
import bcrypt from "bcryptjs";

export const getInitialPassword = (name, phone) => {
  const namePart = (name || "").replace(/\s+/g, "").substring(0, 4).toLowerCase();
  const cleanPhone = (phone || "").replace(/\D/g, "");
  const phonePart = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : "1234";
  return namePart + phonePart;
};
import {
  buildNoteDownloadFilename,
  streamRemoteFileAsAttachment,
} from "../utils/noteDownload.js";
import { supabase, supabaseBucket } from "../utils/supabase.js";

import { getLiveStateForStudent } from "../services/quizRuntime.js";

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
    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;
    const query = { user: ownerId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => b._id);
      query.batch = { $in: batchIds };
    }

    const students = await populateStudent(
      Student.find(query).sort({
        createdAt: -1,
      })
    );

    if (req.user.role === "teacher") {
      const stripped = students.map((s) => {
        const obj = s.toJSON();
        delete obj.totalFees;
        delete obj.feePlanType;
        delete obj.paymentHistory;
        delete obj.paidAmount;
        delete obj.pendingAmount;
        delete obj.dueDate;
        return obj;
      });
      return res.json(stripped);
    }

    return res.json(students);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch students" });
  }
};

export const getStudentById = async (req, res) => {
  try {
    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;
    const query = { _id: req.params.id, user: ownerId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => b._id);
      query.batch = { $in: batchIds };
    }

    const student = await populateStudent(
      Student.findOne(query)
    );

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    if (req.user.role === "teacher") {
      const obj = student.toJSON();
      delete obj.totalFees;
      delete obj.feePlanType;
      delete obj.paymentHistory;
      delete obj.paidAmount;
      delete obj.pendingAmount;
      delete obj.dueDate;
      return res.json(obj);
    }

    return res.json(student);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch student" });
  }
};

export const createStudent = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot enroll students." });
    }

    const {
      name,
      phone,
      parentName,
      parentPhone,
      email,
      address,
      batch,
      batches = [],
      joinedOn,
      totalFees,
      feePlanType,
      dueDate,
      paymentHistory = [],
      attendanceRecords = [],
    } = req.body;

    const targetBatches = Array.isArray(batches) && batches.length > 0 ? batches : (batch ? [batch] : []);

    if (
      !name ||
      !phone ||
      !parentName ||
      targetBatches.length === 0 ||
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

    // Verify all target batches exist
    const verifiedBatches = await Batch.find({ _id: { $in: targetBatches }, user: req.user._id });
    if (verifiedBatches.length !== targetBatches.length) {
      return res.status(400).json({ message: "One or more selected batches do not exist" });
    }

    // Find existing student by email/phone to reuse password and enrollmentNumber
    let enrollmentNumberToUse;
    let hashedPasswordToUse;

    const cleanEmail = email ? email.toLowerCase().trim() : "";
    const cleanPhone = phone ? phone.trim() : "";

    const existingStudent = await Student.findOne({
      $or: [
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
        ...(cleanPhone ? [{ phone: cleanPhone }] : []),
      ].filter(Boolean),
    }).select("enrollmentNumber password");

    if (existingStudent) {
      enrollmentNumberToUse = existingStudent.enrollmentNumber;
      hashedPasswordToUse = existingStudent.password;
    } else {
      enrollmentNumberToUse = await generateEnrollmentNumber(req.user._id);
      const initialPassword = getInitialPassword(name, phone);
      hashedPasswordToUse = await bcrypt.hash(initialPassword, 10);
    }

    const createdStudents = [];

    for (let i = 0; i < targetBatches.length; i++) {
      const currentBatchId = targetBatches[i];
      
      // Store full fees/payment on the first batch, 0 on the rest to maintain collective fee total
      const currentTotalFees = i === 0 ? total : 0;
      const currentPaymentHistory = i === 0 ? paymentHistory : [];

      const student = await Student.create({
        user: req.user._id,
        name,
        phone,
        parentName,
        parentPhone,
        email: email ? email.toLowerCase() : "",
        address,
        enrollmentNumber: enrollmentNumberToUse,
        batch: currentBatchId,
        joinedOn,
        totalFees: currentTotalFees,
        feePlanType,
        dueDate: i === 0 ? resolveDueDate({ feePlanType, joinedOn, dueDate }) : null,
        paymentHistory: currentPaymentHistory,
        attendanceRecords: i === 0 ? attendanceRecords : [],
        password: hashedPasswordToUse,
      });

      const populatedStudent = await populateStudent(Student.findById(student._id));
      createdStudents.push(populatedStudent);
    }

    // Return array if array requested, else single object for backward compatibility
    if (Array.isArray(req.body.batches) && req.body.batches.length > 0) {
      return res.status(201).json(createdStudents);
    } else {
      return res.status(201).json(createdStudents[0]);
    }
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
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot modify students." });
    }

    const {
      name,
      phone,
      parentName,
      parentPhone,
      email,
      address,
      batch,
      batches = [],
      joinedOn,
      totalFees,
      feePlanType,
      dueDate,
      paymentHistory = [],
      attendanceRecords = [],
    } = req.body;

    const targetBatches = Array.isArray(batches) && batches.length > 0 ? batches : (batch ? [batch] : []);

    if (
      !name ||
      !phone ||
      !parentName ||
      targetBatches.length === 0 ||
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

    // Verify all target batches exist
    const verifiedBatches = await Batch.find({ _id: { $in: targetBatches }, user: req.user._id });
    if (verifiedBatches.length !== targetBatches.length) {
      return res.status(400).json({ message: "One or more selected batches do not exist" });
    }

    const student = await Student.findOne({
      _id: req.params.id,
      user: req.user._id,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const originalEmail = student.email ? student.email.toLowerCase() : "";
    const newEmail = email ? email.toLowerCase() : "";

    // Find all student records for this student by original email
    const studentRecords = await Student.find({ email: originalEmail, user: req.user._id });

    const currentBatches = studentRecords.map((s) => String(s.batch));
    const targetBatchIds = targetBatches.map(String);

    const batchesToAdd = targetBatchIds.filter((b) => !currentBatches.includes(b));
    const batchesToRemove = currentBatches.filter((b) => !targetBatchIds.includes(b));

    // Remove unchecked batches
    if (batchesToRemove.length > 0) {
      await Student.deleteMany({
        email: originalEmail,
        user: req.user._id,
        batch: { $in: batchesToRemove },
      });
    }

    // Create newly checked batches
    const initialPassword = student.password;
    const enrollmentNumberToUse = student.enrollmentNumber;
    for (const newBatchId of batchesToAdd) {
      await Student.create({
        user: req.user._id,
        name,
        phone,
        parentName,
        parentPhone,
        email: newEmail,
        address,
        enrollmentNumber: enrollmentNumberToUse,
        batch: newBatchId,
        joinedOn,
        totalFees: 0,
        feePlanType,
        dueDate: null,
        paymentHistory: [],
        attendanceRecords: [],
        password: initialPassword,
      });
    }

    // Update remaining/existing records
    const remainingRecords = await Student.find({
      email: originalEmail,
      user: req.user._id,
      batch: { $in: targetBatchIds },
    });

    for (let i = 0; i < remainingRecords.length; i++) {
      const rec = remainingRecords[i];
      rec.name = name;
      rec.phone = phone;
      rec.parentName = parentName;
      rec.parentPhone = parentPhone || "";
      rec.email = newEmail;
      rec.address = address || "";
      rec.joinedOn = joinedOn;
      rec.feePlanType = feePlanType;

      if (i === 0) {
        rec.totalFees = total;
        rec.paymentHistory = paymentHistory;
        rec.dueDate = resolveDueDate({ feePlanType, joinedOn, dueDate });
      } else {
        rec.totalFees = 0;
        rec.paymentHistory = [];
        rec.dueDate = null;
      }
      await rec.save();
    }

    // Find and return a populated active student record for response compatibility
    const responseRecord = remainingRecords.find((r) => String(r._id) === String(student._id)) || remainingRecords[0];
    
    if (!responseRecord) {
      // Fallback if all were somehow deleted or not found
      return res.json({ message: "Student updated successfully" });
    }

    const populatedStudent = await populateStudent(Student.findById(responseRecord._id));

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
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot delete students." });
    }

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
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot record payments." });
    }

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
    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;
    const query = { _id: req.params.id, user: ownerId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => b._id);
      query.batch = { $in: batchIds };
    }

    const student = await Student.findOne(query);

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

export const getStudentPortalData = async (req, res) => {
  try {
    const students = req.students; // all student records from protectStudent middleware
    const classes = [];

    // Group all student records by institute owner user ID (student.user) to compute collective fees
    const instituteFeesMap = {};

    for (const s of students) {
      const instUser = String(s.user);
      if (!instituteFeesMap[instUser]) {
        instituteFeesMap[instUser] = {
          totalFees: 0,
          paymentHistory: [],
          dueDates: [],
        };
      }
      instituteFeesMap[instUser].totalFees += Number(s.totalFees || 0);
      if (s.paymentHistory && s.paymentHistory.length > 0) {
        instituteFeesMap[instUser].paymentHistory.push(...s.paymentHistory);
      }
      if (s.dueDate) {
        instituteFeesMap[instUser].dueDates.push(s.dueDate);
      }
    }

    // Process collective fees for each institute
    for (const instUser of Object.keys(instituteFeesMap)) {
      const feeInfo = instituteFeesMap[instUser];
      // Sort payment history by date descending
      feeInfo.paymentHistory.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
      
      const paidAmount = feeInfo.paymentHistory.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      feeInfo.paidAmount = paidAmount;
      feeInfo.pendingAmount = Math.max(0, feeInfo.totalFees - paidAmount);
      
      const dates = feeInfo.dueDates.map((d) => new Date(d)).filter((d) => !isNaN(d.getTime()));
      feeInfo.dueDate = dates.length > 0 ? new Date(Math.min(...dates)) : null;
    }

    for (const student of students) {
      const academyAdmin = await User.findById(student.user).select("name email");
      if (!academyAdmin) continue;

      const institute = await Institute.findOne({ adminUser: student.user }).select(
        "_id name status subscriptionEnd"
      );
      if (!institute) continue;

      const isExpired =
        institute.status !== "active" ||
        new Date(institute.subscriptionEnd).getTime() < Date.now();

      if (isExpired) {
        continue; // skip expired institutes
      }

      const instituteId = institute._id;
      const batch = student.batch;
      let teacherName = academyAdmin.name;

      if (batch && batch.teacher) {
        if (batch.teacher.name) {
          teacherName = batch.teacher.name;
        } else {
          const teacherUser = await User.findById(batch.teacher).select("name");
          if (teacherUser) {
            teacherName = teacherUser.name;
          }
        }
      }

      const [notes, testResults, liveQuiz] = await Promise.all([
        Note.find({
          institute: instituteId,
          $or: [{ batch: batch?._id || batch }, { batch: null }],
        })
          .sort({ createdAt: -1 })
          .populate("batch", "name"),
        TestResult.find({ institute: instituteId, student: student._id }).sort({
          createdAt: -1,
        }),
        Promise.resolve(getLiveStateForStudent(student)),
      ]);

      const instUserKey = String(student.user);
      const collectiveFees = instituteFeesMap[instUserKey] || {
        totalFees: student.totalFees,
        paymentHistory: student.paymentHistory || [],
        paidAmount: student.paidAmount,
        pendingAmount: student.pendingAmount,
        dueDate: student.dueDate,
      };

      classes.push({
        studentId: student._id,
        student: {
          id: student._id,
          name: student.name,
          email: student.email,
          phone: student.phone,
          enrollmentNumber: student.enrollmentNumber,
          batch: student.batch,
          paidAmount: collectiveFees.paidAmount,
          pendingAmount: collectiveFees.pendingAmount,
          totalFees: collectiveFees.totalFees,
          feePlanType: student.feePlanType,
          paymentHistory: collectiveFees.paymentHistory,
          dueDate: collectiveFees.dueDate,
        },
        teacherName,
        instituteName: institute.name,
        batchName: batch ? batch.name : "Unassigned",
        timetable: batch
          ? {
              batchName: batch.name,
              scheduleDays: batch.scheduleDays || [],
              startTime: batch.startTime,
              endTime: batch.endTime,
            }
          : null,
        feesHistory: collectiveFees.paymentHistory,
        attendance: student.attendanceRecords || [],
        notes,
        testResults,
        liveQuiz,
      });
    }

    return res.json({
      classes,
    });
  } catch (error) {
    console.error("getStudentPortalData error:", error);
    return res.status(500).json({ message: "Could not load student dashboard" });
  }
};

export const downloadStudentNote = async (req, res) => {
  try {
    const student = req.student;
    const institute = await Institute.findOne({ adminUser: student.user }).select("_id");

    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    const studentBatchId = student.batch?._id || student.batch || null;
    const note = await Note.findOne({
      _id: req.params.id,
      institute: institute._id,
      $or: [{ batch: studentBatchId }, { batch: null }],
    });

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    if (note.pdfUrl && note.pdfUrl.startsWith("http")) {
      // Fallback for legacy Cloudinary files
      await streamRemoteFileAsAttachment({
        res,
        url: note.pdfUrl,
        filename: buildNoteDownloadFilename(note),
      });
    } else {
      // Fetch from Supabase
      const { data, error } = await supabase.storage
        .from(supabaseBucket)
        .download(note.pdfPublicId || note.pdfUrl);

      if (error || !data) {
        return res.status(404).json({ message: "Note file not found in storage" });
      }

      const arrayBuffer = await data.arrayBuffer();
      res.setHeader("Content-Type", "application/pdf");
      res.send(Buffer.from(arrayBuffer));
    }
  } catch (error) {
    if (res.headersSent) {
      return;
    }
    return res.status(500).json({ message: "Could not download note" });
  }
};

