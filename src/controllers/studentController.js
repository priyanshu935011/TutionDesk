import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Institute from "../models/Institute.js";
import Note from "../models/Note.js";
import TestResult from "../models/TestResult.js";
import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import bcrypt from "bcryptjs";
import { getCache, setCache, deleteCache, clearCachePattern } from "../utils/cache.js";
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

    if (feePlanType === "partial" && !dueDate) {
      return res.status(400).json({ message: "Due date is required for partial fee plan" });
    }

    // Verify all target batches exist
    const verifiedBatches = await Batch.find({ _id: { $in: targetBatches }, user: req.user._id });
    if (verifiedBatches.length !== targetBatches.length) {
      return res.status(400).json({ message: "One or more selected batches do not exist" });
    }

    const cleanEmail = email ? email.toLowerCase().trim() : "";
    const cleanPhone = phone ? phone.trim() : "";
    const cleanName = name.trim().toLowerCase();

    // Check if this exact student is already enrolled in any of the target batches
    for (const currentBatchId of targetBatches) {
      const alreadyEnrolled = await Student.findOne({
        user: req.user._id,
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

    // Find existing student by email/phone to reuse password and enrollmentNumber
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
        dueDate: i === 0 ? resolveDueDate({ feePlanType, joinedOn, dueDate, feeStatus }) : null,
        paymentHistory: currentPaymentHistory,
        attendanceRecords: i === 0 ? attendanceRecords : [],
        password: hashedPasswordToUse,
      });

      const populatedStudent = await populateStudent(Student.findById(student._id));
      createdStudents.push(populatedStudent);
    }
    
    if (enrollmentNumberToUse) {
      await deleteCache(`student:dashboard:${enrollmentNumberToUse}`);
    }
    await clearCachePattern("teacher:dashboard:*");

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
      });
    }

    // Update remaining/existing records
    const remainingRecords = await Student.find({
      enrollmentNumber: student.enrollmentNumber,
      user: ownerId,
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

    if (student.enrollmentNumber) {
      await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
    }
    await clearCachePattern("teacher:dashboard:*");

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

    if (student.enrollmentNumber) {
      await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
    }
    await clearCachePattern("teacher:dashboard:*");

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

    if (student.feePlanType === "monthly") {
      student.dueDate = addOneMonth(paymentDate);
    }

    await student.save();

    const populatedStudent = await populateStudent(Student.findById(student._id));

    if (student.enrollmentNumber) {
      await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
    }
    await clearCachePattern("teacher:dashboard:*");

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

    if (student.enrollmentNumber) {
      await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
    }
    await clearCachePattern("teacher:dashboard:*");

    return res.json(populatedStudent);
  } catch (error) {
    return res.status(500).json({ message: "Could not update attendance" });
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
        "_id name status subscriptionEnd quizFeatureEnabled"
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

      const isQuizEnabled = institute.quizFeatureEnabled !== false;

       const [notes, testResults, liveQuiz, rawQuizzes] = await Promise.all([
        Note.find({
          institute: instituteId,
          $or: [
            { targetType: "batch", batch: batch?._id || batch },
            { targetType: "batch", batch: null },
            { targetType: "student", students: student._id },
            { targetType: { $exists: false }, $or: [{ batch: batch?._id || batch }, { batch: null }] }
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
            { batches: batch?._id || batch },
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
      });
    }

    // Query all sibling profiles sharing same email or phone
    const siblingProfilesQuery = [];
    if (req.student?.email) siblingProfilesQuery.push({ email: req.student.email.toLowerCase() });
    if (req.student?.phone) siblingProfilesQuery.push({ phone: req.student.phone });

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

    // Cache batches for this user to avoid excessive DB queries
    const userBatches = await Batch.find({ user: req.user._id });
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
          user: req.user._id,
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
          hashedPasswordToUse = existingStudent.password;
        } else {
          enrollmentNumberToUse = await generateEnrollmentNumber(req.user._id);
          const initialPassword = getInitialPassword(name, phone);
          hashedPasswordToUse = await bcrypt.hash(initialPassword, 10);
        }

        // Determine if fees are paid or unpaid (defaults to unpaid)
        const rawFeeStatus = row.feeStatus ? String(row.feeStatus).toLowerCase().trim() : "unpaid";
        const cleanFeeStatus = (rawFeeStatus === "paid" || rawFeeStatus === "yes" || rawFeeStatus === "true" || rawFeeStatus === "1") ? "paid" : "unpaid";

        const paymentHistory = [];
        if (cleanFeeStatus === "paid" && totalFees > 0) {
          paymentHistory.push({
            amount: totalFees,
            paymentDate: new Date(joinedOn),
            paymentType: feePlanType,
            note: "Auto-collected on bulk import"
          });
        }

        const student = await Student.create({
          user: req.user._id,
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
        });

        results.successCount++;
        results.created.push({ id: student._id, name: student.name });
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
    }

    return res.status(200).json(results);
  } catch (error) {
    console.error("bulkCreateStudents error:", error);
    return res.status(500).json({ message: "Could not bulk import students" });
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


