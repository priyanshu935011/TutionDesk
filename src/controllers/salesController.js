import Institute from "../models/Institute.js";
import User from "../models/User.js";
import SalesLead from "../models/SalesLead.js";
import SalesTerritory from "../models/SalesTerritory.js";
import SystemSetting from "../models/SystemSetting.js";
import CashfreePayment from "../models/CashfreePayment.js";
import bcrypt from "bcryptjs";
import axios from "axios";
import crypto from "crypto";
import { resolveSubscriptionEnd } from "../utils/subscription.js";
import {
  updateInstituteWalletBalanceMetadata,
  updateInstituteAiWalletBalanceMetadata,
  updateInstituteAiSettingsMetadata,
  readInstitutesMetadata,
  writeInstitutesMetadata,
} from "../utils/supabaseModel.js";
import { clearCachePattern } from "../utils/cache.js";
import { logActivity } from "../utils/activityLogger.js";
import {
  getCashfreeConfig,
  getBaseUrl,
  checkCashfreeOrderStatus,
  creditInstituteWallet,
  creditInstituteAiWallet,
} from "./paymentController.js";

// Default Criteria-Based Payout Rules
const DEFAULT_PAYOUT_CONFIG = {
  minSalesToQualify: 1, // Minimum 1 sale required to qualify for fixed payout
  fixedBasePayout: 10000, // Fixed base salary/payout in INR
  incentiveSlabs: [
    { maxAmount: 15000, incentive: 500, label: "Yearly plan up to ₹15,000" },
    { minAmount: 15001, maxAmount: 25000, incentive: 1000, label: "₹15,001 - ₹25,000" },
    { minAmount: 25001, maxAmount: 40000, incentive: 1800, label: "₹25,001 - ₹40,000" },
    { minAmount: 40001, incentive: 2500, label: "Above ₹40,000" },
  ],
};

const getEffectivePayoutConfig = async (userId = null) => {
  try {
    if (userId) {
      const user = await User.findById(userId);
      if (
        user &&
        user.payoutConfig &&
        typeof user.payoutConfig === "object" &&
        (user.payoutConfig.minSalesToQualify !== undefined || user.payoutConfig.fixedBasePayout !== undefined)
      ) {
        return {
          minSalesToQualify: Number(user.payoutConfig.minSalesToQualify ?? DEFAULT_PAYOUT_CONFIG.minSalesToQualify),
          fixedBasePayout: Number(user.payoutConfig.fixedBasePayout ?? DEFAULT_PAYOUT_CONFIG.fixedBasePayout),
          incentiveSlabs:
            Array.isArray(user.payoutConfig.incentiveSlabs) && user.payoutConfig.incentiveSlabs.length > 0
              ? user.payoutConfig.incentiveSlabs
              : DEFAULT_PAYOUT_CONFIG.incentiveSlabs,
        };
      }
    }
    const setting = await SystemSetting.findOne({ key: "sales_payout_config" });
    if (setting && setting.value) {
      const parsed = typeof setting.value === "string" ? JSON.parse(setting.value) : setting.value;
      return { ...DEFAULT_PAYOUT_CONFIG, ...parsed };
    }
  } catch (_) {}
  return DEFAULT_PAYOUT_CONFIG;
};

const calculateIncentiveForAmount = (amount, slabs) => {
  const num = Number(amount || 0);
  for (const slab of slabs) {
    if (slab.maxAmount && slab.minAmount) {
      if (num >= slab.minAmount && num <= slab.maxAmount) return slab.incentive;
    } else if (slab.maxAmount && !slab.minAmount) {
      if (num <= slab.maxAmount) return slab.incentive;
    } else if (slab.minAmount && !slab.maxAmount) {
      if (num >= slab.minAmount) return slab.incentive;
    }
  }
  return 500;
};

