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
    name: "Classtech Free Starter",
    slug: "classtech-free",
    badge: "Free Forever",
    description: "Essential self-study starter pack for independent learners.",
    price: 0,
    discountedPrice: 0,
    billingCycle: "free",
    quotas: {
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
    name: "Classtech Pro Learner",
    slug: "classtech-pro",
    badge: "Most Popular",
    description: "Unlimited 24/7 AI tutor, unlimited mistake book retests, and full test series.",
    price: 299,
    discountedPrice: 199,
    billingCycle: "monthly",
    quotas: {
      aiDoubtsDailyLimit: 100,
      mistakeBookMaxEntries: 1000,
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
  {
    name: "Classtech Exam Master (NEET / JEE / Boards)",
    slug: "classtech-exam-master",
    badge: "Best Value",
    description: "Full annual pass: 10-year PYQ bank, mock exams, formula vault & 1-on-1 AI mentorship.",
    price: 2499,
    discountedPrice: 1499,
    billingCycle: "yearly",
    quotas: {
      aiDoubtsDailyLimit: 250,
      mistakeBookMaxEntries: 5000,
      focusModeMaxDailyMinutes: -1,
      testSeriesAccess: "all",
      digitalNotesAccess: "all",
      maxFreeMockTests: 500,
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
    priority: 3,
    isActive: true,
  },
];

/**
 * Seed Default Packages if collection is empty
 */
export async function ensureDefaultPackages() {
  try {
    const count = await StudentPackage.countDocuments();
    if (count === 0) {
      await StudentPackage.insertMany(DEFAULT_PACKAGES);
      console.log("[studentEntitlementService] Seeded default student packages.");
    }
  } catch (err) {
    console.warn("[studentEntitlementService] Error checking/seeding packages:", err.message);
  }
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
