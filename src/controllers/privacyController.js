import Student from "../models/Student.js";
import User from "../models/User.js";
import Institute from "../models/Institute.js";
import ConsentRecord from "../models/ConsentRecord.js";
import GrievanceTicket from "../models/GrievanceTicket.js";
import DataAccessLog from "../models/DataAccessLog.js";
import TestResult from "../models/TestResult.js";
import TestSeriesAttempt from "../models/TestSeriesAttempt.js";
import WhatsappLog from "../models/WhatsappLog.js";
import AiUsageLog from "../models/AiUsageLog.js";
import { verifyJwtToken } from "../utils/jwtHelper.js";
import {
  buildDpdpNotice,
  DATA_RETENTION_POLICY,
  DPDP_NOTICE_VERSION,
  GRIEVANCE_OFFICER,
  SUB_PROCESSORS,
} from "../utils/dpdpConfig.js";
import {
  cascadeDeleteEducatorOrInstitute,
  cascadeDeleteStudent,
} from "../utils/cascadeErasure.js";
import { runDpdpRetentionSweep } from "../services/dpdpRetentionService.js";
import { maskIp } from "../utils/piiSanitizer.js";

/**
 * Middleware: accepts valid User (teacher/admin/super_admin) OR Student JWT strictly via verifyJwtToken.
 */
export const protectAnyPrincipal = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Not authorized" });
  }

  try {
    const token = authHeader.substring(7).trim();
    const decoded = verifyJwtToken(token);
    if (!decoded || typeof decoded !== "object") {
      return res.status(401).json({ message: "Invalid token" });
    }

    if (decoded.role === "super_admin" || decoded.id === "super-admin") {
      req.principal = {
        type: "super_admin",
        id: "super-admin",
        role: "super_admin",
        name: "Super Admin",
        email: decoded.email || "",
        phone: "",
        instituteId: "",
      };
      return next();
    }

    if (decoded.role === "student" || decoded.studentId) {
      const targetStudentId =
        req.headers["x-student-id"] ||
        req.query?.studentId ||
        req.body?.studentId ||
        decoded.studentId ||
        decoded.id;

      let student = null;
      if (targetStudentId) {
        student = await Student.findById(targetStudentId).catch(() => null);
      }
      if (!student && decoded.enrollmentNumber) {
        student = await Student.findOne({
          enrollmentNumber: String(decoded.enrollmentNumber).trim(),
        }).catch(() => null);
      }
      if (!student) {
        return res.status(404).json({ message: "Student account not found" });
      }

      req.principal = {
        type: "student",
        id: String(student._id || student.id),
        role: "student",
        name: student.name || "Student",
        email: student.email || "",
        phone: student.phone || "",
        parentName: student.parentName || "",
        parentPhone: student.parentPhone || "",
        instituteId: String(student.user || student.institute || ""),
        doc: student,
      };
      return next();
    }

    const userId = decoded.id || decoded._id || decoded.userId || decoded.sub;
    const user =
      (userId ? await User.findById(userId).select("-password").catch(() => null) : null) ||
      (decoded.email
        ? await User.findOne({ email: String(decoded.email).toLowerCase().trim() })
            .select("-password")
            .catch(() => null)
        : null);

    if (!user) {
      return res.status(404).json({ message: "User account not found" });
    }

    const instId = String(
      user.institute?._id || user.institute?.id || user.institute || ""
    ).trim();
    const institute = instId ? await Institute.findById(instId).catch(() => null) : null;

    req.principal = {
      type: "user",
      id: String(user._id || user.id),
      role: user.role || "teacher",
      name: user.name || "",
      email: user.email || "",
      phone: user.phone || "",
      instituteId: instId,
      doc: user,
      instituteDoc: institute,
    };
    return next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired session token" });
  }
};

