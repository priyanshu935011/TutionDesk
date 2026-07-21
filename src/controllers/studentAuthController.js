import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import { getInitialPassword } from "./studentController.js";
import { sendResetEmail } from "../utils/mailer.js";
import redisClient from "../config/redis.js";

const generateToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

export const studentLogin = async (req, res) => {
  try {
    const { email, password, enrollmentNumber } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const loginIdentifier = email.toLowerCase().trim();
    const students = await Student.find({
      $or: [
        { email: loginIdentifier },
        { phone: loginIdentifier }
      ]
    }).populate(
      "batch",
      "name scheduleDays startTime endTime"
    );

    if (!students || students.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Verify password against matching records
    let matchedStudents = [];
    for (const student of students) {
      let isMatch = false;
      if (student.password) {
        isMatch = await bcrypt.compare(password, student.password);
      } else {
        // Backwards compatibility for legacy accounts
        const legacyPassword = ((name, phone) => {
          const namePart = (name || "").replace(/\s+/g, "").substring(0, 4).toLowerCase();
          const cleanPhone = (phone || "").replace(/\D/g, "");
          const phonePart = cleanPhone.length >= 4 ? cleanPhone.slice(-4) : "1234";
          return namePart + phonePart;
        })(student.name, student.phone);

        if (password === "123456" || password === legacyPassword) {
          isMatch = true;
          student.password = await bcrypt.hash(password, 10);
          await student.save();
        }
      }

      if (isMatch) {
        matchedStudents.push(student);
      }
    }

    if (matchedStudents.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Verify subscription status of at least one institution
    let hasActiveSubscription = false;
    for (const student of matchedStudents) {
      const inst = await Institute.findById(student.user).select(
        "status subscriptionEnd"
      );
      if (inst) {
        const isExpired =
          inst.status !== "active" ||
          new Date(inst.subscriptionEnd).getTime() < Date.now();
        if (!isExpired) {
          hasActiveSubscription = true;
          break;
        }
      }
    }

    if (!hasActiveSubscription) {
      return res.status(403).json({
        message: "Your institute subscription has expired.",
        subscriptionExpired: true,
      });
    }

    // Check if there are multiple unique students (siblings/different kids)
    const uniqueEnrollmentNumbers = [...new Set(matchedStudents.map(s => s.enrollmentNumber))];

    if (uniqueEnrollmentNumbers.length > 1 && !enrollmentNumber) {
      const profilesMap = new Map();
      matchedStudents.forEach(student => {
        if (!profilesMap.has(student.enrollmentNumber)) {
          profilesMap.set(student.enrollmentNumber, {
            name: student.name,
            enrollmentNumber: student.enrollmentNumber,
            email: student.email,
            phone: student.phone
          });
        }
      });
      return res.json({
        requiresProfileSelection: true,
        profiles: Array.from(profilesMap.values())
      });
    }

    let finalMatchedStudents = matchedStudents;
    if (enrollmentNumber) {
      finalMatchedStudents = matchedStudents.filter(s => s.enrollmentNumber === enrollmentNumber);
      if (finalMatchedStudents.length === 0) {
        return res.status(401).json({ message: "Invalid profile selected" });
      }
    }

    const matchedStudent = finalMatchedStudents[0];
    const activeInstitute = await Institute.findById(matchedStudent.user).select("name brandingEnabled logoUrl themeColor");

    const sessionId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 11);

    await Student.updateMany(
      { enrollmentNumber: matchedStudent.enrollmentNumber },
      { currentSessionId: sessionId }
    );

    if (redisClient.isReady) {
      try {
        await redisClient.set(`active_session:student:${matchedStudent.enrollmentNumber}`, sessionId);
      } catch (redisError) {
        console.error("Redis set student active session error:", redisError);
      }
    }

    return res.json({
      token: generateToken({
        id: matchedStudent._id,
        role: "student",
        studentId: matchedStudent._id,
        instituteId: matchedStudent.user,
        email: matchedStudent.email,
        phone: matchedStudent.phone,
        enrollmentNumber: matchedStudent.enrollmentNumber,
        sessionId,
      }),
      student: {
        id: matchedStudent._id,
        name: matchedStudent.name,
        email: matchedStudent.email,
        phone: matchedStudent.phone,
        enrollmentNumber: matchedStudent.enrollmentNumber,
        batch: matchedStudent.batch,
        institute: activeInstitute
          ? {
              id: activeInstitute._id,
              name: activeInstitute.name,
              brandingEnabled: activeInstitute.brandingEnabled !== false,
              logoUrl: activeInstitute.logoUrl || null,
              themeColor: activeInstitute.themeColor || "#6366f1",
            }
          : null,
      },
    });
  } catch (error) {
    return res.status(500).json({ message: "Student login failed" });
  }
};

export const forgotStudentPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const student = await Student.findOne({ email: email.toLowerCase() });
    if (!student) {
      return res.status(404).json({ message: "Student with this email not found" });
    }

    // Generate JWT reset token valid for 30 minutes
    const resetToken = jwt.sign(
      { id: student._id, type: "student_reset", email: student.email },
      process.env.JWT_SECRET,
      { expiresIn: "30m" }
    );

    const clientUrl = process.env.CLIENT_URL || "http://localhost:5173";
    const resetLink = `${clientUrl}/student/reset-password?token=${resetToken}`;

    // Send email helper
    await sendResetEmail(student.email, student.name, resetLink);

    return res.json({ message: "Password reset link has been sent to your email." });
  } catch (error) {
    console.error("Forgot password error:", error);
    return res.status(500).json({ message: "Could not initiate forgot password flow." });
  }
};

