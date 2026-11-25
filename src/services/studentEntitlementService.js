import redisClient from "../config/redis.js";
import StudentEntitlement from "../models/StudentEntitlement.js";
import StudentPackage from "../models/StudentPackage.js";

// In-memory fallback if Redis is unavailable
const memoryLedger = new Map();

/**
 * Default Master Packages for Classtech Student Ecosystem
 */
export const DEFAULT_PACKAGES = [
  {
    name: "ClassTech Free",
    slug: "classtech-free",
    badge: "Free Tier",
    description: "Essential self-study starter pack with AI flashcards & active recall.",
    price: 0,
    discountedPrice: 0,
    billingCycle: "free",
    quotas: {
      aiFlashcardsLimit: 25, // Default for free tier (editable by admin)
      aiDoubtsDailyLimit: 5,
      mistakeBookMaxEntries: 30,
      focusModeMaxDailyMinutes: 60,
      testSeriesAccess: "preview",
      digitalNotesAccess: "preview",
      maxFreeMockTests: 3,
    },
    features: {
      aiTutor: true,
      aiMistakeBook: true,
      aiRevision: true,
      aiCareerGuidance: true,
      gamifiedFocusMode: true,
      interactivePyqBank: true,
      virtualStudyRooms: true,
      parentSnapshot: true,
      adFree: false,
    },
    priority: 1,
    isActive: true,
  },
  {
    name: "ClassTech Premium",
    slug: "classtech-premium",
    badge: "All Access",
    description: "Full premium pass: unlimited 24/7 AI tutor, full test series, notes & 500 AI flashcards.",
    price: 499,
    discountedPrice: 299,
    billingCycle: "yearly",
    quotas: {
      aiFlashcardsLimit: 500, // Default for premium tier (editable by admin)
      aiDoubtsDailyLimit: 200,
      mistakeBookMaxEntries: 2000,
      focusModeMaxDailyMinutes: -1, // Unlimited
      testSeriesAccess: "all",
      digitalNotesAccess: "all",
      maxFreeMockTests: 100,
    },
    features: {
      aiTutor: true,
      aiMistakeBook: true,
      aiRevision: true,
      aiCareerGuidance: true,
      gamifiedFocusMode: true,
      interactivePyqBank: true,
      virtualStudyRooms: true,
      parentSnapshot: true,
      adFree: true,
    },
    priority: 2,
    isActive: true,
  },
];

/**
 * Seed Default Packages if collection is empty or legacy
 */
export async function ensureDefaultPackages() {
  try {
    // 1. Ensure Free Tier
    let freePkg = await StudentPackage.findOne({ slug: "classtech-free" });
    if (!freePkg) {
      await StudentPackage.create(DEFAULT_PACKAGES[0]);
    } else if (freePkg.quotas?.aiFlashcardsLimit === undefined) {
      freePkg.quotas = { ...(freePkg.quotas || {}), aiFlashcardsLimit: 25 };
      await freePkg.save();
    }

    // 2. Ensure Premium Tier
    let premPkg = await StudentPackage.findOne({ slug: "classtech-premium" });
    if (!premPkg) {
      await StudentPackage.create(DEFAULT_PACKAGES[1]);
    } else if (premPkg.quotas?.aiFlashcardsLimit === undefined) {
      premPkg.quotas = { ...(premPkg.quotas || {}), aiFlashcardsLimit: 500 };
      await premPkg.save();
    }

    // Deactivate obsolete tiers so ONLY Free and ClassTech Premium exist
    await StudentPackage.updateMany(
      { slug: { $nin: ["classtech-free", "classtech-premium"] } },
      { isActive: false }
    );
  } catch (err) {
    console.warn("[studentEntitlementService] Error checking/seeding packages:", err.message);
  }
}

/**
 * Helper to fetch configured flashcards limit for a given tier
 */
