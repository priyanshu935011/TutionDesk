import express from "express";
import Student from "../models/Student.js";
import Institute from "../models/Institute.js";
import { sendMessage } from "../services/whatsappService.js";

const router = express.Router();

router.post("/fee-reminders", async (req, res) => {
  const token = req.headers["x-cron-token"];
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const students = await Student.find({});
    let sentCount = 0;
    let failCount = 0;

    const instituteMap = new Map();
    for (const student of students) {
      const instId = String(student.user);
      if (!instituteMap.has(instId)) {
        instituteMap.set(instId, []);
      }
      instituteMap.get(instId).push(student);
    }

    for (const [instId, instStudents] of instituteMap.entries()) {
      const inst = await Institute.findById(instId);
      if (!inst || !inst.whatsappSettings?.feeRemindersEnabled) {
        continue;
      }

      const daysBefore = inst.whatsappSettings?.feeReminderDaysBefore ?? 3;
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      for (const student of instStudents) {
        const paid = (student.paymentHistory || []).reduce((sum, p) => sum + p.amount, 0);
        const pending = student.totalFees - paid;

        const targetPhone = (student.parentPhone && student.parentPhone.trim()) ? student.parentPhone.trim() : student.phone;

        if (pending > 0 && targetPhone) {
          if (student.dueDate) {
            const due = new Date(student.dueDate);
            due.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays > daysBefore) {
              continue; // Not yet due within the reminder window
            }
          }

          const template = inst.whatsappSettings?.feeReminderTemplate || "Dear {parentName}, this is a friendly reminder that INR {pendingAmount} is outstanding for student {studentName}'s tuition fee. Due date: {dueDate}. Thank you!";
          const formattedDueDate = student.dueDate ? new Date(student.dueDate).toLocaleDateString("en-IN") : "-";
          const text = template
            .replace(/\{studentName\}/g, student.name || "")
            .replace(/\{parentName\}/g, student.parentName || "Parent")
            .replace(/\{pendingAmount\}/g, String(pending))
            .replace(/\{dueDate\}/g, formattedDueDate)
            .replace(/\{instituteName\}/g, inst.name || "TuitionDesk");

          try {
            await sendMessage(instId, targetPhone, text);
            sentCount++;
            await new Promise((r) => setTimeout(r, 500));
          } catch (err) {
            console.error(`Cron fee reminder fail for student ${student._id}:`, err.message);
            failCount++;
          }
        }
      }
    }

    return res.json({ message: "Automated fee reminders cron run finished.", sent: sentCount, failed: failCount });
  } catch (error) {
    console.error("Cron fee reminders error:", error);
    return res.status(500).json({ message: "Cron execution failed" });
  }
});

export default router;
