import fs from "fs";
import path from "path";
import Student from "../models/Student.js";
import User from "../models/User.js";
import Institute from "../models/Institute.js";
import Batch from "../models/Batch.js";
import Note from "../models/Note.js";
import Notice from "../models/Notice.js";
import Lead from "../models/Lead.js";
import LeadForm from "../models/LeadForm.js";
import TestResult from "../models/TestResult.js";
import TestSeries from "../models/TestSeries.js";
import TestSeriesAttempt from "../models/TestSeriesAttempt.js";
import VideoLecture from "../models/VideoLecture.js";
import VideoWatchLog from "../models/VideoWatchLog.js";
import Notification from "../models/Notification.js";
import WhatsappLog from "../models/WhatsappLog.js";
import StudentAddress from "../models/StudentAddress.js";
import Order from "../models/Order.js";
import AiUsageLog from "../models/AiUsageLog.js";
import AiHarvestLog from "../models/AiHarvestLog.js";
import StaffAttendance from "../models/StaffAttendance.js";
import ConsentRecord from "../models/ConsentRecord.js";
import DataAccessLog from "../models/DataAccessLog.js";
import DirectRegistration from "../models/DirectRegistration.js";
import cloudinary from "./cloudinary.js";
import { supabase } from "./supabase.js";
import { clearCachePattern, deleteCache } from "./cache.js";
import redisClient from "../config/redis.js";