export const resetStudentPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: "Token and new password are required." });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      return res.status(400).json({ message: "Reset link has expired or is invalid." });
    }

    if (decoded.type !== "student_reset") {
      return res.status(400).json({ message: "Invalid reset token." });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters long." });
    }

    const student = await Student.findById(decoded.id);
    if (!student) {
      return res.status(404).json({ message: "Student not found." });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    await Student.updateMany(
      { email: student.email.toLowerCase() },
      { password: hashedPassword }
    );

    return res.json({ message: "Password has been reset successfully. You can now log in." });
  } catch (error) {
    console.error("Reset password error:", error);
    return res.status(500).json({ message: "Could not reset password." });
  }
};

export const changeStudentPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "Current and new password are required." });
    }

    const student = req.student; // Set by protectStudent middleware

    let isMatch = false;
    if (student.password) {
      isMatch = await bcrypt.compare(currentPassword, student.password);
    } else {
      // Backwards compatibility
      const initialPassword = getInitialPassword(student.name, student.phone);
      isMatch = (currentPassword === initialPassword);
    }

    if (!isMatch) {
      return res.status(400).json({ message: "Incorrect current password." });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ message: "New password must be at least 6 characters long." });
    }

    student.password = await bcrypt.hash(newPassword, 10);
    await student.save();

    return res.json({ message: "Password updated successfully." });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ message: "Could not change password." });
  }
};

export const switchProfile = async (req, res) => {
  try {
    const { targetEnrollmentNumber } = req.body;
    if (!targetEnrollmentNumber) {
      return res.status(400).json({ message: "Target enrollment number is required" });
    }

    const currentEmail = req.studentEmail; // from protectStudent
    const currentPhone = req.student?.phone;

    // Find all student records matching targetEnrollmentNumber
    const siblingRecords = await Student.find({ enrollmentNumber: targetEnrollmentNumber });
    if (!siblingRecords || siblingRecords.length === 0) {
      return res.status(404).json({ message: "Profile not found" });
    }

    // Verify security: target student MUST share either the email or the phone with the current student
    const firstSibling = siblingRecords[0];
    const sharesContact =
      (currentEmail && currentEmail.trim() !== "" && firstSibling.email && firstSibling.email.toLowerCase().trim() === currentEmail.toLowerCase().trim()) ||
      (currentPhone && currentPhone.trim() !== "" && firstSibling.phone && firstSibling.phone.trim() === currentPhone.trim());

    if (!sharesContact) {
      return res.status(403).json({ message: "Access denied. You can only switch to sibling profiles sharing your contact info." });
    }

    // Verify subscription status of target profile's institution
    const inst = await Institute.findById(firstSibling.user).select("status subscriptionEnd");
    if (!inst || inst.status !== "active" || new Date(inst.subscriptionEnd).getTime() < Date.now()) {
      return res.status(403).json({ message: "The target profile's institute subscription has expired." });
    }

    // Issue new session ID and token
    const sessionId = Date.now().toString() + "_" + Math.random().toString(36).substring(2, 11);
    await Student.updateMany(
      { enrollmentNumber: firstSibling.enrollmentNumber },
      { currentSessionId: sessionId }
    );

    if (redisClient.isReady) {
      try {
        await redisClient.set(`active_session:student:${firstSibling.enrollmentNumber}`, sessionId);
      } catch (redisError) {
        console.error("Redis set student active session error:", redisError);
      }
    }

    return res.json({
      token: generateToken({
        id: firstSibling._id,
        role: "student",
        studentId: firstSibling._id,
        instituteId: firstSibling.user,
        email: firstSibling.email,
        phone: firstSibling.phone,
        enrollmentNumber: firstSibling.enrollmentNumber,
        sessionId,
      }),
      student: {
        id: firstSibling._id,
        name: firstSibling.name,
        email: firstSibling.email,
        phone: firstSibling.phone,
        role: "student",
        enrollmentNumber: firstSibling.enrollmentNumber,
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not switch profile", error: error.message });
  }
};
