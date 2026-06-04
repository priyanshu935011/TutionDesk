import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import { getInitialPassword } from "./studentController.js";
import { sendResetEmail } from "../utils/mailer.js";

const generateToken = (payload) =>
  jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "7d" });

export const studentLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const students = await Student.find({ email: email.toLowerCase() }).populate(
      "batch",
      "name scheduleDays startTime endTime"
    );

    if (!students || students.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Verify subscription status of at least one institution
    let hasActiveSubscription = false;
    for (const student of students) {
      const inst = await Institute.findOne({ adminUser: student.user }).select(
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

    // Verify password against matching records
    let matchedStudent = null;
    for (const student of students) {
      let isMatch = false;
      if (student.password) {
        isMatch = await bcrypt.compare(password, student.password);
      } else {
        // Backwards compatibility for legacy accounts
        const initialPassword = getInitialPassword(student.name, student.phone);
        if (password === initialPassword) {
          isMatch = true;
          student.password = await bcrypt.hash(initialPassword, 10);
          await student.save();
        }
      }

      if (isMatch) {
        matchedStudent = student;
        break;
      }
    }

    if (!matchedStudent) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const activeInstitute = await Institute.findOne({ adminUser: matchedStudent.user }).select("name");

    return res.json({
      token: generateToken({
        id: matchedStudent._id,
        role: "student",
        studentId: matchedStudent._id,
        instituteId: matchedStudent.user,
        email: matchedStudent.email,
      }),
      student: {
        id: matchedStudent._id,
        name: matchedStudent.name,
        email: matchedStudent.email,
        enrollmentNumber: matchedStudent.enrollmentNumber,
        batch: matchedStudent.batch,
        institute: activeInstitute
          ? {
              id: activeInstitute._id,
              name: activeInstitute.name,
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

    // Generate JWT reset token valid for 1 hour
    const resetToken = jwt.sign(
      { id: student._id, type: "student_reset", email: student.email },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
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

    student.password = await bcrypt.hash(password, 10);
    await student.save();

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
