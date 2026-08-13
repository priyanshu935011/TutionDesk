import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Institute from "../models/Institute.js";
import Note from "../models/Note.js";
import TestResult from "../models/TestResult.js";
import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import SystemSetting from "../models/SystemSetting.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getCache, setCache, deleteCache, clearCachePattern } from "../utils/cache.js";
import { sendMessage, sendDocument, sendTemplateMessage } from "../services/whatsappService.js";
import { getCredentialsTemplate, formatCredentialsMessage, getGlobalTemplates, formatAbsentMessage } from "../utils/whatsappTemplateHelper.js";
import cloudinary from "../utils/cloudinary.js";

export const getInitialPassword = (name, phone) => {
  return "123456";
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

const resolveDueDate = ({ feePlanType, joinedOn, dueDate, feeStatus = "paid" }) => {
  if (feePlanType === "monthly") {
    if (feeStatus === "unpaid") {
      return new Date(joinedOn);
    }
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
    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const cacheKey = `teacher:students:${ownerId}:${req.user.role}`;
    if (req.query.refresh !== "true") {
      const cached = await getCache(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    const query = { user: ownerId };

    // Fetch all batches for this institute and filter by status in-memory
    // NOTE: 'status' is stored in local batches_metadata.json (not in DB), so DB-level
    // filtering on 'status' silently strips the filter and returns ALL batches. We must
    // fetch all and then filter after the status field is hydrated from metadata.
    const allBatches = await Batch.find({ user: ownerId }).select("_id status teacher");
    const archivedBatchIds = allBatches.filter((b) => b.status === "archived").map((b) => b._id);

    if (req.user.role === "teacher") {
      const batchIds = allBatches
        .filter((b) => b.status !== "archived" && String(b.teacher) === String(req.user._id))
        .map((b) => b._id);
      query.batch = { $in: batchIds };
    } else {
      if (archivedBatchIds.length > 0) {
        query.batch = { $nin: archivedBatchIds };
      }
    }

    const students = await populateStudent(
      Student.find(query).sort({
        createdAt: -1,
      })
    );

    let result = students;
    if (req.user.role === "teacher") {
      result = students.map((s) => {
        const obj = s.toJSON();
        delete obj.totalFees;
        delete obj.feePlanType;
        delete obj.paymentHistory;
        delete obj.paidAmount;
        delete obj.pendingAmount;
        delete obj.dueDate;
        return obj;
      });
    }

    await setCache(cacheKey, result, 86400);
    return res.json(result);
  } catch (error) {
    console.error("getStudents catch block error:", error);
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

    try {
      await student._model.populateStudentRecords([student], { includeAttendance: true });
    } catch (e) {}

    const allRecords = await Student.find({
      enrollmentNumber: student.enrollmentNumber,
      user: ownerId,
    }).select("batch");
    const enrolledBatchIds = allRecords.map((r) => r.batch);

    const obj = student.toJSON();
    obj.enrolledBatchIds = enrolledBatchIds;

    if (req.user.role === "teacher") {
      delete obj.totalFees;
      delete obj.feePlanType;
      delete obj.paymentHistory;
      delete obj.paidAmount;
      delete obj.pendingAmount;
      delete obj.dueDate;
      return res.json(obj);
    }

    return res.json(obj);
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
      paymentHistory: initialPaymentHistory = [],
      attendanceRecords = [],
      feeStatus = "paid",
    } = req.body;

    const paymentHistory = feeStatus === "unpaid" ? [] : initialPaymentHistory;

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

    const ownerId = req.user.role === "teacher"
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    if (feePlanType === "partial" && !dueDate) {
      return res.status(400).json({ message: "Due date is required for partial fee plan" });
    }

    // Verify all target batches exist
    const verifiedBatches = await Batch.find({ _id: { $in: targetBatches } });
    if (verifiedBatches.length !== targetBatches.length) {
      return res.status(400).json({ message: "One or more selected batches do not exist" });
    }

    const cleanEmail = email ? email.toLowerCase().trim() : "";
    const cleanPhone = phone ? phone.trim() : "";
    const cleanName = name.trim().toLowerCase();

    // Check if this exact student is already enrolled in any of the target batches
    for (const currentBatchId of targetBatches) {
      const alreadyEnrolled = await Student.findOne({
        user: ownerId,
        name: { $regex: new RegExp(`^${cleanName}$`, "i") },
        batch: currentBatchId,
        $or: [
          ...(cleanEmail ? [{ email: cleanEmail }] : []),
          ...(cleanPhone ? [{ phone: cleanPhone }] : []),
        ].filter(Boolean),
      });

      if (alreadyEnrolled) {
        const batchObj = verifiedBatches.find(b => String(b._id) === String(currentBatchId));
        return res.status(400).json({
          message: `Student "${name}" is already enrolled in batch "${batchObj ? batchObj.name : "selected batch"}"`
        });
      }
    }

    const inst = await Institute.findById(ownerId);
    const portalEnabled = inst?.studentPortalEnabled !== false;

    // Find existing student by email/phone to reuse password and enrollmentNumber
    let enrollmentNumberToUse;
    let hashedPasswordToUse;

    const existingStudent = await Student.findOne({
      user: ownerId,
      name: { $regex: new RegExp(`^${cleanName}$`, "i") },
      $or: [
        ...(cleanEmail ? [{ email: cleanEmail }] : []),
        ...(cleanPhone ? [{ phone: cleanPhone }] : []),
      ].filter(Boolean),
    }).select("enrollmentNumber password");

    if (existingStudent) {
      enrollmentNumberToUse = existingStudent.enrollmentNumber;
      hashedPasswordToUse = portalEnabled ? existingStudent.password : "";
    } else {
      enrollmentNumberToUse = await generateEnrollmentNumber(ownerId);
      if (portalEnabled) {
        const initialPassword = getInitialPassword(name, phone);
        hashedPasswordToUse = await bcrypt.hash(initialPassword, 10);
      } else {
        hashedPasswordToUse = "";
      }
    }

    const customFields = req.body.customFields || {};
    const customFieldConfigs = inst?.studentCustomFields || [];
    for (const field of customFieldConfigs) {
      if (req.body[field.name] !== undefined) {
        customFields[field.name] = req.body[field.name];
      }
    }

    const createdStudents = [];

    for (let i = 0; i < targetBatches.length; i++) {
      const currentBatchId = targetBatches[i];
      
      // Store full fees/payment on the first batch, 0 on the rest to maintain collective fee total
      const currentTotalFees = i === 0 ? total : 0;
      const currentPaymentHistory = i === 0 ? paymentHistory.map(p => ({
        _id: p._id || crypto.randomUUID(),
        amount: Number(p.amount),
        paymentDate: p.paymentDate,
        paymentType: p.paymentType,
        note: p.note || ""
      })) : [];

      const student = await Student.create({
        user: ownerId,
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
        dueDate: i === 0 ? resolveDueDate({ feePlanType, joinedOn, dueDate, feeStatus }) : null,
        paymentHistory: currentPaymentHistory,
        attendanceRecords: i === 0 ? attendanceRecords : [],
        password: hashedPasswordToUse,
        customFields: i === 0 ? customFields : {},
      });

      const populatedStudent = await populateStudent(Student.findById(student._id));
      createdStudents.push(populatedStudent);
    }
    
    try {
      if (enrollmentNumberToUse) {
        await deleteCache(`student:dashboard:${enrollmentNumberToUse}`);
      }
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");
    } catch (cacheErr) {
      console.warn("Cache eviction warning during student enrollment:", cacheErr);
    }

    // Send WhatsApp notifications (credentials & fee reminders) if globally enabled
    const plainPassword = req.body.password || getInitialPassword(name, phone);
    setImmediate(async () => {
      try {
        const instituteId = req.user.institute?._id || req.user.institute;
        const inst = await Institute.findById(instituteId);
        if (!inst) return;

        const recipientPhone = parentPhone?.trim() || phone?.trim();
        if (!recipientPhone) return;

        const instituteName = inst.name || "Classtech";

        // 1. Send Login Credentials if enabled
        const sendCredentialsEnabled = inst.whatsappSettings?.sendCredentialsEnabled ?? false;
        if (portalEnabled && sendCredentialsEnabled) {
          const loginUrl = `${process.env.FRONTEND_URL || "https://classtech.vercel.app"}/student/login`;
          await sendTemplateMessage(String(instituteId), recipientPhone, "student_credentials", [
            instituteName,
            name,
            enrollmentNumberToUse,
            plainPassword,
            loginUrl
          ]);
          console.log(`WhatsApp login credentials template sent successfully to ${name} (${recipientPhone})`);
        }

        // 2. Send Fee Reminder if enabled and due date matches criteria
        const feeRemindersEnabled = inst.whatsappSettings?.feeRemindersEnabled ?? false;
        const feesToUse = Number(totalFees || 0);
        
        if (feeRemindersEnabled && feesToUse > 0 && dueDate) {
          const daysBefore = inst.whatsappSettings?.feeReminderDaysBefore ?? 3;
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          const due = new Date(dueDate);
          due.setHours(0, 0, 0, 0);
          const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          
          if (diffDays <= daysBefore) {
            const formattedDueDate = new Date(dueDate).toLocaleDateString("en-IN");
            await sendTemplateMessage(String(instituteId), recipientPhone, "fee_reminder", [
              parentName || "Parent",
              String(feesToUse),
              name,
              instituteName,
              formattedDueDate
            ]);
            console.log(`WhatsApp fee reminder template sent successfully to ${name} (${recipientPhone})`);
          }
        }
      } catch (wErr) {
        console.error(`Failed to send WhatsApp notifications for ${name}:`, wErr.message);
      }
    });

    // Return array if array requested, else single object for backward compatibility
    if (Array.isArray(req.body.batches) && req.body.batches.length > 0) {
      return res.status(201).json(createdStudents);
    } else {
      return res.status(201).json(createdStudents[0]);
    }
  } catch (error) {
    console.error("Create student error details:", error);
    if (error?.code === 11000 && error?.keyPattern?.enrollmentNumber) {
      return res.status(409).json({
        message:
          "Enrollment number already exists. Please try again once to generate the next sequence.",
      });
    }

    return res.status(500).json({ message: error?.message || "Could not create student" });
  }
};

export const updateStudent = async (req, res) => {
  try {
    const ownerId = req.user.role === "teacher" ? req.user.institute?.adminUser : req.user._id;

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
      customFields,
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

    // Verify all target batches exist and belong to ownerId
    const verifiedQuery = { _id: { $in: targetBatches }, user: ownerId };
    if (req.user.role === "teacher") {
      verifiedQuery.teacher = req.user._id;
    }
    const verifiedBatches = await Batch.find(verifiedQuery);
    if (verifiedBatches.length !== targetBatches.length) {
      return res.status(400).json({ message: "One or more selected batches do not exist or you do not have permission to assign to them" });
    }

    const student = await Student.findOne({
      _id: req.params.id,
      user: ownerId,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // If teacher, verify they own at least one of the student's current batches
    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const myBatchIds = myBatches.map(b => String(b._id));
      if (!myBatchIds.includes(String(student.batch))) {
        return res.status(403).json({ message: "Access denied. You can only modify students in your assigned batches." });
      }
    }

    const originalEmail = student.email ? student.email.toLowerCase() : "";
    const newEmail = email ? email.toLowerCase() : "";

    // Find all student records for this student by enrollment number
    const studentRecords = await Student.find({ enrollmentNumber: student.enrollmentNumber, user: ownerId });

    const currentBatches = studentRecords.map((s) => String(s.batch));
    const targetBatchIds = targetBatches.map(String);

    const batchesToAdd = targetBatchIds.filter((b) => !currentBatches.includes(b));
    const batchesToRemove = currentBatches.filter((b) => !targetBatchIds.includes(b));

    // Remove unchecked batches
    if (batchesToRemove.length > 0) {
      await Student.deleteMany({
        enrollmentNumber: student.enrollmentNumber,
        user: ownerId,
        batch: { $in: batchesToRemove },
      });
    }

    // Create newly checked batches
    const initialPassword = student.password;
    const enrollmentNumberToUse = student.enrollmentNumber;
    for (const newBatchId of batchesToAdd) {
      await Student.create({
        user: ownerId,
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
        customFields: {},
      });
    }

    // Update remaining/existing records
    const remainingRecords = await Student.find({
      enrollmentNumber: student.enrollmentNumber,
      user: ownerId,
      batch: { $in: targetBatchIds },
    });

    const inst = await Institute.findById(ownerId);
    const customFieldsObj = customFields || {};
    const customFieldConfigs = inst?.studentCustomFields || [];
    for (const field of customFieldConfigs) {
      if (req.body[field.name] !== undefined) {
        customFieldsObj[field.name] = req.body[field.name];
      }
    }

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
        rec.paymentHistory = paymentHistory.map(p => ({
          _id: p._id || crypto.randomUUID(),
          amount: Number(p.amount),
          paymentDate: p.paymentDate,
          paymentType: p.paymentType,
          note: p.note || ""
        }));
        rec.dueDate = resolveDueDate({ feePlanType, joinedOn, dueDate });
        rec.customFields = customFieldsObj;
      } else {
        rec.totalFees = 0;
        rec.paymentHistory = [];
        rec.dueDate = null;
        rec.customFields = {};
      }
      await rec.save();
    }

    if (student.enrollmentNumber) {
      await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
    }
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("teacher:students:*");

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

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const student = await Student.findOneAndDelete({
      _id: req.params.id,
      user: ownerId,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    try {
      await supabase.from("attendance").delete().eq("student_id", student._id);
      await supabase.from("payments").delete().eq("student_id", student._id);
    } catch (e) {}

    try {
      if (student.enrollmentNumber) {
        await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
      }
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");
    } catch (cErr) {}

    return res.json({ message: "Student deleted successfully" });
  } catch (error) {
    console.error("deleteStudent error:", error);
    return res.status(500).json({ message: "Could not delete student" });
  }
};

export const addPayment = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot record payments." });
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const { amount, paymentDate, paymentType, note } = req.body;
    const student = await Student.findOne({
      _id: req.params.id,
      user: ownerId,
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

    const paymentId = crypto.randomUUID();
    student.paymentHistory.unshift({
      _id: paymentId,
      amount: Number(amount),
      paymentDate,
      paymentType,
      note: note || "",
    });

    if (student.feePlanType === "monthly") {
      const instId = req.user.institute?._id || req.user.institute || student.user;
      const institute = await Institute.findById(instId).select("flexibleDueDate");
      const isFlexible = institute?.flexibleDueDate === true;

      if (isFlexible) {
        student.dueDate = addOneMonth(paymentDate);
      } else {
        student.dueDate = addOneMonth(student.dueDate || paymentDate);
      }
    }

    // Direct insert into Supabase payments table
    try {
      await supabase.from("payments").insert({
        id: paymentId,
        student_id: student._id,
        amount: Number(amount),
        payment_date: paymentDate,
        payment_type: paymentType,
        note: note || ""
      });
    } catch (payErr) {}

    await student.save();

    const populatedStudent = await populateStudent(Student.findById(student._id));

    try {
      if (student.enrollmentNumber) {
        await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
      }
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");
    } catch (cErr) {}

    return res.json(populatedStudent);
  } catch (error) {
    console.error("addPayment error:", error);
    return res.status(500).json({ message: "Could not add payment" });
  }
};

export const markAttendance = async (req, res) => {
  try {
    const { date, status } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute;
    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);
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

    try {
      if (student.enrollmentNumber) {
        await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
      }
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");
    } catch (cErr) {}

    let whatsappStatus = { sent: false, reason: "Attendance status is not absent." };

    if (status === "absent") {
      try {
        let settings = await getCache(`institute:whatsapp_settings:${instituteId}`);
        if (!settings || Object.keys(settings).length === 0 || settings.absentAlertsEnabled === undefined) {
          const inst = await Institute.findById(instituteId);
          settings = inst?.whatsappSettings || {};
        }
        if (settings && settings.absentAlertsEnabled) {
          const formattedDate = new Date(date).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const globalTemplates = await getGlobalTemplates();
          const inst = await Institute.findById(instituteId);
          const messageText = formatAbsentMessage({
            template: globalTemplates.absent,
            studentName: student.name,
            date: formattedDate,
            instituteName: inst?.name || "Classtech",
          });
          const recipientPhone = student.parentPhone?.trim() || student.phone?.trim();
          if (recipientPhone) {
            const result = await sendMessage(String(instituteId), recipientPhone, messageText, "absent_alert", {
              templateName: "absent_alert",
              parameters: [
                student.name,
                formattedDate,
                inst?.name || "Classtech"
              ]
            });
            if (result && result.success) {
              whatsappStatus = { sent: true, reason: "WhatsApp message sent successfully." };
            } else {
              whatsappStatus = { sent: false, reason: result?.message || "Failed to send message via WhatsApp gateway." };
            }
          } else {
            whatsappStatus = { sent: false, reason: "Student does not have parent phone or phone number." };
          }
        } else {
          whatsappStatus = { sent: false, reason: "WhatsApp absent alerts are disabled in settings." };
        }
      } catch (err) {
        console.error("Failed to send WhatsApp absent alert:", err.message);
        whatsappStatus = { sent: false, reason: `Error occurred: ${err.message}` };
      }
    }

    const resObj = {
      ...(typeof populatedStudent.toObject === "function" ? populatedStudent.toObject() : populatedStudent),
      whatsappStatus
    };
    res.json(resObj);
  } catch (error) {
    return res.status(500).json({ message: "Could not update attendance" });
  }
};

export const markBatchAttendance = async (req, res) => {
  try {
    const { batchId, date, records } = req.body;
    if (!batchId || !date || !Array.isArray(records) || records.length === 0) {
      return res.status(400).json({ message: "Batch ID, date, and student attendance records are required." });
    }

    const instituteId = req.user.institute?._id || req.user.institute;
    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const batch = await Batch.findById(batchId);
    if (!batch) {
      return res.status(404).json({ message: "Batch not found." });
    }

    const batchStudents = await Student.find({ user: ownerId, batch: batchId });
    if (batchStudents.length === 0) {
      return res.status(400).json({ message: "No students found in this batch." });
    }

    const targetDate = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (targetDate.getTime() > today.getTime()) {
      return res.status(400).json({ message: "Future attendance marking is not allowed." });
    }

    const targetDateStr = targetDate.toISOString().split("T")[0];

    let isUpdate = false;
    const absentStudents = [];
    const studentMap = new Map(batchStudents.map(s => [String(s._id), s]));

    for (const item of records) {
      const student = studentMap.get(String(item.studentId));
      if (!student) continue;

      const newStatus = item.status === "present" ? "present" : "absent";

      const existingRecord = (student.attendanceRecords || []).find((r) => {
        if (!r.date) return false;
        const rStr = typeof r.date === "string" ? r.date.substring(0, 10) : new Date(r.date).toISOString().substring(0, 10);
        return rStr === targetDateStr;
      });

      const wasAlreadyAbsent = existingRecord && existingRecord.status === "absent";
      if (newStatus === "absent" && !wasAlreadyAbsent) {
        absentStudents.push(student);
      }

      if (existingRecord) {
        isUpdate = true;
        existingRecord.status = newStatus;
      } else {
        if (!student.attendanceRecords) student.attendanceRecords = [];
        student.attendanceRecords.unshift({ date: targetDateStr, status: newStatus });
      }

      // Also sync to Supabase attendance table directly
      try {
        const { data: existingDbRec } = await supabase
          .from("attendance")
          .select("id")
          .eq("student_id", student._id)
          .eq("date", targetDateStr)
          .maybeSingle();

        if (existingDbRec && existingDbRec.id) {
          isUpdate = true;
          await supabase
            .from("attendance")
            .update({ status: newStatus })
            .eq("id", existingDbRec.id);
        } else {
          await supabase
            .from("attendance")
            .insert({ student_id: student._id, date: targetDateStr, status: newStatus });
        }
      } catch (dbErr) {
        console.error("Direct attendance table sync error:", dbErr.message);
      }

      try {
        await student.save();
      } catch (sErr) {}
    }

    // Clear dashboard & student cache
    try {
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");
      for (const s of batchStudents) {
        if (s.enrollmentNumber) {
          await deleteCache(`student:dashboard:${s.enrollmentNumber}`);
        }
      }
    } catch (cErr) {}

    const updatedStudents = await populateStudent(Student.find({ user: ownerId, batch: batchId }));

    const message = isUpdate ? "Attendance updated successfully" : "Attendance marked successfully";

    let whatsappStatus = [];
    try {
      let settings = await getCache(`institute:whatsapp_settings:${instituteId}`);
      if (!settings || Object.keys(settings).length === 0 || settings.absentAlertsEnabled === undefined) {
        const inst = await Institute.findById(instituteId);
        settings = inst?.whatsappSettings || {};
      }

      if (settings && settings.absentAlertsEnabled && absentStudents.length > 0) {
        const formattedDate = targetDate.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const globalTemplates = await getGlobalTemplates();
        const inst = await Institute.findById(instituteId);

        for (const student of absentStudents) {
          const recipientPhone = student.parentPhone?.trim() || student.phone?.trim();
          if (!recipientPhone) {
            whatsappStatus.push({
              studentName: student.name,
              sent: false,
              reason: "Student does not have parent phone or phone number."
            });
            continue;
          }

          const messageText = formatAbsentMessage({
            template: globalTemplates.absent,
            studentName: student.name,
            date: formattedDate,
            instituteName: inst?.name || "Classtech",
          });

          try {
            console.log(`Sending WhatsApp absent alert to ${student.name} at ${recipientPhone}...`);
            const result = await sendMessage(String(instituteId), recipientPhone, messageText, "absent_alert", {
              templateName: "absent_alert",
              parameters: [
                student.name,
                formattedDate,
                inst?.name || "Classtech"
              ]
            });
            if (result && result.success) {
              console.log(`WhatsApp absent alert sent successfully for ${student.name}`);
              whatsappStatus.push({
                studentName: student.name,
                sent: true,
                reason: "Message sent successfully."
              });
            } else {
              whatsappStatus.push({
                studentName: student.name,
                sent: false,
                reason: result?.message || "Failed to send message via WhatsApp gateway."
              });
            }
            await new Promise((r) => setTimeout(r, 200));
          } catch (wErr) {
            console.error(`Failed sending WhatsApp to ${student.name}:`, wErr.message);
            whatsappStatus.push({
              studentName: student.name,
              sent: false,
              reason: `Error: ${wErr.message}`
            });
          }
        }
      } else if (absentStudents.length > 0) {
        whatsappStatus.push({
          sent: false,
          reason: "WhatsApp absent alerts are disabled in settings."
        });
      }
    } catch (bgErr) {
      console.error("WhatsApp batch dispatch error:", bgErr.message);
    }

    res.json({
      success: true,
      message,
      isUpdate,
      students: updatedStudents,
      whatsappStatus
    });

  } catch (error) {
    console.error("markBatchAttendance error:", error);
    return res.status(500).json({ message: "Could not submit attendance." });
  }
};

export const getStudentPortalData = async (req, res) => {
  try {
    const studentEnrollment = req.student?.enrollmentNumber || req.students[0]?.enrollmentNumber || req.studentEmail;
    const cacheKey = `student:dashboard:${studentEnrollment}`;
    
    const cachedData = await getCache(cacheKey);
    if (cachedData) {
      return res.json(cachedData);
    }

    const adsSetting = await SystemSetting.findOne({ key: "ads_settings" });
    let adsConfig = { enableAds: false, adsenseClientId: "", adsenseCodeSnippet: "", adTuitions: [] };
    if (adsSetting) {
      let val = adsSetting.value;
      if (typeof val === "string") {
        try { val = JSON.parse(val); } catch (e) { val = {}; }
      }
      adsConfig = {
        enableAds: !!val.enableAds,
        adsenseClientId: val.adsenseClientId || "",
        adsenseCodeSnippet: val.adsenseCodeSnippet || "",
        adTuitions: val.adTuitions || [],
      };
    }

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
      const institute = await Institute.findById(student.user).select(
        "_id name status subscriptionEnd quizFeatureEnabled brandingEnabled logoUrl themeColor adminUser allowedFeatures"
      );
      if (!institute) continue;

      const isExpired =
        institute.status !== "active" ||
        new Date(institute.subscriptionEnd).getTime() < Date.now();

      if (isExpired) {
        continue; // skip expired institutes
      }

      const academyAdmin = institute.adminUser
        ? await User.findById(institute.adminUser).select("name email")
        : null;

      const instituteId = institute._id;
      const batch = student.batch;
      let teacherName = academyAdmin ? academyAdmin.name : institute.name;

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

      const isQuizEnabled = institute.quizFeatureEnabled !== false;

       const [notes, testResults, liveQuiz, rawQuizzes] = await Promise.all([
        Note.find({
          institute: instituteId,
          $or: [
            { targetType: "batch", batch: batch?._id || batch?.id || batch },
            { targetType: "batch", batch: null },
            { targetType: "student", students: student._id },
            { targetType: null, batch: batch?._id || batch?.id || batch },
            { targetType: null, batch: null }
          ],
        })
          .sort({ createdAt: -1 })
          .populate("batch", "name"),
        TestResult.find({ institute: instituteId, student: student._id }).sort({
          createdAt: -1,
        }),
        isQuizEnabled ? Promise.resolve(getLiveStateForStudent(student)) : Promise.resolve(null),
        isQuizEnabled ? Quiz.find({
          institute: instituteId,
          $or: [
            { batches: batch?._id || batch?.id || batch },
            { batches: { $size: 0 } }
          ],
          status: { $ne: "archived" },
        }).sort({ createdAt: -1 }) : Promise.resolve([]),
      ]);

      const quizzes = rawQuizzes.map((q) => ({
        _id: q._id,
        title: q.title,
        status: q.status,
        durationSeconds: q.durationSeconds,
        restSeconds: q.restSeconds,
        liveSessionId: q.liveSessionId,
        questionsCount: q.questions?.length || 0,
      }));

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
        quizzes,
        quizFeatureEnabled: isQuizEnabled,
        brandingEnabled: institute.brandingEnabled !== false,
        logoUrl: institute.logoUrl || null,
        themeColor: institute.themeColor || "#6366f1",
        allowedFeatures: institute.allowedFeatures || ["attendance", "notes", "marks", "tests", "whatsapp"],
        showAds: adsConfig.enableAds && adsConfig.adTuitions.includes(String(instituteId)),
        adsenseClientId: (adsConfig.enableAds && adsConfig.adTuitions.includes(String(instituteId))) ? adsConfig.adsenseClientId : "",
        adsenseCodeSnippet: (adsConfig.enableAds && adsConfig.adTuitions.includes(String(instituteId))) ? adsConfig.adsenseCodeSnippet : "",
      });
    }

    // Query all sibling profiles sharing same email or phone (must be non-empty)
    const siblingProfilesQuery = [];
    if (req.student?.email && req.student.email.trim() !== "") {
      siblingProfilesQuery.push({ email: req.student.email.toLowerCase().trim() });
    }
    if (req.student?.phone && req.student.phone.trim() !== "") {
      siblingProfilesQuery.push({ phone: req.student.phone.trim() });
    }

    let siblingProfiles = [];
    if (siblingProfilesQuery.length > 0) {
      const allSiblingStudents = await Student.find({
        $or: siblingProfilesQuery
      }).select("name enrollmentNumber email phone");

      const profilesMap = new Map();
      allSiblingStudents.forEach((s) => {
        if (!profilesMap.has(s.enrollmentNumber)) {
          profilesMap.set(s.enrollmentNumber, {
            name: s.name,
            enrollmentNumber: s.enrollmentNumber,
          });
        }
      });
      siblingProfiles = Array.from(profilesMap.values());
    }

    const responsePayload = { classes, siblingProfiles };
    await setCache(cacheKey, responsePayload, 3600); // Cache for 1 hour

    return res.json(responsePayload);
  } catch (error) {
    console.error("getStudentPortalData error:", error);
    return res.status(500).json({ message: "Could not load student dashboard" });
  }
};

