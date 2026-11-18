import mongoose from "../utils/supabaseModel.js";
import Organization from "../models/Organization.js";
import Institute from "../models/Institute.js";
import UserBranchMembership from "../models/UserBranchMembership.js";
import User from "../models/User.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import { signSessionToken } from "../utils/jwtHelper.js";

/**
 * Resolve current institute helper
 */
async function resolveCurrentInstitute(req) {
  let currentInstituteId = req.headers["x-branch-id"] ||
    req.headers["x-institute-id"] ||
    req.user.institute?._id ||
    req.user.institute?.id ||
    req.user.institute;

  let institute = null;
  if (currentInstituteId && typeof currentInstituteId === "object") {
    currentInstituteId = currentInstituteId._id || currentInstituteId.id;
  }
  const cleanId = String(currentInstituteId || "").trim();

  if (cleanId && cleanId.length >= 8 && cleanId !== "[object Object]") {
    try {
      institute = await Institute.findById(cleanId);
    } catch (_) {}
  }

  if (!institute && req.user._id) {
    try {
      institute = await Institute.findOne({ adminUser: req.user._id });
    } catch (_) {}
  }

  return institute;
}

/**
 * GET /teacher/branches
 * List all branches belonging to user's organization or account
 */
export const getBranches = async (req, res) => {
  try {
    const currentInstitute = await resolveCurrentInstitute(req);
    const currentInstId = currentInstitute
      ? String(currentInstitute._id || currentInstitute.id)
      : null;

    let org = null;
    let rawBranches = [];

    // 1. Check if current institute is tied to an organization
    const orgId = currentInstitute?.organization || currentInstitute?.organization_id;
    if (orgId) {
      try {
        org = await Organization.findById(orgId);
        if (org) {
          rawBranches = await Institute.find({
            $or: [
              { organization: org._id },
              { organization_id: org._id },
              { parentInstitute: currentInstitute._id },
              { parent_institute: currentInstitute._id },
            ]
          }).sort({ isHeadquarters: -1, createdAt: 1 });
        }
      } catch (_) {}
    }

    // 2. Check if user has memberships across branches
    if (rawBranches.length === 0 && req.user._id) {
      try {
        const memberships = await UserBranchMembership.find({ user: req.user._id });
        if (memberships && memberships.length > 0) {
          const mInstIds = memberships.map(m => m.institute).filter(Boolean);
          rawBranches = await Institute.find({
            $or: [
              { _id: { $in: mInstIds } },
              { id: { $in: mInstIds } },
            ]
          }).sort({ isHeadquarters: -1, createdAt: 1 });
        }
      } catch (_) {}
    }

    // 3. Check if user owns an organization
    if (rawBranches.length === 0 && req.user._id) {
      try {
        const userOrg = await Organization.findOne({ ownerUser: req.user._id });
        if (userOrg) {
          org = userOrg;
          rawBranches = await Institute.find({
            $or: [{ organization: userOrg._id }, { organization_id: userOrg._id }]
          }).sort({ isHeadquarters: -1, createdAt: 1 });
        }
      } catch (_) {}
    }

    // 4. Check if current institute has child branches via parentInstitute
    if (rawBranches.length <= 1 && currentInstitute) {
      try {
        const childBranches = await Institute.find({
          $or: [
            { parentInstitute: currentInstitute._id },
            { parent_institute: currentInstitute._id },
          ]
        }).sort({ createdAt: 1 });
        if (childBranches.length > 0) {
          const allB = [currentInstitute, ...childBranches];
          const unique = [];
          const seen = new Set();
          for (const b of allB) {
            const id = String(b._id || b.id);
            if (!seen.has(id)) {
              seen.add(id);
              unique.push(b);
            }
          }
          rawBranches = unique;
        }
      } catch (_) {}
    }

    // 5. Fallback: check if user is admin of multiple institutes
    if (rawBranches.length === 0 && req.user._id) {
      try {
        rawBranches = await Institute.find({ adminUser: req.user._id }).sort({ createdAt: 1 });
      } catch (_) {}
    }

    // 6. Fallback to just the current institute if exists
    if (rawBranches.length === 0 && currentInstitute) {
      rawBranches = [currentInstitute];
    }

    // Build branch summaries with batch and student counts
    const branches = await Promise.all(
      rawBranches.map(async (b) => {
        const bId = String(b._id || b.id);
        const ownerId = b.adminUser || b._id;
        const userFilterIds = Array.from(new Set([String(ownerId), bId].filter(Boolean)));

        let studentsCount = 0;
        let batchesCount = 0;

        try {
          studentsCount = await Student.countDocuments({
            user: { $in: userFilterIds },
            isArchived: { $ne: true },
          });
        } catch (_) {}

        try {
          batchesCount = await Batch.countDocuments({
            user: { $in: userFilterIds },
            status: { $ne: "archived" },
          });
        } catch (_) {}

        return {
          id: bId,
          _id: bId,
          name: b.name || "Branch Campus",
          branchCode: b.branchCode || (b.isHeadquarters ? "HQ-01" : "MAIN"),
          city: b.city || "",
          address: b.address || "",
          isHeadquarters: Boolean(b.isHeadquarters),
          isActive: bId === currentInstId,
          studentsCount,
          batchesCount,
          status: b.status || "active",
        };
      })
    );

    return res.json({
      success: true,
      isMultiBranch: Boolean(org) || branches.length >= 2,
      organization: org || (branches.length >= 2 ? { name: `${currentInstitute?.name || 'Academy'} Network` } : null),
      activeBranchId: currentInstId,
      branches,
    });
  } catch (error) {
    console.error("getBranches error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /teacher/branches/upgrade
 * Upgrade current institute into an Organization Headquarters
 */
export const upgradeToMultiBranch = async (req, res) => {
  try {
    const currentInstitute = await resolveCurrentInstitute(req);
    if (!currentInstitute) {
      return res.status(400).json({
        success: false,
        message: "No active institute found to upgrade.",
      });
    }

    // If already has an organization, return existing
    if (currentInstitute.organization || currentInstitute.organization_id) {
      const orgId = currentInstitute.organization || currentInstitute.organization_id;
      const existingOrg = await Organization.findById(orgId);
      if (existingOrg) {
        return res.json({
          success: true,
          message: "Institute is already part of an organization.",
          organization: existingOrg,
        });
      }
    }

    const orgName = (req.body.organizationName || "").trim() || `${currentInstitute.name} Group`;
    const maxBranches = Number(req.body.maxBranches || 10);

    const org = await Organization.create({
      name: orgName,
      ownerUser: req.user._id,
      ownerName: currentInstitute.ownerName || req.user.name || "Director",
      adminEmail: currentInstitute.adminEmail || req.user.email,
      adminPhone: currentInstitute.adminPhone || req.user.phone || "",
      planType: "multi_branch_pro",
      maxBranches: maxBranches,
      status: "active",
      settings: {
        sharedTestSeries: true,
        sharedNotes: true,
        sharedStaff: true,
      },
    });

    // Update current institute as HQ
    await Institute.updateOne(
      { _id: currentInstitute._id },
      {
        organization: org._id,
        isHeadquarters: true,
        branchCode: req.body.branchCode || "HQ-01",
        city: req.body.city || currentInstitute.city || "Headquarters",
        address: req.body.address || currentInstitute.address || "",
      }
    );

    // Create user branch membership
    await UserBranchMembership.create({
      user: req.user._id,
      institute: currentInstitute._id,
      organization: org._id,
      role: "org_admin",
    }).catch(() => {});

    return res.json({
      success: true,
      message: "Successfully upgraded to Multi-Branch organization!",
      organization: org,
    });
  } catch (error) {
    console.error("upgradeToMultiBranch error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /teacher/branches
 * Create a new branch under current organization
 */
export const createBranch = async (req, res) => {
  try {
    const { name, branchCode, city, address, adminEmail, adminPhone } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: "Branch name is required." });
    }

    let currentInstitute = await resolveCurrentInstitute(req);
    if (!currentInstitute) {
      return res.status(400).json({ success: false, message: "No active institute found." });
    }

    let orgId = currentInstitute.organization || currentInstitute.organization_id;
    let org = null;

    // Auto-upgrade if not part of an organization yet
    if (!orgId) {
      org = await Organization.create({
        name: `${currentInstitute.name} Group`,
        ownerUser: req.user._id,
        ownerName: currentInstitute.ownerName || req.user.name || "Director",
        adminEmail: currentInstitute.adminEmail || req.user.email,
        adminPhone: currentInstitute.adminPhone || req.user.phone || "",
        planType: "multi_branch_pro",
        maxBranches: 10,
        status: "active",
      });
      orgId = org._id;

      await Institute.updateOne(
        { _id: currentInstitute._id },
        {
          organization: orgId,
          organization_id: orgId,
          tuitionType: "multi_branch",
          isHeadquarters: true,
          branchCode: currentInstitute.branchCode || "HQ-01",
          city: currentInstitute.city || "Main Campus",
        }
      );
    } else {
      org = await Organization.findById(orgId);
    }

    if (!org) {
      return res.status(404).json({ success: false, message: "Organization not found." });
    }

    // Check branch count limits
    const existingBranches = await Institute.find({
      $or: [
        { organization: org._id },
        { organization_id: org._id },
        { parentInstitute: currentInstitute._id },
        { parent_institute: currentInstitute._id },
      ],
    });
    const maxBranches = org.maxBranches || 10;
    if (existingBranches.length >= maxBranches) {
      return res.status(400).json({
        success: false,
        message: `Branch limit of ${maxBranches} reached. Please upgrade organization plan to add more campuses.`,
      });
    }

    const branchIdx = existingBranches.length + 1;
    const finalBranchCode = branchCode?.trim() || `BR-0${branchIdx}`;

    // Create the new branch institute
    const newBranch = await Institute.create({
      name: name.trim(),
      ownerName: currentInstitute.ownerName || req.user.name,
      adminEmail: (adminEmail || currentInstitute.adminEmail || "").toLowerCase().trim(),
      adminPhone: adminPhone || currentInstitute.adminPhone || "",
      adminUser: currentInstitute.adminUser || req.user._id,
      organization: orgId,
      organization_id: orgId,
      parentInstitute: currentInstitute._id,
      parent_institute: currentInstitute._id,
      tuitionType: "multi_branch",
      isHeadquarters: false,
      branchCode: finalBranchCode,
      city: city ? city.trim() : "",
      address: address ? address.trim() : "",
      subscriptionPlan: currentInstitute.subscriptionPlan || "yearly",
      subscriptionAmount: 0,
      subscriptionStart: currentInstitute.subscriptionStart || new Date(),
      subscriptionEnd: currentInstitute.subscriptionEnd || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      status: "active",
      allowedFeatures: currentInstitute.allowedFeatures || [
        "attendance", "notes", "marks", "tests", "finances", "whatsapp", "leads"
      ],
    });

    // Add branch membership for new branch
    await UserBranchMembership.create({
      user: req.user._id,
      institute: newBranch._id,
      organization: orgId,
      role: "branch_admin",
    }).catch(() => {});

    // Ensure org admin membership for the current institute
    await UserBranchMembership.create({
      user: req.user._id,
      institute: currentInstitute._id,
      organization: orgId,
      role: "org_admin",
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: "Branch created successfully!",
      branch: {
        id: String(newBranch._id || newBranch.id),
        _id: String(newBranch._id || newBranch.id),
        name: newBranch.name,
        branchCode: newBranch.branchCode,
        city: newBranch.city,
        address: newBranch.address,
        isHeadquarters: false,
        isActive: false,
        studentsCount: 0,
        batchesCount: 0,
      },
    });
  } catch (error) {
    console.error("createBranch error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * POST /teacher/branches/switch
 * Switch active branch session
 */
export const switchBranch = async (req, res) => {
  try {
    const { branchId } = req.body;
    if (!branchId) {
      return res.status(400).json({ success: false, message: "Branch ID is required." });
    }

    const targetBranch = await Institute.findById(branchId);
    if (!targetBranch) {
      return res.status(404).json({ success: false, message: "Branch not found." });
    }

    const currentInstitute = await resolveCurrentInstitute(req);
    const orgId = currentInstitute?.organization || currentInstitute?.organization_id;
    const targetOrgId = targetBranch.organization || targetBranch.organization_id;

    // Check authorization:
    // 1. Super admin
    // 2. Direct owner / adminUser of target branch
    // 3. Same organization
    // 4. UserBranchMembership record
    const isSuper = req.user.role === "super_admin" || req.user.isSuperAdmin === true;
    const isOwner = String(targetBranch.adminUser) === String(req.user._id);
    const isSameOrg = orgId && targetOrgId && String(orgId) === String(targetOrgId);

    let hasMembership = false;
    if (!isSuper && !isOwner && !isSameOrg) {
      const membership = await UserBranchMembership.findOne({
        user: req.user._id,
        institute: targetBranch._id,
      });
      hasMembership = Boolean(membership);
    }

    if (!isSuper && !isOwner && !isSameOrg && !hasMembership) {
      return res.status(403).json({
        success: false,
        message: "You do not have access to switch to this branch.",
      });
    }

    // Sign new JWT token scoped to this branch
    const token = signSessionToken({
      id: req.user._id,
      email: req.user.email,
      name: req.user.name,
      role: req.user.role || "institute_admin",
      institute: targetBranch._id,
      activeInstituteId: targetBranch._id,
      organization: targetBranch.organization || null,
      isHeadquarters: Boolean(targetBranch.isHeadquarters),
      branchCode: targetBranch.branchCode || "",
    });

    return res.json({
      success: true,
      message: `Switched to branch "${targetBranch.name}" successfully`,
      token,
      institute: {
        id: String(targetBranch._id || targetBranch.id),
        _id: String(targetBranch._id || targetBranch.id),
        name: targetBranch.name,
        branchCode: targetBranch.branchCode || "",
        city: targetBranch.city || "",
        isHeadquarters: Boolean(targetBranch.isHeadquarters),
        tuitionType: "multi_branch",
        organization: targetBranch.organization || targetBranch.organization_id || orgId,
        organization_id: targetBranch.organization || targetBranch.organization_id || orgId,
        parentInstitute: targetBranch.parentInstitute || targetBranch.parent_institute || null,
      },
      user: {
        _id: req.user._id,
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role || "institute_admin",
        institute: targetBranch._id,
      },
    });
  } catch (error) {
    console.error("switchBranch error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * GET /teacher/branches/hq-analytics
 * Consolidated HQ Analytics across all branches in the organization
 */
export const getHqAnalytics = async (req, res) => {
  try {
    const currentInstitute = await resolveCurrentInstitute(req);
    let orgId = currentInstitute?.organization || currentInstitute?.organization_id;

    if (!orgId && req.user._id) {
      // Check if user owns an organization directly
      const userOrg = await Organization.findOne({ ownerUser: req.user._id });
      if (userOrg) orgId = userOrg._id;
    }

    if (!orgId && req.user._id) {
      const membership = await UserBranchMembership.findOne({ user: req.user._id, organization: { $ne: null } });
      if (membership?.organization) orgId = membership.organization;
    }

    if (!orgId && currentInstitute?.parentInstitute) {
      const parent = await Institute.findById(currentInstitute.parentInstitute);
      orgId = parent?.organization || parent?.organization_id;
    }

    let org = orgId ? await Organization.findById(orgId) : null;
    let branches = [];
    if (org) {
      branches = await Institute.find({
        $or: [
          { organization: org._id },
          { organization_id: org._id },
          ...(currentInstitute ? [{ parentInstitute: currentInstitute._id }, { parent_institute: currentInstitute._id }] : []),
        ],
      }).sort({ isHeadquarters: -1, createdAt: 1 });
    } else if (currentInstitute) {
      branches = await Institute.find({
        $or: [
          { _id: currentInstitute._id },
          { id: currentInstitute._id },
          { parentInstitute: currentInstitute._id },
          { parent_institute: currentInstitute._id },
          { adminUser: req.user._id },
        ],
      }).sort({ isHeadquarters: -1, createdAt: 1 });
    }

    if (branches.length === 0 && currentInstitute) {
      branches = [currentInstitute];
    }

    let totalStudentsAcross = 0;
    let totalBatchesAcross = 0;
    let totalCollectedFeesAcross = 0;
    let totalPendingFeesAcross = 0;

    const branchAnalytics = await Promise.all(
      branches.map(async (branch) => {
        const bId = String(branch._id || branch.id);
        const ownerId = branch.adminUser || branch._id;
        const userFilterIds = Array.from(new Set([String(ownerId), bId].filter(Boolean)));

        let students = [];
        let batchesCount = 0;

        try {
          students = await Student.find({
            user: { $in: userFilterIds },
            isArchived: { $ne: true },
          }).select("_id paidAmount pendingAmount totalFees fees paymentHistory").lean();
        } catch (_) {}

        try {
          batchesCount = await Batch.countDocuments({
            user: { $in: userFilterIds },
            status: { $ne: "archived" },
          });
        } catch (_) {}

        let branchCollected = 0;
        let branchPending = 0;

        for (const s of students) {
          const total = Number(s.totalFees ?? s.fees ?? 0);
          const history = s.paymentHistory || [];
          const paidFromHistory = history.reduce((sum, p) => sum + Number(p?.amount || 0), 0);
          const paid = (s.paidAmount !== undefined && s.paidAmount !== null && !isNaN(Number(s.paidAmount)))
            ? Math.max(Number(s.paidAmount), paidFromHistory)
            : paidFromHistory;
          const pending = (s.pendingAmount !== undefined && s.pendingAmount !== null && !isNaN(Number(s.pendingAmount)))
            ? Number(s.pendingAmount)
            : Math.max(0, total > 0 ? (total - paid) : 0);

          branchCollected += paid;
          branchPending += pending;
        }

        totalStudentsAcross += students.length;
        totalBatchesAcross += batchesCount;
        totalCollectedFeesAcross += branchCollected;
        totalPendingFeesAcross += branchPending;

        return {
          branchId: bId,
          name: branch.name,
          branchCode: branch.branchCode || (branch.isHeadquarters ? "HQ-01" : "MAIN"),
          city: branch.city || "",
          address: branch.address || "",
          isHeadquarters: Boolean(branch.isHeadquarters),
          status: branch.status || "active",
          studentsCount: students.length,
          batchesCount: batchesCount,
          collectedFees: branchCollected,
          pendingFees: branchPending,
          totalRevenue: branchCollected + branchPending,
        };
      })
    );

    return res.json({
      success: true,
      organization: org ? {
        id: String(org._id || org.id),
        name: org.name,
        planType: org.planType || "multi_branch_pro",
        maxBranches: org.maxBranches || 10,
        status: org.status || "active",
      } : {
        id: "org_default",
        name: `${currentInstitute?.name || 'Academy'} Network`,
        planType: "multi_branch_pro",
        maxBranches: 10,
        status: "active",
      },
      summary: {
        totalBranches: branches.length,
        totalStudentsAcrossBranches: totalStudentsAcross,
        totalBatchesAcrossBranches: totalBatchesAcross,
        totalCollectedFeesAcrossBranches: totalCollectedFeesAcross,
        totalPendingFeesAcrossBranches: totalPendingFeesAcross,
        totalGroupRevenue: totalCollectedFeesAcross + totalPendingFeesAcross,
      },
      branches: branchAnalytics,
    });
  } catch (error) {
    console.error("getHqAnalytics error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