// GET /api/sales/overview
export const getSalesOverview = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userRole = req.user.role;
    const config = await getEffectivePayoutConfig(userId);

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    // 1. Fetch tuition accounts closed by this sales person
    const allInstitutes = await Institute.find();
    const myInstitutes = allInstitutes.filter((inst) => {
      if (userRole === "super_admin" || userRole === "tech_admin") return true;
      const spId = String(inst.salesPerson || inst.createdBy || "");
      const myId = String(userId);
      const myName = (req.user?.name || "").trim().toLowerCase();
      const creatorName = (inst.createdByName || inst.staffName || "").trim().toLowerCase();
      return (spId && spId === myId) || (creatorName && myName && creatorName === myName);
    });

    // Month Sales: Only tuitions whose payment is DONE and APPROVED by Super Admin count towards payout & performance stats!
    const monthInstitutes = myInstitutes.filter((inst) => {
      const d = new Date(inst.payoutApprovedAt || inst.subscriptionPaidAt || inst.subscriptionStart || inst.createdAt);
      const isPaid = inst.subscriptionPaymentStatus === "paid";
      const isApproved = inst.payoutApprovalStatus === "approved";
      return d >= startOfMonth && inst.subscriptionPlan !== "trial" && isPaid && isApproved;
    });

    const pendingApprovalInstitutes = myInstitutes.filter((inst) => {
      return inst.subscriptionPlan !== "trial" && inst.subscriptionPaymentStatus === "paid" && inst.payoutApprovalStatus !== "approved";
    });

    const unpaidInstitutes = myInstitutes.filter((inst) => {
      return inst.subscriptionPlan !== "trial" && inst.subscriptionPaymentStatus !== "paid";
    });

    // Sort month institutes chronologically (earliest to latest)
    monthInstitutes.sort((a, b) => {
      const da = new Date(a.subscriptionStart || a.createdAt || 0);
      const db = new Date(b.subscriptionStart || b.createdAt || 0);
      return da - db;
    });

    // Today Sales (Paid & Approved)
    const todayInstitutes = myInstitutes.filter((inst) => {
      const d = new Date(inst.payoutApprovedAt || inst.subscriptionPaidAt || inst.subscriptionStart || inst.createdAt);
      return d >= startOfToday && inst.subscriptionPlan !== "trial" && inst.subscriptionPaymentStatus === "paid" && inst.payoutApprovalStatus === "approved";
    });

    // Calculate Month Payout & Incentives
    const monthSalesCount = monthInstitutes.length;
    const monthSalesVolume = monthInstitutes.reduce((sum, inst) => sum + Number(inst.subscriptionAmount || 0), 0);

    const minSales = Number(config.minSalesToQualify ?? 1);
    const isQualified = monthSalesCount >= minSales;
    const fixedPayoutEarned = isQualified ? Number(config.fixedBasePayout ?? 10000) : 0;

    // Incentive starts applying ONLY AFTER minimum qualifying sales are achieved!
    // E.g., if minSales is 2, first 2 sales qualify the fixed base payout (earn ₹0 incentive).
    // Deals from sale #3 onwards unlock deal incentive slabs.
    const salesBreakdown = monthInstitutes.map((inst, index) => {
      const amount = Number(inst.subscriptionAmount || 0);
      const isQualifyingDeal = index < minSales;
      const incentive = isQualifyingDeal ? 0 : calculateIncentiveForAmount(amount, config.incentiveSlabs);
      return {
        _id: inst._id || inst.id,
        instituteName: inst.name,
        ownerName: inst.ownerName,
        plan: inst.subscriptionPlan,
        amount,
        incentive,
        isQualifyingDeal,
        saleNumber: index + 1,
        date: inst.subscriptionStart || inst.createdAt,
      };
    });

    const totalIncentiveEarned = salesBreakdown.reduce((sum, item) => sum + item.incentive, 0);
    const totalEstimatedPayout = fixedPayoutEarned + totalIncentiveEarned;

    // 2. Fetch Leads for Today's Follow-ups and Call Counts
    const allLeads = await SalesLead.find();
    // Lookup territory assignments for this user
    const assignments = await SalesTerritory.find();
    const myAssignments = (assignments || []).filter((t) => String(t.salesPersonId) === String(userId));
    const assignedStates = myAssignments.filter((t) => !t.city).map((t) => (t.state || "").trim().toLowerCase());
    const assignedCities = myAssignments.filter((t) => t.city).map((t) => `${(t.state || "").trim().toLowerCase()}::${(t.city || "").trim().toLowerCase()}`);

    const myLeads = allLeads.filter((lead) => {
      if (userRole === "super_admin" || userRole === "tech_admin") {
        return lead.source !== "Self-Added" || String(lead.addedBy) === String(userId);
      }
      // Staff's own self-added lead
      if (String(lead.addedBy || "") === String(userId)) return true;
      // Directly assigned lead
      if (String(lead.salesPerson || "") === String(userId)) return true;
      // Territory assigned
      const lState = (lead.state || "").trim().toLowerCase();
      const lCity = (lead.district || lead.city || "").trim().toLowerCase();
      if (lState && lCity && assignedCities.includes(`${lState}::${lCity}`)) return true;
      if (lState && assignedStates.includes(lState)) return true;

      return false;
    });

    // Count calls logged today
    let callsToday = 0;
    myLeads.forEach((lead) => {
      (lead.callLogs || []).forEach((call) => {
        const callDate = new Date(call.date);
        if (callDate >= startOfToday) {
          callsToday++;
        }
      });
    });

    // Follow-ups due today or overdue
    const todayFollowups = myLeads.filter((lead) => {
      if (!lead.nextFollowUpDate || lead.status === "converted" || lead.status === "lost") {
        return false;
      }
      const fuDate = new Date(lead.nextFollowUpDate);
      return fuDate <= endOfToday;
    });

    return res.json({
      payout: {
        criteria: config,
        monthSalesCount,
        monthSalesVolume,
        isQualified,
        fixedPayoutEarned,
        totalIncentiveEarned,
        totalEstimatedPayout,
        salesBreakdown,
        pendingApprovalCount: pendingApprovalInstitutes.length,
        unpaidCount: unpaidInstitutes.length,
      },
      dailyMetrics: {
        callsToday,
        callsTarget: 30,
        followupsToday: todayFollowups.length,
        todaySalesCount: todayInstitutes.length,
        todaySalesVolume: todayInstitutes.reduce((sum, inst) => sum + Number(inst.subscriptionAmount || 0), 0),
        monthSalesCount,
        monthSalesVolume,
      },
      todayFollowups,
    });
  } catch (error) {
    console.error("getSalesOverview error:", error);
    return res.status(500).json({ message: "Could not fetch sales overview data" });
  }
};

// GET /api/sales/leads
export const getSalesLeads = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userRole = req.user.role;

    const leads = await SalesLead.find().sort({ updatedAt: -1, createdAt: -1 });

    // Lookup territory assignments for this sales person
    const assignments = await SalesTerritory.find();
    const myAssignments = (assignments || []).filter((t) => String(t.salesPersonId) === String(userId));
    const assignedStates = myAssignments.filter((t) => !t.city).map((t) => (t.state || "").trim().toLowerCase());
    const assignedCities = myAssignments.filter((t) => t.city).map((t) => `${(t.state || "").trim().toLowerCase()}::${(t.city || "").trim().toLowerCase()}`);

    const filtered = leads.filter((lead) => {
      // Super admin sees master leads (never staff self-added leads)
      if (userRole === "super_admin" || userRole === "tech_admin") {
        return lead.source !== "Self-Added" || String(lead.addedBy) === String(userId);
      }

      // 1. Staff's own self-added leads ("show leads added by staff only in staff dashboard")
      if (String(lead.addedBy || "") === String(userId)) return true;

      // 2. Directly assigned leads
      if (String(lead.salesPerson || "") === String(userId)) return true;

      // 3. Leads matching assigned state/city territories
      const lState = (lead.state || "").trim().toLowerCase();
      const lCity = (lead.district || lead.city || "").trim().toLowerCase();
      if (lState && lCity && assignedCities.includes(`${lState}::${lCity}`)) return true;
      if (lState && assignedStates.includes(lState)) return true;

      return false;
    });

    return res.json(filtered);
  } catch (error) {
    console.error("getSalesLeads error:", error);
    return res.status(500).json({ message: "Could not fetch sales leads" });
  }
};