export const getPublicDpdpNotice = (req, res) => {
  const lang = String(req.query?.lang || "en").toLowerCase().trim() === "hi" ? "hi" : "en";
  return res.json(buildDpdpNotice(lang));
};

export const getPrivacyOverview = async (req, res) => {
  try {
    const p = req.principal;
    const records = await ConsentRecord.find({ principalId: p.id })
      .sort({ createdAt: -1 })
      .catch(() => []);

    const latestByPurpose = {};
    for (const r of records || []) {
      if (!latestByPurpose[r.purpose]) {
        latestByPurpose[r.purpose] = {
          purpose: r.purpose,
          granted: Boolean(r.granted),
          noticeVersion: r.noticeVersion || DPDP_NOTICE_VERSION,
          method: r.method || "",
          grantedAt: r.grantedAt || r.createdAt,
          withdrawnAt: r.withdrawnAt || null,
        };
      }
    }

    const grievances = await GrievanceTicket.find({ principalId: p.id })
      .sort({ createdAt: -1 })
      .catch(() => []);

    const instituteB2bDpa = p.instituteDoc
      ? {
          instituteName: p.instituteDoc.name || "",
          dpaAccepted: Boolean(p.instituteDoc.dpaAccepted),
          dpaAcceptedAt: p.instituteDoc.dpaAcceptedAt || null,
          dpaVersion: p.instituteDoc.dpaVersion || DPDP_NOTICE_VERSION,
        }
      : null;

    const defaults = {
      core_service: latestByPurpose.core_service?.granted ?? true,
      whatsapp_alerts: latestByPurpose.whatsapp_alerts?.granted ?? true,
      analytics_telemetry:
        p.type === "student"
          ? false
          : latestByPurpose.analytics_telemetry?.granted ?? false,
      b2b_dpa: instituteB2bDpa?.dpaAccepted ?? latestByPurpose.b2b_dpa?.granted ?? false,
    };

    return res.json({
      principal: {
        type: p.type,
        id: p.id,
        role: p.role,
        name: p.name,
        email: p.email,
        phone: p.phone,
        instituteId: p.instituteId,
      },
      consents: defaults,
      consentHistory: Object.values(latestByPurpose),
      instituteB2bDpa,
      grievances: (grievances || []).map((g) => ({
        id: String(g._id || g.id),
        ticketNumber: g.ticketNumber,
        category: g.category,
        subject: g.subject,
        description: g.description,
        status: g.status,
        resolutionNotes: g.resolutionNotes || "",
        slaDeadline: g.slaDeadline,
        createdAt: g.createdAt,
        resolvedAt: g.resolvedAt || null,
      })),
      grievanceOfficer: GRIEVANCE_OFFICER,
      retentionPolicy: DATA_RETENTION_POLICY,
      subProcessors: SUB_PROCESSORS,
      noticeVersion: DPDP_NOTICE_VERSION,
    });
  } catch (err) {
    console.error("getPrivacyOverview error:", err);
    return res.status(500).json({ message: "Could not load privacy settings." });
  }
};

