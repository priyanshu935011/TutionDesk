import Notice from "../models/Notice.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Institute from "../models/Institute.js";
import { sendMessage, getSessionStatus } from "../services/whatsappService.js";
import { getCache, setCache, clearCachePattern } from "../utils/cache.js";

const formatDate = (val) => (val ? new Date(val).toLocaleDateString("en-IN") : "-");

export const createNotice = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with account." });
    }

    const inst = await Institute.findById(instituteId);
    const allowedFeatures = inst?.allowedFeatures || ["attendance", "whatsapp", "quizzes", "notices"];
    if (!allowedFeatures.includes("notices")) {
      return res.status(403).json({ message: "Notice Board feature is disabled for your institute by Super Admin." });
    }

    const {
      title,
      content,
      noticeType = "general",
      targetType = "all",
      batchIds = [],
      holidayDate,
      originalTime,
      rescheduledDate,
      rescheduledTime,
      sendWhatsApp = false,
    } = req.body;

    if (!title) {
      return res.status(400).json({ message: "Notice title is required" });
    }

    const notice = await Notice.create({
      user: instituteId,
      institute: instituteId,
      title,
      content: content || "",
      noticeType,
      targetType,
      batchIds: Array.isArray(batchIds) ? batchIds : [],
      holidayDate: holidayDate || null,
      originalTime: originalTime || "",
      rescheduledDate: rescheduledDate || null,
      rescheduledTime: rescheduledTime || "",
      sendWhatsApp: Boolean(sendWhatsApp),
      createdBy: req.user._id,
    });

    // Invalidate L1 Cache
    await clearCachePattern("teacher:*");
    await clearCachePattern("student:*");

    // Asynchronous background WhatsApp broadcast
    if (sendWhatsApp) {
      setImmediate(async () => {
        try {
          const statusObj = getSessionStatus(String(instituteId));
          if (statusObj.status !== "connected") {
            console.warn(`WhatsApp not connected for institute ${instituteId}. Skipping notice broadcast.`);
            return;
          }

          let studentQuery = { user: instituteId };
          if (targetType === "batch" && Array.isArray(batchIds) && batchIds.length > 0) {
            studentQuery.batch = { $in: batchIds };
          }

          const students = await Student.find(studentQuery);
          if (!students || students.length === 0) return;

          let batchName = "Class";
          if (Array.isArray(batchIds) && batchIds.length > 0) {
            const b = await Batch.findById(batchIds[0]);
            if (b) batchName = b.name;
          }

          let whatsappText = "";
          if (noticeType === "holiday") {
            whatsappText = `🏖️ *Holiday Announcement - ${inst?.name || "TuitionDesk"}*\nTitle: *${title}*\nDate of Holiday: *${formatDate(holidayDate)}*\n${content ? `Details: ${content}\n` : ""}Thank you!`;
          } else if (noticeType === "reschedule") {
            whatsappText = `⏰ *Class Reschedule Alert - ${batchName}*\nTitle: *${title}*\nOriginal Time: *${originalTime || "-"}*\nRescheduled Date: *${formatDate(rescheduledDate)}*\nNew Time: *${rescheduledTime || "-"}*\n${content ? `Note: ${content}\n` : ""}Thank you!`;
          } else {
            whatsappText = `📢 *Announcement - ${inst?.name || "TuitionDesk"}*\n*${title}*\n${content || ""}\nThank you!`;
          }

          // Individual staggered dispatch with 500ms delay
          for (const s of students) {
            const targetPhone = (s.parentPhone && s.parentPhone.trim()) ? s.parentPhone.trim() : s.phone;
            if (targetPhone) {
              try {
                await sendMessage(String(instituteId), targetPhone, whatsappText);
                await new Promise((r) => setTimeout(r, 500));
              } catch (err) {
                console.error(`Notice WhatsApp broadcast failed for student ${s._id}:`, err.message);
              }
            }
          }
        } catch (bgErr) {
          console.error("Background WhatsApp notice broadcast error:", bgErr);
        }
      });
    }

    return res.status(201).json({ message: "Notice created successfully", notice });
  } catch (error) {
    console.error("Create notice error:", error);
    return res.status(500).json({ message: "Could not create notice" });
  }
};

export const getNotices = async (req, res) => {
  try {
    const ownerId = req.user.role === "teacher"
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const cacheKey = `teacher:notices:${ownerId}`;
    const cached = await getCache(cacheKey);
    if (cached && req.query.nocache !== "true") {
      return res.json(cached);
    }

    const notices = await Notice.find({ user: ownerId }).sort({ createdAt: -1 });
    await setCache(cacheKey, notices, 86400);

    return res.json(notices);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch notices" });
  }
};

export const getStudentNotices = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const studentBatchId = req.user.batch?._id || req.user.batch;

    const cacheKey = `student:notices:${req.user._id}`;
    const cached = await getCache(cacheKey);
    if (cached && req.query.nocache !== "true") {
      return res.json(cached);
    }

    const allNotices = await Notice.find({ user: instituteId }).sort({ createdAt: -1 });

    // Filter relevant notices for student
    const relevantNotices = allNotices.filter((n) => {
      if (n.targetType === "all" || !n.targetType) return true;
      if (n.targetType === "batch" && Array.isArray(n.batchIds)) {
        return n.batchIds.some((bId) => String(bId) === String(studentBatchId));
      }
      return true;
    });

    await setCache(cacheKey, relevantNotices, 86400);
    return res.json(relevantNotices);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch student notices" });
  }
};

export const deleteNotice = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    await Notice.findOneAndDelete({ _id: req.params.id, user: instituteId });

    await clearCachePattern("teacher:*");
    await clearCachePattern("student:*");

    return res.json({ message: "Notice deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete notice" });
  }
};
