import jwt from "jsonwebtoken";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import { updateConcurrentPeak } from "../utils/activityTracker.js";
import redisClient from "../config/redis.js";

const protectStudent = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "student" || (!decoded.email && !decoded.enrollmentNumber)) {
      return res.status(401).json({ message: "Invalid student token" });
    }

    // Fetch all sibling student records for this identity so portal contains all enrolled profiles
    const siblingQueries = [];
    if (decoded.email && String(decoded.email).trim() !== "") {
      siblingQueries.push({ email: String(decoded.email).toLowerCase().trim() });
    }
    const phoneStr = decoded.phone ? String(decoded.phone).trim() : "";
    const parentPhoneStr = decoded.parentPhone ? String(decoded.parentPhone).trim() : "";
    const cleanPhone = phoneStr.replace(/\D/g, "");
    const cleanParentPhone = parentPhoneStr.replace(/\D/g, "");

    if (phoneStr !== "") {
      siblingQueries.push({ phone: phoneStr });
      siblingQueries.push({ parentPhone: phoneStr });
    }
    if (cleanPhone.length >= 7) {
      const last10 = cleanPhone.slice(-10);
      siblingQueries.push({ phone: { $regex: last10 + "$", $options: "i" } });
      siblingQueries.push({ parentPhone: { $regex: last10 + "$", $options: "i" } });
    }

    if (parentPhoneStr !== "") {
      siblingQueries.push({ phone: parentPhoneStr });
      siblingQueries.push({ parentPhone: parentPhoneStr });
    }
    if (cleanParentPhone.length >= 7) {
      const last10P = cleanParentPhone.slice(-10);
      siblingQueries.push({ phone: { $regex: last10P + "$", $options: "i" } });
      siblingQueries.push({ parentPhone: { $regex: last10P + "$", $options: "i" } });
    }

    if (decoded.enrollmentNumber) {
      siblingQueries.push({ enrollmentNumber: String(decoded.enrollmentNumber).trim() });
    }

    const query = siblingQueries.length > 0 ? { $or: siblingQueries } : {};

    const students = await Student.find(query)
      .populate({
        path: "batch",
        select: "name scheduleDays startTime endTime teacher",
        populate: {
          path: "teacher",
          select: "name email",
        },
      })
      .populate({
        path: "batches",
        select: "name scheduleDays startTime endTime teacher",
        populate: {
          path: "teacher",
          select: "name email",
        },
      });

    if (!students || students.length === 0) {
      return res.status(401).json({ message: "Student not found" });
    }

    // Verify student portal is enabled for this institute
    const inst = await Institute.findById(students[0].user).select("studentPortalEnabled");
    if (inst && inst.studentPortalEnabled === false) {
      return res.status(403).json({ message: "Student portal is disabled for this institute" });
    }

    if (students[0].lastActiveAt) {
      const fourteenDaysInMs = 14 * 24 * 60 * 60 * 1000;
      if (Date.now() - new Date(students[0].lastActiveAt).getTime() > fourteenDaysInMs) {
        return res.status(401).json({ message: "Session expired due to 14 days of inactivity." });
      }
    }

    req.students = students;
    req.studentEmail = decoded.email.toLowerCase();

    // Determine active student context for single-record endpoints
    // First priority: match student record by decoded JWT token (studentId or enrollmentNumber)
    if (decoded.studentId) {
      req.student = students.find((s) => String(s._id || s.id) === String(decoded.studentId));
    }
    if (!req.student && decoded.enrollmentNumber) {
      req.student = students.find((s) => String(s.enrollmentNumber) === String(decoded.enrollmentNumber));
    }

    // Second priority: override with x-student-id header or param ONLY IF it belongs to the same student enrollment
    const headerOrParamStudentId = req.headers["x-student-id"] || req.query.studentId || req.body.studentId;
    if (headerOrParamStudentId) {
      const matchedParamStudent = students.find((s) => String(s._id || s.id) === String(headerOrParamStudentId));
      if (matchedParamStudent) {
        if (!decoded.enrollmentNumber || String(matchedParamStudent.enrollmentNumber) === String(decoded.enrollmentNumber)) {
          req.student = matchedParamStudent;
        }
      }
    }

    if (!req.student) {
      req.student = students[0]; // fallback to first student record
    }

    // Reorder req.students so active student is ALWAYS first at index 0
    if (req.student) {
      const activeIdx = students.findIndex((s) => String(s._id || s.id) === String(req.student._id || req.student.id));
      if (activeIdx > 0) {
        students.splice(activeIdx, 1);
        students.unshift(req.student);
      }
    }

    next();
    
    if (req.student && req.student.enrollmentNumber) {
      Student.updateMany({ enrollmentNumber: req.student.enrollmentNumber }, { lastActiveAt: new Date() }).catch(() => {});
      if (redisClient.isReady) {
        redisClient.set(`active:user:${req.student.enrollmentNumber}`, "student", { EX: 300 }).catch(() => {});
      }
    } else if (req.student && req.student._id) {
      Student.updateOne({ _id: req.student._id }, { lastActiveAt: new Date() }).catch(() => {});
      if (redisClient.isReady) {
        redisClient.set(`active:user:${req.student._id}`, "student", { EX: 300 }).catch(() => {});
      }
    }
    updateConcurrentPeak().catch(() => {});
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
};

export default protectStudent;
