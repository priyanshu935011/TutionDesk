import StudentPass from "../models/StudentPass.js";
import StudentEntitlement from "../models/StudentEntitlement.js";
import StudentPackage from "../models/StudentPackage.js";
import Student from "../models/Student.js";
import Order from "../models/Order.js";
import { supabase } from "../utils/supabase.js";
import { deleteCache } from "../utils/cache.js";
import { logActivity } from "../utils/activityLogger.js";

/**
 * Helper to fetch student details by an array of student IDs
 */
async function resolveStudentMap(studentIds) {
  const map = new Map();
  if (!studentIds || studentIds.length === 0) return map;

  const uniqueIds = [...new Set(studentIds.filter(Boolean).map(String))];

  // 1. Try Supabase students table
  try {
    if (supabase) {
      const { data: sbStudents, error } = await supabase
        .from("students")
        .select("id, name, email, phone, enrollment_number, avatar, plan_tier")
        .in("id", uniqueIds);

      if (!error && Array.isArray(sbStudents)) {
        for (const s of sbStudents) {
          map.set(String(s.id), {
            id: s.id,
            name: s.name || "Student",
            email: s.email || "",
            phone: s.phone || "",
            enrollmentNumber: s.enrollment_number || "-",
            avatar: s.avatar || "",
            planTier: s.plan_tier || "free",
          });
        }
      }
    }
  } catch (err) {
    console.warn("[resolveStudentMap] Supabase error:", err.message);
  }

  // 2. Fallback to Mongoose Student model for any unresolved
  const missingIds = uniqueIds.filter((id) => !map.has(id));
  if (missingIds.length > 0) {
    try {
      const mongooseStudents = await Student.find({
        $or: [
          { _id: { $in: missingIds } },
          { id: { $in: missingIds } },
          { user: { $in: missingIds } },
        ],
      });

      for (const s of mongooseStudents) {
        const sid = String(s.id || s._id);
        const uid = s.user ? String(s.user) : null;
        const studentObj = {
          id: sid,
          name: s.name || "Student",
          email: s.email || "",
          phone: s.phone || "",
          enrollmentNumber: s.enrollmentNumber || "-",
          avatar: s.avatar || "",
          planTier: s.plan_tier || s.planTier || "free",
        };
        map.set(sid, studentObj);
        if (uid) map.set(uid, studentObj);
      }
    } catch (err) {
      console.warn("[resolveStudentMap] Mongoose error:", err.message);
    }
  }

  return map;
}

/**
 * 1. GET ALL STUDENT SUBSCRIPTIONS (ClassTech Premium + ClassTech Pass)
 */