export const updateConsents = async (req, res) => {
  try {
    const p = req.principal;
    const { purpose, granted, language = "en" } = req.body;
    const allowedPurposes = [
      "whatsapp_alerts",
      "analytics_telemetry",
      "b2b_dpa",
    ];
    if (!allowedPurposes.includes(purpose) || typeof granted !== "boolean") {
      return res.status(400).json({
        message: "Valid consent purpose and boolean granted value are required.",
      });
    }

    // DPDP Section 9(3): Prevent enabling behavioral analytics/telemetry for minor students
    if (p.type === "student" && purpose === "analytics_telemetry" && granted === true) {
      return res.status(403).json({
        message: "DPDP Section 9 prohibits behavioral tracking on student accounts.",
      });
    }

    const record = await ConsentRecord.create({
      principalType: p.type === "student" ? "student" : "user",
      principalId: p.id,
      instituteId: p.instituteId,
      purpose,
      granted,
      noticeVersion: DPDP_NOTICE_VERSION,
      language,
      method: "toggle_settings",
      grantedAt: granted ? new Date() : null,
      withdrawnAt: granted ? null : new Date(),
      ipMasked: maskIp(req.ip || ""),
    });

    if (p.type === "user" && p.instituteDoc && p.role === "institute_admin") {
      if (purpose === "b2b_dpa") {
        p.instituteDoc.dpaAccepted = granted;
        p.instituteDoc.dpaAcceptedAt = granted ? new Date() : null;
        p.instituteDoc.dpaVersion = DPDP_NOTICE_VERSION;
        await p.instituteDoc.save().catch(() => {});
      }
    }

    await DataAccessLog.create({
      actorId: p.id,
      actorRole: p.role,
      instituteId: p.instituteId,
      action: granted ? "consent_granted" : "consent_withdrawn",
      targetType: purpose,
      targetId: p.id,
      ipMasked: maskIp(req.ip || ""),
      details: `Updated consent for ${purpose} -> ${granted}`,
    }).catch(() => {});

    return res.json({
      success: true,
      message: granted
        ? `Consent enabled for ${purpose.replace(/_/g, " ")}.`
        : `Consent withdrawn for ${purpose.replace(/_/g, " ")}.`,
      record,
    });
  } catch (err) {
    console.error("updateConsents error:", err);
    return res.status(500).json({ message: "Could not update consent preference." });
  }
};

export const exportPersonalData = async (req, res) => {
  try {
    const p = req.principal;
    const consents = await ConsentRecord.find({ principalId: p.id }).catch(() => []);
    const grievances = await GrievanceTicket.find({ principalId: p.id }).catch(() => []);

    let exportPayload = {
      exportedAt: new Date().toISOString(),
      dpdpNoticeVersion: DPDP_NOTICE_VERSION,
      section: "DPDP Act 2023 Section 11 / Rule 14 — Right to Access Personal Data Summary",
      dataFiduciary: {
        name: "ClassTech Operating System",
        grievanceOfficer: GRIEVANCE_OFFICER,
      },
      sharedWithProcessors: SUB_PROCESSORS,
      consents,
      grievances,
    };

    if (p.type === "student" && p.doc) {
      const s = p.doc;
      const [marks, attempts, wpLogs] = await Promise.all([
        TestResult.find({ student: p.id }).catch(() => []),
        TestSeriesAttempt.find({ student: p.id }).catch(() => []),
        WhatsappLog.find({
          $or: [{ recipient: s.phone }, { recipient: s.parentPhone }],
        })
          .limit(100)
          .catch(() => []),
      ]);

      exportPayload.principalProfile = {
        id: p.id,
        name: s.name,
        enrollmentNumber: s.enrollmentNumber,
        phone: s.phone,
        email: s.email,
        parentName: s.parentName,
        parentPhone: s.parentPhone,
        address: s.address,
        feePlanType: s.feePlanType,
        totalFees: s.totalFees,
        joinedOn: s.joinedOn,
      };
      exportPayload.academicAndFeeSummary = {
        paymentHistory: s.paymentHistory || [],
        attendanceCount: Array.isArray(s.attendanceRecords) ? s.attendanceRecords.length : 0,
        testMarksCount: (marks || []).length,
        testSeriesAttemptsCount: (attempts || []).length,
        whatsappMessagesLogged: (wpLogs || []).length,
      };
    } else if (p.type === "user" && p.doc) {
      const u = p.doc;
      const aiLogs = await AiUsageLog.find({ userId: p.id }).limit(100).catch(() => []);
      exportPayload.principalProfile = {
        id: p.id,
        name: u.name,
        email: u.email,
        phone: u.phone,
        role: u.role,
        instituteName: p.instituteDoc?.name || "",
        lastActiveAt: u.lastActiveAt || null,
        createdAt: u.createdAt || null,
      };
      exportPayload.instituteWorkspace = p.instituteDoc
        ? {
            id: String(p.instituteDoc._id || p.instituteDoc.id),
            name: p.instituteDoc.name,
            subscriptionPlan: p.instituteDoc.subscriptionPlan,
            dpaAccepted: Boolean(p.instituteDoc.dpaAccepted),
          }
        : null;
      exportPayload.aiUsageCount = (aiLogs || []).length;
    }

    await DataAccessLog.create({
      actorId: p.id,
      actorRole: p.role,
      instituteId: p.instituteId,
      action: "export_data",
      targetType: p.type,
      targetId: p.id,
      ipMasked: maskIp(req.ip || ""),
      details: "DPDP Section 11 personal data export downloaded",
    }).catch(() => {});

    return res.json(exportPayload);
  } catch (err) {
    console.error("exportPersonalData error:", err);
    return res.status(500).json({ message: "Could not export personal data summary." });
  }
};