export async function getTierFlashcardLimit(tier = "free") {
  try {
    const slug = tier === "premium" ? "classtech-premium" : "classtech-free";
    const pkg = await StudentPackage.findOne({ slug });
    if (pkg && pkg.quotas && typeof pkg.quotas.aiFlashcardsLimit === "number") {
      return pkg.quotas.aiFlashcardsLimit;
    }
  } catch (_) {}
  return tier === "premium" ? 500 : 25;
}

/**
 * Helper to update flashcard limits for both tiers
 */
export async function updateTierFlashcardLimits({ freeLimit, premiumLimit }) {
  const results = {};
  if (typeof freeLimit === "number" && freeLimit >= 0) {
    const pkg = await StudentPackage.findOne({ slug: "classtech-free" });
    if (pkg) {
      pkg.quotas = { ...(pkg.quotas || {}), aiFlashcardsLimit: freeLimit };
      await pkg.save();
      results.freeLimit = freeLimit;
    }
  }
  if (typeof premiumLimit === "number" && premiumLimit >= 0) {
    const pkg = await StudentPackage.findOne({ slug: "classtech-premium" });
    if (pkg) {
      pkg.quotas = { ...(pkg.quotas || {}), aiFlashcardsLimit: premiumLimit };
      await pkg.save();
      results.premiumLimit = premiumLimit;
    }
  }
  return results;
}

/**
 * Add premium flashcard quota to a student upon upgrade
 */
export async function addStudentPremiumFlashcards(studentId) {
  if (!studentId) return null;
  const premiumLimit = await getTierFlashcardLimit("premium");

  // 1. Update Supabase students table
  try {
    const { getSupabaseClient } = await import("../utils/supabaseClient.js");
    const supabase = getSupabaseClient();
    if (supabase) {
      await supabase.rpc("add_student_premium_flashcards", {
        p_student_id: String(studentId),
        p_increment: premiumLimit,
      }).catch(async () => {
        const { data: row } = await supabase
          .from("students")
          .select("flashcards_limit")
          .or(`id.eq.${studentId},user_id.eq.${studentId}`)
          .limit(1)
          .maybeSingle();
        const curLimit = Number(row?.flashcards_limit || 25);
        await supabase
          .from("students")
          .update({
            flashcards_limit: curLimit + premiumLimit,
            plan_tier: "premium",
          })
          .or(`id.eq.${studentId},user_id.eq.${studentId}`);
      });
    }
  } catch (err) {
    console.warn("[studentEntitlementService] Supabase addStudentPremiumFlashcards warning:", err.message);
  }

  // 2. Update Mongoose Student document
  try {
    const Student = (await import("../models/Student.js")).default;
    let stu = null;
    try {
      stu = await Student.findById(studentId);
    } catch (_) {}
    if (!stu) {
      stu = await Student.findOne({
        $or: [{ _id: studentId }, { user: studentId }, { phone: studentId }, { email: studentId }],
      });
    }
    if (stu) {
      const current = Number(stu.flashcards_limit ?? stu.flashcardsLimit ?? 25);
      const newLimit = current + premiumLimit;
      stu.flashcards_limit = newLimit;
      stu.flashcardsLimit = newLimit;
      stu.plan_tier = "premium";
      stu.planTier = "premium";
      await stu.save();
      return { limit: newLimit, tier: "premium", added: premiumLimit };
    }
  } catch (err) {
    console.warn("[studentEntitlementService] Mongoose addStudentPremiumFlashcards warning:", err.message);
  }

  return { added: premiumLimit, tier: "premium" };
}

/**
 * Get or create a student's entitlement record
 */
export async function getOrCreateStudentEntitlement(studentId, initialType = "independent_direct") {
  if (!studentId) return null;
  let entitlement = await StudentEntitlement.findOne({ studentId }).populate("activePackage");

  if (!entitlement) {
    await ensureDefaultPackages();
    const freePack = await StudentPackage.findOne({ slug: "classtech-free" });

    entitlement = await StudentEntitlement.create({
      studentId,
      studentType: initialType,
      tier: "free",
      activePackage: freePack?._id || null,
      focusCoins: 100, // Welcome gift
      studyStreakDays: 1,
      lastActiveDate: new Date().toISOString().split("T")[0],
      featureOverrides: {},
    });
    if (freePack) {
      entitlement.activePackage = freePack;
    }
  }

  // Check if paid package expired
  if (entitlement.packageExpiresAt && new Date(entitlement.packageExpiresAt) < new Date()) {
    entitlement.tier = "free";
    const freePack = await StudentPackage.findOne({ slug: "classtech-free" });
    entitlement.activePackage = freePack?._id || null;
    entitlement.packageExpiresAt = null;
    await entitlement.save();
  }

  return entitlement;
}