export const getAdminStudentSubscriptions = async (req, res) => {
  try {
    const { search, type, status } = req.query;
    const now = new Date();

    // 1. Fetch ClassTech Passes
    let passes = [];
    try {
      passes = await StudentPass.find({}).sort({ createdAt: -1 });
    } catch (passErr) {
      console.warn("[getAdminStudentSubscriptions] StudentPass.find error:", passErr.message);
    }

    // 2. Fetch ClassTech Premium Entitlements
    let entitlements = [];
    try {
      const allEntitlements = await StudentEntitlement.find({}).populate("activePackage");
      entitlements = allEntitlements.filter((e) => {
        const t = String(e.current_tier || e.currentTier || e.tier || "").toLowerCase();
        return t === "premium" || Boolean(e.tier_expires_at || e.tierExpiresAt || e.packageExpiresAt);
      });
    } catch (entErr) {
      console.warn("[getAdminStudentSubscriptions] StudentEntitlement.find error:", entErr.message);
    }

    // 3. Also check Students marked as premium that might not have an entitlement yet
    let premiumStudents = [];
    try {
      const allStudents = await Student.find({});
      premiumStudents = allStudents.filter((s) => {
        const pt = String(s.plan_tier || s.planTier || "").toLowerCase();
        return pt === "premium";
      });
    } catch (stuErr) {
      console.warn("[getAdminStudentSubscriptions] Student.find error:", stuErr.message);
    }

    // 4. Also check Paid Orders that purchased ClassTech Pass or Premium
    let passOrders = [];
    try {
      const allPaidOrders = await Order.find({ paymentStatus: "paid" });
      passOrders = (allPaidOrders || []).filter((o) => {
        return (o.items || []).some((item) => {
          const title = String(item.title || "").toLowerCase();
          const pType = String(item.productType || "").toLowerCase();
          return title.includes("pass") || title.includes("premium") || pType === "pass";
        });
      });
    } catch (orderErr) {
      console.warn("[getAdminStudentSubscriptions] Order.find error:", orderErr.message);
    }

    // Collect all student IDs to resolve their profiles in batch
    const studentIds = [
      ...passes.map((p) => p.studentId),
      ...entitlements.map((e) => e.studentId || e.student_id),
      ...premiumStudents.map((s) => s.id || s._id),
      ...passOrders.map((o) => o.studentId),
    ].filter(Boolean);

    const studentMap = await resolveStudentMap(studentIds);

    const unifiedList = [];
    const seenPassIds = new Set();
    const seenEntitlementStudentIds = new Set();

    // A. Add ClassTech Passes
    for (const pass of passes) {
      const pid = String(pass._id || pass.id);
      seenPassIds.add(pid);

      const sid = String(pass.studentId || "");
      const studentInfo = studentMap.get(sid) || {};

      const expiry = pass.validUntil ? new Date(pass.validUntil) : null;
      let calculatedStatus = "active";
      if (pass.status === "cancelled" || pass.status === "revoked") {
        calculatedStatus = "cancelled";
      } else if (expiry && expiry < now) {
        calculatedStatus = "expired";
      } else if (pass.status === "active") {
        calculatedStatus = "active";
      } else {
        calculatedStatus = pass.status || "active";
      }

      unifiedList.push({
        id: pid,
        rawId: pid,
        subscriptionType: "classtech_pass",
        typeLabel: "ClassTech Pass",
        planTitle: pass.passTitle || "ClassTech All-Access Pass",
        studentId: sid,
        studentName: studentInfo.name || "ClassTech Student",
        studentEmail: studentInfo.email || "",
        studentPhone: studentInfo.phone || "",
        enrollmentNumber: studentInfo.enrollmentNumber || "-",
        avatar: studentInfo.avatar || "",
        price: Number(pass.price || 999),
        orderId: pass.orderId || pass.cfOrderId || pass.paymentId || "-",
        startDate: pass.validFrom || pass.createdAt || new Date(),
        expiryDate: pass.validUntil,
        status: calculatedStatus,
        validityDays: pass.validityDays || 365,
        claimedProducts: pass.claimedProducts || [],
        features: [
          "1-Click unlock on Store Test Series",
          "Unrestricted Notes Library Access",
          "Priority AI Doubt Retest Engine",
        ],
        createdAt: pass.createdAt || new Date(),
      });
    }

    // B. Add ClassTech Premium Entitlements
    for (const ent of entitlements) {
      const sid = String(ent.studentId || ent.student_id || "");
      seenEntitlementStudentIds.add(sid);

      const studentInfo = studentMap.get(sid) || {};
      const pkg = ent.activePackage || {};
      const pkgTitle = pkg.title || pkg.name || "ClassTech Premium";
      const pkgPrice = Number(pkg.discountedPrice || pkg.discounted_price || pkg.price || 299);

      const expiry = ent.packageExpiresAt || ent.tier_expires_at ? new Date(ent.packageExpiresAt || ent.tier_expires_at) : null;
      const currentTier = String(ent.tier || ent.current_tier || "free").toLowerCase();

      let calculatedStatus = "active";
      if (currentTier !== "premium") {
        calculatedStatus = "cancelled";
      } else if (expiry && expiry < now) {
        calculatedStatus = "expired";
      } else {
        calculatedStatus = "active";
      }

      // Check if there is an associated order
      const matchedOrder = passOrders.find(
        (o) => String(o.studentId) === sid && o.items?.some((i) => i.title?.toLowerCase().includes("premium"))
      );

      unifiedList.push({
        id: String(ent._id || ent.id),
        rawId: String(ent._id || ent.id),
        subscriptionType: "classtech_premium",
        typeLabel: "ClassTech Premium",
        planTitle: `${pkgTitle} (${(pkg.billingCycle || pkg.billing_cycle || "monthly").toUpperCase()})`,
        studentId: sid,
        studentName: studentInfo.name || "ClassTech Student",
        studentEmail: studentInfo.email || "",
        studentPhone: studentInfo.phone || "",
        enrollmentNumber: studentInfo.enrollmentNumber || "-",
        avatar: studentInfo.avatar || "",
        price: pkgPrice,
        orderId: matchedOrder?.orderNumber || `PREM-${sid.slice(-6).toUpperCase()}`,
        startDate: ent.createdAt || new Date(),
        expiryDate: expiry,
        status: calculatedStatus,
        validityDays: pkg.billingCycle === "yearly" ? 365 : 30,
        features: [
          "24/7 AI Voice & Doubt Tutor",
          "Unlimited Spaced Mistake Retests",
          "500 Flashcards Quota",
          "Unrestricted Gamified Focus Mode",
        ],
        createdAt: ent.createdAt || new Date(),
      });
    }

    // C. Add any Premium Students not yet in Entitlements
    for (const stu of premiumStudents) {
      const sid = String(stu.id || stu._id);
      if (seenEntitlementStudentIds.has(sid)) continue;

      unifiedList.push({
        id: `stu_prem_${sid}`,
        rawId: sid,
        subscriptionType: "classtech_premium",
        typeLabel: "ClassTech Premium",
        planTitle: "ClassTech Premium (Active)",
        studentId: sid,
        studentName: stu.name || "ClassTech Student",
        studentEmail: stu.email || "",
        studentPhone: stu.phone || "",
        enrollmentNumber: stu.enrollmentNumber || "-",
        avatar: stu.avatar || "",
        price: 299,
        orderId: `PREM-${sid.slice(-6).toUpperCase()}`,
        startDate: stu.createdAt || new Date(),
        expiryDate: null,
        status: "active",
        validityDays: 30,
        features: [
          "24/7 AI Voice & Doubt Tutor",
          "Unlimited Spaced Mistake Retests",
          "500 Flashcards Quota",
        ],
        createdAt: stu.createdAt || new Date(),
      });
    }

    // Sort unified list descending by createdAt or startDate
    unifiedList.sort((a, b) => new Date(b.createdAt || b.startDate) - new Date(a.createdAt || a.startDate));

    // Calculate Metrics
    const totalSubscriptions = unifiedList.length;
    const activeSubscriptions = unifiedList.filter((s) => s.status === "active").length;
    const activePremium = unifiedList.filter((s) => s.subscriptionType === "classtech_premium" && s.status === "active").length;
    const activePasses = unifiedList.filter((s) => s.subscriptionType === "classtech_pass" && s.status === "active").length;
    const totalRevenue = unifiedList
      .filter((s) => s.status !== "cancelled")
      .reduce((sum, s) => sum + (Number(s.price) || 0), 0);

    // Apply Filters if query params present
    let filteredList = unifiedList;

    if (type && type !== "all") {
      filteredList = filteredList.filter((s) => s.subscriptionType === type);
    }

    if (status && status !== "all") {
      filteredList = filteredList.filter((s) => s.status === status);
    }

    if (search && search.trim()) {
      const q = search.trim().toLowerCase();
      filteredList = filteredList.filter((s) =>
        (s.studentName || "").toLowerCase().includes(q) ||
        (s.studentEmail || "").toLowerCase().includes(q) ||
        (s.studentPhone || "").includes(q) ||
        (s.orderId || "").toLowerCase().includes(q) ||
        (s.planTitle || "").toLowerCase().includes(q) ||
        (s.enrollmentNumber || "").toLowerCase().includes(q)
      );
    }

    return res.json({
      success: true,
      metrics: {
        totalSubscriptions,
        activeSubscriptions,
        activePremium,
        activePasses,
        totalRevenue,
      },
      subscriptions: filteredList,
    });
  } catch (error) {
    console.error("[getAdminStudentSubscriptions] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch student subscriptions",
      error: error.message,
    });
  }
};

