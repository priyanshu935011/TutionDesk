import StreakTask from "../models/StreakTask.js";
import Badge from "../models/Badge.js";
import StudentStreak from "../models/StudentStreak.js";
import TestSeriesAttempt from "../models/TestSeriesAttempt.js";
import VideoWatchLog from "../models/VideoWatchLog.js";
import AiDoubtHistory from "../models/AiDoubtHistory.js";

/**
 * Returns current date formatted as YYYY-MM-DD in India Standard Time (Asia/Kolkata).
 */
export const getDateInIST = (date = new Date()) => {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

/**
 * Returns Date object boundaries for a given IST date string "YYYY-MM-DD".
 */
export const getISTDayRange = (dateStrIST) => {
  // IST is UTC+5:30. "YYYY-MM-DD" starts at 00:00:00 IST = previous day 18:30:00 UTC
  const [year, month, day] = dateStrIST.split("-").map(Number);
  const startUTC = new Date(Date.UTC(year, month - 1, day, 0, 0, 0) - 5.5 * 3600 * 1000);
  const endUTC = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999) - 5.5 * 3600 * 1000);
  return { startUTC, endUTC };
};

/**
 * Calculates yesterday's date string in IST.
 */
export const getYesterdayInIST = (todayStrIST = getDateInIST()) => {
  const [year, month, day] = todayStrIST.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split("T")[0];
};

/**
 * Returns Monday to Sunday dates and metadata for the current week in IST.
 */
export const getWeekDaysInIST = (currentStreakDoc = null) => {
  const todayStr = getDateInIST();
  const [year, month, day] = todayStr.split("-").map(Number);
  // Construct date in UTC corresponding to IST day
  const todayDate = new Date(Date.UTC(year, month - 1, day));
  
  // getDay(): 0 is Sun, 1 is Mon, ..., 6 is Sat.
  const dayOfWeek = todayDate.getUTCDay();
  // We want Mon = 0, Tue = 1, ..., Sun = 6
  const monOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const weekLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = [];

  const activityMap = new Map();
  if (currentStreakDoc?.activityHistory) {
    for (const item of currentStreakDoc.activityHistory) {
      if (item.dateIST) {
        activityMap.set(item.dateIST, item.isStreakMarked);
      }
    }
  }

  let todayIndex = 0;

  for (let i = 0; i < 7; i++) {
    const d = new Date(todayDate);
    d.setUTCDate(todayDate.getUTCDate() + monOffset + i);
    const dateStr = d.toISOString().split("T")[0];
    const isToday = dateStr === todayStr;
    if (isToday) todayIndex = i;

    // Check if streak was marked for this date
    const isCompleted = activityMap.get(dateStr) || false;

    days.push({
      day: weekLabels[i],
      date: dateStr,
      isToday,
      isCompleted,
    });
  }

  return { days, todayIndex };
};

/**
 * Seed default streak tasks and badges if empty.
 */