export const requestDataCorrection = async (req, res) => {
  try {
    const p = req.principal;
    const { name, email, phone, address, parentName, parentPhone, description = "" } = req.body;

    if (p.type === "student" && p.doc) {
      if (name && String(name).trim()) p.doc.name = String(name).trim();
      if (email !== undefined) p.doc.email = String(email || "").toLowerCase().trim();
      if (phone && String(phone).trim()) p.doc.phone = String(phone).trim();
      if (address !== undefined) p.doc.address = String(address || "").trim();
      if (parentName !== undefined) p.doc.parentName = String(parentName || "").trim();
      if (parentPhone !== undefined) p.doc.parentPhone = String(parentPhone || "").trim();
      await p.doc.save();
    } else if (p.type === "user" && p.doc) {
      if (name && String(name).trim()) p.doc.name = String(name).trim();
      if (email !== undefined) p.doc.email = String(email || "").toLowerCase().trim();
      if (phone !== undefined) p.doc.phone = String(phone || "").trim();
      await p.doc.save();
    }

    let ticket = null;
    if (description && String(description).trim()) {
      ticket = await GrievanceTicket.create({
        ticketNumber: `COR-${Date.now().toString().slice(-6)}`,
        principalType: p.type === "student" ? "student" : p.role,
        principalId: p.id,
        instituteId: p.instituteId,
        name: p.name,
        email: p.email,
        phone: p.phone,
        category: "correction",
        subject: "DPDP Section 12 Record Correction Request",
        description: String(description).trim(),
        status: "open",
      });
    }

    await DataAccessLog.create({
      actorId: p.id,
      actorRole: p.role,
      instituteId: p.instituteId,
      action: "data_correction",
      targetType: p.type,
      targetId: p.id,
      ipMasked: maskIp(req.ip || ""),
      details: ticket ? `Correction ticket ${ticket.ticketNumber}` : "Profile updated directly",
    }).catch(() => {});

    return res.json({
      success: true,
      message: ticket
        ? `Correction updated & ticket ${ticket.ticketNumber} filed for institute/officer review.`
        : "Your profile data has been corrected.",
      ticket,
    });
  } catch (err) {
    console.error("requestDataCorrection error:", err);
    return res.status(500).json({ message: "Could not process correction request." });
  }
};