// POST /api/sales/leads
export const createSalesLead = async (req, res) => {
  try {
    const {
      coachingName,
      contactPerson,
      phone,
      email,
      state,
      district,
      city,
      address,
      studentCapacity,
      planInterest,
      status,
      notes,
      nextFollowUpDate,
      googleBusinessLink,
    } = req.body;

    if (!coachingName || !phone) {
      return res.status(400).json({ message: "Institute Name and Phone number are required." });
    }

    const resolvedContactPerson = (contactPerson || coachingName || "Owner").trim();
    const resolvedState = (state || "").trim();
    const resolvedDistrict = (district || city || "").trim();
    const resolvedCity = (city || district || "").trim();

    const isSuperAdmin = req.user.role === "super_admin" || req.user.role === "tech_admin";
    const source = isSuperAdmin ? "Super Admin" : "Self-Added";

    const newLead = await SalesLead.create({
      coachingName: coachingName.trim(),
      contactPerson: resolvedContactPerson,
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : "",
      state: resolvedState,
      district: resolvedDistrict,
      city: resolvedCity,
      address: address ? address.trim() : "",
      studentCapacity: studentCapacity ? studentCapacity.trim() : "",
      planInterest: planInterest || "Yearly Subscription",
      status: status || "new",
      source,
      salesPerson: req.user._id || req.user.id,
      salesPersonName: req.user.name || "Sales Specialist",
      addedBy: req.user._id || req.user.id,
      addedByName: req.user.name || "Sales Specialist",
      googleBusinessLink: googleBusinessLink ? googleBusinessLink.trim() : "",
      nextFollowUpDate: nextFollowUpDate ? new Date(nextFollowUpDate) : null,
      notes: notes ? notes.trim() : "",
      callLogs: [],
    });

    return res.status(201).json({
      message: "Lead created successfully",
      lead: newLead,
    });
  } catch (error) {
    console.error("createSalesLead error:", error);
    return res.status(500).json({ message: "Could not create sales lead" });
  }
};

// PUT /api/sales/leads/:id
export const updateSalesLead = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const lead = await SalesLead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const updated = await SalesLead.findByIdAndUpdate(id, updates, { new: true });
    return res.json({ message: "Lead updated successfully", lead: updated });
  } catch (error) {
    console.error("updateSalesLead error:", error);
    return res.status(500).json({ message: "Could not update lead" });
  }
};

// POST /api/sales/leads/:id/call
export const logLeadCall = async (req, res) => {
  try {
    const { id } = req.params;
    const { duration, outcome, note, nextFollowUpDate, status } = req.body;

    const lead = await SalesLead.findById(id);
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    const callLogItem = {
      date: new Date().toISOString(),
      duration: duration || "1-2 mins",
      outcome: outcome || "Connected",
      note: note ? note.trim() : "",
      loggedBy: req.user.name || "Sales Specialist",
    };

    const currentCallLogs = Array.isArray(lead.callLogs) ? lead.callLogs : [];
    const updatedCallLogs = [callLogItem, ...currentCallLogs];

    const updatePayload = {
      callLogs: updatedCallLogs,
    };

    if (nextFollowUpDate) {
      updatePayload.nextFollowUpDate = new Date(nextFollowUpDate);
    }
    if (status) {
      updatePayload.status = status;
    }
    if (note) {
      updatePayload.notes = (lead.notes ? `${lead.notes}\n` : "") + `[${new Date().toLocaleDateString()}] ${note.trim()}`;
    }

    const updated = await SalesLead.findByIdAndUpdate(id, updatePayload, { new: true });
    return res.json({ message: "Call logged successfully", lead: updated });
  } catch (error) {
    console.error("logLeadCall error:", error);
    return res.status(500).json({ message: "Could not log call" });
  }
};

// GET /api/sales/institutes
// Basic details only - protects student/teacher rosters!
export const getSalesInstitutes = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const userRole = req.user.role;

    const allInstitutes = await Institute.find().sort({ createdAt: -1 });

    const filtered = allInstitutes.filter((inst) => {
      if (userRole === "super_admin" || userRole === "tech_admin") return true;
      const spId = String(inst.salesPerson || inst.createdBy || "");
      const myId = String(userId);
      const myName = (req.user?.name || "").trim().toLowerCase();
      const creatorName = (inst.createdByName || inst.staffName || "").trim().toLowerCase();
      return (spId && spId === myId) || (creatorName && myName && creatorName === myName);
    });

    // Project ONLY basic institution info (no students, no teachers, no test marks, no credentials)
    const sanitized = filtered.map((inst) => ({
      _id: inst._id || inst.id,
      name: inst.name,
      ownerName: inst.ownerName,
      adminEmail: inst.adminEmail,
      adminPhone: inst.adminPhone,
      subscriptionPlan: inst.subscriptionPlan,
      subscriptionAmount: inst.subscriptionAmount,
      subscriptionStart: inst.subscriptionStart,
      subscriptionEnd: inst.subscriptionEnd,
      status: inst.status,
      tuitionType: inst.tuitionType,
      walletBalance: Number(inst.walletBalance || 0),
      aiWalletBalance: Number(inst.aiWalletBalance || 0),
      aiEnabled: Boolean(inst.aiEnabled),
      recordedLecturesFeatureEnabled: inst.recordedLecturesFeatureEnabled !== false,
      studentCustomFields: inst.studentCustomFields || [],
      allowedFeatures: inst.allowedFeatures || [],
      brandingEnabled: Boolean(inst.brandingEnabled),
      themeColor: inst.themeColor || "#6366f1",
      logoUrl: inst.logoUrl || null,
      createdByName: inst.createdByName || inst.staffName || "",
      subscriptionPaymentStatus: inst.subscriptionPaymentStatus || (inst.subscriptionPlan === "trial" ? "paid" : "unpaid"),
      subscriptionPaymentLink: inst.subscriptionPaymentLink || null,
      subscriptionOrderId: inst.subscriptionOrderId || null,
      subscriptionPaidAt: inst.subscriptionPaidAt || null,
      subscriptionPaidAmount: Number(inst.subscriptionPaidAmount || 0),
      payoutApprovalStatus: inst.payoutApprovalStatus || "pending",
      payoutApprovedAt: inst.payoutApprovedAt || null,
      createdAt: inst.createdAt,
    }));

    return res.json(sanitized);
  } catch (error) {
    console.error("getSalesInstitutes error:", error);
    return res.status(500).json({ message: "Could not fetch sales tuition accounts" });
  }
};