export const seedDefaultStreakData = async () => {
  try {
    const taskCount = await StreakTask.countDocuments();
    if (taskCount === 0) {
      await StreakTask.insertMany([
        {
          title: "Attend a class",
          subtitle: "Join a live or recorded class",
          taskType: "attend_class",
          targetCount: 1,
          icon: "menu_book_rounded",
          isActive: true,
          sortOrder: 1,
        },
        {
          title: "Solve 5 practice questions",
          subtitle: "From any subject",
          taskType: "solve_questions",
          targetCount: 5,
          icon: "track_changes_rounded",
          isActive: true,
          sortOrder: 2,
        },
        {
          title: "Complete a test",
          subtitle: "Attempt any test (mini or full)",
          taskType: "complete_test",
          targetCount: 1,
          icon: "assignment_outlined",
          isActive: true,
          sortOrder: 3,
        },
      ]);
    }

    const badgeCount = await Badge.countDocuments();
    if (badgeCount === 0) {
      await Badge.insertMany([
        {
          title: "Streak Master",
          description: "Maintain a 30-day streak",
          symbol: "local_fire_department",
          backgroundColor: "#F59E0B",
          criteriaType: "streak_days",
          targetValue: 30,
          badgeTier: "Master",
          isActive: true,
          sortOrder: 1,
        },
        {
          title: "Class Attender",
          description: "Attend 50 live or recorded classes",
          symbol: "menu_book",
          backgroundColor: "#3B82F6",
          criteriaType: "classes_attended",
          targetValue: 50,
          badgeTier: "Silver",
          isActive: true,
          sortOrder: 2,
        },
        {
          title: "Practice Pro",
          description: "Solve 500 practice questions",
          symbol: "track_changes",
          backgroundColor: "#8B5CF6",
          criteriaType: "questions_solved",
          targetValue: 500,
          badgeTier: "Diamond",
          isActive: true,
          sortOrder: 3,
        },
        {
          title: "Test Taker",
          description: "Attempt 25 chapter or mock tests",
          symbol: "check_circle",
          backgroundColor: "#10B981",
          criteriaType: "tests_completed",
          targetValue: 25,
          badgeTier: "Gold",
          isActive: true,
          sortOrder: 4,
        },
        {
          title: "Top Performer",
          description: "Score 90%+ in 5 tests",
          symbol: "military_tech",
          backgroundColor: "#F59E0B",
          criteriaType: "score_percentage",
          targetValue: 5,
          badgeTier: "Master",
          isActive: true,
          sortOrder: 5,
        },
        {
          title: "Consistency Pro",
          description: "Maintain a 60-day learning streak",
          symbol: "lock",
          backgroundColor: "#64748B",
          criteriaType: "streak_days",
          targetValue: 60,
          badgeTier: "Diamond",
          isActive: true,
          sortOrder: 6,
        },
      ]);
    }
  } catch (err) {
    console.warn("[StreakService] Seed default data notice:", err.message);
  }
};

/**
 * Record an activity performed by student today in IST and update streak.
 */
export const recordStudentActivity = async (studentId, metrics = {}) => {
  if (!studentId) return null;
  try {
    const todayStrIST = getDateInIST();
    let streakDoc = await StudentStreak.findOne({ studentId });
    if (!streakDoc) {
      streakDoc = new StudentStreak({ studentId, activityHistory: [] });
    }

    let todayEntry = streakDoc.activityHistory.find((a) => a.dateIST === todayStrIST);
    if (!todayEntry) {
      todayEntry = {
        dateIST: todayStrIST,
        isStreakMarked: false,
        completedTasks: [],
        taskMetrics: {
          classesAttended: 0,
          questionsSolved: 0,
          testsCompleted: 0,
          videosWatched: 0,
          doubtsAsked: 0,
        },
      };
      streakDoc.activityHistory.push(todayEntry);
    }

    if (metrics.classesAttended) todayEntry.taskMetrics.classesAttended += Number(metrics.classesAttended) || 0;
    if (metrics.questionsSolved) todayEntry.taskMetrics.questionsSolved += Number(metrics.questionsSolved) || 0;
    if (metrics.testsCompleted) todayEntry.taskMetrics.testsCompleted += Number(metrics.testsCompleted) || 0;
    if (metrics.videosWatched) todayEntry.taskMetrics.videosWatched += Number(metrics.videosWatched) || 0;
    if (metrics.doubtsAsked) todayEntry.taskMetrics.doubtsAsked += Number(metrics.doubtsAsked) || 0;

    await evaluateTasksAndStreaks(streakDoc, todayEntry);
    await streakDoc.save();
    return streakDoc;
  } catch (err) {
    console.error("[StreakService] recordStudentActivity error:", err);
    return null;
  }
};

/**
 * Helper to evaluate which tasks are satisfied today and recalculate streak.
 */
