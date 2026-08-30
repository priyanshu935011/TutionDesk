import axios from "axios";
import VideoLecture from "../models/VideoLecture.js";
import VideoWatchLog from "../models/VideoWatchLog.js";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import Batch from "../models/Batch.js";
import SystemSetting from "../models/SystemSetting.js";
import { clearCachePattern } from "../utils/cache.js";

// Helper: Get Bunny Stream Settings
export const getBunnySettingsHelper = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "bunny_stream_settings" });
    if (setting && setting.value) {
      return {
        apiKey: setting.value.apiKey || "",
        libraryId: setting.value.libraryId || "",
        cdnHostname: setting.value.cdnHostname || "",
        tokenSecurityKey: setting.value.tokenSecurityKey || "",
      };
    }
  } catch (err) {
    console.error("Error reading Bunny settings:", err);
  }
  return {
    apiKey: process.env.BUNNY_API_KEY || "",
    libraryId: process.env.BUNNY_LIBRARY_ID || "",
    cdnHostname: process.env.BUNNY_CDN_HOSTNAME || "iframe.mediadelivery.net",
    tokenSecurityKey: process.env.BUNNY_TOKEN_SECURITY_KEY || "",
  };
};

// -----------------------------------------------------------------------------
// SUPER ADMIN: Bunny Settings & Storage Limits
// -----------------------------------------------------------------------------

export const getBunnySettings = async (req, res) => {
  try {
    const settings = await getBunnySettingsHelper();
    return res.json(settings);
  } catch (error) {
    return res.status(500).json({ message: "Could not fetch Bunny settings" });
  }
};

export const updateBunnySettings = async (req, res) => {
  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "Only super admin can update Bunny settings" });
    }

    const { apiKey, libraryId, cdnHostname, tokenSecurityKey } = req.body;

    await SystemSetting.findOneAndUpdate(
      { key: "bunny_stream_settings" },
      {
        key: "bunny_stream_settings",
        value: {
          apiKey: apiKey ? apiKey.trim() : "",
          libraryId: libraryId ? libraryId.trim() : "",
          cdnHostname: cdnHostname ? cdnHostname.trim() : "iframe.mediadelivery.net",
          tokenSecurityKey: tokenSecurityKey ? tokenSecurityKey.trim() : "",
        },
        description: "Bunny.net Stream API and CDN Configuration",
      },
      { upsert: true, new: true }
    );

    return res.json({ message: "Bunny.net settings updated successfully" });
  } catch (error) {
    console.error("updateBunnySettings error:", error);
    return res.status(500).json({ message: "Could not save Bunny settings" });
  }
};

export const updateInstituteVideoSettings = async (req, res) => {
  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "Only super admin can update institute video settings" });
    }

    const { instituteId } = req.params;
    const { recordedLecturesFeatureEnabled, maxVideoStorageGb } = req.body;

    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    if (recordedLecturesFeatureEnabled !== undefined) {
      institute.recordedLecturesFeatureEnabled = Boolean(recordedLecturesFeatureEnabled);
      if (!institute.allowedFeatures) institute.allowedFeatures = [];
      if (institute.recordedLecturesFeatureEnabled) {
        if (!institute.allowedFeatures.includes("recorded_lectures")) {
          institute.allowedFeatures.push("recorded_lectures");
        }
      } else {
        institute.allowedFeatures = institute.allowedFeatures.filter((f) => f !== "recorded_lectures");
      }
    }

    if (maxVideoStorageGb !== undefined) {
      institute.maxVideoStorageGb = Math.max(1, Number(maxVideoStorageGb));
    }

    await institute.save();

    return res.json({
      message: "Institute video settings updated successfully",
      institute: {
        id: institute._id,
        recordedLecturesFeatureEnabled: institute.recordedLecturesFeatureEnabled,
        maxVideoStorageGb: institute.maxVideoStorageGb,
        usedVideoStorageBytes: institute.usedVideoStorageBytes || 0,
      },
    });
  } catch (error) {
    console.error("updateInstituteVideoSettings error:", error);
    return res.status(500).json({ message: "Could not update institute video settings" });
  }
};

// -----------------------------------------------------------------------------
// TEACHER / ADMIN: Video Management
// -----------------------------------------------------------------------------