// POST /api/sales/institutes
// Sales person creates / closes an active tuition account
export const createSalesInstitute = async (req, res) => {
  try {
    const {
      name,
      ownerName,
      adminEmail,
      adminPhone,
      adminPassword,
      subscriptionPlan,
      subscriptionAmount,
      tuitionType,
      walletBalance,
      aiWalletBalance,
      aiEnabled,
      recordedLecturesFeatureEnabled,
      studentCustomFields,
      allowedFeatures,
      brandingEnabled,
      themeColor,
      logoUrl,
      maxVideoStorageGb,
      testSeriesFeatureEnabled,
    } = req.body;

    if (!name || !ownerName || !adminEmail || !adminPassword || !subscriptionPlan) {
      return res.status(400).json({ message: "Tuition Name, Owner, Email, Password, and Plan are required." });
    }

    const normalizedEmail = adminEmail.toLowerCase().trim();
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return res.status(400).json({ message: "An account with this email already exists." });
    }

    const startDate = new Date();
    const endDate = resolveSubscriptionEnd({
      subscriptionPlan,
      subscriptionStart: startDate,
      trialDays: 14,
    });

    // Clean features: strip UPI for staff onboard
    const cleanedAllowedFeatures = Array.isArray(allowedFeatures) && allowedFeatures.length > 0
      ? allowedFeatures.filter((f) => f !== "upi")
      : ["attendance", "notes", "marks", "tests", "test_series", "whatsapp", "notices"];

    const institute = await Institute.create({
      name: name.trim(),
      ownerName: ownerName.trim(),
      adminEmail: normalizedEmail,
      adminPhone: adminPhone ? adminPhone.trim() : "",
      subscriptionPlan,
      subscriptionAmount: Number(subscriptionAmount || 0),
      subscriptionStart: startDate,
      subscriptionEnd: endDate || new Date(Date.now() + 365 * 86400000),
      status: "active",
      tuitionType: tuitionType || "institution",
      salesPerson: req.user._id || req.user.id,
      createdBy: req.user._id || req.user.id,
      createdByName: req.user.name || "Sales Specialist",
      staffName: req.user.name || "Sales Specialist",
      walletBalance: Number(walletBalance !== undefined && !isNaN(Number(walletBalance)) ? walletBalance : 0),
      aiWalletBalance: Number(aiWalletBalance !== undefined && !isNaN(Number(aiWalletBalance)) ? aiWalletBalance : 0),
      aiEnabled: Boolean(aiEnabled),
      recordedLecturesFeatureEnabled: recordedLecturesFeatureEnabled !== false,
      maxVideoStorageGb: Number(maxVideoStorageGb !== undefined && !isNaN(Number(maxVideoStorageGb)) ? maxVideoStorageGb : 50),
      testSeriesFeatureEnabled: Boolean(testSeriesFeatureEnabled),
      studentCustomFields: Array.isArray(studentCustomFields) ? studentCustomFields : [],
      allowedFeatures: cleanedAllowedFeatures,
      brandingEnabled: Boolean(brandingEnabled),
      themeColor: themeColor || "#6366f1",
      logoUrl: logoUrl || null,
      subscriptionPaymentStatus: subscriptionPlan === "trial" ? "paid" : "unpaid",
      subscriptionPaymentLink: "",
      subscriptionOrderId: "",
      payoutApprovalStatus: "pending",
    });

    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    const user = await User.create({
      name: ownerName.trim(),
      email: normalizedEmail,
      password: hashedPassword,
      role: "institute_admin",
      institute: institute._id || institute.id,
    });

    institute.adminUser = user._id || user.id;
    await institute.save().catch(() => {});

    try {
      await logActivity(
        req.user._id || req.user.id,
        "Tuition Onboarded by Sales",
        `Sales specialist ${req.user.name} onboarded tuition "${name}" with plan ${subscriptionPlan}`,
        req.ip
      );
    } catch (_) {}

    return res.status(201).json({
      message: "Tuition account onboarded successfully!",
      institute: {
        _id: institute._id || institute.id,
        name: institute.name,
        ownerName: institute.ownerName,
        adminEmail: institute.adminEmail,
        adminPhone: institute.adminPhone,
        subscriptionPlan: institute.subscriptionPlan,
        subscriptionAmount: institute.subscriptionAmount,
        tuitionType: institute.tuitionType,
        status: institute.status,
        walletBalance: institute.walletBalance,
        aiWalletBalance: institute.aiWalletBalance,
        aiEnabled: institute.aiEnabled,
        recordedLecturesFeatureEnabled: institute.recordedLecturesFeatureEnabled,
        studentCustomFields: institute.studentCustomFields,
        allowedFeatures: institute.allowedFeatures,
        brandingEnabled: institute.brandingEnabled,
        themeColor: institute.themeColor,
        logoUrl: institute.logoUrl,
        createdByName: institute.createdByName,
        subscriptionPaymentStatus: institute.subscriptionPaymentStatus || (subscriptionPlan === "trial" ? "paid" : "unpaid"),
        subscriptionPaymentLink: institute.subscriptionPaymentLink || "",
        payoutApprovalStatus: institute.payoutApprovalStatus || "pending",
      },
    });
  } catch (error) {
    console.error("createSalesInstitute error:", error);
    return res.status(500).json({ message: error.message || "Could not onboard tuition account" });
  }
};