/**
 * 2. CANCEL A STUDENT SUBSCRIPTION (ClassTech Premium or ClassTech Pass)
 */
export const cancelAdminStudentSubscription = async (req, res) => {
  try {
    const { subscriptionId, type, reason } = req.body;
    if (!subscriptionId) {
      return res.status(400).json({ success: false, message: "Subscription ID is required" });
    }

    const cancelReason = reason || "Cancelled by Super Administrator";
    let targetStudentId = null;
    let cancelledType = type || "classtech_pass";

    // -------------------------------------------------------------
    // CASE A: CLASSTECH PASS CANCELLATION
    // -------------------------------------------------------------
    if (type === "classtech_pass" || !subscriptionId.startsWith("stu_prem_")) {
      // 1. Try finding StudentPass
      let pass = null;
      try {
        pass = await StudentPass.findById(subscriptionId);
      } catch (_) {}

      if (!pass) {
        pass = await StudentPass.findOne({
          $or: [{ _id: subscriptionId }, { id: subscriptionId }, { orderId: subscriptionId }],
        });
      }

      if (pass) {
        targetStudentId = pass.studentId;
        pass.status = "cancelled";
        await pass.save();

        // Also update Supabase student_classtech_passes table if present
        try {
          if (supabase) {
            await supabase
              .from("student_classtech_passes")
              .update({ status: "cancelled", updated_at: new Date().toISOString() })
              .or(`id.eq.${subscriptionId},order_id.eq.${subscriptionId}`);
          }
        } catch (_) {}

        cancelledType = "classtech_pass";
      }
    }

    // -------------------------------------------------------------
    // CASE B: CLASSTECH PREMIUM CANCELLATION
    // -------------------------------------------------------------
    if (type === "classtech_premium" || subscriptionId.startsWith("stu_prem_") || !targetStudentId) {
      let entId = subscriptionId.replace("stu_prem_", "");

      // 1. Try finding StudentEntitlement
      let ent = null;
      try {
        ent = await StudentEntitlement.findById(entId);
      } catch (_) {}

      if (!ent) {
        ent = await StudentEntitlement.findOne({
          $or: [{ _id: entId }, { id: entId }, { studentId: entId }, { student_id: entId }],
        });
      }

      if (ent) {
        targetStudentId = ent.studentId || ent.student_id;
        ent.tier = "free";
        ent.current_tier = "free";
        ent.activePackage = null;
        ent.package_id = null;
        ent.packageExpiresAt = null;
        ent.tier_expires_at = null;
        await ent.save();

        // Also update in Supabase student_entitlements
        try {
          if (supabase) {
            await supabase
              .from("student_entitlements")
              .update({
                current_tier: "free",
                tier_expires_at: null,
                package_id: null,
                updated_at: new Date().toISOString(),
              })
              .or(`id.eq.${entId},student_id.eq.${targetStudentId}`);
          }
        } catch (_) {}

        cancelledType = "classtech_premium";
      } else {
        targetStudentId = entId;
      }
    }

    // -------------------------------------------------------------
    // DOWNGRADE STUDENT MODEL IF NO OTHER ACTIVE PASS/PREMIUM
    // -------------------------------------------------------------
    if (targetStudentId) {
      // Check if student still holds an active pass
      const otherActivePass = await StudentPass.findOne({
        studentId: String(targetStudentId),
        status: "active",
        validUntil: { $gt: new Date() },
      });

      // Check if student still holds an active entitlement
      const otherActiveEnt = await StudentEntitlement.findOne({
        studentId: String(targetStudentId),
        $or: [{ tier: "premium" }, { current_tier: "premium" }],
        packageExpiresAt: { $gt: new Date() },
      });

      if (!otherActivePass && !otherActiveEnt) {
        // Safe to revert student to free tier
        try {
          let stu = await Student.findOne({
            $or: [{ _id: targetStudentId }, { id: targetStudentId }, { user: targetStudentId }],
          });

          if (stu) {
            stu.plan_tier = "free";
            stu.planTier = "free";
            stu.flashcards_limit = 25;
            stu.flashcardsLimit = 25;
            await stu.save();
          }

          if (supabase) {
            await supabase
              .from("students")
              .update({
                plan_tier: "free",
                flashcards_limit: 25,
                updated_at: new Date().toISOString(),
              })
              .or(`id.eq.${targetStudentId},user_id.eq.${targetStudentId}`);
          }
        } catch (downgradeErr) {
          console.warn("[cancelAdminStudentSubscription] Student downgrade warning:", downgradeErr.message);
        }
      }

      // Clear cached data
      try {
        await deleteCache(`student:test_series:${targetStudentId}`);
        await deleteCache(`student:notes:${targetStudentId}`);
        await deleteCache(`student:purchased_product_ids:${targetStudentId}`);
        await deleteCache(`student:entitlement:${targetStudentId}`);
      } catch (_) {}
    }

    // Audit log
    try {
      if (logActivity) {
        await logActivity(
          req,
          "CANCEL_STUDENT_SUBSCRIPTION",
          `Super admin cancelled ${cancelledType} for student ${targetStudentId || subscriptionId}. Reason: ${cancelReason}`
        );
      }
    } catch (_) {}

    return res.json({
      success: true,
      message: `Subscription successfully cancelled (${cancelReason}).`,
      subscriptionId,
      cancelledType,
      studentId: targetStudentId,
    });
  } catch (error) {
    console.error("[cancelAdminStudentSubscription] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to cancel student subscription",
      error: error.message,
    });
  }
};