export const submitGrievance = async (req, res) => {
  try {
    const p = req.principal;
    const { category = "other", subject = "DPDP Privacy Grievance", description } = req.body;
    if (!description || !String(description).trim()) {
      return res.status(400).json({ message: "Please describe your privacy grievance." });
    }

    const ticket = await GrievanceTicket.create({
      ticketNumber: `GRV-${Date.now().toString().slice(-6)}-${Math.floor(10 + Math.random() * 89)}`,
      principalType: p.type === "student" ? "student" : p.role,
      principalId: p.id,
      instituteId: p.instituteId,
      name: p.name,
      email: p.email,
      phone: p.phone,
      category,
      subject: String(subject).trim(),
      description: String(description).trim(),
      status: "open",
      slaDeadline: new Date(Date.now() + GRIEVANCE_OFFICER.responseSlaDays * 24 * 60 * 60 * 1000),
    });

    await DataAccessLog.create({
      actorId: p.id,
      actorRole: p.role,
      instituteId: p.instituteId,
      action: "grievance_created",
      targetType: "grievance",
      targetId: String(ticket._id || ticket.id),
      ipMasked: maskIp(req.ip || ""),
      details: `Ticket ${ticket.ticketNumber} (${category})`,
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: `Grievance ticket ${ticket.ticketNumber} submitted. Target response SLA: ${GRIEVANCE_OFFICER.responseSlaDays} days (statutory max ${GRIEVANCE_OFFICER.statutoryMaxDays} days).`,
      ticket,
    });
  } catch (err) {
    console.error("submitGrievance error:", err);
    return res.status(500).json({ message: "Could not submit grievance." });
  }
};

export const selfServiceDeleteAccount = async (req, res) => {
  try {
    const p = req.principal;
    if (p.role === "super_admin") {
      return res.status(403).json({ message: "Super admin account cannot be self-erased." });
    }
    if (req.body?.confirm !== true && req.body?.confirmText !== "DELETE") {
      return res.status(400).json({
        message: "Explicit confirmation is required before permanent account erasure.",
      });
    }

    if (p.type === "student") {
      await cascadeDeleteStudent({
        studentId: p.id,
        studentDoc: p.doc,
        retainTaxLedger: true,
        actorId: p.id,
        actorRole: "student",
        reason: "self_service_dpdp_erasure",
      });
      return res.json({
        success: true,
        message:
          "Your student account and personal records have been permanently erased (anonymized tax invoice totals retained only as required by law).",
      });
    }

    await cascadeDeleteEducatorOrInstitute({
      userId: p.id,
      role: p.role,
      instituteId: p.instituteId,
      retainTaxLedger: true,
      reason: "self_service_dpdp_erasure",
    });

    return res.json({
      success: true,
      message: "Your account and associated personal data have been erased.",
    });
  } catch (err) {
    console.error("selfServiceDeleteAccount error:", err);
    return res.status(500).json({ message: "Could not delete account." });
  }
};

// Super Admin Grievance & Rule 6 Audit Endpoints
export const adminListGrievances = async (req, res) => {
  if (req.principal?.role !== "super_admin") {
    return res.status(403).json({ message: "Super Admin access required." });
  }
  const tickets = await GrievanceTicket.find({}).sort({ createdAt: -1 }).catch(() => []);
  return res.json(tickets || []);
};

export const adminResolveGrievance = async (req, res) => {
  if (req.principal?.role !== "super_admin") {
    return res.status(403).json({ message: "Super Admin access required." });
  }
  const { status = "resolved", resolutionNotes = "" } = req.body;
  const ticket = await GrievanceTicket.findByIdAndUpdate(
    req.params.id,
    {
      status,
      resolutionNotes,
      resolvedAt: status === "resolved" ? new Date() : null,
    },
    { new: true }
  ).catch(() => null);
  if (!ticket) return res.status(404).json({ message: "Ticket not found." });
  return res.json({ success: true, ticket });
};

export const adminListAccessLogs = async (req, res) => {
  if (req.principal?.role !== "super_admin") {
    return res.status(403).json({ message: "Super Admin access required." });
  }
  const logs = await DataAccessLog.find({}).sort({ createdAt: -1 }).limit(200).catch(() => []);
  return res.json(logs || []);
};

export const adminTriggerRetentionSweep = async (req, res) => {
  if (req.principal?.role !== "super_admin") {
    return res.status(403).json({ message: "Super Admin access required." });
  }
  const report = await runDpdpRetentionSweep();
  return res.json({ success: true, report });
};