export const downloadStudentNote = async (req, res) => {
  try {
    const student = req.student;
    const institute = await Institute.findById(student.user).select("_id");

    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    const studentBatchId = student.batch?._id || student.batch?.id || student.batch || null;
    const note = await Note.findOne({
      _id: req.params.id,
      institute: institute._id,
      $or: [{ batch: studentBatchId }, { batch: null }],
    });

    if (!note) {
      return res.status(404).json({ message: "Note not found" });
    }

    if (note.pdfUrl && note.pdfUrl.startsWith("http")) {
      let downloadUrl = note.pdfUrl;
      if (note.pdfUrl.includes("/raw/private/")) {
        downloadUrl = cloudinary.utils.private_download_url(note.pdfPublicId, "", {
          resource_type: "raw",
          type: "private",
        });
      }

      await streamRemoteFileAsAttachment({
        res,
        url: downloadUrl,
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

export const bulkCreateStudents = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot enroll students." });
    }

    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ message: "Invalid students array" });
    }

    const results = {
      successCount: 0,
      failCount: 0,
      errors: [],
      created: []
    };

    const ownerId = req.user.institute?._id || req.user.institute || req.user._id;
    const inst = await Institute.findById(ownerId);
    const portalEnabled = inst?.studentPortalEnabled !== false;
    const customFieldConfigs = inst?.studentCustomFields || [];

    // Cache batches for this user to avoid excessive DB queries
    const userBatches = await Batch.find({ user: ownerId });
    const batchMap = new Map();
    userBatches.forEach(b => {
      batchMap.set(b.name.toLowerCase().trim(), b._id);
    });

    for (let index = 0; index < students.length; index++) {
      const row = students[index];
      const rowNum = index + 2; // Row 1 is header

      try {
        const name = row.name ? String(row.name).trim() : "";
        const phone = row.phone ? String(row.phone).trim() : "";
        const parentName = row.parentName ? String(row.parentName).trim() : "";
        const parentPhone = row.parentPhone ? String(row.parentPhone).trim() : "";
        const email = row.email ? String(row.email).toLowerCase().trim() : "";
        const address = row.address ? String(row.address).trim() : "";
        const batchName = row.batchName ? String(row.batchName).toLowerCase().trim() : "";
        const joinedOn = row.joinedOn ? String(row.joinedOn).trim() : new Date().toISOString().split('T')[0];
        const totalFees = row.totalFees !== undefined && row.totalFees !== "" ? Number(row.totalFees) : 0;
        const feePlanType = row.feePlanType ? String(row.feePlanType).toLowerCase().trim() : "full_course";
        const dueDate = row.dueDate ? String(row.dueDate).trim() : null;

        // Validate required fields
        if (!name) throw new Error("Name is required");
        if (!phone) throw new Error("Phone is required");
        if (!parentName) throw new Error("Parent Name is required");
        if (!batchName) throw new Error("Batch Name is required");

        // Resolve batch ID
        const batchId = batchMap.get(batchName);
        if (!batchId) {
          throw new Error(`Batch "${row.batchName}" not found. Create the batch first.`);
        }

        if (Number.isNaN(totalFees) || totalFees < 0) {
          throw new Error("Total Fees must be a positive number");
        }

        if (!["monthly", "full_course", "partial"].includes(feePlanType)) {
          throw new Error("Fee Plan Type must be 'monthly', 'full_course', or 'partial'");
        }

        if (feePlanType === "partial" && !dueDate) {
          throw new Error("Due Date is required for partial fee plan");
        }

        const cleanEmail = email ? email.toLowerCase().trim() : "";
        const cleanPhone = phone ? phone.trim() : "";
        const cleanName = name.trim().toLowerCase();

        // Check if student is already enrolled in this exact batch at this institute
        const alreadyEnrolled = await Student.findOne({
          user: ownerId,
          name: { $regex: new RegExp(`^${cleanName}$`, "i") },
          batch: batchId,
          $or: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanPhone ? [{ phone: cleanPhone }] : [])
          ].filter(Boolean)
        });
        if (alreadyEnrolled) {
          throw new Error(`Student "${name}" is already enrolled in batch "${row.batchName}"`);
        }

        // Find existing student by email/phone to reuse credentials
        let enrollmentNumberToUse;
        let hashedPasswordToUse;

        const existingStudent = await Student.findOne({
          name: { $regex: new RegExp(`^${cleanName}$`, "i") },
          $or: [
            ...(cleanEmail ? [{ email: cleanEmail }] : []),
            ...(cleanPhone ? [{ phone: cleanPhone }] : []),
          ].filter(Boolean),
        }).select("enrollmentNumber password");

        if (existingStudent) {
          enrollmentNumberToUse = existingStudent.enrollmentNumber;
          hashedPasswordToUse = portalEnabled ? existingStudent.password : "";
        } else {
          enrollmentNumberToUse = await generateEnrollmentNumber(ownerId);
          if (portalEnabled) {
            const initialPassword = getInitialPassword(name, phone);
            hashedPasswordToUse = await bcrypt.hash(initialPassword, 10);
          } else {
            hashedPasswordToUse = "";
          }
        }

        // Extract custom fields values
        const customFields = {};
        for (const field of customFieldConfigs) {
          let val = row[field.name] ?? row[field.label] ?? undefined;
          if (val !== undefined) {
            customFields[field.name] = String(val).trim();
          }
        }

        // Determine if fees are paid or unpaid (defaults to unpaid)
        const rawFeeStatus = row.feeStatus ? String(row.feeStatus).toLowerCase().trim() : "unpaid";
        const cleanFeeStatus = (rawFeeStatus === "paid" || rawFeeStatus === "yes" || rawFeeStatus === "true" || rawFeeStatus === "1") ? "paid" : "unpaid";

        const paymentHistory = [];
        if (cleanFeeStatus === "paid" && totalFees > 0) {
          paymentHistory.push({
            _id: crypto.randomUUID(),
            amount: totalFees,
            paymentDate: new Date(joinedOn),
            paymentType: feePlanType,
            note: "Auto-collected on bulk import"
          });
        }

        const student = await Student.create({
          user: ownerId,
          name,
          phone,
          parentName,
          parentPhone,
          email: email ? email.toLowerCase() : "",
          address,
          enrollmentNumber: enrollmentNumberToUse,
          batch: batchId,
          joinedOn,
          totalFees,
          feePlanType,
          dueDate: resolveDueDate({ feePlanType, joinedOn, dueDate, feeStatus: cleanFeeStatus }),
          paymentHistory,
          attendanceRecords: [],
          password: hashedPasswordToUse,
          customFields,
        });

        results.successCount++;
        results.created.push({
          id: student._id,
          name: student.name,
          phone: student.phone,
          parentPhone: student.parentPhone,
          parentName: student.parentName,
          enrollmentNumber: student.enrollmentNumber,
          plainPassword: portalEnabled ? getInitialPassword(name, phone) : "",
          totalFees: student.totalFees,
          dueDate: student.dueDate,
        });
      } catch (err) {
        results.failCount++;
        results.errors.push({
          row: rowNum,
          studentName: row.name || "Unknown",
          message: err.message
        });
      }
    }

    if (results.successCount > 0) {
      await clearCachePattern("student:dashboard:*");
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");

      const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
      const inst = await Institute.findById(instituteId);
      const sendCredentialsEnabled = inst?.whatsappSettings?.sendCredentialsEnabled ?? false;
      const feeRemindersEnabled = inst?.whatsappSettings?.feeRemindersEnabled ?? false;

      if (sendCredentialsEnabled || feeRemindersEnabled) {
        const createdItems = [...results.created];
        setImmediate(async () => {
          try {
            const instituteName = inst?.name || "Classtech";
            const loginUrl = `${process.env.FRONTEND_URL || "https://classtech.vercel.app"}/student/login`;
            const daysBefore = inst?.whatsappSettings?.feeReminderDaysBefore ?? 3;

            for (const item of createdItems) {
              const recipientPhone = item.parentPhone?.trim() || item.phone?.trim();
              if (!recipientPhone) continue;

              // 1. Send Login Credentials if enabled
              if (sendCredentialsEnabled && item.plainPassword) {
                try {
                  console.log(`Sending bulk WhatsApp login credentials to ${item.name} (${recipientPhone})...`);
                  await sendTemplateMessage(String(instituteId), recipientPhone, "student_credentials", [
                    instituteName,
                    item.name,
                    item.enrollmentNumber,
                    item.plainPassword,
                    loginUrl
                  ]);
                  await new Promise((r) => setTimeout(r, 600));
                } catch (wErr) {
                  console.error(`Failed sending bulk WhatsApp credentials to ${item.name}:`, wErr.message);
                }
              }

              // 2. Send Fee Reminder if enabled and due date matches criteria
              const feesToUse = Number(item.totalFees || 0);
              if (feeRemindersEnabled && feesToUse > 0 && item.dueDate) {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const due = new Date(item.dueDate);
                due.setHours(0, 0, 0, 0);
                const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                
                if (diffDays <= daysBefore) {
                  try {
                    console.log(`Sending bulk WhatsApp fee reminder to ${item.name} (${recipientPhone})...`);
                    const formattedDueDate = new Date(item.dueDate).toLocaleDateString("en-IN");
                    await sendTemplateMessage(String(instituteId), recipientPhone, "fee_reminder", [
                      item.parentName || "Parent",
                      String(feesToUse),
                      item.name,
                      instituteName,
                      formattedDueDate
                    ]);
                    await new Promise((r) => setTimeout(r, 600));
                  } catch (wErr) {
                    console.error(`Failed sending bulk WhatsApp fee reminder to ${item.name}:`, wErr.message);
                  }
                }
              }
            }
          } catch (bgErr) {
            console.error("Bulk WhatsApp dispatch error:", bgErr.message);
          }
        });
      }
    }

    return res.status(200).json(results);
  } catch (error) {
    console.error("bulkCreateStudents error:", error);
    return res.status(500).json({ message: "Could not bulk import students" });
  }
};