// PUT /api/sales/institutes/:id
// Update tuition account from staff dashboard
export const updateSalesInstitute = async (req, res) => {
  try {
    const { id } = req.params;
    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition account not found" });
    }

    const {
      name,
      ownerName,
      adminEmail,
      adminPhone,
      subscriptionPlan,
      subscriptionAmount,
      tuitionType,
      walletBalance,
      aiWalletBalance,
      aiEnabled,
      recordedLecturesFeatureEnabled,
      testSeriesFeatureEnabled,
      studentCustomFields,
      allowedFeatures,
      brandingEnabled,
      logoUrl,
    } = req.body;

    if (name) institute.name = name.trim();
    if (ownerName) institute.ownerName = ownerName.trim();
    if (adminPhone !== undefined) institute.adminPhone = adminPhone ? adminPhone.trim() : "";
    if (tuitionType) institute.tuitionType = tuitionType;

    if (subscriptionPlan !== undefined && subscriptionPlan) {
      const planChanged = institute.subscriptionPlan !== subscriptionPlan;
      institute.subscriptionPlan = subscriptionPlan;

      if (subscriptionPlan === "trial") {
        institute.subscriptionAmount = 0;
        institute.subscriptionPaymentStatus = "paid";
        institute.subscriptionPaymentLink = "";
      } else if (planChanged && institute.subscriptionPaymentStatus !== "paid") {
        // Clear previous payment link if plan changed while unpaid so new link matches new plan
        institute.subscriptionPaymentLink = "";
        institute.subscriptionOrderId = "";
      }

      if (planChanged) {
        const nextEnd = resolveSubscriptionEnd({
          subscriptionPlan,
          subscriptionStart: institute.subscriptionStart || new Date(),
          trialDays: subscriptionPlan === "trial" ? 14 : 0,
        });
        if (nextEnd) {
          institute.subscriptionEnd = nextEnd;
        }
      }
    }

    if (subscriptionAmount !== undefined && !isNaN(Number(subscriptionAmount))) {
      const numAmount = Number(subscriptionAmount);
      // If amount changed while unpaid, clear the old payment link
      if (institute.subscriptionAmount !== numAmount && institute.subscriptionPaymentStatus !== "paid") {
        institute.subscriptionPaymentLink = "";
        institute.subscriptionOrderId = "";
      }
      institute.subscriptionAmount = numAmount;
    }
    if (aiEnabled !== undefined) {
      institute.aiEnabled = Boolean(aiEnabled);
      updateInstituteAiSettingsMetadata(id, { aiEnabled: Boolean(aiEnabled) });
    }
    if (recordedLecturesFeatureEnabled !== undefined) {
      institute.recordedLecturesFeatureEnabled = Boolean(recordedLecturesFeatureEnabled);
    }
    if (testSeriesFeatureEnabled !== undefined) {
      institute.testSeriesFeatureEnabled = Boolean(testSeriesFeatureEnabled);
    }
    if (studentCustomFields !== undefined && Array.isArray(studentCustomFields)) {
      institute.studentCustomFields = studentCustomFields;
    }
    if (brandingEnabled !== undefined) institute.brandingEnabled = Boolean(brandingEnabled);
    if (logoUrl !== undefined) institute.logoUrl = logoUrl ? logoUrl.trim() : null;

    if (allowedFeatures !== undefined && Array.isArray(allowedFeatures)) {
      let feats = allowedFeatures.filter((f) => f !== "upi" && f !== "test_series");
      if (institute.testSeriesFeatureEnabled) {
        feats.push("test_series");
      }
      institute.allowedFeatures = feats;
    }

    if (adminEmail && adminEmail.trim().toLowerCase() !== (institute.adminEmail || "").toLowerCase()) {
      const normalizedEmail = adminEmail.trim().toLowerCase();
      const existingUser = await User.findOne({ email: normalizedEmail, _id: { $ne: institute.adminUser } });
      if (existingUser) {
        return res.status(400).json({ message: "An account with this email already exists." });
      }
      institute.adminEmail = normalizedEmail;
      if (institute.adminUser) {
        await User.findByIdAndUpdate(institute.adminUser, {
          email: normalizedEmail,
          name: institute.ownerName,
        }).catch(() => {});
      }
    } else if (ownerName && institute.adminUser) {
      await User.findByIdAndUpdate(institute.adminUser, { name: ownerName.trim() }).catch(() => {});
    }

    if (walletBalance !== undefined && walletBalance !== null && !isNaN(Number(walletBalance))) {
      const newBal = Number(walletBalance);
      institute.walletBalance = newBal;
      updateInstituteWalletBalanceMetadata(id, newBal);
      if (institute._id) updateInstituteWalletBalanceMetadata(institute._id, newBal);
    }

    if (aiWalletBalance !== undefined && aiWalletBalance !== null && !isNaN(Number(aiWalletBalance))) {
      const newAiBal = Number(aiWalletBalance);
      institute.aiWalletBalance = newAiBal;
      updateInstituteAiWalletBalanceMetadata(id, newAiBal);
      if (institute._id) updateInstituteAiWalletBalanceMetadata(institute._id, newAiBal);
    }

    await institute.save();

    // Sync metadata
    try {
      const metadata = readInstitutesMetadata();
      const instId = String(institute._id || institute.id);
      if (metadata[instId]) {
        metadata[instId].subscriptionPlan = institute.subscriptionPlan;
        metadata[instId].subscriptionAmount = institute.subscriptionAmount;
        metadata[instId].subscriptionEnd = institute.subscriptionEnd;
        metadata[instId].subscriptionPaymentStatus = institute.subscriptionPaymentStatus;
        metadata[instId].subscriptionPaymentLink = institute.subscriptionPaymentLink;
        metadata[instId].subscriptionOrderId = institute.subscriptionOrderId;
        writeInstitutesMetadata(metadata);
      }
    } catch (_) {}

    await clearCachePattern("institute:*").catch(() => {});

    try {
      await logActivity(
        req.user._id || req.user.id,
        "Tuition Updated by Staff",
        `Staff member ${req.user.name} updated tuition "${institute.name}"`,
        req.ip
      );
    } catch (_) {}

    return res.json({
      message: "Tuition account updated successfully!",
      institute,
    });
  } catch (error) {
    console.error("updateSalesInstitute error:", error);
    return res.status(500).json({ message: error.message || "Could not update tuition account" });
  }
};

// POST /api/sales/institutes/:id/wallet-topup
export const topupSalesInstituteWallet = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    const num = Number(amount);
    if (isNaN(num) || num <= 0) {
      return res.status(400).json({ message: "Valid positive amount is required" });
    }

    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition account not found" });
    }

    const currentBal = Number(institute.walletBalance || 0);
    const newBal = currentBal + num;

    institute.walletBalance = newBal;
    await institute.save().catch(() => {});

    updateInstituteWalletBalanceMetadata(id, newBal);
    if (institute._id) updateInstituteWalletBalanceMetadata(institute._id, newBal);

    await clearCachePattern("institute:*").catch(() => {});

    return res.json({
      message: `WhatsApp wallet successfully topped up with INR ${num}. New balance: INR ${newBal}`,
      walletBalance: newBal,
    });
  } catch (error) {
    console.error("topupSalesInstituteWallet error:", error);
    return res.status(500).json({ message: "Could not top up WhatsApp wallet" });
  }
};