export const getBunnyUploadSignature = async (req, res) => {
  try {
    const bunny = await getBunnySettingsHelper();
    const { title } = req.body;

    if (!bunny.apiKey || !bunny.libraryId) {
      return res.status(400).json({
        message: "Bunny.net credentials are not configured in Super Admin settings.",
      });
    }

    // Call Bunny Stream Create Video API
    const response = await axios.post(
      `https://video.bunnycdn.com/library/${bunny.libraryId}/videos`,
      { title: title || "Untitled Lecture" },
      {
        headers: {
          AccessKey: bunny.apiKey,
          "Content-Type": "application/json",
        },
      }
    );

    const videoData = response.data;
    const videoId = videoData.guid;

    const directUploadUrl = `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${videoId}`;
    const hlsUrl = `https://${bunny.cdnHostname}/${videoId}/playlist.m3u8`;
    const embedUrl = `https://${bunny.cdnHostname}/embed/${bunny.libraryId}/${videoId}`;
    const thumbnailUrl = `https://${bunny.cdnHostname}/${videoId}/thumbnail.jpg`;

    return res.json({
      bunnyVideoId: videoId,
      libraryId: bunny.libraryId,
      apiKey: bunny.apiKey,
      directUploadUrl,
      hlsUrl,
      embedUrl,
      thumbnailUrl,
    });
  } catch (error) {
    console.error("getBunnyUploadSignature error:", error?.response?.data || error.message);
    return res.status(500).json({
      message: "Could not generate Bunny upload signature",
      error: error?.response?.data || error.message,
    });
  }
};

export const createVideoLecture = async (req, res) => {
  try {
    const rawInst = req.user.institute;
    let instituteId = typeof rawInst === "object" ? String(rawInst?._id || rawInst?.id || "") : String(rawInst || "");
    if (!instituteId) instituteId = String(req.user._id || "");

    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    if (req.user.role !== "super_admin" && institute.recordedLecturesFeatureEnabled === false) {
      return res.status(403).json({ message: "Recorded Lectures feature is disabled for this institute" });
    }

    const {
      title,
      description,
      bunnyVideoId,
      videoUrl,
      hlsUrl,
      thumbnailUrl,
      durationSeconds = 0,
      fileSizeBytes = 0,
      targetType = "batch",
      batchIds = [],
      studentIds = [],
      expiryType = "none",
      expiryDate,
      presetExpiry,
    } = req.body;

    if (!title || !bunnyVideoId) {
      return res.status(400).json({ message: "Video title and Bunny Video ID are required" });
    }

    // Check storage limit
    const addedBytes = Number(fileSizeBytes || 0);
    const currentUsed = Number(institute.usedVideoStorageBytes || 0);
    const maxBytes = Number(institute.maxVideoStorageGb || 50) * 1024 * 1024 * 1024;

    if (currentUsed + addedBytes > maxBytes) {
      const freeMb = Math.max(0, Math.round((maxBytes - currentUsed) / (1024 * 1024)));
      return res.status(400).json({
        message: `Video upload exceeds storage limit. Free storage remaining: ${freeMb} MB out of ${institute.maxVideoStorageGb} GB. Contact Super Admin to upgrade storage.`,
      });
    }

    // Calculate expiryDate
    let finalExpiryDate = null;
    let resolvedExpiryType = expiryType;

    if (expiryType === "date" && expiryDate) {
      finalExpiryDate = new Date(expiryDate);
    } else if (expiryType === "preset" && presetExpiry) {
      const now = new Date();
      if (presetExpiry === "1_week") {
        finalExpiryDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      } else if (presetExpiry === "1_month") {
        finalExpiryDate = new Date(now.setMonth(now.getMonth() + 1));
      } else if (presetExpiry === "3_months") {
        finalExpiryDate = new Date(now.setMonth(now.getMonth() + 3));
      } else if (presetExpiry === "6_months") {
        finalExpiryDate = new Date(now.setMonth(now.getMonth() + 6));
      }
    }

    const bunny = await getBunnySettingsHelper();
    const finalHlsUrl = hlsUrl || `https://${bunny.cdnHostname}/${bunnyVideoId}/playlist.m3u8`;
    const finalVideoUrl = videoUrl || `https://${bunny.cdnHostname}/embed/${bunny.libraryId}/${bunnyVideoId}`;
    const finalThumbnailUrl = thumbnailUrl || `https://${bunny.cdnHostname}/${bunnyVideoId}/thumbnail.jpg`;

    const video = await VideoLecture.create({
      institute: instituteId,
      createdBy: req.user._id,
      title: title.trim(),
      description: description ? description.trim() : "",
      bunnyVideoId: bunnyVideoId.trim(),
      videoUrl: finalVideoUrl,
      hlsUrl: finalHlsUrl,
      thumbnailUrl: finalThumbnailUrl,
      durationSeconds: Number(durationSeconds || 0),
      fileSizeBytes: addedBytes,
      targetType,
      batches: Array.isArray(batchIds) ? batchIds.filter(Boolean) : [],
      students: Array.isArray(studentIds) ? studentIds.filter(Boolean) : [],
      expiryType: resolvedExpiryType,
      expiryDate: finalExpiryDate,
      status: "active",
    });

    // Update institute used storage
    institute.usedVideoStorageBytes = currentUsed + addedBytes;
    await institute.save();

    await clearCachePattern("*");

    return res.status(201).json(video);
  } catch (error) {
    console.error("createVideoLecture error:", error);
    return res.status(500).json({ message: error.message || "Could not save video lecture" });
  }
};

