/**
 * Staff & Receptionist Permission and Role Helper
 * Centralizes permission checks across controllers to ensure rock-solid
 * data isolation, role-based access control (RBAC), and security.
 */

export const isInstituteAdmin = (user) => {
  if (!user) return false;
  const role = String(user.role || "").toLowerCase().trim();
  return role === "institute_admin" || role === "super_admin" || user.isSuperAdmin === true;
};

export const isReceptionist = (user) => {
  if (!user) return false;
  if (isInstituteAdmin(user)) return false;
  const role = String(user.role || "").toLowerCase().trim();
  const staffRole = String(user.staffRole || "").toLowerCase().trim();
  return role === "receptionist" || (role === "staff" && staffRole === "receptionist");
};

export const isHiredTeacher = (user) => {
  if (!user) return false;
  if (isInstituteAdmin(user)) return false;
  const role = String(user.role || "").toLowerCase().trim();
  const staffRole = String(user.staffRole || "").toLowerCase().trim();
  if (role === "teacher") return true;
  if (role === "staff" && staffRole !== "receptionist") return true;
  return false;
};

export const RECEPTIONIST_FEATURE_ALIASES = {
  leads: ["leads", "enquiries_leads", "enquiries"],
  students: ["students"],
  fees: ["fees", "fee_collection", "collected_fees", "pending_fees", "payments"],
  attendance: ["attendance"],
  batches: ["batches"],
  notices: ["notices"],
  marketing: ["marketing", "marketing_posters", "posters_marketing"],
};

export const isReceptionistFeatureAllowed = (user, featureKey) => {
  if (!user) return false;
  if (isInstituteAdmin(user)) return true;
  if (!isReceptionist(user)) return false;

  const rawAllowed = Array.isArray(user.allowedFeatures) ? user.allowedFeatures : [];
  if (rawAllowed.length === 0) {
    // If no features are explicitly assigned, nothing is permitted
    return false;
  }

  const normalizedAllowed = rawAllowed.map((f) => String(f).toLowerCase().trim());
  const aliases = RECEPTIONIST_FEATURE_ALIASES[featureKey] || [featureKey];

  return aliases.some((alias) => normalizedAllowed.includes(alias.toLowerCase()));
};

export const getTodayISTDateString = () => {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
};
