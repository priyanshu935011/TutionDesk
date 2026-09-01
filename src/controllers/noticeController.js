import Notice from "../models/Notice.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import Institute from "../models/Institute.js";
import SystemSetting from "../models/SystemSetting.js";
import { sendMessage, getSessionStatus, sendTemplateMessage } from "../services/whatsappService.js";
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
          let studentQuery = { user: instituteId };
          if (targetType === "batch" && Array.isArray(batchIds) && batchIds.length > 0) {
            studentQuery.$or = [
              { batch: { $in: batchIds } },
              { batches: { $in: batchIds } },
              { enrolledBatchIds: { $in: batchIds } }
            ];
          }

          const students = await Student.find(studentQuery);
          if (!students || students.length === 0) return;

          let batchName = "Class";
          if (Array.isArray(batchIds) && batchIds.length > 0) {
            const b = await Batch.findById(batchIds[0]);
            if (b) batchName = b.name;
          }

          let templateName = "";
          let getParameters = (s) => [];
          let fallbackText = "";

          const instName = inst?.name || "Classtech";

          if (noticeType === "general") {
            templateName = "general_announcement";
            getParameters = (s) => [
              (s.parentPhone && s.parentPhone.trim() && s.parentName && s.parentName.trim()) ? s.parentName.trim() : s.name,
              title,
              content || "-",
              instName
            ];
            fallbackText = `📢 *Announcement - ${instName}*\n*${title}*\n${content || ""}\nThank you!`;
          } else if (noticeType === "reschedule" || noticeType === "reschedule") {
            templateName = "class_rescheduled";
            getParameters = (s) => [
              (s.parentPhone && s.parentPhone.trim() && s.parentName && s.parentName.trim()) ? s.parentName.trim() : s.name,
              batchName,
              originalTime || "-",
              rescheduledDate ? formatDate(rescheduledDate) : "-",
              rescheduledTime || "-",
              instName
            ];
            fallbackText = `⏰ *Class Reschedule Alert - ${batchName}*\nTitle: *${title}*\nOriginal Time: *${originalTime || "-"}*\nRescheduled Date: *${formatDate(rescheduledDate)}*\nNew Time: *${rescheduledTime || "-"}*\n${content ? `Note: ${content}\n` : ""}Thank you!`;
          } else if (noticeType === "homework") {
            templateName = "homework_update";
            getParameters = (s) => [
              (s.parentPhone && s.parentPhone.trim() && s.parentName && s.parentName.trim()) ? s.parentName.trim() : "Parent",
              batchName,
              content || "-",
              holidayDate ? formatDate(holidayDate) : "-",
              instName
            ];
            fallbackText = `📝 *Homework Update - ${batchName}*\nSubject: *${batchName}*\nTopic: *${content || "-"}*\nDue Date: *${holidayDate ? formatDate(holidayDate) : "-"}*\nThank you!`;
          } else if (noticeType === "exam") {
            templateName = "exam_announcement";
            getParameters = (s) => [
              (s.parentPhone && s.parentPhone.trim() && s.parentName && s.parentName.trim()) ? s.parentName.trim() : s.name,
              batchName,
              holidayDate ? formatDate(holidayDate) : "-",
              originalTime || "-",
              content || "-",
              instName
            ];
            fallbackText = `📝 *Exam Announcement - ${batchName}*\nSubject: *${batchName}*\nDate: *${holidayDate ? formatDate(holidayDate) : "-"}*\nTime: *${originalTime || "-"}*\nSyllabus: *${content || "-"}*\nThank you!`;
          } else if (noticeType === "holiday") {
            templateName = "holiday_announcement";
            getParameters = (s) => [
              (s.parentPhone && s.parentPhone.trim() && s.parentName && s.parentName.trim()) ? s.parentName.trim() : s.name,
              holidayDate ? formatDate(holidayDate) : "-",
              title,
              rescheduledDate ? formatDate(rescheduledDate) : "-",
              instName
            ];
            fallbackText = `🏖️ *Holiday Announcement - ${instName}*\nTitle: *${title}*\nDate of Holiday: *${formatDate(holidayDate)}*\n${content ? `Details: ${content}\n` : ""}Thank you!`;
          }

          // Individual staggered dispatch with 500ms delay
          for (const s of students) {
            const targetPhone = (s.parentPhone && s.parentPhone.trim()) ? s.parentPhone.trim() : s.phone;
            if (targetPhone) {
              try {
                let sent = false;
                if (templateName) {
                  try {
                    await sendTemplateMessage(String(instituteId), targetPhone, templateName, getParameters(s));
                    sent = true;
                  } catch (tplErr) {
                    console.warn(`Template message failed for ${targetPhone}, trying direct text fallback:`, tplErr.message);
                  }
                }
                if (!sent) {
                  await sendMessage(String(instituteId), targetPhone, fallbackText);
                }
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
    const instituteId = req.user.institute?._id || req.user.institute;
    const ownerId = req.user.role === "teacher"
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    const queryFilter = {
      $or: [
        { user: ownerId },
        { user: instituteId },
        { institute: instituteId }
      ].filter(Boolean)
    };

    const noticeSetting = await SystemSetting.findOne({ key: "notice_global_expiry_settings" });
    const isEnabled = noticeSetting?.value?.enabled !== false;
    const expiryDays = Number(noticeSetting?.value?.globalExpiryDays ?? 7);
    const cutoffTime = (isEnabled && expiryDays > 0) ? Date.now() - (expiryDays * 24 * 60 * 60 * 1000) : 0;

    let notices = await Notice.find(queryFilter).sort({ createdAt: -1 });
    if (cutoffTime > 0) {
      notices = notices.filter((n) => {
        if (!n.createdAt) return true;
        const t = new Date(n.createdAt).getTime();
        return isNaN(t) || t >= cutoffTime;
      });
    }

    return res.json(notices);
  } catch (error) {
    console.error("getNotices error:", error);
    return res.status(500).json({ message: "Could not fetch notices" });
  }
};

export const getStudentNotices = async (req, res) => {
  try {
    const student = req.student || req.user;
    if (!student) {
      return res.status(401).json({ message: "Student not authorized" });
    }
    const instituteId = student.institute?._id || student.institute || student.user;
    const studentBatchId = student.batch?._id || student.batch;

    const studentId = student._id || student.id;
    const cacheKey = `student:notices:${studentId}`;
    const cached = await getCache(cacheKey);
    if (cached && req.query.nocache !== "true") {
      return res.json(cached);
    }

    const noticeSetting = await SystemSetting.findOne({ key: "notice_global_expiry_settings" });
    const isEnabled = noticeSetting?.value?.enabled !== false;
    const expiryDays = Number(noticeSetting?.value?.globalExpiryDays ?? 7);
    const cutoffTime = (isEnabled && expiryDays > 0) ? Date.now() - (expiryDays * 24 * 60 * 60 * 1000) : 0;

    const allNotices = await Notice.find({}).sort({ createdAt: -1 });

    const instIdStr = String(instituteId);
    const batchIdStr = String(studentBatchId || "");

    const relevantNotices = allNotices.filter((n) => {
      const nInst = String(n.institute || n.user || n.institute_id || n.instituteId || "");
      if (nInst !== instIdStr) return false;

      if (cutoffTime > 0 && n.createdAt) {
        const createdTime = new Date(n.createdAt).getTime();
        if (!isNaN(createdTime) && createdTime < cutoffTime) return false;
      }

      if (n.targetType === "all" || !n.targetType) return true;
      if (n.targetType === "batch" && Array.isArray(n.batchIds)) {
        return n.batchIds.some((bId) => String(bId) === batchIdStr);
      }
      return true;
    });

    await setCache(cacheKey, relevantNotices, 86400);
    return res.json(relevantNotices);
  } catch (error) {
    console.error("getStudentNotices error:", error);
    return res.status(500).json({ message: "Could not fetch student notices" });
  }
};

export const deleteNotice = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const ownerId = req.user.role === "teacher"
      ? (req.user.institute?.adminUser || req.user.institute?._id || req.user.institute)
      : (req.user.institute?._id || req.user.institute || req.user._id);

    await Notice.findOneAndDelete({
      _id: req.params.id,
      $or: [
        { user: ownerId },
        { user: instituteId },
        { institute: instituteId }
      ].filter(Boolean)
    });

    await clearCachePattern("teacher:*");
    await clearCachePattern("student:*");

    return res.json({ message: "Notice deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete notice" });
  }
};
