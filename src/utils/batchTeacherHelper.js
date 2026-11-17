import Batch from "../models/Batch.js";
import { toValidUUID, readUserMetadata, readBatchesMetadata, writeBatchesMetadata } from "./supabaseModel.js";

/**
 * Checks if a user is an authorized teacher for the given batch.
 * Evaluates against:
 * 1. user.assignedBatches (User document or user_metadata.json)
 * 2. batch.teachers (Array of co-teachers)
 * 3. batch.teacher (Primary teacher field by ID, UUID, phone, or email)
 * 4. batches_metadata.json (fallback cache)
 */
export const isTeacherOfBatch = (b, user) => {
  if (!b || !user) return false;
  const bId = String(b._id || b.id || "").trim();
  const uId = String(user._id || user.id || "").trim();
  const uUuid = toValidUUID(user._id || user.id);
  const uPhone = String(user.phone || "").trim();
  const uEmail = String(user.email || "").trim().toLowerCase();

  // 1. Check user.assignedBatches (from User doc or user_metadata.json)
  if (bId) {
    let assignedList = user.assignedBatches;
    if (!Array.isArray(assignedList) || assignedList.length === 0) {
      try {
        const meta = readUserMetadata()[uId];
        if (meta && Array.isArray(meta.assignedBatches)) {
          assignedList = meta.assignedBatches;
        }
      } catch (_) {}
    }
    if (Array.isArray(assignedList)) {
      const hasBatch = assignedList.some((item) => {
        const itemStr = String(item?._id || item?.id || item || "").trim();
        return itemStr === bId;
      });
      if (hasBatch) return true;
    }
  }

  // 2. Check b.teachers (array of co-teachers)
  const teachersList = Array.isArray(b.teachers) ? b.teachers : [];
  for (const t of teachersList) {
    if (!t) continue;
    if (typeof t === "object") {
      const tId = String(t._id || t.id || "").trim();
      const tPhone = String(t.phone || "").trim();
      const tEmail = String(t.email || "").trim().toLowerCase();
      if (
        (tId && (tId === uId || (uUuid && tId === uUuid))) ||
        (tPhone && uPhone && tPhone === uPhone) ||
        (tEmail && uEmail && tEmail === uEmail)
      ) {
        return true;
      }
    } else {
      const tStr = String(t).trim();
      if (
        (tStr && (tStr === uId || (uUuid && tStr === uUuid))) ||
        (uPhone && tStr === uPhone) ||
        (uEmail && tStr.toLowerCase() === uEmail)
      ) {
        return true;
      }
    }
  }

  // 3. Check b.teacher (primary teacher)
  if (b.teacher) {
    const t = b.teacher;
    if (typeof t === "object" && t !== null) {
      const tId = String(t._id || t.id || "").trim();
      const tPhone = String(t.phone || "").trim();
      const tEmail = String(t.email || "").trim().toLowerCase();
      if (
        (tId && (tId === uId || (uUuid && tId === uUuid))) ||
        (tPhone && uPhone && tPhone === uPhone) ||
        (tEmail && uEmail && tEmail === uEmail)
      ) {
        return true;
      }
    } else {
      const tStr = String(t).trim();
      if (
        (tStr && (tStr === uId || (uUuid && tStr === uUuid))) ||
        (uPhone && tStr === uPhone) ||
        (uEmail && tStr.toLowerCase() === uEmail)
      ) {
        return true;
      }
    }
  }

  // 4. Check batches_metadata.json
  if (bId) {
    try {
      const bMeta = readBatchesMetadata()[bId];
      if (bMeta && Array.isArray(bMeta.teachers)) {
        if (bMeta.teachers.includes(uId) || (uUuid && bMeta.teachers.includes(uUuid))) {
          return true;
        }
      }
    } catch (_) {}
  }

  return false;
};

/**
 * Returns all active batch IDs (as Strings) assigned to a given teacher.
 * Resolves both primary and co-teacher assignments across DB and metadata.
 */
export const getTeacherAssignedBatchIds = async (user, instituteId = null) => {
  if (!user) return [];
  const uId = String(user._id || user.id || "").trim();

  const rawAssigned = Array.isArray(user.assignedBatches) ? user.assignedBatches : [];
  let metaAssigned = [];
  try {
    const userMeta = readUserMetadata();
    metaAssigned = Array.isArray(userMeta[uId]?.assignedBatches) ? userMeta[uId].assignedBatches : [];
  } catch (_) {}

  const directBatchIds = new Set([
    ...rawAssigned.map(b => String(b?._id || b?.id || b || "")).filter(Boolean),
    ...metaAssigned.map(b => String(b?._id || b?.id || b || "")).filter(Boolean),
  ]);

  const rawInst = user.institute;
  const ownerId = rawInst?.adminUser || rawInst?._id || rawInst || user._id;
  const instUserIds = [
    instituteId,
    ownerId,
    rawInst?._id,
    rawInst,
    user._id,
  ].filter(Boolean).map(id => String(id?._id || id?.id || id || "").trim());

  let allBatches = [];
  try {
    const query = instUserIds.length > 0 ? { user: { $in: instUserIds } } : {};
    allBatches = await Batch.find(query).select("_id id name status teacher teachers");
  } catch (_) {}

  const resultIds = new Set();
  for (const b of allBatches) {
    const bId = String(b._id || b.id || "").trim();
    if (!bId) continue;
    if (b.status === "archived") continue;

    if (directBatchIds.has(bId) || isTeacherOfBatch(b, user)) {
      resultIds.add(bId);
    }
  }

  // Include directBatchIds
  for (const dbId of directBatchIds) {
    resultIds.add(dbId);
  }

  return Array.from(resultIds);
};
