import mongoose from "mongoose";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Institute from "../models/Institute.js";
import Note from "../models/Note.js";
import TestResult from "../models/TestResult.js";
import User from "../models/User.js";
import Quiz from "../models/Quiz.js";
import QuizAttempt from "../models/QuizAttempt.js";
import SystemSetting from "../models/SystemSetting.js";
import Notice from "../models/Notice.js";
import VideoLecture from "../models/VideoLecture.js";
import VideoRelease from "../models/VideoRelease.js";
import VideoReleaseStudent from "../models/VideoReleaseStudent.js";
import { supabase, readFallbackData, toValidUUID } from "../utils/supabaseModel.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getCache, setCache, deleteCache, clearCachePattern } from "../utils/cache.js";
import { sendMessage, sendDocument, sendTemplateMessage, getSessionStatus } from "../services/whatsappService.js";
import { getCredentialsTemplate, formatCredentialsMessage, getGlobalTemplates, formatAbsentMessage } from "../utils/whatsappTemplateHelper.js";
import cloudinary from "../utils/cloudinary.js";
import Notification from "../models/Notification.js";
import { sendStudentNotification } from "../services/notificationService.js";

const formatDate = (val) => (val ? new Date(val).toLocaleDateString("en-IN") : "-");

export const getInitialPassword = (name, phone) => {
  return "123456";
};
import {
  buildNoteDownloadFilename,
  streamRemoteFileAsAttachment,
} from "../utils/noteDownload.js";
import { supabaseBucket } from "../utils/supabase.js";

import { getLiveStateForStudent } from "../services/quizRuntime.js";

const allowedFeeTypes = ["monthly", "full_course", "partial"];

const addOneMonth = (dateValue) => {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (isNaN(date.getTime())) return null;
  date.setMonth(date.getMonth() + 1);
  return date;
};

const getISTDateStr = (dateInput) => {
  if (!dateInput) {
    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    return nowIST.toISOString().split("T")[0];
  }
  if (typeof dateInput === "string") {
    const match = dateInput.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
  }
  const d = new Date(dateInput);
  const istMs = d.getTime() + (5.5 * 3600 * 1000);
  return new Date(istMs).toISOString().split("T")[0];
};

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
  query.populate("batch", "name scheduleDays startTime endTime")
       .populate("batches", "name scheduleDays startTime endTime");

const resolveDueDate = ({ feePlanType, joinedOn, dueDate, feeStatus = "paid" }) => {
  if (dueDate) {
    const parsed = new Date(dueDate);
    if (!isNaN(parsed.getTime())) return parsed;
  }

  const baseDate = joinedOn ? new Date(joinedOn) : new Date();
  const validBase = isNaN(baseDate.getTime()) ? new Date() : baseDate;

  return new Date(validBase.getFullYear(), validBase.getMonth() + 1, 1);
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

    const cacheKey = `teacher:students:${req.user._id}:${req.user.role}:${req.query.includeArchived}:${req.query.archivedOnly}`;
    if (req.query.refresh !== "true" && req.query.archivedOnly !== "true") {
      const cached = await getCache(cacheKey);
      if (cached) {
        return res.json(cached);
      }
    }

    const query = { user: ownerId };

    if (req.query.archivedOnly === "true") {
      // Allow in-memory filtering below to capture both explicitly archived students and batch-archived students
    } else if (req.query.includeArchived !== "true") {
      query.isArchived = { $ne: true };
    }

    // Fetch all batches for this institute and filter by status in-memory
    const allBatches = await Batch.find({ user: ownerId }).select("_id status teacher");
    const activeBatchIds = new Set(allBatches.filter((b) => b.status !== "archived").map((b) => String(b._id)));
    const archivedBatchIds = new Set(allBatches.filter((b) => b.status === "archived").map((b) => String(b._id)));

const isTeacherOfBatch = (b, user) => {
  if (!b || !b.teacher || !user) return false;
  const t = b.teacher;
  const uId = String(user._id || user.id || "").trim();
  const uUuid = toValidUUID(user._id || user.id);
  const uPhone = String(user.phone || "").trim();
  const uEmail = String(user.email || "").trim().toLowerCase();

  if (typeof t === "object" && t !== null) {
    const tId = String(t._id || t.id || "").trim();
    const tPhone = String(t.phone || "").trim();
    const tEmail = String(t.email || "").trim().toLowerCase();
    return (
      (tId && (tId === uId || tId === uUuid)) ||
      (tPhone && uPhone && tPhone === uPhone) ||
      (tEmail && uEmail && tEmail === uEmail)
    );
  } else {
    const tStr = String(t).trim();
    return (
      (tStr && (tStr === uId || tStr === uUuid)) ||
      (uPhone && tStr === uPhone) ||
      (uEmail && tStr.toLowerCase() === uEmail)
    );
  }
};

    let teacherBatchIds = [];
    if (req.user.role === "teacher") {
      teacherBatchIds = Array.from(activeBatchIds).filter((bId) => {
        const b = allBatches.find((x) => String(x._id) === bId);
        return isTeacherOfBatch(b, req.user);
      });
      if (teacherBatchIds.length === 0) {
        await setCache(cacheKey, []);
        return res.json([]);
      }
      query.$or = [
        { batch: { $in: teacherBatchIds } },
        { batches: { $in: teacherBatchIds } },
        { enrolledBatchIds: { $in: teacherBatchIds } },
      ];
    }

    const rawStudents = await Student.find(query).sort({
      createdAt: -1,
    });

    let students = rawStudents;
    if (req.user.role === "teacher") {
      const teacherBatchSet = new Set(teacherBatchIds);
      students = rawStudents.filter((student) => {
        if (student.isArchived) return false;
        const studentBatchIds = [];
        if (student.batch) studentBatchIds.push(String(student.batch._id || student.batch.id || student.batch));
        if (Array.isArray(student.batches)) student.batches.forEach((b) => studentBatchIds.push(String(b._id || b.id || b)));
        if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => studentBatchIds.push(String(b)));
        return studentBatchIds.some((bId) => teacherBatchSet.has(bId));
      });
    } else if (req.query.archivedOnly === "true") {
      students = rawStudents.filter((student) => {
        if (student.isArchived === true || String(student.isArchived) === "true") return true;
        // Check if student belongs exclusively to archived batches
        const studentBatchIds = [];
        if (student.batch) studentBatchIds.push(String(student.batch._id || student.batch));
        if (Array.isArray(student.batches)) student.batches.forEach((b) => studentBatchIds.push(String(b._id || b)));
        if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => studentBatchIds.push(String(b)));
        if (studentBatchIds.length === 0) return false;
        return studentBatchIds.every((bId) => archivedBatchIds.has(bId));
      });
    } else if (req.query.includeArchived !== "true") {
      students = rawStudents.filter((student) => {
        if (student.isArchived === true || String(student.isArchived) === "true" || student.is_archived === true || String(student.is_archived) === "true") return false;
        const isExplicitlyUnarchived = student.isArchived === false || student.is_archived === false || String(student.isArchived) === "false" || String(student.is_archived) === "false";
        if (isExplicitlyUnarchived) return true;

        const studentBatchIds = [];
        if (student.batch) studentBatchIds.push(String(student.batch._id || student.batch.id || student.batch));
        if (Array.isArray(student.batches)) student.batches.forEach((b) => studentBatchIds.push(String(b._id || b.id || b)));
        if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => studentBatchIds.push(String(b)));
        if (studentBatchIds.length === 0) return true;
        return studentBatchIds.some((bId) => activeBatchIds.has(bId));
      });
    }

    // Return lightweight list with enrollmentNumber, name, batches, pending fees without server joins or JS reduce loops
    const lightStudents = students.map((student) => {
      const sObj = student.toJSON ? student.toJSON() : student;
      const total = Number(sObj.totalFees || 0);
      const paid = Number(
        sObj.paidAmount !== undefined && sObj.paidAmount !== null
          ? sObj.paidAmount
          : (sObj.paymentHistory || []).reduce((sum, p) => sum + Number(p.amount || 0), 0)
      );
      const pendingAmount = Number(
        sObj.pendingAmount !== undefined && sObj.pendingAmount !== null
          ? sObj.pendingAmount
          : Math.max(0, total - paid)
      );

      const enrolledBatchIds = (sObj.batches && sObj.batches.length > 0)
        ? sObj.batches.map((b) => (b?._id || b?.id || b).toString())
        : (sObj.batch ? [(sObj.batch?._id || sObj.batch?.id || sObj.batch).toString()] : []);

      return {
        _id: sObj._id || sObj.id,
        id: sObj._id || sObj.id,
        name: sObj.name || "",
        enrollmentNumber: sObj.enrollmentNumber || "",
        batch: sObj.batch,
        batches: sObj.batches || [],
        enrolledBatchIds,
        pendingAmount,
        totalFees: total,
        paidAmount: paid,
        feePlanType: sObj.feePlanType || "monthly",
        phone: sObj.phone || "",
        parentPhone: sObj.parentPhone || "",
        attendanceRecords: sObj.attendanceRecords || [],
        isArchived: Boolean(sObj.isArchived),
      };
    });

    const responsePayload = {
      students: lightStudents,
      total: lightStudents.length,
    };

    await setCache(cacheKey, responsePayload, 86400);
    return res.json(responsePayload);
  } catch (error) {
    console.error("getStudents catch block error:", error);
    return res.status(500).json({ message: "Could not fetch students" });
  }
};

export const invalidateStudentCache = async (studentId) => {
  try {
    if (studentId) {
      const sId = String(studentId);
      await deleteCache(`student:profile:${sId}`);
      await deleteCache(`student:basic:${sId}`);
      await deleteCache(`student:personal:${sId}`);
      await deleteCache(`student:payments:${sId}`);
      await deleteCache(`student:attendance:${sId}`);
      await deleteCache(`student:tests:${sId}`);
    }
    await clearCachePattern("attendance:batch:*");
    await clearCachePattern("teacher:students:*");
    await clearCachePattern("teacher:dashboard:*");
  } catch (err) {
    console.error("Error invalidating student cache:", err);
  }
};

export const getStudentPersonalInfoById = async (req, res) => {
  try {
    const studentId = req.params.id;
    const cacheKey = `student:personal:${studentId}`;
    const isRefresh = req.query.refresh === "true" || req.query.nocache === "true" || req.query.skipCache === "true";
    if (!isRefresh) {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute) 
      : req.user._id;

    const student = await Student.findOne({ _id: studentId, user: ownerId })
      .select("_id phone email parentName parentPhone address joinedOn customFields profilePicture name enrollmentNumber batch batches");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const payload = {
      _id: student._id,
      name: student.name || "",
      enrollmentNumber: student.enrollmentNumber || "",
      phone: student.phone || "",
      email: student.email || "",
      parentName: student.parentName || "",
      parentPhone: student.parentPhone || "",
      address: student.address || "",
      joinedOn: student.joinedOn,
      customFields: student.customFields || {},
      profilePicture: student.profilePicture || "",
    };

    await setCache(cacheKey, payload, 3600);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch student personal info" });
  }
};