/**
 * 3. GRANT / MANUALLY ACTIVATE A SUBSCRIPTION FOR A STUDENT
 */
export const grantAdminStudentSubscription = async (req, res) => {
  try {
    const { studentId, type, validityDays, reason } = req.body;
    if (!studentId) {
      return res.status(400).json({ success: false, message: "Student ID is required" });
    }

    const sId = String(studentId);
    const days = Number(validityDays || (type === "classtech_pass" ? 365 : 30));
    const validUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const grantReason = reason || "Administrative Grant by Super Admin";

    let grantedSub = null;

    if (type === "classtech_pass") {
      // Create StudentPass
      grantedSub = await StudentPass.create({
        studentId: sId,
        passTitle: "ClassTech All-Access Pass (Admin Grant)",
        price: 0,
        validityDays: days,
        orderId: `ADMIN-PASS-${Date.now()}`,
        status: "active",
        validFrom: new Date(),
        validUntil,
        claimedProducts: [],
      });
    } else {
      // Find Premium package
      let premiumPkg = await StudentPackage.findOne({
        $or: [{ tier: "premium" }, { slug: "classtech-premium" }],
      });

      // Find or create entitlement
      let ent = await StudentEntitlement.findOne({ studentId: sId });
      if (!ent) {
        ent = await StudentEntitlement.create({
          studentId: sId,
          tier: "premium",
          activePackage: premiumPkg?._id || premiumPkg?.id,
          packageExpiresAt: validUntil,
        });
      } else {
        ent.tier = "premium";
        ent.current_tier = "premium";
        ent.activePackage = premiumPkg?._id || premiumPkg?.id;
        ent.packageExpiresAt = validUntil;
        ent.tier_expires_at = validUntil;
        await ent.save();
      }
      grantedSub = ent;
    }

    // Upgrade student model
    try {
      let stu = await Student.findOne({
        $or: [{ _id: sId }, { id: sId }, { user: sId }],
      });
      if (stu) {
        stu.plan_tier = "premium";
        stu.planTier = "premium";
        stu.flashcards_limit = Math.max(Number(stu.flashcards_limit || 25), 500);
        stu.flashcardsLimit = stu.flashcards_limit;
        await stu.save();
      }

      if (supabase) {
        await supabase
          .from("students")
          .update({
            plan_tier: "premium",
            flashcards_limit: 500,
            updated_at: new Date().toISOString(),
          })
          .or(`id.eq.${sId},user_id.eq.${sId}`);
      }
    } catch (stuErr) {
      console.warn("[grantAdminStudentSubscription] Student update warning:", stuErr.message);
    }

    // Invalidate caches
    try {
      await deleteCache(`student:test_series:${sId}`);
      await deleteCache(`student:notes:${sId}`);
      await deleteCache(`student:purchased_product_ids:${sId}`);
      await deleteCache(`student:entitlement:${sId}`);
    } catch (_) {}

    return res.json({
      success: true,
      message: `🎉 Successfully granted ${type === "classtech_pass" ? "ClassTech All-Access Pass" : "ClassTech Premium"} (${grantReason}).`,
      subscription: grantedSub,
    });
  } catch (error) {
    console.error("[grantAdminStudentSubscription] error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to grant subscription",
      error: error.message,
    });
  }
};