export const sendStudentCredentialsWhatsApp = async (req, res) => {
  try {
    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const student = await Student.findOne({ _id: req.params.id, user: ownerId });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const instituteId = req.user.institute?._id || req.user.institute || req.user._id;
    const inst = await Institute.findById(instituteId);
    const instituteName = inst?.name || "Classtech";
    const recipientPhone = student.parentPhone?.trim() || student.phone?.trim();

    if (!recipientPhone) {
      return res.status(400).json({ message: "Student or parent phone number is missing" });
    }

    const plainPassword = getInitialPassword(student.name, student.phone);
    const loginUrl = `${process.env.FRONTEND_URL || "https://classtech.vercel.app"}/student/login`;

    const targetTemplate = await getCredentialsTemplate();
    const messageText = formatCredentialsMessage({
      template: targetTemplate,
      studentName: student.name,
      enrollmentNumber: student.enrollmentNumber,
      password: plainPassword,
      phone: recipientPhone,
      instituteName,
      loginUrl,
    });

    const result = await sendMessage(String(instituteId), recipientPhone, messageText, "credentials", {
      templateName: "student_credentials",
      parameters: [
        instituteName,
        student.name,
        student.enrollmentNumber,
        plainPassword,
        loginUrl
      ]
    });

    if (!result || !result.success) {
      return res.status(400).json({ message: result?.message || "Failed to send credentials via WhatsApp" });
    }

    return res.json({
      success: true,
      message: `WhatsApp credentials sent to ${student.name} (${recipientPhone}) successfully!`,
    });
  } catch (error) {
    console.error("sendStudentCredentialsWhatsApp error:", error);
    return res.status(500).json({ message: error.message || "Could not send WhatsApp message. Please verify WhatsApp connection." });
  }
};