// POST /api/sales/institutes/:id/ai-wallet-topup
export const topupSalesInstituteAiWallet = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount } = req.body;

    const num = Number(amount);
    if (isNaN(num) || num <= 0) {
      return res.status(400).json({ message: "Valid positive amount is required" });
    }

    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition account not found" });
    }

    const currentBal = Number(institute.aiWalletBalance || 0);
    const newBal = currentBal + num;

    institute.aiWalletBalance = newBal;
    await institute.save().catch(() => {});

    updateInstituteAiWalletBalanceMetadata(id, newBal);
    if (institute._id) updateInstituteAiWalletBalanceMetadata(institute._id, newBal);

    await clearCachePattern("institute:*").catch(() => {});

    return res.json({
      message: `AI credits successfully topped up with INR ${num}. New balance: INR ${newBal}`,
      aiWalletBalance: newBal,
    });
  } catch (error) {
    console.error("topupSalesInstituteAiWallet error:", error);
    return res.status(500).json({ message: "Could not top up AI credits" });
  }
};

// POST /api/sales/institutes/:id/create-recharge-link
export const createSalesInstituteRechargeLink = async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, type } = req.body; // type: "wallet" (WhatsApp) or "ai_wallet" (AI credits)

    const num = Number(amount);
    if (isNaN(num) || num <= 0) {
      return res.status(400).json({ message: "Valid positive amount is required." });
    }

    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition account not found." });
    }

    const isAi = type === "ai_wallet" || type === "ai";
    const paymentType = isAi ? "ai_wallet_recharge" : "wallet_recharge";
    const planName = isAi ? "AI Credits Top Up" : "WhatsApp Wallet Recharge";

    let config;
    try {
      config = await getCashfreeConfig();
    } catch (cfgErr) {
      return res.status(400).json({ message: cfgErr.message || "Cashfree payment gateway is not configured." });
    }

    const { appId, secretKey, environment } = config;
    if (!appId || !secretKey) {
      return res.status(400).json({ message: "Cashfree API credentials missing in system settings." });
    }

    const baseUrl = getBaseUrl(environment);
    const prefix = isAi ? "ai_cf_" : "wp_cf_";
    const cfOrderId = prefix + crypto.randomUUID().replace(/-/g, "").substring(0, 20);

    let origin = req.headers.origin || "https://classtech-v1.up.railway.app";
    if (!origin.startsWith("https://") && !origin.includes("localhost") && !origin.includes("127.0.0.1")) {
      origin = "https://classtech-v1.up.railway.app";
    }

    const returnUrl = origin.includes("localhost") || origin.includes("127.0.0.1")
      ? `${origin}/sales-dashboard?verify_recharge=${cfOrderId}`
      : `${origin}/dashboard?verify_recharge=${cfOrderId}`;

    const orderPayload = {
      order_id: cfOrderId,
      order_amount: num,
      order_currency: "INR",
      customer_details: {
        customer_id: String(institute._id || institute.id || "cust_" + Date.now()),
        customer_name: institute.name || institute.ownerName || "Tuition Admin",
        customer_email: institute.adminEmail || req.user?.email || "support@classtech.in",
        customer_phone: (institute.adminPhone && /^[6-9]\d{9}$/.test(institute.adminPhone))
          ? institute.adminPhone
          : "9999999999",
      },
      order_meta: {
        return_url: returnUrl,
      },
      order_note: `${planName} for ${institute.name}`,
    };

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const response = await axios.post(`${baseUrl}/orders`, orderPayload, { headers });
    const sessionId = response.data.payment_session_id;
    const cleanEnv = String(environment || "").trim().toLowerCase();
    const paymentLink = response.data.payments?.url ||
      response.data.payment_link ||
      ((cleanEnv === "production" || cleanEnv === "live")
        ? `https://payments.cashfree.com/order/${sessionId}`
        : `https://payments-test.cashfree.com/order/${sessionId}`);

    const record = await CashfreePayment.create({
      institute: institute._id || institute.id,
      instituteName: institute.name,
      plan: paymentType,
      amount: num,
      type: paymentType,
      status: "pending",
      cfOrderId,
      paymentSessionId: sessionId,
      autoRenew: false,
      cfPaymentDetails: {
        paymentLink,
        environment,
        createdBy: req.user._id || req.user.id,
        createdByName: req.user.name || "Staff",
      },
    });

    return res.status(201).json({
      message: "Cashfree payment link generated successfully!",
      cfOrderId,
      paymentSessionId: sessionId,
      paymentLink,
      type: paymentType,
      amount: num,
      status: "pending",
      recordId: record._id || record.id,
    });
  } catch (error) {
    console.error("createSalesInstituteRechargeLink error:", error.response?.data || error);
    const msg = error.response?.data?.message || error.message || "Could not generate Cashfree payment link";
    return res.status(500).json({ message: msg });
  }
};