const evaluateTasksAndStreaks = async (streakDoc, todayEntry) => {
  const activeTasks = await StreakTask.find({ isActive: true }).sort({ sortOrder: 1 });
  const completedTaskIds = [];

  for (const task of activeTasks) {
    let currentVal = 0;
    switch (task.taskType) {
      case "attend_class":
        currentVal = (todayEntry.taskMetrics.classesAttended || 0) + (todayEntry.taskMetrics.videosWatched || 0);
        break;
      case "solve_questions":
        currentVal = todayEntry.taskMetrics.questionsSolved || 0;
        break;
      case "complete_test":
        currentVal = todayEntry.taskMetrics.testsCompleted || 0;
        break;
      case "watch_video":
        currentVal = todayEntry.taskMetrics.videosWatched || 0;
        break;
      case "ask_doubt":
        currentVal = todayEntry.taskMetrics.doubtsAsked || 0;
        break;
      default:
        currentVal = (todayEntry.taskMetrics.testsCompleted || 0) + (todayEntry.taskMetrics.questionsSolved || 0);
    }

    if (currentVal >= task.targetCount) {
      completedTaskIds.push(task._id);
    }
  }

  todayEntry.completedTasks = completedTaskIds;

  // Streak is automatically marked if user completes >= 2 tasks (or all tasks if less than 2 exist)
  const threshold = Math.min(2, Math.max(1, activeTasks.length));
  const wasMarked = todayEntry.isStreakMarked;
  const isNowMarked = completedTaskIds.length >= threshold;
  todayEntry.isStreakMarked = isNowMarked;

  if (isNowMarked && !wasMarked) {
    const yesterdayStr = getYesterdayInIST(todayEntry.dateIST);
    const yesterdayEntry = streakDoc.activityHistory.find((a) => a.dateIST === yesterdayStr);

    if (yesterdayEntry && yesterdayEntry.isStreakMarked) {
      streakDoc.currentStreak = (streakDoc.currentStreak || 0) + 1;
    } else if (streakDoc.lastActiveDateIST === yesterdayStr) {
      streakDoc.currentStreak = (streakDoc.currentStreak || 0) + 1;
    } else {
      streakDoc.currentStreak = 1;
    }

    streakDoc.lastActiveDateIST = todayEntry.dateIST;
    if (streakDoc.currentStreak > (streakDoc.longestStreak || 0)) {
      streakDoc.longestStreak = streakDoc.currentStreak;
    }
  }
};

/**
 * Get comprehensive streak & badges data for student.
 */