export const getTeacherVideos = async (req, res) => {
  try {
    const rawInst = req.user.institute;
    let instituteId = typeof rawInst === "object" ? String(rawInst?._id || rawInst?.id || "") : String(rawInst || "");
    if (!instituteId) instituteId = String(req.user._id || "");

    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    const videos = await VideoLecture.find({ institute: instituteId })
      .sort({ createdAt: -1 })
      .populate("batches", "name")
      .populate("students", "name enrollmentNumber");

    const now = new Date();
    const activeVideos = [];
    const expiredVideos = [];

    videos.forEach((v) => {
      const isExpired = v.expiryDate && new Date(v.expiryDate).getTime() < now.getTime();
      if (isExpired && v.status !== "expired") {
        v.status = "expired";
      }
      const vObj = typeof v.toObject === "function" ? v.toObject() : v;
      if (isExpired) {
        expiredVideos.push(vObj);
      } else {
        activeVideos.push(vObj);
      }
    });

    const maxGb = Number(institute.maxVideoStorageGb || 50);
    const usedBytes = Number(institute.usedVideoStorageBytes || 0);
    const usedGb = Number((usedBytes / (1024 * 1024 * 1024)).toFixed(2));
    const freeGb = Number(Math.max(0, maxGb - usedGb).toFixed(2));
    const usagePercentage = maxGb > 0 ? Math.min(100, Math.round((usedGb / maxGb) * 100)) : 0;

    return res.json({
      featureEnabled: institute.recordedLecturesFeatureEnabled !== false,
      storage: {
        maxStorageGb: maxGb,
        usedStorageBytes: usedBytes,
        usedStorageGb: usedGb,
        freeStorageGb: freeGb,
        usagePercentage,
      },
      activeVideos,
      expiredVideos,
      totalCount: videos.length,
    });
  } catch (error) {
    console.error("getTeacherVideos error:", error);
    return res.status(500).json({ message: "Could not fetch video lectures" });
  }
};

export const updateVideoLecture = async (req, res) => {
  try {
    const rawInst = req.user.institute;
    let instituteId = typeof rawInst === "object" ? String(rawInst?._id || rawInst?.id || "") : String(rawInst || "");
    if (!instituteId) instituteId = String(req.user._id || "");

    const video = await VideoLecture.findOne({ _id: req.params.id, institute: instituteId });
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    const {
      title,
      description,
      targetType,
      batchIds,
      studentIds,
      expiryType,
      expiryDate,
      presetExpiry,
    } = req.body;

    if (title !== undefined) video.title = title.trim();
    if (description !== undefined) video.description = description.trim();
    if (targetType !== undefined) video.targetType = targetType;
    if (Array.isArray(batchIds)) video.batches = batchIds.filter(Boolean);
    if (Array.isArray(studentIds)) video.students = studentIds.filter(Boolean);

    if (expiryType !== undefined) {
      video.expiryType = expiryType;
      if (expiryType === "none") {
        video.expiryDate = null;
      } else if (expiryType === "date" && expiryDate) {
        video.expiryDate = new Date(expiryDate);
      } else if (expiryType === "preset" && presetExpiry) {
        const now = new Date();
        if (presetExpiry === "1_week") {
          video.expiryDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        } else if (presetExpiry === "1_month") {
          video.expiryDate = new Date(now.setMonth(now.getMonth() + 1));
        } else if (presetExpiry === "3_months") {
          video.expiryDate = new Date(now.setMonth(now.getMonth() + 3));
        } else if (presetExpiry === "6_months") {
          video.expiryDate = new Date(now.setMonth(now.getMonth() + 6));
        }
      }
    }

    // Re-evaluate status
    const now = new Date();
    if (!video.expiryDate || new Date(video.expiryDate).getTime() >= now.getTime()) {
      video.status = "active";
    } else {
      video.status = "expired";
    }

    await video.save();
    await clearCachePattern("*");

    return res.json({ message: "Video lecture updated successfully", video });
  } catch (error) {
    console.error("updateVideoLecture error:", error);
    return res.status(500).json({ message: "Could not update video lecture" });
  }
};

