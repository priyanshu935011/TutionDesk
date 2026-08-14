import express from "express";
import Student from "../models/Student.js";
import Institute from "../models/Institute.js";
import { sendMessage } from "../services/whatsappService.js";
import { getGlobalTemplates, formatFeeReminderMessage } from "../utils/whatsappTemplateHelper.js";
import { cronVerifyPendingRecharges } from "../controllers/paymentController.js";

const router = express.Router();

router.post("/pending-recharges", cronVerifyPendingRecharges);

router.post("/fee-reminders", async (req, res) => {
  const token = req.headers["x-cron-token"];
  if (process.env.CRON_SECRET && token !== process.env.CRON_SECRET) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const globalTemplates = await getGlobalTemplates();
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

          const formattedDueDate = student.dueDate ? new Date(student.dueDate).toLocaleDateString("en-IN") : "-";
          const text = formatFeeReminderMessage({
            template: globalTemplates.feeReminder,
            studentName: student.name || "",
            parentName: student.parentName || "Parent",
            pendingAmount: String(pending),
            dueDate: formattedDueDate,
            instituteName: inst.name || "Classtech",
          });

          try {
            const result = await sendMessage(instId, targetPhone, text, "fee_reminder", {
              templateName: "fee_reminder",
              parameters: [
                student.parentName || "Parent",
                String(pending),
                student.name || "",
                inst.name || "Classtech",
                formattedDueDate
              ]
            });
            if (result && result.success) {
              sentCount++;
            } else {
              console.warn(`Cron fee reminder skipped for student ${student._id}: ${result?.message || "unknown"}`);
              failCount++;
            }
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