// POST /api/sales/institutes/:id/verify-recharge
export const verifySalesInstituteRecharge = async (req, res) => {
  try {
    const { id } = req.params;
    const { cfOrderId } = req.body;

    if (!cfOrderId) {
      return res.status(400).json({ message: "cfOrderId is required" });
    }

    const cleanOrderId = String(cfOrderId).trim();
    let payment = await CashfreePayment.findOne({
      $or: [
        { cfOrderId: cleanOrderId },
        { paymentSessionId: cleanOrderId },
        { _id: cleanOrderId }
      ]
    });

    if (!payment) {
      return res.status(404).json({ message: "Recharge transaction record not found." });
    }

    const targetInstId = payment.institute || id;
    const institute = await Institute.findById(targetInstId);

    // If already marked success
    if (payment.status === "success") {
      const isAi = payment.type === "ai_wallet_recharge";
      return res.json({
        status: "success",
        alreadyCredited: true,
        message: "Payment is already completed and credited.",
        walletBalance: institute?.walletBalance || 0,
        aiWalletBalance: institute?.aiWalletBalance || 0,
      });
    }

    let config;
    try {
      config = await getCashfreeConfig();
    } catch (e) {
      return res.status(400).json({ message: "Cashfree gateway credentials not available." });
    }

    const result = await checkCashfreeOrderStatus(payment.cfOrderId || cleanOrderId, config);
    payment.status = result.status;
    if (result.rawData && Object.keys(result.rawData).length > 0) {
      payment.cfPaymentDetails = {
        ...(payment.cfPaymentDetails || {}),
        ...result.rawData,
      };
    }
    await payment.save();

    if (result.status === "success") {
      const isAi = payment.type === "ai_wallet_recharge";
      let updatedBalance;
      if (isAi) {
        updatedBalance = await creditInstituteAiWallet(targetInstId, payment.amount);
      } else {
        updatedBalance = await creditInstituteWallet(targetInstId, payment.amount);
      }

      const refreshedInst = await Institute.findById(targetInstId);
      return res.json({
        status: "success",
        message: `Payment verified! INR ${payment.amount} added to ${isAi ? "AI Credits" : "WhatsApp Wallet"}.`,
        walletBalance: refreshedInst?.walletBalance || 0,
        aiWalletBalance: refreshedInst?.aiWalletBalance || 0,
      });
    }

    return res.json({
      status: result.status,
      message: result.status === "pending"
        ? "Payment is still pending. If payment was made, please click Refresh Status in a few seconds."
        : `Payment status: ${result.status}`,
    });
  } catch (error) {
    console.error("verifySalesInstituteRecharge error:", error);
    return res.status(500).json({ message: error.response?.data?.message || error.message || "Could not verify payment." });
  }
};

// GET /api/sales/institutes/:id/recharge-history
export const getSalesInstituteRechargeHistory = async (req, res) => {
  try {
    const { id } = req.params;
    const cleanId = String(id).trim();

    const payments = await CashfreePayment.find({
      $or: [
        { institute: cleanId },
        { instituteName: cleanId }
      ],
      type: { $in: ["wallet_recharge", "ai_wallet_recharge"] }
    }).sort({ createdAt: -1 });

    const history = (payments || []).map((p) => {
      const details = p.cfPaymentDetails || {};
      const env = details.environment || "sandbox";
      const cleanEnv = String(env).trim().toLowerCase();
      const fallbackLink = p.paymentSessionId
        ? ((cleanEnv === "production" || cleanEnv === "live")
          ? `https://payments.cashfree.com/order/${p.paymentSessionId}`
          : `https://payments-test.cashfree.com/order/${p.paymentSessionId}`)
        : "";

      return {
        _id: p._id || p.id,
        cfOrderId: p.cfOrderId,
        amount: p.amount,
        type: p.type,
        status: p.status,
        paymentLink: details.paymentLink || fallbackLink,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
      };
    });

    return res.json(history);
  } catch (error) {
    console.error("getSalesInstituteRechargeHistory error:", error);
    return res.status(500).json({ message: "Could not fetch recharge history." });
  }
};

// POST /api/sales/institutes/:id/create-subscription-payment-link
// Generate a Cashfree payment link for a staff-onboarded tuition subscription
export const createSalesSubscriptionPaymentLink = async (req, res) => {
  try {
    const { id } = req.params;
    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition account not found" });
    }

    if (institute.subscriptionPlan === "trial") {
      return res.status(400).json({ message: "Trial plan tuitions do not require payment." });
    }

    if (institute.subscriptionPaymentStatus === "paid") {
      return res.status(400).json({ message: "Tuition subscription is already paid." });
    }

    const amount = Number(institute.subscriptionAmount || 0);
    if (amount <= 0) {
      return res.status(400).json({ message: "Subscription amount must be greater than 0 to generate a payment link." });
    }

    let config;
    try {
      config = await getCashfreeConfig();
    } catch (e) {
      return res.status(400).json({ message: e.message || "Cashfree payment gateway is not configured." });
    }

    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const cfOrderId = "sub_cf_" + crypto.randomUUID().replace(/-/g, "").substring(0, 16);

    let origin = req.headers.origin || "https://classtech-v1.up.railway.app";
    const returnUrl = `${origin}/sales?verify_sub_order=${cfOrderId}`;

    const orderPayload = {
      order_id: cfOrderId,
      order_amount: amount,
      order_currency: "INR",
      customer_details: {
        customer_id: String(institute._id || institute.id).replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 50),
        customer_name: (institute.ownerName || institute.name || "Tuition Admin").substring(0, 50),
        customer_email: institute.adminEmail || "support@classtech.com",
        customer_phone: (institute.adminPhone || "9999999999").replace(/[^0-9]/g, "").slice(-10) || "9999999999",
      },
      order_meta: {
        return_url: returnUrl,
      },
      order_note: `Subscription (${institute.subscriptionPlan}) for ${institute.name}`,
    };

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const response = await axios.post(`${baseUrl}/orders`, orderPayload, { headers });

    const paymentLink = response.data.payments?.url || response.data.payment_link || (
      String(environment).toLowerCase() === "production" || String(environment).toLowerCase() === "live"
        ? `https://payments.cashfree.com/order/${response.data.payment_session_id}`
        : `https://payments-test.cashfree.com/order/${response.data.payment_session_id}`
    );

    await CashfreePayment.create({
      institute: institute._id || institute.id,
      instituteName: institute.name,
      plan: institute.subscriptionPlan,
      amount,
      type: "subscription",
      status: "pending",
      cfOrderId,
      paymentSessionId: response.data.payment_session_id,
      autoRenew: false,
      cfPaymentDetails: {
        environment,
        returnUrl,
        createdByStaff: req.user.name || "Sales Specialist",
        createdByStaffId: req.user._id || req.user.id,
      },
    });

    institute.subscriptionPaymentLink = paymentLink;
    institute.subscriptionOrderId = cfOrderId;
    institute.subscriptionPaymentStatus = "unpaid";
    await institute.save();

    // Update metadata if present
    try {
      const metadata = readInstitutesMetadata();
      const instId = String(institute._id || institute.id);
      if (metadata[instId]) {
        metadata[instId].subscriptionPaymentLink = paymentLink;
        metadata[instId].subscriptionOrderId = cfOrderId;
        metadata[instId].subscriptionPaymentStatus = "unpaid";
        writeInstitutesMetadata(metadata);
      }
    } catch (_) {}

    return res.json({
      success: true,
      message: "Payment link generated successfully!",
      paymentLink,
      cfOrderId,
      subscriptionPaymentStatus: "unpaid",
      amount,
    });
  } catch (error) {
    console.error("createSalesSubscriptionPaymentLink error:", error.response?.data || error);
    const msg = error.response?.data?.message || error.message || "Could not generate subscription payment link";
    return res.status(500).json({ message: msg });
  }
};