export const getStudentBasicById = async (req, res) => {
  try {
    const studentId = req.params.id;
    const cacheKey = `student:basic:${studentId}`;
    const isRefresh = req.query.refresh === "true" || req.query.nocache === "true" || req.query.skipCache === "true";
    if (!isRefresh) {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute) 
      : req.user._id;

    const query = { _id: studentId, user: ownerId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => b._id);
      query.$or = [{ batch: { $in: batchIds } }, { batches: { $in: batchIds } }];
    }

    const student = await Student.findOne(query)
      .select("_id name phone parentName parentPhone email address enrollmentNumber batch batches joinedOn dueDate feePlanType profilePicture customFields isArchived")
      .populate("batch", "name scheduleDays startTime endTime")
      .populate("batches", "name scheduleDays startTime endTime");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const enrolledBatchIds = (student.batches && student.batches.length > 0)
      ? student.batches.map((b) => (b?._id || b).toString())
      : (student.batch ? [(student.batch?._id || student.batch).toString()] : []);

    const obj = student.toJSON ? student.toJSON() : student;
    obj.enrolledBatchIds = enrolledBatchIds;

    await setCache(cacheKey, obj, 3600);
    return res.json(obj);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch student basic info" });
  }
};

export const getStudentPaymentsById = async (req, res) => {
  try {
    const studentId = req.params.id;
    const cacheKey = `student:payments:${studentId}`;
    const isRefresh = req.query.refresh === "true" || req.query.nocache === "true" || req.query.skipCache === "true";
    if (!isRefresh) {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute) 
      : req.user._id;

    const student = await Student.findOne({ _id: studentId, user: ownerId })
      .select("_id totalFees feePlanType dueDate paymentHistory paidAmount pendingAmount feeStatus");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const paymentHistory = student.paymentHistory || [];
    const paidAmount = paymentHistory.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    const totalFees = Number(student.totalFees || 0);
    const pendingAmount = Math.max(0, totalFees - paidAmount);

    const payload = {
      _id: student._id,
      totalFees,
      feePlanType: student.feePlanType || "monthly",
      dueDate: student.dueDate,
      feeStatus: pendingAmount === 0 ? "paid" : "unpaid",
      paidAmount,
      pendingAmount,
      paymentHistory,
    };

    await setCache(cacheKey, payload, 3600);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch student payment info" });
  }
};

export const getStudentAttendanceById = async (req, res) => {
  try {
    const studentId = req.params.id;
    const cacheKey = `student:attendance:${studentId}`;
    const isRefresh = req.query.refresh === "true" || req.query.nocache === "true" || req.query.skipCache === "true";
    if (!isRefresh) {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute) 
      : req.user._id;

    const student = await Student.findOne({ _id: studentId, user: ownerId })
      .select("_id attendanceRecords");

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const records = student.attendanceRecords || [];
    const total = records.length;
    const present = records.filter((r) => r.status === "present").length;
    const absent = total - present;
    const attendancePercentage = total > 0 ? Number(((present / total) * 100).toFixed(1)) : 0.0;

    const payload = {
      _id: student._id,
      records,
      total,
      present,
      absent,
      attendancePercentage,
    };

    await setCache(cacheKey, payload, 3600);
    return res.json(payload);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch student attendance info" });
  }
};

export const getStudentById = async (req, res) => {
  try {
    const studentId = req.params.id;
    const cacheKey = `student:profile:${studentId}`;
    const isRefresh = req.query.refresh === "true" || req.query.nocache === "true" || req.query.skipCache === "true";
    if (!isRefresh) {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute) 
      : req.user._id;
    const query = { _id: studentId, user: ownerId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => b._id);
      query.$or = [{ batch: { $in: batchIds } }, { batches: { $in: batchIds } }];
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

    const enrolledBatchIds = (student.batches && student.batches.length > 0)
      ? student.batches.map((b) => (b?._id || b).toString())
      : (student.batch ? [(student.batch?._id || student.batch).toString()] : []);

    const obj = student.toJSON();
    obj.enrolledBatchIds = enrolledBatchIds;

    await setCache(cacheKey, obj, 3600);
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
      parentName = "",
      parentPhone = "",
      email = "",
      address = "",
      batch,
      batches = [],
      joinedOn,
      totalFees,
      feePlanType,
      dueDate,
      paymentHistory: initialPaymentHistory = [],
      attendanceRecords = [],
      feeStatus = "unpaid",
    } = req.body;

    let paymentHistory = Array.isArray(initialPaymentHistory) ? [...initialPaymentHistory] : [];
    const paidFeesInput = Number(req.body.paidFees || req.body.paid_fees || req.body.paidAmount || 0);
    const resolvedTotalFees = (totalFees !== undefined && totalFees !== null && totalFees !== "") ? Number(totalFees) : 0;
    if (paymentHistory.length === 0 && (paidFeesInput > 0 || feeStatus === "paid")) {
      const amountToRecord = paidFeesInput > 0 ? paidFeesInput : resolvedTotalFees;
      if (amountToRecord > 0) {
        paymentHistory.push({
          _id: crypto.randomUUID(),
          amount: amountToRecord,
          paymentDate: joinedOn ? new Date(joinedOn) : new Date(),
          paymentType: (feePlanType && allowedFeeTypes.includes(feePlanType)) ? feePlanType : "monthly",
          note: "Initial paid fees"
        });
      }
    }

    const rawTarget = Array.isArray(batches) && batches.length > 0 ? batches : (batch ? [batch] : []);
    const extractBatchId = (b) => {
      if (!b) return null;
      if (typeof b === "object") {
        return (b._id || b.id || b.value || "").toString().trim() || null;
      }
      return String(b).trim() || null;
    };
    const targetBatches = rawTarget.map(extractBatchId).filter(Boolean);

    if (!name || !name.trim() || !phone || !phone.trim() || targetBatches.length === 0) {
      return res.status(400).json({ message: "Name, phone number, and batch are required." });
    }

    const total = (totalFees !== undefined && totalFees !== null && totalFees !== "") ? Number(totalFees) : 0;
    const resolvedFeePlanType = (feePlanType && allowedFeeTypes.includes(feePlanType)) ? feePlanType : "monthly";
    const resolvedJoinedOn = joinedOn ? new Date(joinedOn) : new Date();

    const amountError = validatePayments(total, paymentHistory);
    const attendanceError = validateAttendance(attendanceRecords);

    if (amountError) {
      return res.status(400).json({ message: amountError });
    }

    if (attendanceError) {
      return res.status(400).json({ message: attendanceError });
    }

    const ownerId = req.user.role === "teacher"
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    // Verify all target batches exist by _id, id, or name
    const queryConditions = [
      { _id: { $in: targetBatches } },
      { id: { $in: targetBatches } },
      { name: { $in: targetBatches } }
    ];

    let verifiedBatches = [];
    try {
      verifiedBatches = await Batch.find({ $or: queryConditions });
    } catch (err) {
      console.error("Error verifying batches:", err);
    }

    const batchMap = new Map();
    for (const b of verifiedBatches) {
      const bId = String(b._id || b.id);
      batchMap.set(bId, bId);
      if (b.id) batchMap.set(String(b.id), bId);
      if (b._id) batchMap.set(String(b._id), bId);
      if (b.name) {
        batchMap.set(b.name, bId);
        batchMap.set(b.name.trim().toLowerCase(), bId);
      }
    }

    const resolvedIds = [];
    for (const tb of targetBatches) {
      const tbStr = String(tb).trim();
      if (batchMap.has(tbStr)) {
        resolvedIds.push(batchMap.get(tbStr));
      } else if (batchMap.has(tbStr.toLowerCase())) {
        resolvedIds.push(batchMap.get(tbStr.toLowerCase()));
      } else {
        resolvedIds.push(tbStr);
      }
    }

    let finalBatchIds = Array.from(new Set(resolvedIds));

    if (finalBatchIds.length === 0) {
      const fallbackBatch = await Batch.findOne({ user: ownerId }) || await Batch.findOne({});
      if (fallbackBatch) {
        finalBatchIds.push(String(fallbackBatch._id || fallbackBatch.id));
      }
    }

    const cleanEmail = email ? email.toLowerCase().trim() : "";
    const cleanPhone = phone ? phone.trim() : "";
    const cleanName = name.trim().toLowerCase();

    // Check if this exact student is already enrolled in any of the target batches
    for (const currentBatchId of finalBatchIds) {
      if (!mongoose.Types.ObjectId.isValid(currentBatchId)) continue;
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

    const primaryBatch = finalBatchIds[0];
    const formattedPayments = paymentHistory.map(p => ({
      _id: p._id || crypto.randomUUID(),
      amount: Number(p.amount),
      paymentDate: p.paymentDate,
      paymentType: p.paymentType,
      note: p.note || ""
    }));

    const student = await Student.create({
      user: ownerId,
      name,
      phone,
      parentName,
      parentPhone,
      email: email ? email.toLowerCase() : "",
      address,
      enrollmentNumber: enrollmentNumberToUse,
      batch: primaryBatch,
      batches: finalBatchIds,
      joinedOn,
      totalFees: total,
      feePlanType,
      dueDate: resolveDueDate({ feePlanType, joinedOn, dueDate, feeStatus }),
      paymentHistory: formattedPayments,
      attendanceRecords,
      password: hashedPasswordToUse,
      customFields,
    });

    const populatedStudent = await populateStudent(Student.findById(student._id));
    
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
          const loginUrl = `${process.env.FRONTEND_URL || "https://classtech.in"}/student/login`;
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

    const obj = populatedStudent ? (populatedStudent.toJSON ? populatedStudent.toJSON() : populatedStudent) : student;
    const enrolledBatchIds = (obj.batches && obj.batches.length > 0)
      ? obj.batches.map((b) => (b?._id || b?.id || b).toString())
      : (obj.batch ? [(obj.batch?._id || obj.batch?.id || obj.batch).toString()] : []);
    obj.enrolledBatchIds = enrolledBatchIds;

    return res.status(201).json(obj);
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
    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    // Teacher ownership check
    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const myBatchIds = myBatches.map(b => String(b._id));
      const studentBatchIds = (student.batches && student.batches.length > 0)
        ? student.batches.map(b => (b?._id || b?.id || b).toString())
        : (student.batch ? [(student.batch?._id || student.batch?.id || student.batch).toString()] : []);
      
      const hasMatch = studentBatchIds.some(bId => myBatchIds.includes(bId));
      if (myBatchIds.length > 0 && !hasMatch) {
        return res.status(403).json({ message: "Access denied. You can only modify students in your assigned batches." });
      }
    }

    const extractBatchId = (b) => {
      if (!b) return null;
      if (typeof b === "object") {
        return (b._id || b.id || b.value || "").toString().trim() || null;
      }
      return String(b).trim() || null;
    };

    const {
      name = student.name,
      phone = student.phone,
      parentName = student.parentName || "Parent",
      parentPhone = student.parentPhone || "",
      email = student.email || "",
      address = student.address || "",
      batch,
      batches,
      enrolledBatchIds,
      joinedOn = student.joinedOn || student.createdAt,
      totalFees = student.totalFees,
      feePlanType = student.feePlanType || "monthly",
      dueDate = student.dueDate,
      paymentHistory,
      attendanceRecords,
      customFields,
    } = req.body;

    const safeParseDate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    let rawBatches = [];
    if (batches !== undefined && Array.isArray(batches) && batches.length > 0) {
      rawBatches = batches;
    } else if (enrolledBatchIds !== undefined && Array.isArray(enrolledBatchIds) && enrolledBatchIds.length > 0) {
      rawBatches = enrolledBatchIds;
    } else if (batch !== undefined && batch !== null && batch !== "") {
      rawBatches = [batch];
    } else {
      rawBatches = student.batches?.length ? student.batches : (student.batch ? [student.batch] : []);
    }

    const targetBatches = rawBatches.map(extractBatchId).filter(Boolean);
    if (targetBatches.length === 0) {
      return res.status(400).json({ message: "At least one batch must be assigned" });
    }

    const inputTotal = Number(totalFees !== undefined ? totalFees : student.totalFees);
    const finalPaymentHistory = paymentHistory !== undefined 
      ? paymentHistory 
      : (student.paymentHistory || []);

    const paid = getPaidAmount(finalPaymentHistory);
    const total = Math.max(inputTotal, paid);

    const amountError = validatePayments(total, finalPaymentHistory);
    if (amountError) {
      return res.status(400).json({ message: amountError });
    }

    if (attendanceRecords !== undefined) {
      const attendanceError = validateAttendance(attendanceRecords);
      if (attendanceError) {
        return res.status(400).json({ message: attendanceError });
      }
    }

    if (!allowedFeeTypes.includes(feePlanType)) {
      return res.status(400).json({ message: "Invalid fee plan type" });
    }

    // Verify target batches exist by _id, id, or name
    const queryConditions = [
      { _id: { $in: targetBatches } },
      { id: { $in: targetBatches } },
      { name: { $in: targetBatches } }
    ];

    let verifiedBatches = [];
    try {
      verifiedBatches = await Batch.find({ $or: queryConditions });
    } catch (err) {
      console.error("Error verifying batches in updateStudent:", err);
    }

    const batchMap = new Map();
    for (const b of verifiedBatches) {
      const bId = String(b._id || b.id);
      batchMap.set(bId, bId);
      if (b.id) batchMap.set(String(b.id), bId);
      if (b._id) batchMap.set(String(b._id), bId);
      if (b.name) {
        batchMap.set(b.name, bId);
        batchMap.set(b.name.trim().toLowerCase(), bId);
      }
    }

    const resolvedIds = [];
    for (const tb of targetBatches) {
      const tbStr = String(tb).trim();
      if (batchMap.has(tbStr)) {
        resolvedIds.push(batchMap.get(tbStr));
      } else if (batchMap.has(tbStr.toLowerCase())) {
        resolvedIds.push(batchMap.get(tbStr.toLowerCase()));
      } else {
        resolvedIds.push(tbStr);
      }
    }

    let finalBatchIds = Array.from(new Set(resolvedIds));
    if (finalBatchIds.length === 0) {
      if (student.batch) {
        finalBatchIds.push(String(student.batch._id || student.batch.id || student.batch));
      } else {
        const fallbackBatch = await Batch.findOne({ user: ownerId }) || await Batch.findOne({});
        if (fallbackBatch) {
          finalBatchIds.push(String(fallbackBatch._id || fallbackBatch.id));
        }
      }
    }

    const primaryBatchId = finalBatchIds[0];

    student.name = name;
    student.phone = phone;
    student.parentName = parentName;
    student.parentPhone = parentPhone || "";
    student.email = email ? email.toLowerCase().trim() : "";
    student.address = address || "";

    student.batch = primaryBatchId;
    student.batch_id = primaryBatchId;
    student.batches = finalBatchIds;
    student.batch_ids = finalBatchIds;

    const resolvedJoinedOn = safeParseDate(joinedOn) || student.joinedOn || student.createdAt || new Date();
    student.joinedOn = resolvedJoinedOn;
    student.feePlanType = feePlanType;
    student.totalFees = total;
    student.paymentHistory = finalPaymentHistory.map(p => ({
      _id: p._id || crypto.randomUUID(),
      amount: Number(p.amount || 0),
      paymentDate: safeParseDate(p.paymentDate) || new Date(),
      paymentType: p.paymentType || "monthly",
      note: p.note || ""
    }));
    
    student.paidAmount = student.paymentHistory.reduce((sum, p) => sum + Number(p.amount || 0), 0);
    student.pendingAmount = Math.max(0, student.totalFees - student.paidAmount);

    const calculatedDueDate = resolveDueDate({ feePlanType, joinedOn: resolvedJoinedOn, dueDate: safeParseDate(dueDate) });
    student.dueDate = safeParseDate(calculatedDueDate) || calculatedDueDate;

    const inst = await Institute.findById(student.user) || await Institute.findById(ownerId);
    const customFieldsObj = customFields || student.customFields || {};
    const customFieldConfigs = inst?.studentCustomFields || [];
    for (const field of customFieldConfigs) {
      if (req.body[field.name] !== undefined) {
        customFieldsObj[field.name] = req.body[field.name];
      }
    }
    student.customFields = customFieldsObj;

    if (typeof student.markModified === "function") {
      student.markModified("batch");
      student.markModified("batches");
      student.markModified("customFields");
      student.markModified("paymentHistory");
    }

    await student.save();

    // Invalidate Redis and L1 RAM caches
    try {
      if (student.enrollmentNumber) {
        await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
      }
      await invalidateStudentCache(student._id);
    } catch (_) {}

    // Fetch updated populated student from DB
    const populatedStudent = await Student.findById(student._id)
      .populate("batch", "name scheduleDays startTime endTime")
      .populate("batches", "name scheduleDays startTime endTime");

    const obj = populatedStudent ? (populatedStudent.toJSON ? populatedStudent.toJSON() : populatedStudent) : student.toJSON();
    const respEnrolledBatchIds = (obj.batches && obj.batches.length > 0)
      ? obj.batches.map((b) => (b?._id || b?.id || b).toString())
      : (obj.batch ? [(obj.batch?._id || obj.batch?.id || obj.batch).toString()] : []);
    obj.enrolledBatchIds = respEnrolledBatchIds;

    let batchName = "Unassigned";
    if (obj.batch) {
      if (typeof obj.batch === "object" && obj.batch.name) {
        batchName = obj.batch.name;
      } else {
        const found = verifiedBatches.find(b => String(b._id || b.id) === String(obj.batch));
        if (found) batchName = found.name;
      }
    }
    obj.batchName = batchName;

    return res.json(obj);
  } catch (error) {
    console.error("updateStudent error:", error);
    if (error?.code === 11000 && error?.keyPattern?.enrollmentNumber) {
      return res.status(409).json({
        message: "Enrollment number already exists. Please try again once to generate the next sequence.",
      });
    }
    return res.status(500).json({ message: error?.message || "Could not update student" });
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
      await clearCachePattern("teacher:batches:*");
    } catch (cErr) {}

    return res.json({ message: "Student deleted successfully" });
  } catch (error) {
    console.error("deleteStudent error:", error);
    return res.status(500).json({ message: "Could not delete student" });
  }
};