export const getStudentStreaksAndBadges = async (studentId) => {
  await seedDefaultStreakData();

  let streakDoc = await StudentStreak.findOne({ studentId });
  if (!streakDoc) {
    streakDoc = new StudentStreak({
      studentId,
      currentStreak: 0,
      longestStreak: 0,
      activityHistory: [],
      unlockedBadges: [],
    });
  }

  const todayStrIST = getDateInIST();
  let todayEntry = streakDoc.activityHistory.find((a) => a.dateIST === todayStrIST);
  if (!todayEntry) {
    todayEntry = {
      dateIST: todayStrIST,
      isStreakMarked: false,
      completedTasks: [],
      taskMetrics: {
        classesAttended: 0,
        questionsSolved: 0,
        testsCompleted: 0,
        videosWatched: 0,
        doubtsAsked: 0,
      },
    };
    streakDoc.activityHistory.push(todayEntry);
  }

  // Aggregate real activity from database for today in IST
  try {
    const { startUTC, endUTC } = getISTDayRange(todayStrIST);

    // Tests attempted today
    const todayAttempts = await TestSeriesAttempt.find({
      student: studentId,
      createdAt: { $gte: startUTC, $lte: endUTC },
    }).lean();

    const dbTestsCompleted = todayAttempts.length;
    let dbQuestionsSolved = 0;
    for (const att of todayAttempts) {
      if (Array.isArray(att.answers)) {
        dbQuestionsSolved += att.answers.length;
      } else if (att.totalQuestions) {
        dbQuestionsSolved += att.totalQuestions;
      }
    }

    // Videos watched today
    const dbVideosWatched = await VideoWatchLog.countDocuments({
      student: studentId,
      createdAt: { $gte: startUTC, $lte: endUTC },
    });

    // Doubts asked today
    const dbDoubtsAsked = await AiDoubtHistory.countDocuments({
      student: studentId,
      createdAt: { $gte: startUTC, $lte: endUTC },
    });

    // Maximize metrics with DB observations
    todayEntry.taskMetrics.testsCompleted = Math.max(todayEntry.taskMetrics.testsCompleted || 0, dbTestsCompleted);
    todayEntry.taskMetrics.questionsSolved = Math.max(todayEntry.taskMetrics.questionsSolved || 0, dbQuestionsSolved);
    todayEntry.taskMetrics.videosWatched = Math.max(todayEntry.taskMetrics.videosWatched || 0, dbVideosWatched);
    todayEntry.taskMetrics.doubtsAsked = Math.max(todayEntry.taskMetrics.doubtsAsked || 0, dbDoubtsAsked);
  } catch (err) {
    console.warn("[StreakService] DB activity aggregation notice:", err.message);
  }

  // Evaluate tasks and update streak
  await evaluateTasksAndStreaks(streakDoc, todayEntry);
  await streakDoc.save();

  // Load all active tasks
  const activeTasks = await StreakTask.find({ isActive: true }).sort({ sortOrder: 1 }).lean();

  const taskPayload = activeTasks.map((task) => {
    let currentCount = 0;
    switch (task.taskType) {
      case "attend_class":
        currentCount = (todayEntry.taskMetrics.classesAttended || 0) + (todayEntry.taskMetrics.videosWatched || 0);
        break;
      case "solve_questions":
        currentCount = todayEntry.taskMetrics.questionsSolved || 0;
        break;
      case "complete_test":
        currentCount = todayEntry.taskMetrics.testsCompleted || 0;
        break;
      case "watch_video":
        currentCount = todayEntry.taskMetrics.videosWatched || 0;
        break;
      case "ask_doubt":
        currentCount = todayEntry.taskMetrics.doubtsAsked || 0;
        break;
      default:
        currentCount = todayEntry.taskMetrics.testsCompleted || 0;
    }

    const isCompleted = currentCount >= task.targetCount;
    return {
      _id: task._id,
      id: String(task._id),
      title: task.title,
      subtitle: task.subtitle,
      taskType: task.taskType,
      targetCount: task.targetCount,
      currentCount,
      isCompleted,
      icon: task.icon || "assignment_outlined",
    };
  });

  // Calculate lifetime metrics for badge goals
  let lifetimeQuestions = 0;
  let lifetimeTests = 0;
  let lifetimeClasses = 0;
  for (const hist of streakDoc.activityHistory || []) {
    lifetimeQuestions += hist.taskMetrics?.questionsSolved || 0;
    lifetimeTests += hist.taskMetrics?.testsCompleted || 0;
    lifetimeClasses += (hist.taskMetrics?.classesAttended || 0) + (hist.taskMetrics?.videosWatched || 0);
  }

  // Load all active badges
  const allBadges = await Badge.find({ isActive: true }).sort({ sortOrder: 1 }).lean();
  const unlockedBadgeMap = new Map();
  for (const ub of streakDoc.unlockedBadges || []) {
    unlockedBadgeMap.set(String(ub.badgeId), ub.unlockedAt);
  }

  let newlyUnlocked = false;

  const badgePayload = allBadges.map((badge) => {
    let currentValue = 0;
    switch (badge.criteriaType) {
      case "streak_days":
        currentValue = Math.max(streakDoc.currentStreak || 0, streakDoc.longestStreak || 0);
        break;
      case "questions_solved":
        currentValue = lifetimeQuestions;
        break;
      case "tests_completed":
        currentValue = lifetimeTests;
        break;
      case "classes_attended":
        currentValue = lifetimeClasses;
        break;
      case "score_percentage":
        currentValue = Math.min(badge.targetValue, lifetimeTests > 0 ? 3 : 0);
        break;
      default:
        currentValue = streakDoc.currentStreak || 0;
    }

    const targetVal = badge.targetValue || 1;
    let isUnlocked = unlockedBadgeMap.has(String(badge._id)) || currentValue >= targetVal;

    if (isUnlocked && !unlockedBadgeMap.has(String(badge._id))) {
      streakDoc.unlockedBadges.push({
        badgeId: badge._id,
        unlockedAt: new Date(),
        criteriaValueAtUnlock: currentValue,
      });
      newlyUnlocked = true;
    }

    const progress = Math.min(1.0, Number((currentValue / targetVal).toFixed(2)));

    return {
      _id: badge._id,
      id: String(badge._id),
      title: badge.title,
      description: badge.description,
      symbol: badge.symbol,
      backgroundColor: badge.backgroundColor,
      criteriaType: badge.criteriaType,
      targetValue: targetVal,
      currentValue,
      progress,
      badgeTier: badge.badgeTier,
      isUnlocked,
    };
  });

  if (newlyUnlocked) {
    await streakDoc.save();
  }

  const { days: weekDays, todayIndex } = getWeekDaysInIST(streakDoc);

  return {
    currentStreak: streakDoc.currentStreak || 0,
    longestStreak: streakDoc.longestStreak || 0,
    todayIndex,
    todayDateIST: todayStrIST,
    weekDays,
    tasks: taskPayload,
    completedTasksCount: taskPayload.filter((t) => t.isCompleted).length,
    requiredTasksCount: Math.min(2, Math.max(1, activeTasks.length)),
    badges: badgePayload,
  };
};
