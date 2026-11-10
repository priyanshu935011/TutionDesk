import Student from "../models/Student.js";
import Lead from "../models/Lead.js";
import AiHarvestLog from "../models/AiHarvestLog.js";
import SystemLog from "../models/SystemLog.js";
import DataAccessLog from "../models/DataAccessLog.js";
import DpdpRetentionNotice from "../models/DpdpRetentionNotice.js";
import { DATA_RETENTION_POLICY } from "../utils/dpdpConfig.js";
import { cascadeDeleteStudent } from "../utils/cascadeErasure.js";
import { sendMessage } from "./whatsappService.js";
import { maskPhone } from "../utils/piiSanitizer.js";

/**
 * DPDP Rule 8 Data Retention & Automated Erasure Scheduler
 * - Retains DataAccessLog for >= 365 days (Rule 6 mandatory 1-year minimum)
 * - Purges raw AI prompt harvest logs older than 90 days
 * - Sends mandatory 48-hour pre-erasure warning notice prior to deleting
 *   archived/inactive student records or stale leads, then purges once due.
 */
export async function runDpdpRetentionSweep() {
  const now = Date.now();
  const report = {
    aiHarvestPurged: 0,
    systemLogsPurged: 0,
    accessLogsPurgedAfter1Yr: 0,
    leadsDeleted: 0,
    noticesIssued48h: 0,
    scheduledStudentsErased: 0,
  };

  try {
    // 1. Purge raw AI Harvest prompt logs older than 90 days (data minimization)
    const aiCutoff = new Date(
      now - DATA_RETENTION_POLICY.aiHarvestPromptMaxDays * 24 * 60 * 60 * 1000
    );
    const aiRes = await AiHarvestLog.deleteMany({ createdAt: { $lt: aiCutoff } }).catch(() => null);
    report.aiHarvestPurged = aiRes?.deletedCount || 0;

    // 2. Purge stale Leads older than 180 days that were never converted
    const leadCutoff = new Date(
      now - DATA_RETENTION_POLICY.inactiveLeadMaxDays * 24 * 60 * 60 * 1000
    );
    const leadRes = await Lead.deleteMany({
      createdAt: { $lt: leadCutoff },
      status: { $nin: ["converted", "enrolled"] },
    }).catch(() => null);
    report.leadsDeleted = leadRes?.deletedCount || 0;

    // 3. Enforce Rule 6: Retain SystemLog & DataAccessLog at least 365 days; delete only older than 366 days
    const logCutoff = new Date(
      now - (DATA_RETENTION_POLICY.securityAccessLogsMinDays + 1) * 24 * 60 * 60 * 1000
    );
    const sysRes = await SystemLog.deleteMany({ createdAt: { $lt: logCutoff } }).catch(() => null);
    const accRes = await DataAccessLog.deleteMany({ createdAt: { $lt: logCutoff } }).catch(() => null);
    report.systemLogsPurged = sysRes?.deletedCount || 0;
    report.accessLogsPurgedAfter1Yr = accRes?.deletedCount || 0;

    // 4. Execute scheduled student erasures whose 48-hour notice window has elapsed
    const dueNotices = await DpdpRetentionNotice.find({
      status: "notified",
      targetType: "student",
      scheduledErasureAt: { $lte: new Date(now) },
    }).catch(() => []);

    for (const notice of dueNotices || []) {
      const targetStudent = await Student.findById(notice.targetId).catch(() => null);
      if (!targetStudent) {
        notice.status = "executed";
        notice.executedAt = new Date();
        await notice.save().catch(() => {});
        continue;
      }

      // Cancel automatic erasure if user became active again recently
      const lastAct = targetStudent.lastActiveAt ? new Date(targetStudent.lastActiveAt).getTime() : 0;
      if (lastAct > new Date(notice.noticeSentAt).getTime()) {
        notice.status = "cancelled";
        await notice.save().catch(() => {});
        continue;
      }

      await cascadeDeleteStudent({
        studentId: notice.targetId,
        studentDoc: targetStudent,
        retainTaxLedger: true,
        actorRole: "dpdp_retention_cron",
        reason: notice.reason || "rule_8_retention_expiry",
      });
      notice.status = "executed";
      notice.executedAt = new Date();
      await notice.save().catch(() => {});
      report.scheduledStudentsErased += 1;
    }

    // 5. Issue 48-hour advance deletion notice for long-archived (>365d) or 3-year inactive students
    const archivedCutoff = now - DATA_RETENTION_POLICY.archivedStudentMaxDays * 24 * 60 * 60 * 1000;
    const inactiveCutoff = now - DATA_RETENTION_POLICY.inactiveAccountMaxDays * 24 * 60 * 60 * 1000;
    const students = await Student.find({}).catch(() => []);

    for (const st of students || []) {
      const sId = String(st._id || st.id || "");
      if (!sId) continue;

      const updatedAtMs = st.updatedAt ? new Date(st.updatedAt).getTime() : 0;
      const lastActiveMs = st.lastActiveAt ? new Date(st.lastActiveAt).getTime() : updatedAtMs;

      const isLongArchived = st.isArchived === true && updatedAtMs > 0 && updatedAtMs < archivedCutoff;
      const is3YrInactive = lastActiveMs > 0 && lastActiveMs < inactiveCutoff;

      if (!isLongArchived && !is3YrInactive) continue;

      const existingNotice = await DpdpRetentionNotice.findOne({
        targetType: "student",
        targetId: sId,
        status: "notified",
      }).catch(() => null);
      if (existingNotice) continue;

      const scheduledAt = new Date(
        now + DATA_RETENTION_POLICY.inactiveAccountNoticeAdvanceHours * 60 * 60 * 1000
      );
      const notifyPhone = (st.parentPhone || st.phone || "").trim();

      if (notifyPhone && st.whatsappConsentGranted !== false) {
        const msg = `Notice under DPDP Rules (Rule 8): Your student profile (${st.enrollmentNumber || "Account"}) has been inactive/archived past our retention period. Unless you log in within the next 48 hours, personal data will be erased/anonymized on ${scheduledAt.toLocaleDateString("en-IN")}.`;
        sendMessage(String(st.user || ""), notifyPhone, msg, "custom").catch(() => {});
      }

      await DpdpRetentionNotice.create({
        targetType: "student",
        targetId: sId,
        instituteId: String(st.user || ""),
        reason: isLongArchived ? "archived_past_retention" : "inactive_3_years",
        contactMasked: maskPhone(notifyPhone),
        noticeSentAt: new Date(now),
        scheduledErasureAt: scheduledAt,
        status: "notified",
      }).catch(() => {});

      report.noticesIssued48h += 1;
    }
  } catch (err) {
    console.error("[DPDP Retention Sweep Error]:", err.message);
  }

  return report;
}

let retentionTimer = null;
export function startDpdpRetentionScheduler() {
  if (retentionTimer) return;
  // Run once 2 minutes after boot, then once every 24 hours
  const initialDelay = setTimeout(() => {
    runDpdpRetentionSweep().catch(() => {});
  }, 120 * 1000);
  if (initialDelay.unref) initialDelay.unref();

  retentionTimer = setInterval(() => {
    runDpdpRetentionSweep().catch(() => {});
  }, 24 * 60 * 60 * 1000);
  if (retentionTimer.unref) retentionTimer.unref();
}