export const archiveStudent = async (req, res) => {
  try {
    if (req.user.role === "teacher") {
      return res.status(403).json({ message: "Access denied. Teachers cannot archive students." });
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const student = await Student.findOne({
      _id: req.params.id,
      user: ownerId,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const targetArchivedState = req.body.isArchived !== undefined ? Boolean(req.body.isArchived) : !student.isArchived;
    student.isArchived = targetArchivedState;
    student.is_archived = targetArchivedState;
    await student.save();

    if (!targetArchivedState && student.batch) {
      try {
        const bId = String(student.batch._id || student.batch.id || student.batch);
        const b = await Batch.findById(bId);
        if (b && b.status === "archived") {
          b.status = "active";
          await b.save();
        }
      } catch (_) {}
    }

    try {
      if (student.enrollmentNumber) {
        await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
      }
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");
    } catch (_) {}

    const populatedStudent = await populateStudent(Student.findById(student._id));
    return res.json(populatedStudent);
  } catch (error) {
    console.error("archiveStudent error:", error);
    return res.status(500).json({ message: "Could not archive student" });
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

    const { amount, paymentDate, paymentType, note, remarks } = req.body;
    const paymentNote = note || remarks || "";
    const effectivePaymentType = (paymentType && allowedFeeTypes.includes(paymentType)) ? paymentType : "monthly";

    const student = await Student.findOne({
      _id: req.params.id,
      user: ownerId,
    });

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const numAmount = Number(amount);
    if (amount === undefined || isNaN(numAmount) || numAmount <= 0 || !paymentDate) {
      return res.status(400).json({ message: "Valid payment amount and payment date are required" });
    }

    const currentPaid = Number(student.paidAmount || 0);
    const totalFees = Number(student.totalFees || 0);
    const nextPaidAmount = currentPaid + numAmount;

    if (totalFees > 0 && nextPaidAmount > totalFees) {
      return res.status(400).json({ message: "Paid amount cannot be more than total fees" });
    }

    student.paidAmount = nextPaidAmount;
    student.pendingAmount = Math.max(0, totalFees - nextPaidAmount);

    const paymentId = crypto.randomUUID();
    const newPaymentRecord = {
      _id: paymentId,
      id: paymentId,
      amount: numAmount,
      paymentDate,
      paymentType: effectivePaymentType,
      note: paymentNote,
    };

    if (!Array.isArray(student.paymentHistory)) {
      student.paymentHistory = [];
    }
    student.paymentHistory.unshift(newPaymentRecord);

    if (student.feePlanType === "monthly") {
      try {
        const instId = req.user.institute?._id || req.user.institute || student.user;
        const institute = await Institute.findById(instId).select("flexibleDueDate");
        const isFlexible = institute?.flexibleDueDate === true;

        if (isFlexible) {
          student.dueDate = addOneMonth(paymentDate);
        } else {
          student.dueDate = addOneMonth(student.dueDate || paymentDate);
        }
      } catch (dErr) {}
    }

    // Direct insert into Supabase payments table
    try {
      await supabase.from("payments").insert({
        id: paymentId,
        student_id: String(student._id || student.id),
        amount: numAmount,
        payment_date: paymentDate ? new Date(paymentDate).toISOString() : new Date().toISOString(),
        payment_type: effectivePaymentType,
        note: paymentNote
      });
    } catch (payErr) {
      console.error("Supabase payments insert error:", payErr);
    }

    await student.save();

    try {
      const remaining = student.pendingAmount;
      sendStudentNotification({
        studentIds: [student._id],
        instituteId: req.user.institute?._id || req.user.institute,
        title: "Fee Payment Received",
        message: `Payment of ₹${numAmount} received. Remaining balance: ₹${remaining}.`,
        type: "fee_paid",
        data: { amount: numAmount, remaining },
      });
    } catch (nErr) {}

    try {
      if (student.enrollmentNumber) {
        await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
      }
      await invalidateStudentCache(student._id);
    } catch (cErr) {}

    return res.json({
      success: true,
      message: "Payment recorded successfully",
      payment: newPaymentRecord,
      studentId: student._id,
      paidAmount: student.paidAmount,
      pendingAmount: student.pendingAmount,
      totalFees: student.totalFees
    });
  } catch (error) {
    console.error("addPayment error:", error);
    return res.status(500).json({ message: "Could not add payment" });
  }
};

export const markAttendance = async (req, res) => {
  try {
    const { date, status, batchId } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute;
    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);
    const query = { _id: req.params.id, user: ownerId };

    if (req.user.role === "teacher") {
      const myBatches = await Batch.find({ user: ownerId, teacher: req.user._id }).select("_id");
      const batchIds = myBatches.map((b) => b._id);
      const strBatchIds = batchIds.map((b) => String(b));
      query.$or = [
        { batch: { $in: batchIds } },
        { batches: { $in: batchIds } },
        { enrolledBatchIds: { $in: strBatchIds } }
      ];
    }

    const student = await Student.findOne(query);

    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    if (!date || !["present", "absent"].includes(status)) {
      return res.status(400).json({ message: "Date and valid attendance status are required" });
    }

    const targetDateStr = getISTDateStr(date);
    const todayISTStr = getISTDateStr(new Date());
    if (targetDateStr > todayISTStr) {
      return res.status(400).json({ message: "Future attendance marking is not allowed." });
    }
    const targetDay = targetDateStr;

    const targetBatchIdStr = batchId ? String(batchId) : (student.batch ? String(student.batch) : null);

    const existingRecord = (student.attendanceRecords || []).find((record) => {
      if (!record.date) return false;
      const rStr = typeof record.date === "string" ? record.date.substring(0, 10) : new Date(record.date).toISOString().substring(0, 10);
      const matchesDate = rStr === targetDateStr || new Date(record.date).toDateString() === targetDay;
      const matchesBatch = targetBatchIdStr && record.batchId ? String(record.batchId) === targetBatchIdStr : true;
      return matchesDate && matchesBatch;
    });

    if (existingRecord) {
      existingRecord.status = status;
      if (targetBatchIdStr) existingRecord.batchId = targetBatchIdStr;
    } else {
      if (!student.attendanceRecords) student.attendanceRecords = [];
      const newRec = { date: targetDateStr, status };
      if (targetBatchIdStr) newRec.batchId = targetBatchIdStr;
      student.attendanceRecords.unshift(newRec);
    }

    // Sync to Supabase
    try {
      let sbQuery = supabase
        .from("attendance")
        .select("id")
        .eq("student_id", student._id)
        .eq("date", targetDateStr);
      
      if (targetBatchIdStr) {
        sbQuery = sbQuery.eq("batch_id", targetBatchIdStr);
      }

      const { data: existingDbRec } = await sbQuery.maybeSingle();

      if (existingDbRec && existingDbRec.id) {
        await supabase
          .from("attendance")
          .update({ status, ...(targetBatchIdStr ? { batch_id: targetBatchIdStr } : {}) })
          .eq("id", existingDbRec.id);
      } else {
        await supabase
          .from("attendance")
          .insert({
            student_id: student._id,
            date: targetDateStr,
            status,
            ...(targetBatchIdStr ? { batch_id: targetBatchIdStr } : {})
          });
      }
    } catch (dbErr) {
      console.error("Direct attendance table sync error:", dbErr.message);
    }

    await student.save();

    try {
      const formattedStatus = status === "present" ? "Present" : "Absent";
      sendStudentNotification({
        studentIds: [student._id],
        instituteId,
        title: status === "present" ? "Attendance Marked" : "Attendance Alert",
        message: `Your attendance for ${targetDay} has been marked as ${formattedStatus}.`,
        type: "attendance",
        data: { status, date: targetDay },
      });
    } catch (nErr) {}

    const populatedStudent = await populateStudent(Student.findById(student._id));

    try {
      if (student.enrollmentNumber) {
        await deleteCache(`student:dashboard:${student.enrollmentNumber}`);
      }
      await invalidateStudentCache(student._id);
    } catch (cErr) {}

    let whatsappStatus = { sent: false, reason: "Attendance status is not absent." };

    if (status === "absent") {
      try {
        const actualInstId = req.user.institute?._id ? String(req.user.institute._id) : String(req.user.institute || "");
        let settings = await getCache(`institute:whatsapp_settings:${actualInstId}`);
        if (!settings || Object.keys(settings).length === 0 || settings.absentAlertsEnabled === undefined) {
          const inst = await Institute.findById(actualInstId);
          settings = inst?.whatsappSettings || {};
        }

        const isAlertsEnabled = settings && (settings.absentAlertsEnabled === true || settings.absentAlertsEnabled === "true");

        if (isAlertsEnabled) {
          const dateObj = date ? new Date(date) : new Date();
          const formattedDate = dateObj.toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          });
          const globalTemplates = await getGlobalTemplates();
          const inst = await Institute.findById(actualInstId);
          const messageText = formatAbsentMessage({
            template: globalTemplates.absent,
            studentName: student.name,
            date: formattedDate,
            instituteName: inst?.name || "Classtech",
          });
          const recipientPhone = student.parentPhone?.trim() || student.phone?.trim();
          if (recipientPhone) {
            const result = await sendMessage(actualInstId, recipientPhone, messageText, "absent_alert", {
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

    const batchStudents = await Student.find({
      user: ownerId,
      $or: [
        { batch: batchId },
        { batches: batchId },
        { enrolledBatchIds: String(batchId) }
      ]
    });
    if (batchStudents.length === 0) {
      return res.status(400).json({ message: "No students found in this batch." });
    }

    const targetDateStr = getISTDateStr(date);
    const todayISTStr = getISTDateStr(new Date());
    if (targetDateStr > todayISTStr) {
      return res.status(400).json({ message: "Future attendance marking is not allowed." });
    }

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
        const matchesDate = rStr === targetDateStr;
        const matchesBatch = r.batchId ? String(r.batchId) === String(batchId) : true;
        return matchesDate && matchesBatch;
      });

      const wasAlreadyAbsent = existingRecord && existingRecord.status === "absent";
      if (newStatus === "absent" && !wasAlreadyAbsent) {
        absentStudents.push(student);
      }

      if (existingRecord) {
        isUpdate = true;
        existingRecord.status = newStatus;
        if (batchId) existingRecord.batchId = String(batchId);
      } else {
        if (!student.attendanceRecords) student.attendanceRecords = [];
        student.attendanceRecords.unshift({ date: targetDateStr, status: newStatus, batchId: String(batchId) });
      }

      // Also sync to Supabase attendance table directly
      try {
        const { data: existingDbRec } = await supabase
          .from("attendance")
          .select("id")
          .eq("student_id", student._id)
          .eq("date", targetDateStr)
          .eq("batch_id", String(batchId))
          .maybeSingle();

        if (existingDbRec && existingDbRec.id) {
          isUpdate = true;
          await supabase
            .from("attendance")
            .update({ status: newStatus, batch_id: String(batchId) })
            .eq("id", existingDbRec.id);
        } else {
          await supabase
            .from("attendance")
            .insert({ student_id: student._id, batch_id: String(batchId), date: targetDateStr, status: newStatus });
        }
      } catch (dbErr) {
        console.error("Direct attendance table sync error:", dbErr.message);
      }

      try {
        await student.save();
        const formattedStatus = newStatus === "present" ? "Present" : "Absent";
        sendStudentNotification({
          studentIds: [student._id],
          instituteId,
          title: newStatus === "present" ? "Attendance Marked" : "Attendance Alert",
          message: `Your attendance for ${targetDateStr} has been marked as ${formattedStatus}.`,
          type: "attendance",
          data: { status: newStatus, date: targetDateStr },
        });
      } catch (sErr) {}
    }

    // Sync single aggregated document to Supabase batch_attendance_records table
    try {
      const statusMap = {};
      let pCount = 0;
      let aCount = 0;
      for (const rec of records) {
        const sId = String(rec.studentId || rec.id || rec._id);
        const st = String(rec.status || "unmarked").toLowerCase();
        statusMap[sId] = st;
        if (st === "present") pCount++;
        else if (st === "absent") aCount++;
      }
      await supabase.from("batch_attendance_records").upsert({
        batch_id: String(batchId),
        date: targetDateStr,
        attendance_map: statusMap,
        total_count: records.length,
        present_count: pCount,
        absent_count: aCount,
        updated_at: new Date().toISOString()
      }, { onConflict: "batch_id, date" });
      await deleteCache(`attendance:batch:statusmap:${batchId}:${targetDateStr}`);
    } catch (_) {}

    // Clear dashboard & student cache
    try {
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("teacher:students:*");
      await clearCachePattern("attendance:batch:*");
      for (const s of batchStudents) {
        await invalidateStudentCache(s._id);
        if (s.enrollmentNumber) {
          await deleteCache(`student:dashboard:${s.enrollmentNumber}`);
        }
      }
    } catch (cErr) {}

    const updatedStudents = await populateStudent(Student.find({
      user: ownerId,
      $or: [
        { batch: batchId },
        { batches: batchId },
        { enrolledBatchIds: String(batchId) }
      ]
    }));

    const message = isUpdate ? "Attendance updated successfully" : "Attendance marked successfully";

    let whatsappStatus = [];
    try {
      const actualInstId = req.user.institute?._id ? String(req.user.institute._id) : String(req.user.institute || "");
      let settings = await getCache(`institute:whatsapp_settings:${actualInstId}`);
      if (!settings || Object.keys(settings).length === 0 || settings.absentAlertsEnabled === undefined) {
        const inst = await Institute.findById(actualInstId);
        settings = inst?.whatsappSettings || {};
      }

      const isAlertsEnabled = settings && (settings.absentAlertsEnabled === true || settings.absentAlertsEnabled === "true");

      if (isAlertsEnabled && absentStudents.length > 0) {
        const dateObj = date ? new Date(date) : new Date();
        const formattedDate = dateObj.toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          year: "numeric",
        });
        const globalTemplates = await getGlobalTemplates();
        const inst = await Institute.findById(actualInstId);

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
            const result = await sendMessage(actualInstId, recipientPhone, messageText, "absent_alert", {
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

export const getStudentSyncData = async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    const studentEnrollment = req.student?.enrollmentNumber || req.students[0]?.enrollmentNumber || req.studentEmail;
    const cacheKey = `student:sync:${studentEnrollment}`;
    
    if (req.query.nocache !== "true" && req.query.refresh !== "true") {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }
    }

    const students = req.students || (req.student ? [req.student] : []);
    const siblings = [];

    for (const student of students) {
      let institute = await Institute.findById(student.user).select(
        "_id name status subscriptionEnd brandingEnabled logoUrl themeColor allowedFeatures adminUser"
      );
      if (!institute) {
        institute = await Institute.findOne({ adminUser: student.user }).select(
          "_id name status subscriptionEnd brandingEnabled logoUrl themeColor allowedFeatures adminUser"
        );
      }
      if (!institute) {
        const uDoc = await User.findById(student.user).select("institute");
        if (uDoc && uDoc.institute) {
          institute = await Institute.findById(uDoc.institute).select(
            "_id name status subscriptionEnd brandingEnabled logoUrl themeColor allowedFeatures adminUser"
          );
        }
      }
      if (!institute) continue;

      const isExpired =
        institute.status !== "active" ||
        new Date(institute.subscriptionEnd).getTime() < Date.now();

      if (isExpired) continue;

      const academyAdmin = institute.adminUser
        ? await User.findById(institute.adminUser).select("name email")
        : null;

      const instituteId = institute._id;

      let rawBatches = [];
      if (Array.isArray(student.batches) && student.batches.length > 0) {
        rawBatches.push(...student.batches);
      }
      if (student.batch) {
        rawBatches.push(student.batch);
      }
      if (rawBatches.length === 0) {
        rawBatches = [null];
      }

      const batchMap = new Map();
      for (const b of rawBatches) {
        const bKey = b ? String(b._id || b.id || b) : "unassigned";
        if (!batchMap.has(bKey)) {
          batchMap.set(bKey, b);
        }
      }
      const uniqueBatches = Array.from(batchMap.values());

      for (const currentBatchItem of uniqueBatches) {
        let batch = typeof currentBatchItem === "object" ? currentBatchItem : null;
        if (!batch && currentBatchItem && currentBatchItem !== "unassigned") {
          batch = await Batch.findById(currentBatchItem).select("name scheduleDays startTime endTime teacher");
        }

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

        const currentBatchIdVal = batch ? (batch._id || batch.id) : null;

        // Fetch top 3 notes & notices for fast homepage preview summary
        const [notes, notices, totalNotesCount, totalNoticesCount] = await Promise.all([
          Note.find({
            institute: instituteId,
            $or: [
              { targetType: "batch", batch: currentBatchIdVal },
              { targetType: "batch", batch: null },
              { targetType: "student", students: student._id },
              { targetType: null, batch: currentBatchIdVal },
              { targetType: null, batch: null }
            ],
          })
            .select("_id title subject createdAt fileUrl")
            .sort({ createdAt: -1 })
            .limit(3),
          Notice.find({
            institute: instituteId,
            $or: [
              { targetType: "all" },
              { targetType: "batch", batches: currentBatchIdVal },
              { targetType: "batch", batch: currentBatchIdVal },
              { targetType: "student", students: student._id },
              { targetType: null },
            ],
          })
            .select("_id title content noticeType createdAt holidayDate originalTime rescheduledDate rescheduledTime")
            .sort({ createdAt: -1 })
            .limit(3),
          Note.countDocuments({
            institute: instituteId,
            $or: [
              { targetType: "batch", batch: currentBatchIdVal },
              { targetType: "batch", batch: null },
              { targetType: "student", students: student._id },
              { targetType: null, batch: currentBatchIdVal },
              { targetType: null, batch: null }
            ],
          }),
          Notice.countDocuments({
            institute: instituteId,
            $or: [
              { targetType: "all" },
              { targetType: "batch", batches: currentBatchIdVal },
              { targetType: "batch", batch: currentBatchIdVal },
              { targetType: "student", students: student._id },
              { targetType: null },
            ],
          }),
        ]);

        const rawAttendance = student.attendanceRecords || student.attendance || [];
        const batchAttendanceRecords = currentBatchIdVal
          ? rawAttendance.filter((a) => !a.batchId || String(a.batchId) === String(currentBatchIdVal))
          : rawAttendance;

        const totalClasses = batchAttendanceRecords.length;
        const presentCount = batchAttendanceRecords.filter((a) => a.status === "present").length;
        const absentCount = batchAttendanceRecords.filter((a) => a.status === "absent").length;
        const attendancePercentage = totalClasses > 0 ? Number(((presentCount / totalClasses) * 100).toFixed(1)) : 100;

        const totalFees = Number(student.totalFees || 0);
        const paidFees = (student.paymentHistory || []).reduce((sum, p) => sum + Number(p.amount || 0), 0);
        const pendingFees = Math.max(0, totalFees - paidFees);

        const timetable = batch
          ? {
              batchName: batch.name,
              scheduleDays: batch.scheduleDays || [],
              startTime: batch.startTime,
              endTime: batch.endTime,
            }
          : null;

        const sBatchId = currentBatchIdVal ? String(currentBatchIdVal) : (student.batch ? String(student.batch._id || student.batch.id || student.batch) : "");
        const sBatchIdsList = [];
        if (sBatchId) sBatchIdsList.push(sBatchId);
        if (Array.isArray(student.batches)) student.batches.forEach((b) => sBatchIdsList.push(String(b._id || b.id || b)));
        if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => sBatchIdsList.push(String(b)));
        const cleanSBatchIdsList = Array.from(new Set(sBatchIdsList.filter(Boolean)));

        siblings.push({
          studentId: student._id,
          enrollmentNumber: student.enrollmentNumber,
          batchId: sBatchId,
          batch_id: sBatchId,
          batchIds: cleanSBatchIdsList,
          batch_ids: cleanSBatchIdsList,
          student: {
            id: student._id,
            name: student.name,
            email: student.email,
            phone: student.phone,
            parentName: student.parentName || "",
            parentPhone: student.parentPhone || "",
            enrollmentNumber: student.enrollmentNumber,
            profilePicture: student.profilePicture || "",
            batchId: sBatchId,
            batch_id: sBatchId,
            batchIds: cleanSBatchIdsList,
            batch_ids: cleanSBatchIdsList,
          },
          teacherName,
          instituteName: institute.name,
          batchName: batch ? batch.name : "Unassigned",
          brandingEnabled: institute.brandingEnabled !== false,
          logoUrl: (institute.brandingEnabled !== false) ? (institute.logoUrl || null) : null,
          themeColor: (institute.brandingEnabled !== false) ? (institute.themeColor || "#4C3FBE") : "#4C3FBE",
          allowedFeatures: institute.allowedFeatures || ["attendance", "notes", "marks", "tests", "whatsapp"],

          // Clean Summary Section requested by user
          summary: {
            enrollmentNumber: student.enrollmentNumber,
            attendance: {
              totalClasses,
              presentCount,
              absentCount,
              attendancePercentage,
            },
            fees: {
              totalFees,
              paidFees,
              pendingFees,
              feePlanType: student.feePlanType || "monthly",
              dueDate: student.dueDate || null,
            },
            studyNotesCount: totalNotesCount,
            noticeBoardCount: totalNoticesCount,
            classSchedule: timetable,
          },

          notices: notices || [],
          timetable: timetable,
        });
      }
    }

    let siblingProfiles = [];
    try {
      const siblingProfilesQuery = [];
      const phonesSet = new Set();
      const emailsSet = new Set();
      const enrollmentsSet = new Set();

      const allRecords = [...(req.students || []), ...(req.student ? [req.student] : [])];
      allRecords.forEach((s) => {
        if (s && s.email && String(s.email).trim()) emailsSet.add(String(s.email).toLowerCase().trim());
        if (s && s.phone && String(s.phone).trim()) phonesSet.add(String(s.phone).trim());
        if (s && s.parentPhone && String(s.parentPhone).trim()) phonesSet.add(String(s.parentPhone).trim());
        if (s && s.enrollmentNumber) enrollmentsSet.add(String(s.enrollmentNumber).trim());
      });

      emailsSet.forEach((e) => siblingProfilesQuery.push({ email: e }));
      phonesSet.forEach((p) => {
        siblingProfilesQuery.push({ phone: p });
        siblingProfilesQuery.push({ parentPhone: p });
        const clean = String(p).replace(/\D/g, "");
        if (clean.length >= 7) {
          const last10 = clean.slice(-10);
          siblingProfilesQuery.push({ phone: { $regex: last10 + "$", $options: "i" } });
          siblingProfilesQuery.push({ parentPhone: { $regex: last10 + "$", $options: "i" } });
        }
      });
      enrollmentsSet.forEach((enr) => siblingProfilesQuery.push({ enrollmentNumber: enr }));

      if (siblingProfilesQuery.length > 0) {
        const allSiblingStudents = await Student.find({
          $or: siblingProfilesQuery
        }).select("name enrollmentNumber email phone parentPhone user batch batches enrolledBatchIds");

        const profilesMap = new Map();
        allSiblingStudents.forEach((s) => {
          if (s && s.enrollmentNumber && !profilesMap.has(s.enrollmentNumber)) {
            const sbId = String(s.batch?._id || s.batch?.id || s.batch || "");
            const sbIds = [];
            if (sbId) sbIds.push(sbId);
            if (Array.isArray(s.batches)) s.batches.forEach((b) => sbIds.push(String(b._id || b.id || b)));
            if (Array.isArray(s.enrolledBatchIds)) s.enrolledBatchIds.forEach((b) => sbIds.push(String(b)));
            const cleanSbIds = Array.from(new Set(sbIds.filter(Boolean)));

            profilesMap.set(s.enrollmentNumber, {
              id: s._id || s.id,
              name: s.name,
              enrollmentNumber: s.enrollmentNumber,
              email: s.email || "",
              phone: s.phone || s.parentPhone || "",
              batchId: sbId,
              batch_id: sbId,
              batchIds: cleanSbIds,
              batch_ids: cleanSbIds,
            });
          }
        });
        siblingProfiles = Array.from(profilesMap.values());
      }
    } catch (siblingErr) {
      console.error("Error fetching sibling profiles in getStudentSyncData:", siblingErr);
    }

    const responsePayload = {
      isSyncSummary: true,
      siblings: siblings,
      classes: siblings,
      siblingProfiles: siblingProfiles,
    };

    await setCache(cacheKey, responsePayload, 300);

    return res.json(responsePayload);
  } catch (error) {
    console.error("getStudentSyncData error:", error);
    return res.status(500).json({ message: "Server error fetching student sync summary data" });
  }
};

export const getStudentAttendance = async (req, res) => {
  try {
    const targetStudent = req.student || (req.students ? req.students[0] : null);
    if (!targetStudent) {
      return res.json({ success: true, attendanceMap: {} });
    }
    const rawAttendance = targetStudent.attendanceRecords || targetStudent.attendance || [];
    const attendanceMap = {
      [String(targetStudent._id || targetStudent.id)]: rawAttendance
    };

    return res.json({ success: true, attendanceMap });
  } catch (error) {
    console.error("getStudentAttendance error:", error);
    return res.status(500).json({ message: "Error fetching attendance" });
  }
};

export const getStudentNotes = async (req, res) => {
  try {
    const students = req.students || (req.student ? [req.student] : []);
    if (!students || students.length === 0) {
      return res.json({ success: true, notesMap: {}, notes: [] });
    }

    const notesMap = {};
    const allNotesSet = new Map();

    for (const student of students) {
      const stIdStr = String(student._id || student.id || "").trim();
      const studentBatchIds = [];
      if (student.batch) studentBatchIds.push(String(student.batch._id || student.batch.id || student.batch));
      if (Array.isArray(student.batches)) student.batches.forEach((b) => studentBatchIds.push(String(b._id || b.id || b)));
      if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => studentBatchIds.push(String(b)));
      const activeStudentBatchIds = Array.from(new Set(studentBatchIds.filter(Boolean)));
      const activeBatchIdsSet = new Set(activeStudentBatchIds);

      const studentNotes = await Note.find({
        institute: student.user
      })
        .sort({ createdAt: -1 })
        .populate("batch", "name");

      const isNoteForStudent = (n) => {
        if (!n) return false;
        const targetType = (n.targetType || n.target_type || "").toLowerCase();
        if (targetType === "student") {
          const stList = [...(n.students || []), ...(n.student_ids || [])].map((s) => String(s._id || s.id || s));
          return stList.includes(stIdStr);
        }
        if (targetType === "all") return true;

        const noteBatchIds = [];
        if (n.batch_id) noteBatchIds.push(String(n.batch_id));
        if (n.batch) noteBatchIds.push(String(n.batch._id || n.batch.id || n.batch));
        if (Array.isArray(n.batch_ids)) n.batch_ids.forEach((b) => noteBatchIds.push(String(b)));
        if (Array.isArray(n.batches)) n.batches.forEach((b) => noteBatchIds.push(String(b._id || b.id || b)));

        const cleanNoteBatchIds = Array.from(new Set(noteBatchIds.filter(Boolean)));
        if (cleanNoteBatchIds.length === 0) return true;

        return cleanNoteBatchIds.some((bId) => activeBatchIdsSet.has(bId));
      };

      const filteredNotes = (studentNotes || []).filter(isNoteForStudent);
      notesMap[stIdStr] = filteredNotes;

      filteredNotes.forEach((n) => {
        const nId = String(n._id || n.id);
        if (nId) allNotesSet.set(nId, n);
      });
    }

    return res.json({
      success: true,
      notesMap,
      notes: Array.from(allNotesSet.values()),
    });
  } catch (error) {
    console.error("getStudentNotes error:", error);
    return res.status(500).json({ message: "Error fetching notes" });
  }
};

export const getStudentTestMarks = async (req, res) => {
  try {
    const students = req.students || (req.student ? [req.student] : []);
    if (!students || students.length === 0) {
      return res.json({ success: true, testResultsMap: {}, testResults: [] });
    }

    const testResultsMap = {};
    const allTestResults = [];

    for (const student of students) {
      const stIdStr = String(student._id || student.id || "").trim();
      const testResults = await TestResult.find({
        student: student._id
      }).sort({ createdAt: -1 });

      testResultsMap[stIdStr] = testResults || [];
      if (Array.isArray(testResults)) {
        allTestResults.push(...testResults);
      }
    }

    return res.json({
      success: true,
      testResultsMap,
      testResults: allTestResults,
    });
  } catch (error) {
    console.error("getStudentTestMarks error:", error);
    return res.status(500).json({ message: "Error fetching test marks" });
  }
};

export const getStudentVideos = async (req, res) => {
  try {
    const students = req.students || (req.student ? [req.student] : []);
    if (!students || students.length === 0) {
      return res.json({ success: true, videosMap: {}, videos: [], recordedLectures: [] });
    }

    const videosMap = {};
    const allRecordedLecturesMap = new Map();
    const now = new Date();

    for (const student of students) {
      const stIdStr = String(student._id || student.id || "").trim();
      const videosList = [];

      const studentBatchIds = [];
      if (student.batch) studentBatchIds.push(String(student.batch._id || student.batch.id || student.batch));
      if (Array.isArray(student.batches)) student.batches.forEach((b) => studentBatchIds.push(String(b._id || b.id || b)));
      if (Array.isArray(student.enrolledBatchIds)) student.enrolledBatchIds.forEach((b) => studentBatchIds.push(String(b)));
      const activeStudentBatchIds = Array.from(new Set(studentBatchIds.filter(Boolean)));
      const activeBatchIdsSet = new Set(activeStudentBatchIds);
      const studentId = student._id;

      // 1. Direct target audience videos
      const rawVideos = await VideoLecture.find({
        institute: student.user,
        isArchived: { $ne: true },
        $or: [
          { targetType: "all" },
          { targetType: "batch", batches: { $in: activeStudentBatchIds } },
          { targetType: "batch", batch: { $in: activeStudentBatchIds } },
          { targetType: "student", students: studentId },
          { targetType: null },
        ],
      }).sort({ createdAt: -1 });

      videosList.push(...rawVideos);

      // 2. Educator released videos for student
      try {
        const relIds = [];
        const directVideoIds = [];

        // 2a. Query VideoReleaseStudent Mongoose model
        const releaseMappings = await VideoReleaseStudent.find({
          $or: [
            { student: studentId },
            { student_id: stIdStr },
            { student: stIdStr },
          ],
        });

        for (const m of releaseMappings || []) {
          if (m.release_id) relIds.push(String(m.release_id));
          if (m.release) relIds.push(String(m.release));
          if (m.video_id) directVideoIds.push(String(m.video_id));
          if (m.video) directVideoIds.push(String(m.video));
        }

        // 2b. Query Supabase table video_release_students directly
        try {
          if (supabase) {
            const { data: sbVrs } = await supabase
              .from("video_release_students")
              .select("release_id, video_id, student_id")
              .eq("student_id", stIdStr);

            if (Array.isArray(sbVrs)) {
              for (const r of sbVrs) {
                if (r.release_id) relIds.push(String(r.release_id));
                if (r.video_id) directVideoIds.push(String(r.video_id));
              }
            }
          }
        } catch (_) {}

        // 2c. Query fallback JSON storage for video_release_students
        try {
          const fallbackVrs = readFallbackData("video_release_students");
          for (const item of fallbackVrs || []) {
            const itemStudentId = String(item.student_id || item.student || "").trim();
            if (itemStudentId === stIdStr) {
              if (item.release_id || item.release) relIds.push(String(item.release_id || item.release));
              if (item.video_id || item.video) directVideoIds.push(String(item.video_id || item.video));
            }
          }
        } catch (_) {}

        // 2d. Fetch active VideoRelease records
        const cleanRelIds = Array.from(new Set(relIds.filter(Boolean)));
        if (cleanRelIds.length > 0) {
          const activeReleases = await VideoRelease.find({
            $or: [
              { _id: { $in: cleanRelIds } },
              { id: { $in: cleanRelIds } },
            ],
            status: "ACTIVE",
            revokedAt: null,
            startsAt: { $lte: now },
            $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
          }).populate("video");

          for (const r of activeReleases || []) {
            if (r.video) {
              const vObj = typeof r.video.toObject === "function" ? r.video.toObject() : r.video;
              if ((vObj.status === "READY" || vObj.status === "active") && !vObj.isArchived) {
                if (r.expiresAt || r.expires_at) {
                  vObj.expiryDate = r.expiresAt || r.expires_at;
                }
                videosList.push(vObj);
              }
            } else if (r.video_id || r.video) {
              directVideoIds.push(String(r.video_id || r.video));
            }
          }
        }

        // 2e. Fetch video lectures directly by collected video_ids
        const cleanDirectVideoIds = Array.from(new Set(directVideoIds.filter(Boolean)));
        if (cleanDirectVideoIds.length > 0) {
          const relVideos = await VideoLecture.find({
            $or: [
              { _id: { $in: cleanDirectVideoIds } },
              { id: { $in: cleanDirectVideoIds } },
              { bunnyVideoId: { $in: cleanDirectVideoIds } },
            ],
            isArchived: { $ne: true },
          });

          videosList.push(...relVideos);
        }
      } catch (relErr) {
        console.error("Error fetching release videos in getStudentVideos:", relErr);
      }

      const isVideoForStudent = (v) => {
        if (!v) return false;
        const st = (v.status || "").toLowerCase();
        const isActiveOrReady = st === "active" || st === "ready" || st === "";
        const notExpired = !v.expiryDate || new Date(v.expiryDate).getTime() >= now.getTime();
        if (!isActiveOrReady || !notExpired || v.isArchived) return false;

        const targetType = (v.targetType || v.target_type || "").toLowerCase();
        if (targetType === "student") {
          const stList = [...(v.students || []), ...(v.student_ids || [])].map((s) => String(s._id || s.id || s));
          return stList.includes(stIdStr);
        }
        if (targetType === "all") return true;

        const videoBatchIds = [];
        if (v.batch_id) videoBatchIds.push(String(v.batch_id));
        if (v.batch) videoBatchIds.push(String(v.batch._id || v.batch.id || v.batch));
        if (Array.isArray(v.batch_ids)) v.batch_ids.forEach((b) => videoBatchIds.push(String(b)));
        if (Array.isArray(v.batches)) v.batches.forEach((b) => videoBatchIds.push(String(b._id || b.id || b)));

        const cleanVideoBatchIds = Array.from(new Set(videoBatchIds.filter(Boolean)));
        if (cleanVideoBatchIds.length === 0) return true;

        return cleanVideoBatchIds.some((bId) => activeBatchIdsSet.has(bId));
      };

      const recordedLecturesMap = new Map();
      videosList
        .filter(isVideoForStudent)
        .forEach((v) => {
          const vIdStr = String(v._id || v.id || v.bunnyVideoId || "");
          if (vIdStr) {
            const videoObj = {
              _id: v._id || v.id,
              title: v.title,
              description: v.description || "",
              playlist: v.playlist || "",
              bunnyVideoId: v.bunnyVideoId,
              videoUrl: v.videoUrl,
              hlsUrl: v.hlsUrl,
              thumbnailUrl: v.thumbnailUrl,
              durationSeconds: v.durationSeconds || 0,
              fileSizeBytes: v.fileSizeBytes || 0,
              createdAt: v.createdAt,
              expiryDate: v.expiryDate,
            };
            recordedLecturesMap.set(vIdStr, videoObj);
            allRecordedLecturesMap.set(vIdStr, videoObj);
          }
        });

      videosMap[stIdStr] = Array.from(recordedLecturesMap.values());
    }

    const allRecordedLectures = Array.from(allRecordedLecturesMap.values());
    return res.json({
      success: true,
      videosMap,
      videos: allRecordedLectures,
      recordedLectures: allRecordedLectures
    });
  } catch (error) {
    console.error("getStudentVideos error:", error);
    return res.status(500).json({ message: "Error fetching video lectures" });
  }
};

export const getStudentFeePayment = async (req, res) => {
  try {
    const students = req.students || (req.student ? [req.student] : []);
    const feesMap = {};

    for (const student of students) {
      const totalFees = Number(student.totalFees || 0);
      const paymentHistory = student.paymentHistory || [];
      const paidAmount = paymentHistory.reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const pendingAmount = Math.max(0, totalFees - paidAmount);

      feesMap[String(student._id)] = {
        studentId: student._id,
        enrollmentNumber: student.enrollmentNumber,
        totalFees,
        paidAmount,
        pendingAmount,
        paymentHistory,
        feePlanType: student.feePlanType,
        dueDate: student.dueDate,
      };
    }

    return res.json({ success: true, fees: feesMap });
  } catch (error) {
    console.error("getStudentFeePayment error:", error);
    return res.status(500).json({ message: "Error fetching fee payment details" });
  }
};

export const getStudentPortalData = async (req, res) => {
  try {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");

    const studentEnrollment = req.student?.enrollmentNumber || req.students[0]?.enrollmentNumber || req.studentEmail;
    const cacheKey = `student:dashboard:${studentEnrollment}`;
    
    if (req.query.nocache !== "true" && req.query.refresh !== "true") {
      const cachedData = await getCache(cacheKey);
      if (cachedData) {
        return res.json(cachedData);
      }
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
      let institute = await Institute.findById(student.user).select(
        "_id name status subscriptionEnd quizFeatureEnabled brandingEnabled logoUrl themeColor adminUser allowedFeatures studentCustomFields"
      );
      if (!institute) {
        institute = await Institute.findOne({ adminUser: student.user }).select(
          "_id name status subscriptionEnd quizFeatureEnabled brandingEnabled logoUrl themeColor adminUser allowedFeatures studentCustomFields"
        );
      }
      if (!institute) {
        const uDoc = await User.findById(student.user).select("institute");
        if (uDoc && uDoc.institute) {
          institute = await Institute.findById(uDoc.institute).select(
            "_id name status subscriptionEnd quizFeatureEnabled brandingEnabled logoUrl themeColor adminUser allowedFeatures studentCustomFields"
          );
        }
      }
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

      // Extract all assigned batch objects/IDs for this student record
      let rawBatches = [];
      if (Array.isArray(student.batches) && student.batches.length > 0) {
        rawBatches.push(...student.batches);
      }
      if (student.batch) {
        rawBatches.push(student.batch);
      }
      if (rawBatches.length === 0) {
        rawBatches = [null];
      }

      // Deduplicate assigned batches by batch ID
      const batchMap = new Map();
      for (const b of rawBatches) {
        const bKey = b ? String(b._id || b.id || b) : "unassigned";
        if (!batchMap.has(bKey)) {
          batchMap.set(bKey, b);
        }
      }
      const uniqueBatches = Array.from(batchMap.values());

      for (const currentBatchItem of uniqueBatches) {
        let batch = typeof currentBatchItem === "object" ? currentBatchItem : null;
        if (!batch && currentBatchItem && currentBatchItem !== "unassigned") {
          batch = await Batch.findById(currentBatchItem).populate("teacher", "name email");
        }

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
        const isVideosEnabled = institute.recordedLecturesFeatureEnabled !== false;

        const currentBatchIdVal = batch ? (batch._id || batch.id) : null;

        const [notes, testResults, liveQuiz, rawQuizzes, rawVideos, notices] = await Promise.all([
          Note.find({
            institute: instituteId,
            $or: [
              { targetType: "batch", batch: currentBatchIdVal },
              { targetType: "batch", batch: null },
              { targetType: "student", students: student._id },
              { targetType: null, batch: currentBatchIdVal },
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
              { batches: currentBatchIdVal },
              { batches: { $size: 0 } }
            ],
            status: { $ne: "archived" },
          }).sort({ createdAt: -1 }) : Promise.resolve([]),
          isVideosEnabled
            ? VideoLecture.find({
                institute: instituteId,
                status: "active",
                $or: [
                  { targetType: "all" },
                  { targetType: "batch", batches: currentBatchIdVal },
                  { targetType: "batch", batches: { $size: 0 } },
                  { targetType: "student", students: student._id },
                  { targetType: null },
                ],
              }).sort({ createdAt: -1 })
            : Promise.resolve([]),
          Notice.find({
            institute: instituteId,
            $or: [
              { targetType: "all" },
              { targetType: "batch", batches: currentBatchIdVal },
              { targetType: "batch", batch: currentBatchIdVal },
              { targetType: "student", students: student._id },
              { targetType: null },
            ],
          }).sort({ createdAt: -1 }),
        ]);

        const rawAttendance = student.attendanceRecords || student.attendance || [];
        const batchAttendanceRecords = currentBatchIdVal
          ? rawAttendance.filter((a) => !a.batchId || String(a.batchId) === String(currentBatchIdVal))
          : rawAttendance;

        const batchNotes = notes || [];
        const batchTestResults = testResults || [];
        const studentNotices = notices || [];

        const now = new Date();
        const recordedLectures = (rawVideos || [])
          .filter((v) => !v.expiryDate || new Date(v.expiryDate).getTime() >= now.getTime())
          .map((v) => ({
            _id: v._id,
            title: v.title,
            description: v.description,
            bunnyVideoId: v.bunnyVideoId,
            videoUrl: v.videoUrl,
            hlsUrl: v.hlsUrl,
            thumbnailUrl: v.thumbnailUrl,
            durationSeconds: v.durationSeconds,
            fileSizeBytes: v.fileSizeBytes,
            createdAt: v.createdAt,
            expiryDate: v.expiryDate,
          }));

        const quizzes = rawQuizzes.map((q) => ({
          _id: q._id,
          title: q.title,
          status: q.status,
          durationSeconds: q.durationSeconds,
          restSeconds: q.restSeconds,
          liveSessionId: q.liveSessionId,
          questionsCount: q.questions?.length || 0,
        }));

        classes.push({
          studentId: student._id,
          student: {
            id: student._id,
            name: student.name,
            email: student.email,
            phone: student.phone,
            parentName: student.parentName,
            parentPhone: student.parentPhone,
            address: student.address,
            profilePicture: student.profilePicture || "",
            customFields: student.customFields || {},
            enrollmentNumber: student.enrollmentNumber,
            batch: batch || student.batch,
            paidAmount: student.paidAmount || 0,
            pendingAmount: student.pendingAmount || 0,
            totalFees: student.totalFees || 0,
            feePlanType: student.feePlanType,
            paymentHistory: student.paymentHistory || [],
            dueDate: student.dueDate,
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
          feesHistory: student.paymentHistory || [],
          attendance: batchAttendanceRecords,
          notes: batchNotes,
          testResults: batchTestResults,
          studentCustomFields: institute.studentCustomFields || [],
          notices: studentNotices.map((n) => ({
            _id: n._id,
            title: n.title,
            content: n.content,
            noticeType: n.noticeType || "general",
            targetType: n.targetType,
            createdAt: n.createdAt,
            holidayDate: n.holidayDate,
            originalTime: n.originalTime,
            rescheduledDate: n.rescheduledDate,
            rescheduledTime: n.rescheduledTime,
          })),
          liveQuiz,
          quizzes,
          quizFeatureEnabled: isQuizEnabled,
          recordedLectures,
          recordedLecturesFeatureEnabled: isVideosEnabled,
          brandingEnabled: institute.brandingEnabled !== false,
          logoUrl: (institute.brandingEnabled !== false) ? (institute.logoUrl || null) : null,
          themeColor: (institute.brandingEnabled !== false) ? (institute.themeColor || "#4C3FBE") : "#4C3FBE",
          allowedFeatures: institute.allowedFeatures || ["attendance", "notes", "marks", "tests", "whatsapp"],
          showAds: adsConfig.enableAds && adsConfig.adTuitions.includes(String(instituteId)),
          adsenseClientId: (adsConfig.enableAds && adsConfig.adTuitions.includes(String(instituteId))) ? adsConfig.adsenseClientId : "",
          adsenseCodeSnippet: (adsConfig.enableAds && adsConfig.adTuitions.includes(String(instituteId))) ? adsConfig.adsenseCodeSnippet : "",
        });
      }
    }

    // Query all sibling profiles sharing same email, phone, parentPhone, or enrollmentNumber
    let siblingProfiles = [];
    try {
      const siblingProfilesQuery = [];
      const phonesSet = new Set();
      const emailsSet = new Set();
      const enrollmentsSet = new Set();

      const allRecords = [...(req.students || []), ...(req.student ? [req.student] : [])];
      allRecords.forEach((s) => {
        if (s && s.email && String(s.email).trim()) emailsSet.add(String(s.email).toLowerCase().trim());
        if (s && s.phone && String(s.phone).trim()) phonesSet.add(String(s.phone).trim());
        if (s && s.parentPhone && String(s.parentPhone).trim()) phonesSet.add(String(s.parentPhone).trim());
        if (s && s.enrollmentNumber) enrollmentsSet.add(String(s.enrollmentNumber).trim());
      });

      emailsSet.forEach((e) => siblingProfilesQuery.push({ email: e }));
      phonesSet.forEach((p) => {
        siblingProfilesQuery.push({ phone: p });
        siblingProfilesQuery.push({ parentPhone: p });
        const clean = String(p).replace(/\D/g, "");
        if (clean.length >= 7) {
          const last10 = clean.slice(-10);
          siblingProfilesQuery.push({ phone: { $regex: last10 + "$", $options: "i" } });
          siblingProfilesQuery.push({ parentPhone: { $regex: last10 + "$", $options: "i" } });
        }
      });
      enrollmentsSet.forEach((enr) => siblingProfilesQuery.push({ enrollmentNumber: enr }));

      if (siblingProfilesQuery.length > 0) {
        const allSiblingStudents = await Student.find({
          $or: siblingProfilesQuery
        }).select("name enrollmentNumber email phone parentPhone user");

        const profilesMap = new Map();
        allSiblingStudents.forEach((s) => {
          if (s && s.enrollmentNumber && !profilesMap.has(s.enrollmentNumber)) {
            profilesMap.set(s.enrollmentNumber, {
              name: s.name,
              enrollmentNumber: s.enrollmentNumber,
              email: s.email || "",
              phone: s.phone || s.parentPhone || "",
            });
          }
        });
        siblingProfiles = Array.from(profilesMap.values());
      }
    } catch (siblingErr) {
      console.error("Error fetching sibling profiles in getStudentPortalData:", siblingErr);
    }

        if (classes.length === 0 && students.length > 0) {
      const s = students[0];
      let inst = await Institute.findById(s.user).select("name brandingEnabled logoUrl themeColor studentCustomFields");
      if (!inst) {
        inst = await Institute.findOne({ adminUser: s.user }).select("name brandingEnabled logoUrl themeColor studentCustomFields");
      }
      if (!inst) {
        const uDoc = await User.findById(s.user).select("institute");
        if (uDoc && uDoc.institute) {
          inst = await Institute.findById(uDoc.institute).select("name brandingEnabled logoUrl themeColor studentCustomFields");
        }
      }
      classes.push({
        studentId: s._id,
        student: {
          id: s._id,
          name: s.name,
          email: s.email,
          phone: s.phone,
          parentName: s.parentName || "",
          parentPhone: s.parentPhone || "",
          address: s.address || "",
          profilePicture: s.profilePicture || "",
          customFields: s.customFields || {},
          enrollmentNumber: s.enrollmentNumber,
          batch: s.batch,
          paidAmount: s.paidAmount || 0,
          pendingAmount: s.pendingAmount || 0,
          totalFees: s.totalFees || 0,
          paymentHistory: s.paymentHistory || [],
        },
        teacherName: inst ? inst.name : "Tuition Teacher",
        instituteName: inst ? inst.name : "Classtech",
        studentCustomFields: inst?.studentCustomFields || [],
        batchName: s.batch ? s.batch.name : "General Batch",
        attendance: s.attendanceRecords || [],
        notes: [],
        testResults: [],
        brandingEnabled: inst ? inst.brandingEnabled !== false : false,
        logoUrl: (inst && inst.brandingEnabled !== false) ? (inst.logoUrl || null) : null,
        themeColor: (inst && inst.brandingEnabled !== false) ? (inst.themeColor || "#4C3FBE") : "#4C3FBE",
      });
    }

    const responsePayload = { classes, siblingProfiles };
    await setCache(cacheKey, responsePayload, 300); // Cache for 5 minutes

    return res.json(responsePayload);
  } catch (error) {
    console.error("getStudentPortalData error:", error);
    return res.status(500).json({ message: "Could not load student dashboard" });
  }
};

export const downloadStudentNote = async (req, res) => {
  try {
    const student = req.student;
    const instituteId = String(student.user?._id || student.user || "");

    const studentBatchId = student.batch?._id || student.batch?.id || student.batch || null;
    const note = await Note.findOne({
      _id: req.params.id,
      institute: instituteId,
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
        const paidFeesInput = Number(row.paidFees || row.paid_fees || row.paidAmount || 0);

        const paymentHistory = [];
        if (paidFeesInput > 0) {
          paymentHistory.push({
            _id: crypto.randomUUID(),
            amount: paidFeesInput,
            paymentDate: new Date(joinedOn),
            paymentType: feePlanType,
            note: "Auto-collected on bulk import"
          });
        } else if (cleanFeeStatus === "paid" && totalFees > 0) {
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
            const loginUrl = `${process.env.FRONTEND_URL || "https://classtech.in"}/student/login`;
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
    const loginUrl = `${process.env.FRONTEND_URL || "https://classtech.in"}/student/login`;

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

export const sendFeeReminderWhatsApp = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with account." });
    }

    const student = await Student.findById(req.params.id);
    if (!student) {
      return res.status(404).json({ message: "Student not found" });
    }

    const inst = await Institute.findById(instituteId);
    const instName = inst?.name || "Classtech";

    const recipientPhone = student.parentPhone && student.parentPhone.trim()
      ? student.parentPhone.trim()
      : student.phone;

    if (!recipientPhone) {
      return res.status(400).json({ message: "No phone number available for this student or parent." });
    }

    const pendingAmount = Number(student.totalFees || 0) - student.paidAmount;
    if (pendingAmount <= 0) {
      return res.status(400).json({ message: "This student has no pending fee amount." });
    }

    const dueDate = student.dueDate ? formatDate(student.dueDate) : "-";

    try {
      await sendTemplateMessage(String(instituteId), recipientPhone, "fee_reminder", [
        (student.parentName && student.parentName.trim()) ? student.parentName.trim() : student.name,
        pendingAmount.toString(),
        student.name,
        dueDate,
        inst.name || "Classtech"
      ]);
    } catch (wErr) {
      console.error("WhatsApp fee reminder send failed, triggering in-app notification:", wErr.message);
    }

    try {
      sendStudentNotification({
        studentIds: [student._id],
        instituteId,
        title: "Fee Payment Reminder",
        message: `Fee Reminder: Pending dues of ₹${pendingAmount}. Please pay at your earliest convenience.`,
        type: "fee_reminder",
        data: { pendingAmount, dueDate },
      });
    } catch (nErr) {}

    return res.json({ message: "Fee reminder sent via WhatsApp successfully!" });
  } catch (error) {
    console.error("sendFeeReminderWhatsApp error:", error);
    return res.status(500).json({ message: error.message || "Failed to send fee reminder" });
  }
};

export const getStudentNotifications = async (req, res) => {
  try {
    const studentId = req.student._id;
    const { supabase: sb } = await import("../utils/supabase.js");

    const { data: rows, error } = await sb
      .from("notifications")
      .select("*")
      .eq("student_id", String(studentId))
      .order("created_at", { ascending: false })
      .limit(50);

    let notifications = [];
    if (!error && rows) {
      const seenKeys = new Set();
      for (const r of rows) {
        const key = `${(r.title || "").trim()}|${(r.message || "").trim()}|${r.type || ""}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          notifications.push({
            id: r.id,
            _id: r.id,
            title: r.title,
            message: r.message,
            type: r.type || "general",
            data: r.data ? (typeof r.data === "string" ? JSON.parse(r.data) : r.data) : {},
            isRead: r.is_read || false,
            createdAt: r.created_at,
          });
        }
      }
    } else {
      const docs = await Notification.find({ student: studentId })
        .sort({ createdAt: -1 })
        .limit(50);
      const seenKeys = new Set();
      for (const d of docs) {
        const key = `${(d.title || "").trim()}|${(d.message || "").trim()}|${d.type || ""}`;
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          notifications.push({
            id: d._id,
            _id: d._id,
            title: d.title,
            message: d.message,
            type: d.type,
            data: d.data,
            isRead: d.isRead,
            createdAt: d.createdAt,
          });
        }
      }
    }

    const unreadCount = notifications.filter((n) => !n.isRead).length;
    return res.json({ notifications, unreadCount });
  } catch (error) {
    console.error("getStudentNotifications error:", error.message);
    return res.status(500).json({ message: "Could not fetch notifications" });
  }
};

export const markNotificationRead = async (req, res) => {
  try {
    const studentId = req.student._id;
    const notificationId = req.params.id;
    const { supabase: sb } = await import("../utils/supabase.js");

    if (notificationId === "read-all") {
      await sb
        .from("notifications")
        .update({ is_read: true })
        .eq("student_id", String(studentId));
      await Notification.updateMany({ student: studentId }, { isRead: true });
    } else {
      await sb
        .from("notifications")
        .update({ is_read: true })
        .eq("id", notificationId)
        .eq("student_id", String(studentId));
      await Notification.updateOne({ _id: notificationId, student: studentId }, { isRead: true });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("markNotificationRead error:", error.message);
    return res.status(500).json({ message: "Could not update notification" });
  }
};

export const updateStudentFcmToken = async (req, res) => {
  try {
    const studentId = req.student._id;
    const { fcmToken } = req.body;
    if (!fcmToken) {
      return res.status(400).json({ message: "fcmToken is required" });
    }

    const { supabase: sb } = await import("../utils/supabase.js");
    try {
      await sb
        .from("students")
        .update({ fcm_token: String(fcmToken).trim() })
        .eq("id", String(studentId));
    } catch (_) {}

    await Student.findByIdAndUpdate(studentId, { fcmToken: String(fcmToken).trim() });

    return res.json({ message: "FCM token registered successfully!" });
  } catch (error) {
    console.error("updateStudentFcmToken error:", error);
    return res.status(500).json({ message: "Could not register FCM token" });
  }
};

export const getBatchAttendanceByDate = async (req, res) => {
  try {
    const { batchId, date } = req.query;
    if (!batchId || !date) {
      return res.status(400).json({ message: "Batch ID and date query parameters are required." });
    }

    const targetDateStr = getISTDateStr(date);
    const cacheKey = `attendance:batch:${batchId}:${targetDateStr}`;
    const isRefresh = req.query.refresh === "true" || req.query.nocache === "true" || req.query.skipCache === "true";
    if (!isRefresh) {
      const cachedPayload = await getCache(cacheKey);
      if (cachedPayload) {
        return res.status(200).json(cachedPayload);
      }
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    let batchObj = null;
    try {
      batchObj = await Batch.findById(batchId);
    } catch (_) {}

    if (!batchObj) {
      batchObj = await Batch.findOne({ user: ownerId, name: { $regex: new RegExp(`^${String(batchId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") } });
    }

    const bIdStr = batchObj ? String(batchObj._id) : String(batchId);
    const bNameStr = batchObj ? batchObj.name.trim().toLowerCase() : String(batchId).trim().toLowerCase();

    const allStudents = await Student.find({
      user: ownerId,
      isArchived: { $ne: true }
    });

    const batchStudents = allStudents.filter((s) => {
      const studentBatchNamesAndIds = new Set();

      if (s.batchName && s.batchName.toString().trim()) {
        studentBatchNamesAndIds.add(s.batchName.toString().trim().toLowerCase());
      }
      if (s.batch) {
        if (typeof s.batch === "object" && s.batch !== null) {
          if (s.batch.name) studentBatchNamesAndIds.add(s.batch.name.toString().trim().toLowerCase());
          if (s.batch._id || s.batch.id) studentBatchNamesAndIds.add(String(s.batch._id || s.batch.id).trim().toLowerCase());
        } else {
          studentBatchNamesAndIds.add(String(s.batch).trim().toLowerCase());
        }
      }
      if (Array.isArray(s.batches)) {
        for (const b of s.batches) {
          if (typeof b === "object" && b !== null) {
            if (b.name) studentBatchNamesAndIds.add(b.name.toString().trim().toLowerCase());
            if (b._id || b.id) studentBatchNamesAndIds.add(String(b._id || b.id).trim().toLowerCase());
          } else if (b) {
            studentBatchNamesAndIds.add(String(b).trim().toLowerCase());
          }
        }
      }
      if (Array.isArray(s.enrolledBatchIds)) {
        for (const enrolledId of s.enrolledBatchIds) {
          if (enrolledId) studentBatchNamesAndIds.add(String(enrolledId).trim().toLowerCase());
        }
      }

      return studentBatchNamesAndIds.has(bIdStr.toLowerCase()) || studentBatchNamesAndIds.has(bNameStr);
    });

    const responseStudents = batchStudents.map((s) => {
      const sObj = s.toObject ? s.toObject() : s;
      const records = sObj.attendanceRecords || [];
      const record = records.find((r) => {
        if (!r.date) return false;
        const rDateKey = getISTDateStr(r.date);
        return rDateKey === targetDateStr;
      });

      return {
        id: sObj._id || sObj.id,
        _id: sObj._id || sObj.id,
        name: sObj.name || "",
        enrollmentNumber: sObj.enrollmentNumber || "",
        phone: sObj.phone || "",
        parentPhone: sObj.parentPhone || "",
        batchName: sObj.batchName || (batchObj ? batchObj.name : ""),
        batch: sObj.batch,
        batches: sObj.batches || [],
        enrolledBatchIds: sObj.enrolledBatchIds || [],
        status: record ? (record.status ? record.status.toLowerCase() : "unmarked") : "unmarked",
      };
    });

    const responsePayload = {
      success: true,
      batchId: bIdStr,
      batchName: batchObj ? batchObj.name : batchId,
      date: targetDateStr,
      totalCount: responseStudents.length,
      students: responseStudents,
    };

    await setCache(cacheKey, responsePayload, 1800);
    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("getBatchAttendanceByDate error:", error);
    return res.status(500).json({ message: "Could not fetch batch attendance data." });
  }
};

export const getBatchAttendanceStatusMap = async (req, res) => {
  try {
    const { batchId, date } = req.query;
    if (!batchId || !date) {
      return res.status(400).json({ message: "Batch ID and date query parameters are required." });
    }

    const targetDateStr = getISTDateStr(date);
    const todayISTStr = getISTDateStr(new Date());
    const isPastDate = targetDateStr < todayISTStr;

    // Strategic Client & Redis Caching
    // Past dates: Immutable cache in Redis (30 days) and HTTP Header max-age=2592000, immutable
    // Today: Dynamic cache in Redis (5 min) and HTTP Header max-age=300
    const cacheKey = `attendance:batch:statusmap:${batchId}:${targetDateStr}`;
    const isRefresh = req.query.refresh === "true" || req.query.nocache === "true" || req.query.skipCache === "true";

    if (isPastDate && !isRefresh) {
      res.setHeader("Cache-Control", "public, max-age=2592000, immutable");
    } else {
      res.setHeader("Cache-Control", "no-cache");
    }

    if (cachedPayload && !isRefresh) {
      return res.status(200).json(cachedPayload);
    }

    const ownerId = req.user.role === "teacher" 
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    // 1. Try fetching single aggregated document from Supabase batch_attendance_records table using compound index (batch_id, date)
    let statusMap = {};
    let summary = { total: 0, present: 0, absent: 0 };
    let foundRecord = false;

    try {
      const { data: dbRec, error: dbErr } = await supabase
        .from("batch_attendance_records")
        .select("attendance_map, total_count, present_count, absent_count")
        .eq("batch_id", String(batchId))
        .eq("date", targetDateStr)
        .maybeSingle();

      if (!dbErr && dbRec && dbRec.attendance_map) {
        statusMap = dbRec.attendance_map;
        summary = {
          total: dbRec.total_count || Object.keys(statusMap).length,
          present: dbRec.present_count || Object.values(statusMap).filter(v => v === "present").length,
          absent: dbRec.absent_count || Object.values(statusMap).filter(v => v === "absent").length,
        };
        foundRecord = true;
      }
    } catch (_) {}

    // 2. Fallback if single document record not created yet: Query batch students & build minimal status map
    if (!foundRecord) {
      let batchObj = null;
      try {
        batchObj = await Batch.findById(batchId);
      } catch (_) {}

      if (!batchObj) {
        batchObj = await Batch.findOne({ user: ownerId, name: { $regex: new RegExp(`^${String(batchId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, "i") } });
      }

      const bIdStr = batchObj ? String(batchObj._id) : String(batchId);
      const bNameStr = batchObj ? batchObj.name.trim().toLowerCase() : String(batchId).trim().toLowerCase();

      const allStudents = await Student.find({ user: ownerId, isArchived: { $ne: true } });
      const batchStudents = allStudents.filter((s) => {
        const set = new Set();
        if (s.batchName) set.add(s.batchName.toString().trim().toLowerCase());
        if (s.batch) set.add((s.batch._id || s.batch).toString().trim().toLowerCase());
        if (Array.isArray(s.batches)) {
          for (const b of s.batches) set.add((b._id || b).toString().trim().toLowerCase());
        }
        return set.has(bIdStr.toLowerCase()) || set.has(bNameStr);
      });

      let presentCount = 0;
      let absentCount = 0;

      for (const s of batchStudents) {
        const sId = String(s._id || s.id);
        const records = s.attendanceRecords || [];
        const record = records.find((r) => r.date && getISTDateStr(r.date) === targetDateStr);
        const st = record ? (record.status ? record.status.toLowerCase() : "unmarked") : "unmarked";
        statusMap[sId] = st;
        if (st === "present") presentCount++;
        else if (st === "absent") absentCount++;
      }

      summary = {
        total: batchStudents.length,
        present: presentCount,
        absent: absentCount,
      };

      // Upsert single document into Supabase batch_attendance_records table asynchronously
      try {
        await supabase.from("batch_attendance_records").upsert({
          batch_id: String(batchId),
          date: targetDateStr,
          attendance_map: statusMap,
          total_count: summary.total,
          present_count: summary.present,
          absent_count: summary.absent,
          updated_at: new Date().toISOString()
        }, { onConflict: "batch_id, date" });
      } catch (_) {}
    }

    const responsePayload = {
      success: true,
      batchId: String(batchId),
      date: targetDateStr,
      statusMap,
      summary,
      isPastDate,
    };

    // Strategic TTL: 30 days for past dates, 300 seconds for today
    const ttlSeconds = isPastDate ? (30 * 24 * 3600) : 300;
    await setCache(cacheKey, responsePayload, ttlSeconds);

    return res.status(200).json(responsePayload);
  } catch (error) {
    console.error("getBatchAttendanceStatusMap error:", error);
    return res.status(500).json({ message: "Could not fetch batch attendance status map." });
  }
};