/**
 * Get today's daily usage count for a student
 */
export async function getDailyUsage(studentId, metricKey) {
  const today = new Date().toISOString().split("T")[0];
  const redisKey = `quota:${studentId}:${metricKey}:${today}`;

  if (redisClient && redisClient.isOpen) {
    try {
      const val = await redisClient.get(redisKey);
      return val ? parseInt(val, 10) : 0;
    } catch (_) {}
  }

  const memKey = `${studentId}:${metricKey}:${today}`;
  return memoryLedger.get(memKey) || 0;
}

/**
 * Increment daily usage count for a student
 */
export async function incrementDailyUsage(studentId, metricKey, amount = 1) {
  const today = new Date().toISOString().split("T")[0];
  const redisKey = `quota:${studentId}:${metricKey}:${today}`;

  if (redisClient && redisClient.isOpen) {
    try {
      const newVal = await redisClient.incrBy(redisKey, amount);
      // Expire at end of day (86400s)
      await redisClient.expire(redisKey, 86400);
      return newVal;
    } catch (_) {}
  }

  const memKey = `${studentId}:${metricKey}:${today}`;
  const curr = memoryLedger.get(memKey) || 0;
  const newVal = curr + amount;
  memoryLedger.set(memKey, newVal);
  return newVal;
}

/**
 * Check if a student can access a specific feature or if quota exceeded
 */
export async function checkFeatureAccess(studentId, featureKey) {
  const entitlement = await getOrCreateStudentEntitlement(studentId);
  if (!entitlement) return { allowed: false, reason: "Student profile not found" };

  const pkg = entitlement.activePackage || {};
  const quotas = pkg.quotas || {};
  const features = pkg.features || {};

  // 1. Check Super Admin student-level feature overrides
  if (entitlement.featureOverrides?.has?.(featureKey)) {
    const override = entitlement.featureOverrides.get(featureKey);
    if (override && override.enabled === false) {
      return { allowed: false, reason: "Feature disabled for your profile by administrator" };
    }
  }

  // 2. Metric Quota Check for AI Doubts
  if (featureKey === "ai_tutor") {
    let limit = quotas.aiDoubtsDailyLimit ?? 5;
    // Check override limit
    const override = entitlement.featureOverrides?.get?.(featureKey);
    if (override && override.customDailyLimit > -1) {
      limit = override.customDailyLimit;
    }

    const usedToday = await getDailyUsage(studentId, "ai_doubts");
    if (limit !== -1 && usedToday >= limit) {
      return {
        allowed: false,
        reason: "Daily AI doubt limit reached",
        usedToday,
        limit,
        canUpgrade: true,
      };
    }
    return { allowed: true, usedToday, limit, tier: entitlement.tier };
  }

  // 3. Metric Quota Check for Focus Mode
  if (featureKey === "focus_mode") {
    const limit = quotas.focusModeMaxDailyMinutes ?? 60;
    const usedToday = await getDailyUsage(studentId, "focus_minutes");
    if (limit !== -1 && usedToday >= limit) {
      return {
        allowed: false,
        reason: "Daily focus time limit reached",
        usedToday,
        limit,
        canUpgrade: true,
      };
    }
    return { allowed: true, usedToday, limit, tier: entitlement.tier };
  }

  // 4. Feature Flag Check
  const isEnabled = features[featureKey] !== false;
  return {
    allowed: isEnabled,
    tier: entitlement.tier,
    package: pkg.name,
  };
}