function extractCloudinaryPublicId(url = "") {
  try {
    if (!url || !url.includes("res.cloudinary.com")) return null;
    const parts = url.split("/upload/");
    if (parts.length < 2) return null;
    let tail = parts[1].replace(/^v\d+\//, "");
    const dotIdx = tail.lastIndexOf(".");
    if (dotIdx !== -1) tail = tail.substring(0, dotIdx);
    return tail;
  } catch (_) {
    return null;
  }
}

function purgeStudentMetadataEntry(studentId) {
  try {
    const dir = process.env.FALLBACK_DIR || path.join(process.cwd(), "scratch", "data");
    const file = path.join(dir, "student_metadata.json");
    if (!fs.existsSync(file)) return;
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    if (raw && typeof raw === "object" && raw[studentId]) {
      delete raw[studentId];
      fs.writeFileSync(file, JSON.stringify(raw, null, 2));
    }
  } catch (_) {}
}

/**
 * DPDP Section 12 / Rule 8 Complete Cascade Erasure for a Student.
 * Removes personal data across primary DB, Supabase tables, academic logs,
 * AI logs, push notifications, WhatsApp logs, addresses, and Cloudinary media,
 * while anonymizing (instead of deleting) paid financial/invoice records only where
 * statutory GST/tax accounting retention applies.
 */
export async function cascadeDeleteStudent({
  studentId,
  studentDoc = null,
  retainTaxLedger = true,
  actorId = "",
  actorRole = "system",
  reason = "student_erasure",
}) {
  const sId = String(studentId || studentDoc?._id || studentDoc?.id || "").trim();
  if (!sId) return { erased: false };

  const student = studentDoc || (await Student.findById(sId).catch(() => null));
  const enrollmentNumber = student?.enrollmentNumber || "";
  const phone = student?.phone || "";
  const parentPhone = student?.parentPhone || "";
  const instituteId = String(student?.user || student?.institute || "");

  // 1. Delete primary student document
  await Student.findByIdAndDelete(sId).catch(() => null);
  purgeStudentMetadataEntry(sId);

  // 2. Delete Supabase attendance & handle Supabase payments (anonymize if paid tax record)
  try {
    await supabase.from("attendance").delete().eq("student_id", sId);
  } catch (_) {}

  try {
    if (retainTaxLedger) {
      await supabase
        .from("payments")
        .update({ note: "[Erased Principal - Statutory Tax Ledger Retained]" })
        .eq("student_id", sId);
    } else {
      await supabase.from("payments").delete().eq("student_id", sId);
    }
  } catch (_) {}

  // 3. Cascade delete academic, video, notification, address, and AI logs
  const deletions = [
    TestResult.deleteMany({ student: sId }).catch(() => {}),
    TestSeriesAttempt.deleteMany({ student: sId }).catch(() => {}),
    VideoWatchLog.deleteMany({ student: sId }).catch(() => {}),
    Notification.deleteMany({ student: sId }).catch(() => {}),
    StudentAddress.deleteMany({ studentId: sId }).catch(() => {}),
    AiUsageLog.deleteMany({ userId: sId }).catch(() => {}),
    AiHarvestLog.deleteMany({ user: sId }).catch(() => {}),
  ];

  // Scrub shipping/student PII on store orders while keeping invoice totals for GST compliance
  deletions.push(
    Order.updateMany(
      { studentId: sId },
      {
        $set: {
          studentName: "[Erased User]",
          studentEmail: "",
          studentPhone: "",
          shippingAddress: { city: "", state: "", pincode: "", line1: "[Erased]" },
        },
      }
    ).catch(() => {})
  );

  // Scrub recipient & message content from WhatsApp logs referencing student's phones
  const phonesToScrub = [phone, parentPhone].map((p) => String(p || "").trim()).filter(Boolean);
  if (phonesToScrub.length > 0) {
    deletions.push(
      WhatsappLog.deleteMany({
        $or: [{ recipient: { $in: phonesToScrub } }, { to: { $in: phonesToScrub } }],
      }).catch(() => {})
    );
  }

  // Delete Cloudinary profile picture if hosted on Cloudinary
  if (student?.profilePicture) {
    const publicId = extractCloudinaryPublicId(student.profilePicture);
    if (publicId) {
      deletions.push(cloudinary.uploader.destroy(publicId).catch(() => {}));
    }
  }

  // Mark existing ConsentRecords as withdrawn/erased
  deletions.push(
    ConsentRecord.updateMany(
      { principalId: sId },
      { $set: { granted: false, withdrawnAt: new Date() } }
    ).catch(() => {})
  );

  await Promise.allSettled(deletions);

  // 4. Clear caches & active sessions
  try {
    if (enrollmentNumber) {
      await deleteCache(`student:dashboard:${enrollmentNumber}`);
      if (redisClient?.isReady) {
        await redisClient.del(`active_session:student:${enrollmentNumber}`);
      }
    }
    await clearCachePattern("teacher:dashboard:*");
    await clearCachePattern("teacher:students:*");
    await clearCachePattern("teacher:batches:*");
  } catch (_) {}

  // 5. Log compliance erasure in DataAccessLog (Rule 6: retained minimum 1 year without student PII)
  await DataAccessLog.create({
    actorId: String(actorId || sId),
    actorRole,
    instituteId,
    action: "cascade_delete_student",
    targetType: "student",
    targetId: sId,
    details: `Reason: ${reason}. RetainTaxLedger=${Boolean(retainTaxLedger)}`,
  }).catch(() => {});

  return { erased: true, studentId: sId };
}

/**
 * DPDP Section 12 Complete Account Erasure for Teachers or Institute Admins.
 */
export async function cascadeDeleteEducatorOrInstitute({
  userId,
  role,
  instituteId = null,
  retainTaxLedger = true,
  reason = "self_service_erasure",
}) {
  const uId = String(userId || "").trim();
  const instId = String(instituteId || "").trim();

  if (role === "teacher" && uId) {
    await User.findByIdAndDelete(uId).catch(() => null);
    await Batch.updateMany({ teacher: uId }, { $set: { teacher: null } }).catch(() => {});
    await StaffAttendance.deleteMany({ teacher: uId }).catch(() => {});
    await AiUsageLog.deleteMany({ userId: uId }).catch(() => {});
    await AiHarvestLog.deleteMany({ user: uId }).catch(() => {});
    await ConsentRecord.updateMany(
      { principalId: uId },
      { $set: { granted: false, withdrawnAt: new Date() } }
    ).catch(() => {});

    if (redisClient?.isReady) {
      await redisClient.del(`active_session:user:${uId}`).catch(() => {});
    }

    await DataAccessLog.create({
      actorId: uId,
      actorRole: role,
      instituteId: instId,
      action: "cascade_delete_teacher",
      targetType: "user",
      targetId: uId,
      details: reason,
    }).catch(() => {});

    return { erased: true, scope: "teacher" };
  }

  // Institute Admin full workspace deletion
  if (instId) {
    const instStudents = await Student.find({
      $or: [{ user: instId }, { institute: instId }],
    }).catch(() => []);

    for (const s of instStudents) {
      await cascadeDeleteStudent({
        studentId: s._id || s.id,
        studentDoc: s,
        retainTaxLedger,
        actorId: uId,
        actorRole: role,
        reason: "institute_erasure",
      });
    }

    await Promise.allSettled([
      Batch.deleteMany({ $or: [{ user: instId }, { institute: instId }] }),
      Note.deleteMany({ $or: [{ user: instId }, { institute: instId }] }),
      Notice.deleteMany({ $or: [{ user: instId }, { institute: instId }] }),
      Lead.deleteMany({ institute: instId }),
      LeadForm.deleteMany({ institute: instId }),
      TestSeries.deleteMany({ institute: instId }),
      VideoLecture.deleteMany({ institute: instId }),
      WhatsappLog.deleteMany({ institute: instId }),
      StaffAttendance.deleteMany({ institute: instId }),
      AiUsageLog.deleteMany({ institute: instId }),
      AiHarvestLog.deleteMany({ instituteId: instId }),
      User.deleteMany({ $or: [{ _id: uId }, { institute: instId }, { parentAdmin: uId }] }),
      DirectRegistration.deleteMany({ $or: [{ _id: instId }, { instituteId: instId }] }),
      Institute.findByIdAndDelete(instId),
    ]);
  } else if (uId) {
    await User.findByIdAndDelete(uId).catch(() => null);
  }

  await ConsentRecord.updateMany(
    { $or: [{ principalId: uId }, { instituteId: instId }] },
    { $set: { granted: false, withdrawnAt: new Date() } }
  ).catch(() => {});

  if (redisClient?.isReady && uId) {
    await redisClient.del(`active_session:user:${uId}`).catch(() => {});
  }

  await DataAccessLog.create({
    actorId: uId,
    actorRole: role || "institute_admin",
    instituteId: instId,
    action: "cascade_delete_institute",
    targetType: "institute",
    targetId: instId || uId,
    details: `${reason} (RetainTaxLedger=${Boolean(retainTaxLedger)})`,
  }).catch(() => {});

  await clearCachePattern("teacher:*").catch(() => {});
  return { erased: true, scope: "institute" };
}
