import express from "express";
import protect from "../middleware/authMiddleware.js";
import Institute from "../models/Institute.js";
import { getSessionStatus, initializeSession, logoutSession, sendMessage } from "../services/whatsappService.js";
import { getCache, setCache, clearCachePattern } from "../utils/cache.js";

const router = express.Router();

router.use(protect);

router.get("/status", async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }
    const statusObj = getSessionStatus(String(instituteId));

    let settings = await getCache(`institute:whatsapp_settings:${instituteId}`);
    if (!settings) {
      const inst = await Institute.findById(instituteId);
      settings = inst?.whatsappSettings || {
        absentAlertsEnabled: false,
        feeRemindersEnabled: false,
        feeReminderDaysBefore: 3,
        customMessageTemplate: "Dear Parent, your child {studentName} was marked absent on {date}.",
        feeReminderTemplate: "Dear {parentName}, this is a friendly reminder that INR {pendingAmount} is outstanding for student {studentName}'s tuition fee. Due date: {dueDate}. Thank you!",
      };
    }

    return res.json({
      ...statusObj,
      settings,
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch WhatsApp status" });
  }
});

router.post("/initialize", async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }
    const status = await initializeSession(String(instituteId));
    return res.json(status);
  } catch (error) {
    console.error("WhatsApp initialization error:", error);
    return res.status(500).json({ message: "Could not initialize WhatsApp" });
  }
});

router.post("/logout", async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }
    await logoutSession(String(instituteId));
    return res.json({ message: "WhatsApp logged out successfully." });
  } catch (error) {
    return res.status(500).json({ message: "Could not logout WhatsApp session" });
  }
});

router.post("/settings", async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }
    const { absentAlertsEnabled, feeRemindersEnabled, feeReminderDaysBefore, customMessageTemplate, feeReminderTemplate } = req.body;
    const inst = await Institute.findById(instituteId);
    if (!inst) {
      return res.status(404).json({ message: "Institute not found." });
    }

    const updatedSettings = {
      absentAlertsEnabled: typeof absentAlertsEnabled === "boolean" ? absentAlertsEnabled : Boolean(inst.whatsappSettings?.absentAlertsEnabled),
      feeRemindersEnabled: typeof feeRemindersEnabled === "boolean" ? feeRemindersEnabled : Boolean(inst.whatsappSettings?.feeRemindersEnabled),
      feeReminderDaysBefore: feeReminderDaysBefore !== undefined ? Number(feeReminderDaysBefore) : Number(inst.whatsappSettings?.feeReminderDaysBefore ?? 3),
      customMessageTemplate: customMessageTemplate !== undefined ? String(customMessageTemplate) : (inst.whatsappSettings?.customMessageTemplate || ""),
      feeReminderTemplate: feeReminderTemplate !== undefined ? String(feeReminderTemplate) : (inst.whatsappSettings?.feeReminderTemplate || "Dear {parentName}, this is a friendly reminder that INR {pendingAmount} is outstanding for student {studentName}'s tuition fee. Due date: {dueDate}. Thank you!"),
    };

    inst.whatsappSettings = updatedSettings;

    try {
      await inst.save();
    } catch (saveErr) {
      console.warn("Institute DB save warning:", saveErr);
    }

    try {
      await setCache(`institute:whatsapp_settings:${instituteId}`, updatedSettings, 315360000);
      await clearCachePattern("teacher:dashboard:*");
      await clearCachePattern("student:dashboard:*");
    } catch (cacheErr) {
      console.error("Cache update error in whatsapp settings:", cacheErr);
    }

    return res.json({ message: "WhatsApp configuration saved successfully.", settings: updatedSettings });
  } catch (error) {
    console.error("Save WhatsApp settings error:", error);
    return res.status(500).json({ message: error?.message || "Could not save settings." });
  }
});

router.post("/test", async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }
    const { phone, text } = req.body;
    if (!phone || !text) {
      return res.status(400).json({ message: "Phone and text are required." });
    }
    await sendMessage(String(instituteId), phone, text);
    return res.json({ message: "Test message sent successfully." });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Failed to send test message." });
  }
});

export default router;
