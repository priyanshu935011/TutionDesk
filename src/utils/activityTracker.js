import mongoose from "mongoose";
import User from "../models/User.js";
import Student from "../models/Student.js";
import SystemMetric from "../models/SystemMetric.js";

let lastPeakCheck = 0;
const peakCheckThrottle = 60 * 1000; // 1 minute

export const updateConcurrentPeak = async () => {
  const now = Date.now();
  if (now - lastPeakCheck < peakCheckThrottle) {
    return;
  }
  lastPeakCheck = now;

  try {
    const fiveMinsAgo = new Date(now - 5 * 60 * 1000);
    const [activeUsers, activeStudents] = await Promise.all([
      User.countDocuments({ lastActiveAt: { $gte: fiveMinsAgo } }),
      Student.countDocuments({ lastActiveAt: { $gte: fiveMinsAgo } }),
    ]);
    const currentActive = activeUsers + activeStudents;

    const peakMetric = await SystemMetric.findOne({ key: "highestConcurrentActiveUsers" });
    if (!peakMetric) {
      await SystemMetric.create({ key: "highestConcurrentActiveUsers", value: currentActive });
    } else if (currentActive > Number(peakMetric.value || 0)) {
      peakMetric.value = currentActive;
      await peakMetric.save();
    }
  } catch (err) {
    console.error("Peak active check error:", err);
  }
};
