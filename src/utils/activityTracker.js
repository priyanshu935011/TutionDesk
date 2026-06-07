import mongoose from "mongoose";
import User from "../models/User.js";
import Student from "../models/Student.js";
import SystemMetric from "../models/SystemMetric.js";
import redisClient from "../config/redis.js";

let lastPeakCheck = 0;
const peakCheckThrottle = 60 * 1000; // 1 minute

export const updateConcurrentPeak = async () => {
  const now = Date.now();
  if (now - lastPeakCheck < peakCheckThrottle) {
    return;
  }
  lastPeakCheck = now;

  try {
    let currentActive = 0;

    if (redisClient.isReady) {
      let count = 0;
      for await (const key of redisClient.scanIterator({
        MATCH: "active:user:*",
        COUNT: 500,
      })) {
        count++;
      }
      currentActive = count;
    } else {
      // Fallback to MongoDB
      const fiveMinsAgo = new Date(now - 5 * 60 * 1000);
      const [activeUsers, activeStudentsResult] = await Promise.all([
        User.countDocuments({ lastActiveAt: { $gte: fiveMinsAgo } }),
        Student.aggregate([
          { $match: { lastActiveAt: { $gte: fiveMinsAgo } } },
          { $group: { _id: "$enrollmentNumber" } },
          { $count: "count" }
        ]),
      ]);
      const activeStudents = activeStudentsResult[0]?.count || 0;
      currentActive = activeUsers + activeStudents;
    }

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
