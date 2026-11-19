import jwt from "jsonwebtoken";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
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

    if (
      decoded.role !== "student" ||
      (!decoded.email && !decoded.enrollmentNumber && !decoded.phone && !decoded.studentId && !decoded.id)
    ) {
      return res.status(401).json({ message: "Invalid student token" });
    }

    // Fetch all sibling student records for this identity so portal contains all enrolled profiles
    const siblingQueries = [];
    if (decoded.studentId) {
      siblingQueries.push({ _id: decoded.studentId });
    }
    if (decoded.id) {
      siblingQueries.push({ _id: decoded.id });
    }
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

    let students = await Student.find(query)
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

    // Auto-recover/heal: If student row is missing in students table for this user
    if (!students || students.length === 0) {
      if (decoded.id || decoded.phone || decoded.email) {
        try {
          const userDoc = await User.findOne({
            $or: [
              ...(decoded.id ? [{ _id: decoded.id }] : []),
              ...(decoded.phone ? [{ phone: decoded.phone }] : []),
              ...(decoded.email ? [{ email: decoded.email }] : []),
            ],
          });
          if (userDoc && (userDoc.role === "student" || userDoc.student_type === "independent_direct")) {
            const cleanP = (userDoc.phone || decoded.phone || "").replace(/\D/g, "");
            const newStudent = await Student.create({
              user: null,
              name: userDoc.name || decoded.name || "Self-Study Student",
              phone: userDoc.phone || decoded.phone || cleanP,
              email: userDoc.email || decoded.email || `direct_${cleanP}@classtech.selfstudy`,
              parentName: "Parent",
              parentPhone: userDoc.phone || decoded.phone || cleanP,
              parent_name: "Parent",
              parent_phone: userDoc.phone || decoded.phone || cleanP,
              enrollmentNumber: decoded.enrollmentNumber || `STU-D2C-${Date.now().toString().slice(-6)}`,
            });
            if (newStudent) {
              students = [newStudent];
            }
          }
        } catch (recoverErr) {
          console.warn("[protectStudent] Auto-recover student error:", recoverErr.message);
        }
      }
    }

    if (!students || students.length === 0) {
      return res.status(401).json({ message: "Student not found" });
    }

    // Verify student portal is enabled for this institute (if student is attached to an institute)
    if (students[0].user) {
      const inst = await Institute.findById(students[0].user).select("studentPortalEnabled");
      if (inst && inst.studentPortalEnabled === false) {
        return res.status(403).json({ message: "Student portal is disabled for this institute" });
      }
    }

    req.students = students;
    req.studentEmail = decoded.email ? String(decoded.email).toLowerCase().trim() : "";

    // Determine active student context for single-record endpoints
    const targetStudentId =
      req.headers?.["x-student-id"] ||
      req.query?.studentId ||
      req.body?.studentId ||
      decoded.studentId;

    if (targetStudentId) {
      req.student = students.find((s) => String(s._id || s.id) === String(targetStudentId));
    }

    if (!req.student && decoded.enrollmentNumber) {
      req.student = students.find((s) => String(s.enrollmentNumber) === String(decoded.enrollmentNumber));
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

    const isSuperAdminAccess =
      Boolean(decoded?.isSuperAdmin) ||
      decoded?.role === "super_admin" ||
      decoded?.role === "tech_admin" ||
      Boolean(decoded?.superAdminEmail) ||
      req.headers["x-is-super-admin"] === "true" ||
      Boolean(req.headers["x-super-admin-email"]) ||
      Boolean(req.headers["x-impersonated-by-admin"]);

    return next();
  } catch (error) {
    console.error("[protectStudent error]:", error);
    return res.status(401).json({ message: "Invalid token" });
  }
};

export default protectStudent;
