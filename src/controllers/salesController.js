import Institute from "../models/Institute.js";
import User from "../models/User.js";
import SalesLead from "../models/SalesLead.js";
import SystemSetting from "../models/SystemSetting.js";
import bcrypt from "bcryptjs";
import { resolveSubscriptionEnd } from "../utils/subscription.js";
import {
  updateInstituteWalletBalanceMetadata,
  updateInstituteAiWalletBalanceMetadata,
} from "../utils/supabaseModel.js";
import { clearCachePattern } from "../utils/cache.js";
import { logActivity } from "../utils/activityLogger.js";

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
      const spId = String(inst.salesPerson || inst.createdBy || inst.adminUser || "");
      return spId === String(userId);
    });

    // Month Sales
    const monthInstitutes = myInstitutes.filter((inst) => {
      const d = new Date(inst.subscriptionStart || inst.createdAt);
      return d >= startOfMonth && inst.subscriptionPlan !== "trial";
    });

    // Today Sales
    const todayInstitutes = myInstitutes.filter((inst) => {
      const d = new Date(inst.subscriptionStart || inst.createdAt);
      return d >= startOfToday && inst.subscriptionPlan !== "trial";
    });

    // Calculate Month Payout & Incentives
    const monthSalesCount = monthInstitutes.length;
    const monthSalesVolume = monthInstitutes.reduce((sum, inst) => sum + Number(inst.subscriptionAmount || 0), 0);

    const isQualified = monthSalesCount >= config.minSalesToQualify;
    const fixedPayoutEarned = isQualified ? config.fixedBasePayout : 0;

    const salesBreakdown = monthInstitutes.map((inst) => {
      const amount = Number(inst.subscriptionAmount || 0);
      const incentive = calculateIncentiveForAmount(amount, config.incentiveSlabs);
      return {
        _id: inst._id || inst.id,
        instituteName: inst.name,
        ownerName: inst.ownerName,
        plan: inst.subscriptionPlan,
        amount,
        incentive,
        date: inst.subscriptionStart || inst.createdAt,
      };
    });

    const totalIncentiveEarned = salesBreakdown.reduce((sum, item) => sum + item.incentive, 0);
    const totalEstimatedPayout = fixedPayoutEarned + totalIncentiveEarned;

    // 2. Fetch Leads for Today's Follow-ups and Call Counts
    const allLeads = await SalesLead.find();
    const myLeads = allLeads.filter((lead) => {
      if (userRole === "super_admin" || userRole === "tech_admin") return true;
      const leadSpId = String(lead.salesPerson || lead.addedBy || "");
      return !leadSpId || leadSpId === String(userId) || lead.source === "Super Admin";
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

    const filtered = leads.filter((lead) => {
      if (userRole === "super_admin" || userRole === "tech_admin") return true;
      const spId = String(lead.salesPerson || lead.addedBy || "");
      return !spId || spId === String(userId) || lead.source === "Super Admin";
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
      city,
      studentCapacity,
      planInterest,
      status,
      notes,
      nextFollowUpDate,
    } = req.body;

    if (!coachingName || !contactPerson || !phone) {
      return res.status(400).json({ message: "Coaching Name, Contact Person and Phone are required." });
    }

    const source = req.user.role === "super_admin" ? "Super Admin" : "Self-Added";

    const newLead = await SalesLead.create({
      coachingName: coachingName.trim(),
      contactPerson: contactPerson.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : "",
      city: city ? city.trim() : "",
      studentCapacity: studentCapacity ? studentCapacity.trim() : "",
      planInterest: planInterest || "Yearly Subscription",
      status: status || "new",
      source,
      salesPerson: req.user._id || req.user.id,
      salesPersonName: req.user.name || "Sales Specialist",
      addedBy: req.user._id || req.user.id,
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
      const spId = String(inst.salesPerson || inst.createdBy || inst.adminUser || "");
      return spId === String(userId);
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
      walletBalance: 100, // complimentary starter wallet
      aiWalletBalance: 50, // complimentary starter AI balance
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
        status: institute.status,
        walletBalance: institute.walletBalance,
        aiWalletBalance: institute.aiWalletBalance,
      },
    });
  } catch (error) {
    console.error("createSalesInstitute error:", error);
    return res.status(500).json({ message: error.message || "Could not onboard tuition account" });
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