export const deleteVideoLecture = async (req, res) => {
  try {
    const rawInst = req.user.institute;
    let instituteId = typeof rawInst === "object" ? String(rawInst?._id || rawInst?.id || "") : String(rawInst || "");
    if (!instituteId) instituteId = String(req.user._id || "");

    const video = await VideoLecture.findOne({ _id: req.params.id, institute: instituteId });
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    const freedBytes = Number(video.fileSizeBytes || 0);

    // Call Bunny Delete Video API if possible
    try {
      const bunny = await getBunnySettingsHelper();
      if (bunny.apiKey && bunny.libraryId && video.bunnyVideoId) {
        await axios.delete(
          `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${video.bunnyVideoId}`,
          { headers: { AccessKey: bunny.apiKey } }
        );
      }
    } catch (bErr) {
      console.warn("Bunny API video delete failed (soft ignored):", bErr.message);
    }

    await VideoLecture.findByIdAndDelete(video._id);
    await VideoWatchLog.deleteMany({ video: video._id });

    // Update institute storage
    const institute = await Institute.findById(instituteId);
    if (institute) {
      institute.usedVideoStorageBytes = Math.max(0, Number(institute.usedVideoStorageBytes || 0) - freedBytes);
      await institute.save();
    }

    await clearCachePattern("*");

    return res.json({ message: "Video lecture deleted successfully" });
  } catch (error) {
    console.error("deleteVideoLecture error:", error);
    return res.status(500).json({ message: "Could not delete video lecture" });
  }
};

// -----------------------------------------------------------------------------
// STUDENT & WATCH PROGRESS API
// -----------------------------------------------------------------------------

export const recordStudentWatchProgress = async (req, res) => {
  try {
    const { videoId, watchTimeSeconds, totalDurationSeconds } = req.body;
    const student = req.user;

    if (!videoId) {
      return res.status(400).json({ message: "Video ID is required" });
    }

    const video = await VideoLecture.findById(videoId);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    const duration = Number(totalDurationSeconds || video.durationSeconds || 1);
    const watched = Math.min(duration, Number(watchTimeSeconds || 0));
    const percentage = duration > 0 ? Math.min(100, Math.round((watched / duration) * 100)) : 0;

    let log = await VideoWatchLog.findOne({ video: videoId, student: student._id });

    if (!log) {
      log = new VideoWatchLog({
        video: videoId,
        student: student._id,
        institute: video.institute,
        batch: student.batch || null,
        watchTimeSeconds: watched,
        totalDurationSeconds: duration,
        watchPercentage: percentage,
        lastWatchedAt: new Date(),
      });
      // Increment overall video views count
      video.viewCount = Number(video.viewCount || 0) + 1;
      await video.save();
    } else {
      log.watchTimeSeconds = Math.max(log.watchTimeSeconds || 0, watched);
      log.totalDurationSeconds = duration;
      log.watchPercentage = Math.max(log.watchPercentage || 0, percentage);
      log.lastWatchedAt = new Date();
    }

    await log.save();

    return res.json({
      message: "Watch progress updated",
      log: {
        watchTimeSeconds: log.watchTimeSeconds,
        watchPercentage: log.watchPercentage,
      },
    });
  } catch (error) {
    console.error("recordStudentWatchProgress error:", error);
    return res.status(500).json({ message: "Could not record watch progress" });
  }
};

