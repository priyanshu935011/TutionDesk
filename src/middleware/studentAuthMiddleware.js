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

    if (decoded.role !== "student" || !decoded.email) {
      return res.status(401).json({ message: "Invalid student token" });
    }

    // Fetch all student records for this email
    const students = await Student.find({
      email: decoded.email.toLowerCase(),
    }).populate({
      path: "batch",
      select: "name scheduleDays startTime endTime teacher",
      populate: {
        path: "teacher",
        select: "name email",
      },
    });

    if (!students || students.length === 0) {
      return res.status(401).json({ message: "Student not found" });
    }

    if (decoded.sessionId) {
      let sessionValid = true;
      const cacheSessionKey = `active_session:student:${decoded.email.toLowerCase()}`;
      if (redisClient.isReady) {
        try {
          let activeSessionId = await redisClient.get(cacheSessionKey);
          if (!activeSessionId) {
            activeSessionId = students[0].currentSessionId;
            if (activeSessionId) {
              await redisClient.set(cacheSessionKey, activeSessionId);
            }
          }
          if (activeSessionId && activeSessionId !== decoded.sessionId) {
            sessionValid = false;
          }
        } catch (redisErr) {
          console.error("Redis student session lookup error:", redisErr);
        }
      } else {
        if (students[0].currentSessionId && students[0].currentSessionId !== decoded.sessionId) {
          sessionValid = false;
        }
      }

      if (!sessionValid) {
        return res.status(401).json({ message: "Session expired due to login on another device." });
      }
    }

    req.students = students;
    req.studentEmail = decoded.email.toLowerCase();

    // Determine active student context for single-record endpoints
    const targetStudentId =
      req.headers["x-student-id"] ||
      req.query.studentId ||
      req.body.studentId ||
      decoded.studentId;

    if (targetStudentId) {
      req.student = students.find((s) => String(s._id) === String(targetStudentId));
    }

    if (!req.student) {
      req.student = students[0]; // fallback to first student record
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