/**
 * 4. SEARCH STUDENTS (For Grant Subscription Modal)
 */
export const searchStudentsForSubscription = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
      return res.json({ success: true, students: [] });
    }

    const query = q.trim();
    let results = [];

    // Query Supabase students
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from("students")
          .select("id, name, phone, email, enrollment_number, plan_tier")
          .or(`name.ilike.%${query}%,phone.ilike.%${query}%,email.ilike.%${query}%,enrollment_number.ilike.%${query}%`)
          .limit(15);

        if (!error && Array.isArray(data)) {
          results = data.map((s) => ({
            id: s.id,
            name: s.name || "Student",
            phone: s.phone || "",
            email: s.email || "",
            enrollmentNumber: s.enrollment_number || "-",
            planTier: s.plan_tier || "free",
          }));
        }
      }
    } catch (_) {}

    if (results.length === 0) {
      const stuList = await Student.find({
        $or: [
          { name: { $regex: query, $options: "i" } },
          { phone: { $regex: query, $options: "i" } },
          { email: { $regex: query, $options: "i" } },
          { enrollmentNumber: { $regex: query, $options: "i" } },
        ],
      }).limit(15);

      results = stuList.map((s) => ({
        id: String(s.id || s._id),
        name: s.name || "Student",
        phone: s.phone || "",
        email: s.email || "",
        enrollmentNumber: s.enrollmentNumber || "-",
        planTier: s.plan_tier || s.planTier || "free",
      }));
    }

    return res.json({ success: true, students: results });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