export const getVideoWatchAnalytics = async (req, res) => {
  try {
    const { id: videoId } = req.params;
    const rawInst = req.user.institute;
    let instituteId = typeof rawInst === "object" ? String(rawInst?._id || rawInst?.id || "") : String(rawInst || "");
    if (!instituteId) instituteId = String(req.user._id || "");

    const video = await VideoLecture.findOne({ _id: videoId, institute: instituteId })
      .populate("batches", "name")
      .populate("students", "name enrollmentNumber");

    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    // Find all target students for this video
    let targetStudents = [];
    if (video.targetType === "batch" && Array.isArray(video.batches) && video.batches.length > 0) {
      const batchIds = video.batches.map((b) => b._id || b);
      targetStudents = await Student.find({ user: req.user.adminUser || req.user._id, batch: { $in: batchIds } })
        .populate("batch", "name");
    } else if (video.targetType === "student" && Array.isArray(video.students) && video.students.length > 0) {
      const studentIds = video.students.map((s) => s._id || s);
      targetStudents = await Student.find({ _id: { $in: studentIds } }).populate("batch", "name");
    } else {
      targetStudents = await Student.find({ user: req.user.adminUser || req.user._id }).populate("batch", "name");
    }

    const watchLogs = await VideoWatchLog.find({ video: videoId });
    const watchMap = {};
    watchLogs.forEach((l) => {
      watchMap[String(l.student)] = l;
    });

    const studentAnalytics = targetStudents.map((s) => {
      const sIdStr = String(s._id);
      const log = watchMap[sIdStr];
      const watchTime = log ? log.watchTimeSeconds : 0;
      const totalDur = log ? log.totalDurationSeconds : (video.durationSeconds || 0);
      const pct = log ? log.watchPercentage : 0;

      return {
        studentId: s._id,
        name: s.name,
        enrollmentNumber: s.enrollmentNumber || "N/A",
        batchName: s.batch?.name || "General Batch",
        watchTimeSeconds: watchTime,
        totalDurationSeconds: totalDur,
        watchPercentage: pct,
        lastWatchedAt: log ? log.lastWatchedAt : null,
        hasWatched: pct > 0,
      };
    });

    return res.json({
      video: {
        id: video._id,
        title: video.title,
        durationSeconds: video.durationSeconds,
        fileSizeBytes: video.fileSizeBytes,
        viewCount: video.viewCount || 0,
      },
      totalAssignedStudents: studentAnalytics.length,
      watchedStudentsCount: studentAnalytics.filter((s) => s.hasWatched).length,
      studentAnalytics,
    });
  } catch (error) {
    console.error("getVideoWatchAnalytics error:", error);
    return res.status(500).json({ message: "Could not fetch watch analytics" });
  }
};

// -----------------------------------------------------------------------------
// SUPER ADMIN STATS & ANALYTICS
// -----------------------------------------------------------------------------

