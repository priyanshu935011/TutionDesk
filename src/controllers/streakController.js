import StreakTask from "../models/StreakTask.js";
import Badge from "../models/Badge.js";
import Student from "../models/Student.js";
import { getStudentStreaksAndBadges, seedDefaultStreakData } from "../services/streakService.js";

// ============================================================================
// STUDENT ENDPOINTS
// ============================================================================

/**
 * Get student streaks and badges in IST timezone.
 */
export const getStudentStreaks = async (req, res) => {
  try {
    let studentId = req.user?._id || req.user?.id;

    // Optional query or body override if authorized
    if (req.query.studentId && (req.user?.role === "super_admin" || req.user?.role === "teacher")) {
      studentId = req.query.studentId;
    }

    if (!studentId) {
      // Find fallback student if student token has enrollmentNumber or email
      if (req.user?.enrollmentNumber) {
        const s = await Student.findOne({ enrollmentNumber: req.user.enrollmentNumber });
        if (s) studentId = s._id;
      }
    }

    if (!studentId) {
      // Create or fallback to default student representation
      const defaultStudent = await Student.findOne().sort({ createdAt: -1 });
      if (defaultStudent) studentId = defaultStudent._id;
    }

    if (!studentId) {
      return res.status(404).json({ message: "Student profile not identified" });
    }

    const data = await getStudentStreaksAndBadges(studentId);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("[StreakController] getStudentStreaks error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch streak data",
      error: error.message,
    });
  }
};

// ============================================================================
// SUPER ADMIN: STREAK TASKS
// ============================================================================

export const getAllStreakTasksAdmin = async (req, res) => {
  try {
    await seedDefaultStreakData();
    const tasks = await StreakTask.find().sort({ sortOrder: 1, createdAt: 1 });
    return res.status(200).json({
      success: true,
      tasks,
    });
  } catch (error) {
    console.error("[StreakController] getAllStreakTasksAdmin error:", error);
    return res.status(500).json({ message: "Failed to fetch streak tasks" });
  }
};

export const createStreakTaskAdmin = async (req, res) => {
  try {
    const { title, subtitle, taskType, targetCount, icon, isActive, sortOrder } = req.body;
    if (!title || !taskType) {
      return res.status(400).json({ message: "Task title and task type are required" });
    }

    const task = new StreakTask({
      title: title.trim(),
      subtitle: (subtitle || "").trim(),
      taskType,
      targetCount: Math.max(1, Number(targetCount) || 1),
      icon: (icon || "assignment_outlined").trim(),
      isActive: isActive !== false,
      sortOrder: Number(sortOrder) || 0,
    });

    await task.save();
    return res.status(201).json({
      success: true,
      message: "Streak task created successfully",
      task,
    });
  } catch (error) {
    console.error("[StreakController] createStreakTaskAdmin error:", error);
    return res.status(500).json({ message: "Failed to create streak task" });
  }
};

export const updateStreakTaskAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, taskType, targetCount, icon, isActive, sortOrder } = req.body;

    const task = await StreakTask.findById(id);
    if (!task) {
      return res.status(404).json({ message: "Streak task not found" });
    }

    if (title !== undefined) task.title = title.trim();
    if (subtitle !== undefined) task.subtitle = subtitle.trim();
    if (taskType !== undefined) task.taskType = taskType;
    if (targetCount !== undefined) task.targetCount = Math.max(1, Number(targetCount) || 1);
    if (icon !== undefined) task.icon = icon.trim();
    if (isActive !== undefined) task.isActive = Boolean(isActive);
    if (sortOrder !== undefined) task.sortOrder = Number(sortOrder) || 0;

    await task.save();
    return res.status(200).json({
      success: true,
      message: "Streak task updated successfully",
      task,
    });
  } catch (error) {
    console.error("[StreakController] updateStreakTaskAdmin error:", error);
    return res.status(500).json({ message: "Failed to update streak task" });
  }
};

export const deleteStreakTaskAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const task = await StreakTask.findByIdAndDelete(id);
    if (!task) {
      return res.status(404).json({ message: "Streak task not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Streak task deleted successfully",
    });
  } catch (error) {
    console.error("[StreakController] deleteStreakTaskAdmin error:", error);
    return res.status(500).json({ message: "Failed to delete streak task" });
  }
};

// ============================================================================
// SUPER ADMIN: BADGES
// ============================================================================

export const getAllBadgesAdmin = async (req, res) => {
  try {
    await seedDefaultStreakData();
    const badges = await Badge.find().sort({ sortOrder: 1, createdAt: 1 });
    return res.status(200).json({
      success: true,
      badges,
    });
  } catch (error) {
    console.error("[StreakController] getAllBadgesAdmin error:", error);
    return res.status(500).json({ message: "Failed to fetch badges" });
  }
};

export const createBadgeAdmin = async (req, res) => {
  try {
    const {
      title,
      description,
      symbol,
      backgroundColor,
      criteriaType,
      targetValue,
      badgeTier,
      isActive,
      sortOrder,
    } = req.body;

    if (!title || !criteriaType) {
      return res.status(400).json({ message: "Badge title and criteria type are required" });
    }

    const badge = new Badge({
      title: title.trim(),
      description: (description || "").trim(),
      symbol: (symbol || "military_tech").trim(),
      backgroundColor: (backgroundColor || "#8B5CF6").trim(),
      criteriaType,
      targetValue: Math.max(1, Number(targetValue) || 1),
      badgeTier: (badgeTier || "Gold").trim(),
      isActive: isActive !== false,
      sortOrder: Number(sortOrder) || 0,
    });

    await badge.save();
    return res.status(201).json({
      success: true,
      message: "Badge created successfully",
      badge,
    });
  } catch (error) {
    console.error("[StreakController] createBadgeAdmin error:", error);
    return res.status(500).json({ message: "Failed to create badge" });
  }
};

export const updateBadgeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      symbol,
      backgroundColor,
      criteriaType,
      targetValue,
      badgeTier,
      isActive,
      sortOrder,
    } = req.body;

    const badge = await Badge.findById(id);
    if (!badge) {
      return res.status(404).json({ message: "Badge not found" });
    }

    if (title !== undefined) badge.title = title.trim();
    if (description !== undefined) badge.description = description.trim();
    if (symbol !== undefined) badge.symbol = symbol.trim();
    if (backgroundColor !== undefined) badge.backgroundColor = backgroundColor.trim();
    if (criteriaType !== undefined) badge.criteriaType = criteriaType;
    if (targetValue !== undefined) badge.targetValue = Math.max(1, Number(targetValue) || 1);
    if (badgeTier !== undefined) badge.badgeTier = badgeTier.trim();
    if (isActive !== undefined) badge.isActive = Boolean(isActive);
    if (sortOrder !== undefined) badge.sortOrder = Number(sortOrder) || 0;

    await badge.save();
    return res.status(200).json({
      success: true,
      message: "Badge updated successfully",
      badge,
    });
  } catch (error) {
    console.error("[StreakController] updateBadgeAdmin error:", error);
    return res.status(500).json({ message: "Failed to update badge" });
  }
};

export const deleteBadgeAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const badge = await Badge.findByIdAndDelete(id);
    if (!badge) {
      return res.status(404).json({ message: "Badge not found" });
    }

    return res.status(200).json({
      success: true,
      message: "Badge deleted successfully",
    });
  } catch (error) {
    console.error("[StreakController] deleteBadgeAdmin error:", error);
    return res.status(500).json({ message: "Failed to delete badge" });
  }
};