// POST /api/sales/institutes/:id/verify-subscription-payment
// Refresh/verify payment status for a tuition subscription
export const verifySalesSubscriptionPayment = async (req, res) => {
  try {
    const { id } = req.params;
    const institute = await Institute.findById(id);
    if (!institute) {
      return res.status(404).json({ message: "Tuition account not found" });
    }

    if (institute.subscriptionPaymentStatus === "paid") {
      return res.json({
        status: "paid",
        alreadyPaid: true,
        message: "Subscription payment is already verified and marked as paid.",
        payoutApprovalStatus: institute.payoutApprovalStatus || "pending",
        subscriptionPaidAt: institute.subscriptionPaidAt,
        subscriptionPaidAmount: institute.subscriptionPaidAmount,
      });
    }

    const orderIdToVerify = institute.subscriptionOrderId || req.body.cfOrderId;
    if (!orderIdToVerify) {
      return res.status(400).json({ message: "No active payment order found for this tuition." });
    }

    const cleanOrderId = String(orderIdToVerify).trim();
    let payment = await CashfreePayment.findOne({
      $or: [
        { cfOrderId: cleanOrderId },
        { paymentSessionId: cleanOrderId },
        { _id: cleanOrderId }
      ]
    });

    let config;
    try {
      config = await getCashfreeConfig();
    } catch (e) {
      return res.status(400).json({ message: "Cashfree gateway credentials not available." });
    }

    const result = await checkCashfreeOrderStatus(payment?.cfOrderId || cleanOrderId, config);

    if (payment) {
      payment.status = result.status;
      if (result.rawData && Object.keys(result.rawData).length > 0) {
        payment.cfPaymentDetails = {
          ...(payment.cfPaymentDetails || {}),
          ...result.rawData,
        };
      }
      await payment.save();
    }

    if (result.status === "success") {
      const paidAmount = Number(payment?.amount || institute.subscriptionAmount || 0);
      institute.subscriptionPaymentStatus = "paid";
      institute.subscriptionPaymentLink = ""; // Remove the link once paid!
      institute.subscriptionPaidAt = new Date();
      institute.subscriptionPaidAmount = paidAmount;
      if (!institute.payoutApprovalStatus) {
        institute.payoutApprovalStatus = "pending";
      }
      institute.status = "active";
      await institute.save();

      // Update metadata
      try {
        const metadata = readInstitutesMetadata();
        const instId = String(institute._id || institute.id);
        if (metadata[instId]) {
          metadata[instId].subscriptionPaymentStatus = "paid";
          metadata[instId].subscriptionPaymentLink = "";
          metadata[instId].subscriptionPaidAt = institute.subscriptionPaidAt;
          metadata[instId].subscriptionPaidAmount = paidAmount;
          metadata[instId].payoutApprovalStatus = institute.payoutApprovalStatus;
          writeInstitutesMetadata(metadata);
        }
      } catch (_) {}

      return res.json({
        status: "paid",
        message: "Payment successfully received and verified!",
        payoutApprovalStatus: institute.payoutApprovalStatus,
        subscriptionPaymentStatus: "paid",
        subscriptionPaidAt: institute.subscriptionPaidAt,
        subscriptionPaidAmount: paidAmount,
      });
    }

    return res.json({
      status: result.status,
      message: result.status === "pending"
        ? "Payment is still pending. Once client makes the payment, click Refresh Status."
        : `Payment status: ${result.status}`,
      subscriptionPaymentStatus: institute.subscriptionPaymentStatus,
      payoutApprovalStatus: institute.payoutApprovalStatus,
    });
  } catch (error) {
    console.error("verifySalesSubscriptionPayment error:", error);
    return res.status(500).json({ message: error.response?.data?.message || error.message || "Could not verify payment." });
  }
};

// GET /api/sales/payout-config
export const getPayoutConfig = async (req, res) => {
  try {
    const targetUserId = req.query.userId || req.user._id || req.user.id;
    const config = await getEffectivePayoutConfig(targetUserId);
    return res.json(config);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch payout configuration" });
  }
};

// PUT /api/sales/payout-config (Super Admin only)
export const updatePayoutConfig = async (req, res) => {
  try {
    if (req.user.role !== "super_admin" && req.user.role !== "tech_admin") {
      return res.status(403).json({ message: "Only Super Admin can update payout criteria" });
    }

    const { minSalesToQualify, fixedBasePayout, incentiveSlabs, userId } = req.body;
    const payload = {
      minSalesToQualify: Number(minSalesToQualify ?? 1),
      fixedBasePayout: Number(fixedBasePayout ?? 10000),
      incentiveSlabs: Array.isArray(incentiveSlabs) ? incentiveSlabs : DEFAULT_PAYOUT_CONFIG.incentiveSlabs,
    };

    if (userId) {
      const user = await User.findById(userId);
      if (user) {
        user.payoutConfig = payload;
        await user.save();
        return res.json({ message: "Employee payout criteria saved successfully", config: payload });
      }
    }

    let setting = await SystemSetting.findOne({ key: "sales_payout_config" });
    if (setting) {
      setting.value = payload;
      await setting.save();
    } else {
      await SystemSetting.create({
        key: "sales_payout_config",
        value: payload,
      });
    }

    return res.json({ message: "Payout criteria updated successfully", config: payload });
  } catch (error) {
    console.error("updatePayoutConfig error:", error);
    return res.status(500).json({ message: "Could not update payout criteria" });
  }
};