export const getSuperAdminVideoStats = async (req, res) => {
  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "Only super admin can view global video stats" });
    }

    const [allVideos, allInstitutes, watchLogs] = await Promise.all([
      VideoLecture.find().select("title durationSeconds fileSizeBytes viewCount createdAt institute status"),
      Institute.find().select("name ownerName tuittionType maxVideoStorageGb usedVideoStorageBytes recordedLecturesFeatureEnabled"),
      VideoWatchLog.find().select("watchTimeSeconds lastWatchedAt createdAt"),
    ]);

    let totalVideos = allVideos.length;
    let totalStorageBytes = 0;
    let totalViews = 0;

    allVideos.forEach((v) => {
      totalStorageBytes += Number(v.fileSizeBytes || 0);
      totalViews += Number(v.viewCount || 0);
    });

    const totalStorageGb = Number((totalStorageBytes / (1024 * 1024 * 1024)).toFixed(2));

    // Daily & Monthly views aggregation
    const dailyViewsMap = {};
    const monthlyViewsMap = {};

    watchLogs.forEach((l) => {
      const dt = new Date(l.lastWatchedAt || l.createdAt);
      if (!isNaN(dt.getTime())) {
        const dateKey = dt.toISOString().substring(0, 10);
        const monthKey = dt.toISOString().substring(0, 7);
        dailyViewsMap[dateKey] = (dailyViewsMap[dateKey] || 0) + 1;
        monthlyViewsMap[monthKey] = (monthlyViewsMap[monthKey] || 0) + 1;
      }
    });

    // Cost Calculations (Bunny.net Pricing: Storage = $0.01/GB/mo, Bandwidth = $0.005/GB)
    const storageCostUsd = totalStorageGb * 0.01;
    const estBandwidthGb = (totalViews * 0.5); // avg 0.5 GB per view
    const bandwidthCostUsd = estBandwidthGb * 0.005;
    const totalCostUsd = Number((storageCostUsd + bandwidthCostUsd).toFixed(2));
    const totalCostInr = Math.round(totalCostUsd * 83.5);

    // Institute Breakdown
    const instVideoMap = {};
    allVideos.forEach((v) => {
      const k = String(v.institute);
      if (!instVideoMap[k]) instVideoMap[k] = { count: 0, views: 0 };
      instVideoMap[k].count++;
      instVideoMap[k].views += Number(v.viewCount || 0);
    });

    const instituteStats = allInstitutes.map((inst) => {
      const k = String(inst._id);
      const vData = instVideoMap[k] || { count: 0, views: 0 };
      const usedGb = Number(((inst.usedVideoStorageBytes || 0) / (1024 * 1024 * 1024)).toFixed(2));
      const maxGb = Number(inst.maxVideoStorageGb || 50);

      return {
        instituteId: inst._id,
        name: inst.name,
        ownerName: inst.ownerName,
        tuitionType: inst.tuitionType || "solo",
        featureEnabled: inst.recordedLecturesFeatureEnabled !== false,
        maxVideoStorageGb: maxGb,
        usedVideoStorageGb: usedGb,
        freeVideoStorageGb: Number(Math.max(0, maxGb - usedGb).toFixed(2)),
        usagePercentage: maxGb > 0 ? Math.min(100, Math.round((usedGb / maxGb) * 100)) : 0,
        videoCount: vData.count,
        totalViews: vData.views,
      };
    });

    return res.json({
      summary: {
        totalVideos,
        totalStorageGb,
        totalStorageBytes,
        totalViews,
        totalInstitutesCount: allInstitutes.length,
        estimatedMonthlyCost: {
          usd: totalCostUsd,
          inr: totalCostInr,
          storageCostUsd: Number(storageCostUsd.toFixed(2)),
          bandwidthCostUsd: Number(bandwidthCostUsd.toFixed(2)),
        },
      },
      dailyViews: dailyViewsMap,
      monthlyViews: monthlyViewsMap,
      instituteStats,
    });
  } catch (error) {
    console.error("getSuperAdminVideoStats error:", error);
    return res.status(500).json({ message: "Could not fetch super admin video stats" });
  }
};

export const getInstituteVideoStatsSuperAdmin = async (req, res) => {
  try {
    if (req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "Only super admin can view institute video stats" });
    }

    const { instituteId } = req.params;
    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    const videos = await VideoLecture.find({ institute: instituteId })
      .sort({ createdAt: -1 })
      .populate("batches", "name");

    const maxGb = Number(institute.maxVideoStorageGb || 50);
    const usedBytes = Number(institute.usedVideoStorageBytes || 0);
    const usedGb = Number((usedBytes / (1024 * 1024 * 1024)).toFixed(2));
    const freeGb = Number(Math.max(0, maxGb - usedGb).toFixed(2));

    let totalViews = 0;
    videos.forEach((v) => {
      totalViews += Number(v.viewCount || 0);
    });

    return res.json({
      institute: {
        id: institute._id,
        name: institute.name,
        recordedLecturesFeatureEnabled: institute.recordedLecturesFeatureEnabled !== false,
        maxVideoStorageGb: maxGb,
        usedVideoStorageGb: usedGb,
        freeVideoStorageGb: freeGb,
        usagePercentage: maxGb > 0 ? Math.min(100, Math.round((usedGb / maxGb) * 100)) : 0,
      },
      totalVideos: videos.length,
      totalViews,
      videos,
    });
  } catch (error) {
    console.error("getInstituteVideoStatsSuperAdmin error:", error);
    return res.status(500).json({ message: "Could not fetch institute video stats" });
  }
};