export const getQuizLeaderboard = async (req, res) => {
  try {
    const quizId = req.params.id;
    const quiz = await Quiz.findById(quizId);
    if (!quiz) {
      return res.status(404).json({ message: "Quiz not found" });
    }
    const institute = await Institute.findById(quiz.institute);
    if (institute?.quizFeatureEnabled === false) {
      return res.status(403).json({ message: "Quiz feature is disabled for this institute" });
    }
    const attempts = await QuizAttempt.find({ quiz: quizId })
      .populate("student", "name")
      .sort({ score: -1, updatedAt: 1 });

    const leaderboard = attempts.map((attempt, index) => ({
      studentId: attempt.student?._id || attempt.student,
      studentName: attempt.student?.name || "Unknown Student",
      score: attempt.score,
      lastAnswerAt: attempt.updatedAt,
    }));

    return res.json(leaderboard);
  } catch (error) {
    console.error("getQuizLeaderboard error:", error);
    return res.status(500).json({ message: "Could not fetch leaderboard" });
  }
};

export const sendPaymentReceiptWhatsApp = async (req, res) => {
  try {
    const { id, paymentId } = req.params;
    const instituteId = req.user.institute?._id || req.user.institute;

    if (!req.file) {
      return res.status(400).json({ message: "PDF document file is required" });
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const student = await Student.findOne({ _id: id, user: ownerId });
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const targetPhone = (student.parentPhone && student.parentPhone.trim()) ? student.parentPhone.trim() : student.phone;
    if (!targetPhone) {
      return res.status(400).json({ message: "Student has no phone number configured" });
    }

    const inst = await Institute.findById(instituteId);
    const instName = inst?.name || "Classtech";

    const fileName = `Fee_Receipt_${paymentId.substring(0, 8)}.pdf`;
    const caption = `📄 *Fee Receipt Sent - ${instName}*\nDear Parent/Student, please find attached the fee receipt for your recorded payment.\n\nThank you!`;

    await sendDocument(String(instituteId), targetPhone, req.file.buffer, fileName, caption);

    return res.json({ success: true, message: "Receipt PDF sent successfully via WhatsApp!" });
  } catch (error) {
    console.error("sendPaymentReceiptWhatsApp error:", error);
    return res.status(500).json({ message: error.message || "Could not send receipt PDF via WhatsApp" });
  }
};


