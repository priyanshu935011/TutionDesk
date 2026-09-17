import axios from "axios";
import mongoose from "mongoose";
import VideoLecture from "../models/VideoLecture.js";
import VideoPlaylist from "../models/VideoPlaylist.js";
import VideoPlaylistItem from "../models/VideoPlaylistItem.js";
import VideoRelease from "../models/VideoRelease.js";
import VideoReleaseStudent from "../models/VideoReleaseStudent.js";
import VideoUpload from "../models/VideoUpload.js";
import InstituteVideoStorage from "../models/InstituteVideoStorage.js";
import VideoWatchLog from "../models/VideoWatchLog.js";
import Institute from "../models/Institute.js";
import Student from "../models/Student.js";
import User from "../models/User.js";
import SystemSetting from "../models/SystemSetting.js";
import { clearCachePattern } from "../utils/cache.js";
import cloudinary from "../utils/cloudinary.js";
import { supabase } from "../utils/supabaseModel.js";

// Helper: Get Bunny Stream Settings
export const getBunnySettingsHelper = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "bunny_stream_settings" });
    if (setting && setting.value) {
      let val = setting.value;
      if (typeof val === "string") {
        try {
          val = JSON.parse(val);
        } catch (_) {}
      }
      if (val && typeof val === "object") {
        return {
          apiKey: (val.apiKey || "").trim(),
          libraryId: (val.libraryId || "").trim(),
          cdnHostname: (val.cdnHostname || "iframe.mediadelivery.net").trim(),
          tokenSecurityKey: (val.tokenSecurityKey || "").trim(),
        };
      }
    }
  } catch (err) {
    console.error("Error reading Bunny settings:", err);
  }
  return {
    apiKey: (process.env.BUNNY_API_KEY || "").trim(),
    libraryId: (process.env.BUNNY_LIBRARY_ID || "").trim(),
    cdnHostname: (process.env.BUNNY_CDN_HOSTNAME || "iframe.mediadelivery.net").trim(),
    tokenSecurityKey: (process.env.BUNNY_TOKEN_SECURITY_KEY || "").trim(),
  };
};

// Helper: Check if string is a valid non-empty DB ID (Mongo ObjectId, UUID, or String)
export const isValidId = (id) => {
  if (!id) return false;
  const s = String(id).trim();
  if (!s || s === "null" || s === "undefined" || s === "[object Object]") return false;
  return s.length >= 8;
};

// Helper: Resolve instituteId safely from request
export const resolveInstituteId = (req) => {
  let inst = req.query?.instituteId || req.body?.instituteId;
  if (isValidId(inst)) return String(inst).trim();

  const rawInst = req.user?.institute;
  if (rawInst) {
    if (typeof rawInst === "object") {
      const id = String(rawInst._id || rawInst.id || "");
      if (isValidId(id)) return id.trim();
    } else if (typeof rawInst === "string" && isValidId(rawInst)) {
      return rawInst.trim();
    }
  }

  const userId = req.user?._id || req.user?.id;
  if (isValidId(userId)) {
    return String(userId).trim();
  }

  return "000000000000000000000000";
};

// Helper: Sync & calculate institute storage quota
export const getInstituteStorageAccount = async (instituteId) => {
  if (!isValidId(instituteId)) {
    return {
      storage: null,
      limitBytes: 50 * 1024 * 1024 * 1024,
      usedBytes: 0,
      reservedBytes: 0,
      availableBytes: 50 * 1024 * 1024 * 1024,
      maxGb: 50,
      usedGb: 0,
      availableGb: 50,
    };
  }

  let storage = await InstituteVideoStorage.findOne({ institute: instituteId });
  let institute = null;
  if (mongoose.Types.ObjectId.isValid(instituteId)) {
    institute = await Institute.findById(instituteId);
  }

  const maxGb = Number(institute?.maxVideoStorageGb || 50);
  const limitBytes = maxGb * 1024 * 1024 * 1024;

  if (!storage) {
    const usedBytes = Number(institute?.usedVideoStorageBytes || 0);
    const reservedBytes = Number(institute?.reservedVideoStorageBytes || 0);
    storage = await InstituteVideoStorage.create({
      institute: instituteId,
      storageLimitBytes: limitBytes,
      usedStorageBytes: usedBytes,
      reservedStorageBytes: reservedBytes,
    });
  } else if (storage.storageLimitBytes !== limitBytes) {
    storage.storageLimitBytes = limitBytes;
    await storage.save();
  }

  const availableBytes = Math.max(
    0,
    storage.storageLimitBytes - storage.usedStorageBytes - storage.reservedStorageBytes
  );

  return {
    storage,
    limitBytes: storage.storageLimitBytes,
    usedBytes: storage.usedStorageBytes,
    reservedBytes: storage.reservedStorageBytes,
    availableBytes,
    maxGb,
    usedGb: Number((storage.usedStorageBytes / (1024 * 1024 * 1024)).toFixed(2)),
    availableGb: Number((availableBytes / (1024 * 1024 * 1024)).toFixed(2)),
  };
};

export const syncInstituteStorage = getInstituteStorageAccount;

// -----------------------------------------------------------------------------
// 1. UPLOAD INITIALIZATION & STORAGE QUOTA RESERVATION
// -----------------------------------------------------------------------------

export const initVideoUpload = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    let institute = null;
    if (instituteId && mongoose.Types.ObjectId.isValid(instituteId)) {
      institute = await Institute.findById(instituteId);
    }

    if (req.user.role !== "super_admin" && institute && institute.recordedLecturesFeatureEnabled === false) {
      return res.status(403).json({ message: "Recorded Lectures feature is disabled for this institute" });
    }

    const {
      fileName,
      fileSize,
      title,
      description,
      playlistId,
      playlistName,
      targetAudienceType = "none",
      targetAudienceMetadata = {},
    } = req.body;

    const fileSizeBytes = Number(fileSize || 0);
    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Video title is required" });
    }
    if (fileSizeBytes <= 0) {
      return res.status(400).json({ message: "Invalid file size" });
    }

    // Authoritative Storage Quota Check
    const storageAcc = await getInstituteStorageAccount(instituteId);
    if (storageAcc.availableBytes < fileSizeBytes) {
      const fileMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
      const availMb = (storageAcc.availableBytes / (1024 * 1024)).toFixed(1);
      return res.status(400).json({
        message: `Not enough storage! Your institute has ${availMb} MB available, but this video is ${fileMb} MB. Please delete old videos to free up space or contact Super Admin to upgrade storage.`,
        storage: {
          availableMb: availMb,
          requiredMb: fileMb,
          limitGb: storageAcc.maxGb,
          usedGb: storageAcc.usedGb,
        },
      });
    }

    // Bunny Stream Config
    const bunny = await getBunnySettingsHelper();
    if (!bunny.apiKey || !bunny.libraryId) {
      return res.status(400).json({
        message: "Bunny.net Stream credentials are not configured in Super Admin settings.",
      });
    }

    // Call Bunny Stream Create Video API
    let bunnyRes;
    try {
      bunnyRes = await axios.post(
        `https://video.bunnycdn.com/library/${bunny.libraryId}/videos`,
        { title: title.trim() },
        {
          headers: {
            AccessKey: bunny.apiKey,
            accept: "application/json",
            "content-type": "application/json",
          },
          params: { AccessKey: bunny.apiKey },
        }
      );
    } catch (bErr) {
      console.error("Bunny Stream API error:", bErr.response?.data || bErr.message);
      const is401 = bErr.response?.status === 401;
      return res.status(400).json({
        message: is401
          ? "Bunny Stream AccessKey / API Key is invalid or expired. Please update Bunny settings in Super Admin portal."
          : `Failed to create video on Bunny CDN: ${bErr.response?.data?.message || bErr.message}`,
      });
    }

    const bunnyVideoId = bunnyRes.data.guid;

    const rawUserId = req.user ? (req.user._id || req.user.id) : null;
    const creatorId = isValidId(rawUserId) ? String(rawUserId).trim() : instituteId;

    // Resolve Playlist if specified
    let targetPlaylistId = null;
    let playlistTitle = playlistName ? playlistName.trim() : "";
    if (playlistId) {
      targetPlaylistId = playlistId;
    } else if (playlistTitle) {
      let existingPlaylist = await VideoPlaylist.findOne({
        institute: instituteId,
        name: { $regex: new RegExp(`^${playlistTitle}$`, "i") },
      });
      if (!existingPlaylist) {
        existingPlaylist = await VideoPlaylist.create({
          institute: instituteId,
          teacher: creatorId,
          name: playlistTitle,
        });
      }
      targetPlaylistId = existingPlaylist._id;
    }

    // Create ClassTech Video Lecture (Status: UPLOADING)
    const hlsUrl = `https://${bunny.cdnHostname}/${bunnyVideoId}/playlist.m3u8`;
    const embedUrl = `https://${bunny.cdnHostname}/embed/${bunny.libraryId}/${bunnyVideoId}`;
    const thumbnailUrl = `https://${bunny.cdnHostname}/${bunnyVideoId}/thumbnail.jpg`;

    const video = await VideoLecture.create({
      institute: instituteId,
      createdBy: creatorId,
      bunnyVideoId,
      bunnyLibraryId: bunny.libraryId,
      title: title.trim(),
      description: description ? description.trim() : "",
      playlist: playlistTitle,
      playlistId: targetPlaylistId,
      uploadFileName: fileName || "video.mp4",
      uploadFileSizeBytes: fileSizeBytes,
      fileSizeBytes: fileSizeBytes,
      videoUrl: embedUrl,
      hlsUrl,
      thumbnailUrl,
      targetAudienceType,
      targetAudienceMetadata,
      status: "UPLOADING",
      processingProgress: 0,
    });

    // If playlist specified, add playlist item entry
    if (targetPlaylistId) {
      const itemCount = await VideoPlaylistItem.countDocuments({ playlist: targetPlaylistId });
      await VideoPlaylistItem.create({
        playlist: targetPlaylistId,
        video: video._id,
        sortOrder: itemCount + 1,
      });
    }

    // Reserve Storage Bytes
    storageAcc.storage.reservedStorageBytes += fileSizeBytes;
    await storageAcc.storage.save();
    if (institute) {
      institute.reservedVideoStorageBytes = (institute.reservedVideoStorageBytes || 0) + fileSizeBytes;
      await institute.save();
    }

    // Create Upload Audit Log
    const uploadSession = await VideoUpload.create({
      institute: instituteId,
      teacher: creatorId,
      video: video._id,
      originalFileName: fileName || "video.mp4",
      fileSizeBytes: fileSizeBytes,
      reservationBytes: fileSizeBytes,
      uploadStatus: "INITIATED",
    });

    const directUploadUrl = `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${bunnyVideoId}`;

    return res.status(201).json({
      videoId: video._id,
      bunnyVideoId,
      libraryId: bunny.libraryId,
      uploadSessionId: uploadSession._id,
      directUploadUrl,
      hlsUrl,
      embedUrl,
      thumbnailUrl,
      apiKey: bunny.apiKey,
    });
  } catch (error) {
    console.error("initVideoUpload error:", error);
    return res.status(500).json({ message: error.message || "Could not initialize video upload" });
  }
};

export const completeVideoUpload = async (req, res) => {
  try {
    const { videoId, uploadSessionId } = req.body;
    const instituteId = resolveInstituteId(req);

    const query = { _id: videoId };
    if (instituteId) query.institute = instituteId;

    const video = await VideoLecture.findOne(query);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    // Update status to PROCESSING
    video.status = "PROCESSING";
    video.processingProgress = 10;
    await video.save();

    // Update Upload Session & Storage Reservation
    if (uploadSessionId) {
      const uploadSession = await VideoUpload.findById(uploadSessionId);
      if (uploadSession) {
        uploadSession.uploadStatus = "COMPLETED";
        uploadSession.completedAt = new Date();
        await uploadSession.save();

        const storageAcc = await getInstituteStorageAccount(instituteId);
        const institute = await Institute.findById(instituteId);

        // Move reserved bytes to used bytes
        const bytes = uploadSession.reservationBytes || video.fileSizeBytes || 0;
        storageAcc.storage.reservedStorageBytes = Math.max(0, storageAcc.storage.reservedStorageBytes - bytes);
        storageAcc.storage.usedStorageBytes += bytes;
        await storageAcc.storage.save();

        if (institute) {
          institute.reservedVideoStorageBytes = Math.max(0, (institute.reservedVideoStorageBytes || 0) - bytes);
          institute.usedVideoStorageBytes = (institute.usedVideoStorageBytes || 0) + bytes;
          await institute.save();
        }
      }
    }

    await clearCachePattern("*");

    return res.json({
      message: "Upload completed. Video is now processing.",
      video: {
        id: video._id,
        status: video.status,
        processingProgress: video.processingProgress,
      },
    });
  } catch (error) {
    console.error("completeVideoUpload error:", error);
    return res.status(500).json({ message: "Could not mark upload completed" });
  }
};

// -----------------------------------------------------------------------------
// 2. BUNNY PROCESSING SYNCHRONIZATION & STATUS POLLING
// -----------------------------------------------------------------------------

export const checkVideoStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const rawInst = req.user.institute;
    let instituteId = typeof rawInst === "object" ? String(rawInst?._id || rawInst?.id || "") : String(rawInst || "");
    if (!instituteId) instituteId = String(req.user._id || "");

    const video = await VideoLecture.findOne({ _id: id, institute: instituteId });
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    if (video.status === "READY" || video.status === "FAILED") {
      return res.json({
        status: video.status,
        processingProgress: video.processingProgress || 100,
        video,
      });
    }

    // Query Bunny API directly
    const bunny = await getBunnySettingsHelper();
    if (bunny.apiKey && bunny.libraryId && video.bunnyVideoId) {
      try {
        const bRes = await axios.get(
          `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${video.bunnyVideoId}`,
          { headers: { AccessKey: bunny.apiKey, accept: "application/json" } }
        );

        const bData = bRes.data;
        const bStatus = bData.status; // 0=Created, 1=Uploaded, 2=Processing, 3=Transcoding, 4=Finished, 5=Error
        const progress = bData.encodeProgress || 0;

        if (bStatus === 4 || bStatus === 3 || progress >= 99) {
          video.status = "READY";
          video.processingProgress = 100;
          if (bData.length > 0) video.durationSeconds = bData.length;
          if (bData.storageSize > 0) video.storageSizeBytes = bData.storageSize;
          await video.save();
        } else if (bStatus === 5) {
          video.status = "FAILED";
          video.processingProgress = 0;
          await video.save();
        } else {
          video.processingProgress = Math.max(video.processingProgress || 10, progress);
          await video.save();
        }
      } catch (bErr) {
        console.warn("Bunny status check warning:", bErr.message);
      }
    }

    return res.json({
      status: video.status,
      processingProgress: video.processingProgress,
      video,
    });
  } catch (error) {
    console.error("checkVideoStatus error:", error);
    return res.status(500).json({ message: "Could not fetch video status" });
  }
};

export const handleBunnyWebhook = async (req, res) => {
  try {
    const { VideoId, Status, LibraryId } = req.body;
    if (!VideoId) {
      return res.status(400).json({ message: "Missing VideoId" });
    }

    const video = await VideoLecture.findOne({ bunnyVideoId: String(VideoId) });
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    if (Status === 4 || Status === 3 || Status === "Finished") {
      video.status = "READY";
      video.processingProgress = 100;
      await video.save();
    } else if (Status === 5 || Status === "Error") {
      video.status = "FAILED";
      await video.save();
    }

    await clearCachePattern("*");

    return res.json({ message: "Webhook processed successfully" });
  } catch (error) {
    console.error("handleBunnyWebhook error:", error);
    return res.status(500).json({ message: "Webhook handler failed" });
  }
};

// -----------------------------------------------------------------------------
// 3. TEACHER VIDEO MANAGEMENT, SEARCH & ARCHIVE
// -----------------------------------------------------------------------------

export const getTeacherVideos = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);

    let institute = null;
    if (instituteId && mongoose.Types.ObjectId.isValid(instituteId)) {
      try {
        institute = await Institute.findById(instituteId);
      } catch (_) {}
    }

    const { search, playlistId, status, isArchived } = req.query;

    const query = {};

    if (req.user?.role === "super_admin" && !req.query?.instituteId) {
      // Super admin sees all videos
    } else {
      const conditions = [];
      if (instituteId && instituteId !== "000000000000000000000000") {
        conditions.push({ institute: instituteId });
      }
      if (req.user?._id) {
        conditions.push({ createdBy: req.user._id });
        conditions.push({ institute: req.user._id });
      }
      if (conditions.length > 0) {
        query.$or = conditions;
      }
    }

    if (isArchived === "true") {
      query.isArchived = true;
    } else {
      query.isArchived = { $ne: true };
    }

    if (playlistId && mongoose.Types.ObjectId.isValid(playlistId)) {
      query.playlistId = playlistId;
    }

    if (status) {
      query.status = status;
    }

    if (search && search.trim()) {
      const q = search.trim();
      const searchOr = [
        { title: { $regex: q, $options: "i" } },
        { description: { $regex: q, $options: "i" } },
        { playlist: { $regex: q, $options: "i" } },
      ];
      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchOr }];
        delete query.$or;
      } else {
        query.$or = searchOr;
      }
    }

    let videos = [];
    try {
      videos = await VideoLecture.find(query)
        .sort({ createdAt: -1 })
        .populate("playlistId", "name description");
    } catch (findErr) {
      console.warn("getTeacherVideos populate fallback:", findErr.message);
      videos = await VideoLecture.find(query).sort({ createdAt: -1 });
    }

    let storageInfo = {
      maxGb: 50,
      usedBytes: 0,
      usedGb: 0,
      availableGb: 50,
      availableBytes: 50 * 1024 * 1024 * 1024,
      limitBytes: 50 * 1024 * 1024 * 1024,
    };
    try {
      storageInfo = await getInstituteStorageAccount(instituteId);
    } catch (stErr) {
      console.warn("getInstituteStorageAccount warning:", stErr.message);
    }

    const activeVideos = [];
    const archivedVideos = [];

    (videos || []).forEach((v) => {
      const vObj = typeof v.toObject === "function" ? v.toObject() : v;
      if (v.isArchived || v.status === "ARCHIVED") {
        archivedVideos.push(vObj);
      } else {
        activeVideos.push(vObj);
      }
    });

    return res.json({
      featureEnabled: institute ? institute.recordedLecturesFeatureEnabled !== false : true,
      releaseVideosFeatureEnabled: institute ? institute.releaseVideosFeatureEnabled !== false : true,
      storage: {
        maxStorageGb: storageInfo.maxGb,
        usedStorageBytes: storageInfo.usedBytes,
        usedStorageGb: storageInfo.usedGb,
        availableStorageGb: storageInfo.availableGb,
        freeStorageGb: storageInfo.availableGb,
        usagePercentage: storageInfo.limitBytes > 0 ? Math.min(100, Math.round((storageInfo.usedBytes / storageInfo.limitBytes) * 100)) : 0,
      },
      activeVideos,
      expiredVideos: archivedVideos,
      archivedVideos,
      totalCount: videos.length,
    });
  } catch (error) {
    console.error("getTeacherVideos error:", error);
    return res.status(500).json({ message: error.message || "Could not fetch video lectures" });
  }
};

export const updateVideoLecture = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = { _id: req.params.id };
    if (instituteId) query.institute = instituteId;

    const video = await VideoLecture.findOne(query);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    const {
      title,
      description,
      playlist,
      playlistId,
      targetAudienceType,
      targetAudienceMetadata,
      thumbnailUrl,
    } = req.body;

    if (title !== undefined && title.trim()) video.title = title.trim();
    if (description !== undefined) video.description = description.trim();
    if (playlist !== undefined) video.playlist = playlist.trim();
    if (playlistId !== undefined) video.playlistId = playlistId || null;
    if (targetAudienceType !== undefined) video.targetAudienceType = targetAudienceType;
    if (targetAudienceMetadata !== undefined) video.targetAudienceMetadata = targetAudienceMetadata;
    if (thumbnailUrl !== undefined) video.thumbnailUrl = thumbnailUrl ? thumbnailUrl.trim() : video.thumbnailUrl;

    await video.save();
    await clearCachePattern("*");

    return res.json({ message: "Video lecture updated successfully", video });
  } catch (error) {
    console.error("updateVideoLecture error:", error);
    return res.status(500).json({ message: "Could not update video lecture" });
  }
};

export const archiveVideoLecture = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = { _id: req.params.id };
    if (instituteId) query.institute = instituteId;

    const video = await VideoLecture.findOne(query);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    video.isArchived = true;
    video.archivedAt = new Date();
    video.archivedBy = req.user._id;
    await video.save();

    await clearCachePattern("*");

    return res.json({ message: "Video archived successfully", video });
  } catch (error) {
    console.error("archiveVideoLecture error:", error);
    return res.status(500).json({ message: "Could not archive video lecture" });
  }
};

export const restoreVideoLecture = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = { _id: req.params.id };
    if (instituteId) query.institute = instituteId;

    const video = await VideoLecture.findOne(query);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    video.isArchived = false;
    video.archivedAt = null;
    video.archivedBy = null;
    await video.save();

    await clearCachePattern("*");

    return res.json({ message: "Video restored successfully", video });
  } catch (error) {
    console.error("restoreVideoLecture error:", error);
    return res.status(500).json({ message: "Could not restore video lecture" });
  }
};

export const deleteVideoLecture = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = { _id: req.params.id };
    if (instituteId) query.institute = instituteId;

    const video = await VideoLecture.findOne(query);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    const freedBytes = Number(video.fileSizeBytes || video.storageSizeBytes || 0);

    // Call Bunny Delete Video API
    try {
      const bunny = await getBunnySettingsHelper();
      if (bunny.apiKey && bunny.libraryId && video.bunnyVideoId) {
        await axios.delete(
          `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${video.bunnyVideoId}`,
          { headers: { AccessKey: bunny.apiKey } }
        );
      }
    } catch (bErr) {
      console.warn("Bunny API delete failed (soft ignored):", bErr.message);
    }

    await VideoLecture.findByIdAndDelete(video._id);
    await VideoPlaylistItem.deleteMany({ video: video._id });
    await VideoRelease.deleteMany({ video: video._id });
    await VideoWatchLog.deleteMany({ video: video._id });

    // Update institute storage
    const storageAcc = await getInstituteStorageAccount(instituteId);
    storageAcc.storage.usedStorageBytes = Math.max(0, storageAcc.storage.usedStorageBytes - freedBytes);
    await storageAcc.storage.save();

    let institute = null;
    if (instituteId && mongoose.Types.ObjectId.isValid(instituteId)) {
      institute = await Institute.findById(instituteId);
    }
    if (institute) {
      institute.usedVideoStorageBytes = Math.max(0, (institute.usedVideoStorageBytes || 0) - freedBytes);
      await institute.save();
    }

    await clearCachePattern("*");

    return res.json({ message: "Video lecture deleted permanently" });
  } catch (error) {
    console.error("deleteVideoLecture error:", error);
    return res.status(500).json({ message: "Could not delete video lecture" });
  }
};

// -----------------------------------------------------------------------------
// 4. PLAYLISTS API
// -----------------------------------------------------------------------------

export const getVideoPlaylists = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const rawUserId = req.user?._id || req.user?.id;
    const teacherId = isValidId(rawUserId) ? String(rawUserId).trim() : null;

    const query = { isArchived: { $ne: true } };

    if (req.user?.role === "super_admin" && !req.query?.instituteId) {
      // Super admin without specific institute targeting sees all playlists
    } else {
      const conditions = [];
      if (isValidId(instituteId) && instituteId !== "000000000000000000000000") {
        conditions.push({ institute: instituteId });
      }
      if (teacherId) {
        conditions.push({ teacher: teacherId });
        conditions.push({ institute: teacherId });
      }
      if (conditions.length > 0) {
        query.$or = conditions;
      }
    }

    const playlists = await VideoPlaylist.find(query)
      .sort({ createdAt: -1 });

    const result = await Promise.all(
      playlists.map(async (p) => {
        const videoCount = await VideoPlaylistItem.countDocuments({ playlist: p._id });
        const pObj = typeof p.toObject === "function" ? p.toObject() : p;
        return {
          ...pObj,
          videoCount,
        };
      })
    );

    return res.json({ playlists: result });
  } catch (error) {
    console.error("getVideoPlaylists error:", error);
    return res.status(500).json({ message: "Could not fetch video playlists" });
  }
};

export const createVideoPlaylist = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const rawUserId = req.user?._id || req.user?.id;
    const teacherId = isValidId(rawUserId) ? String(rawUserId).trim() : instituteId;

    const { name, description, thumbnailUrl } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Playlist name is required" });
    }

    const playlist = await VideoPlaylist.create({
      institute: instituteId,
      teacher: teacherId,
      name: name.trim(),
      description: description ? description.trim() : "",
      thumbnailUrl: thumbnailUrl ? thumbnailUrl.trim() : "",
    });

    return res.status(201).json(playlist);
  } catch (error) {
    console.error("createVideoPlaylist error:", error);
    return res.status(500).json({ message: error.message || "Could not create video playlist" });
  }
};

export const updateVideoPlaylist = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = { _id: req.params.id };
    if (instituteId) query.institute = instituteId;

    const playlist = await VideoPlaylist.findOne(query);
    if (!playlist) {
      return res.status(404).json({ message: "Playlist not found" });
    }

    const { name, description, thumbnailUrl } = req.body;
    if (name !== undefined && name.trim()) playlist.name = name.trim();
    if (description !== undefined) playlist.description = description.trim();
    if (thumbnailUrl !== undefined) playlist.thumbnailUrl = thumbnailUrl ? thumbnailUrl.trim() : "";

    await playlist.save();
    return res.json({ message: "Playlist updated successfully", playlist });
  } catch (error) {
    console.error("updateVideoPlaylist error:", error);
    return res.status(500).json({ message: "Could not update video playlist" });
  }
};

export const getPlaylistVideos = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = { _id: req.params.id };
    if (instituteId) query.institute = instituteId;

    const playlist = await VideoPlaylist.findOne(query);
    if (!playlist) {
      return res.status(404).json({ message: "Playlist not found" });
    }

    const items = await VideoPlaylistItem.find({ playlist: playlist._id })
      .sort({ sortOrder: 1 })
      .populate("video");

    const videos = items.map((i) => i.video).filter(Boolean);

    return res.json({
      playlist,
      totalVideos: videos.length,
      videos,
    });
  } catch (error) {
    console.error("getPlaylistVideos error:", error);
    return res.status(500).json({ message: "Could not fetch playlist videos" });
  }
};

// -----------------------------------------------------------------------------
// 5. VIDEO RELEASE ENGINE (TEACHER ACCESS CONTROL)
// -----------------------------------------------------------------------------

export const createVideoRelease = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req) || String(req.user._id || "");

    let institute = null;
    if (instituteId && mongoose.Types.ObjectId.isValid(instituteId)) {
      institute = await Institute.findById(instituteId);
    }
    if (institute && institute.releaseVideosFeatureEnabled === false) {
      return res.status(403).json({ message: "Release Videos feature is disabled for your profile." });
    }

    const { videoIds = [], studentIds = [], startsAt, expiresAt, neverExpires } = req.body;

    if (!Array.isArray(videoIds) || videoIds.length === 0) {
      return res.status(400).json({ message: "Please select at least one video to release." });
    }

    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ message: "Please select at least one student." });
    }

    const startDt = startsAt ? new Date(startsAt) : new Date();
    const expiryDt = (neverExpires === true || !expiresAt) ? null : new Date(expiresAt);

    // Verify all selected videos are READY and belong to institute
    const readyVideos = await VideoLecture.find({
      _id: { $in: videoIds },
      status: "READY",
      isArchived: { $ne: true },
    });

    if (readyVideos.length === 0) {
      return res.status(400).json({ message: "No ready, non-archived videos selected for release." });
    }

    const createdReleases = [];

    for (const video of readyVideos) {
      const release = await VideoRelease.create({
        institute: instituteId,
        teacher: req.user._id,
        video: video._id,
        startsAt: startDt,
        expiresAt: expiryDt,
        status: "ACTIVE",
      });

      for (const sId of studentIds) {
        await VideoReleaseStudent.create({
          release: release._id,
          student: sId,
        });
      }

      createdReleases.push(release);
    }

    await clearCachePattern("*");

    return res.status(201).json({
      message: `Successfully released ${readyVideos.length} video(s) to ${studentIds.length} student(s).`,
      releasesCount: createdReleases.length,
    });
  } catch (error) {
    console.error("createVideoRelease error:", error);
    return res.status(500).json({ message: "Could not create video release" });
  }
};

export const getVideoReleases = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = {};
    if (instituteId) query.institute = instituteId;

    const releases = await VideoRelease.find(query)
      .sort({ createdAt: -1 })
      .populate("video", "title thumbnailUrl durationSeconds status")
      .populate("teacher", "name email");

    const result = await Promise.all(
      releases.map(async (r) => {
        const studentCount = await VideoReleaseStudent.countDocuments({ release: r._id });
        const rObj = typeof r.toObject === "function" ? r.toObject() : r;
        return {
          ...rObj,
          studentCount,
        };
      })
    );

    return res.json({ releases: result });
  } catch (error) {
    console.error("getVideoReleases error:", error);
    return res.status(500).json({ message: "Could not fetch video releases" });
  }
};

export const revokeVideoRelease = async (req, res) => {
  try {
    const instituteId = resolveInstituteId(req);
    const query = { _id: req.params.id };
    if (instituteId) query.institute = instituteId;

    const release = await VideoRelease.findOne(query);
    if (!release) {
      return res.status(404).json({ message: "Release record not found" });
    }

    release.status = "REVOKED";
    release.revokedAt = new Date();
    release.revokedBy = req.user._id;
    await release.save();

    await clearCachePattern("*");

    return res.json({ message: "Video release revoked successfully" });
  } catch (error) {
    console.error("revokeVideoRelease error:", error);
    return res.status(500).json({ message: "Could not revoke video release" });
  }
};

// -----------------------------------------------------------------------------
// 6. STUDENT RELEASED LECTURES & SECURE PLAYBACK
// -----------------------------------------------------------------------------

export const getStudentReleasedLectures = async (req, res) => {
  try {
    const student = req.user;
    const studentId = String(student._id || student.id || "");
    const instituteId = student.institute?._id || student.institute || student.user;

    const now = new Date();

    // 1. Find all release mappings for this student
    const releaseMappings = await VideoReleaseStudent.find({ student: studentId }).select("release");
    const releaseIds = releaseMappings.map((m) => m.release);

    if (releaseIds.length === 0) {
      return res.json({ videos: [] });
    }

    // 2. Query Active Valid Releases
    const activeReleases = await VideoRelease.find({
      _id: { $in: releaseIds },
      status: "ACTIVE",
      revokedAt: null,
      startsAt: { $lte: now },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }).populate("video");

    // Group valid videos and calculate longest validity
    const videoValidityMap = {};
    activeReleases.forEach((r) => {
      if (r.video && r.video.status === "READY" && !r.video.isArchived) {
        const vId = String(r.video._id || r.video.id);
        const existingExp = videoValidityMap[vId]?.expiresAt;
        const currentExp = r.expiresAt;

        if (!existingExp || (currentExp && new Date(currentExp) > new Date(existingExp))) {
          videoValidityMap[vId] = {
            video: r.video,
            expiresAt: currentExp,
            neverExpires: !currentExp,
          };
        }
      }
    });

    const videos = Object.values(videoValidityMap).map((item) => {
      const vObj = typeof item.video.toObject === "function" ? item.video.toObject() : item.video;
      return {
        ...vObj,
        releaseExpiresAt: item.expiresAt,
        releaseNeverExpires: item.neverExpires,
      };
    });

    return res.json({ videos });
  } catch (error) {
    console.error("getStudentReleasedLectures error:", error);
    return res.status(500).json({ message: "Could not fetch student video lectures" });
  }
};

export const getStudentPlaybackAuthorization = async (req, res) => {
  try {
    const { id: videoId } = req.params;
    const student = req.user;
    const studentId = String(student._id || student.id || "");
    const now = new Date();

    const video = await VideoLecture.findById(videoId);
    if (!video || video.status !== "READY" || video.isArchived) {
      return res.status(404).json({ message: "Video lecture not available" });
    }

    // Verify Active Release
    const releaseMappings = await VideoReleaseStudent.find({ student: studentId }).select("release");
    const releaseIds = releaseMappings.map((m) => m.release);

    const validRelease = await VideoRelease.findOne({
      _id: { $in: releaseIds },
      video: video._id,
      status: "ACTIVE",
      revokedAt: null,
      startsAt: { $lte: now },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    });

    if (!validRelease && req.user.role !== "super_admin" && req.user.role !== "institute_admin" && req.user.role !== "teacher") {
      return res.status(403).json({ message: "You do not have active access to play this video lecture." });
    }

    const bunny = await getBunnySettingsHelper();
    const hlsUrl = video.hlsUrl || `https://${bunny.cdnHostname}/${video.bunnyVideoId}/playlist.m3u8`;
    const embedUrl = video.videoUrl || `https://${bunny.cdnHostname}/embed/${bunny.libraryId}/${video.bunnyVideoId}`;

    return res.json({
      authorized: true,
      video: {
        id: video._id,
        title: video.title,
        description: video.description,
        hlsUrl,
        embedUrl,
        thumbnailUrl: video.thumbnailUrl,
        durationSeconds: video.durationSeconds,
      },
    });
  } catch (error) {
    console.error("getStudentPlaybackAuthorization error:", error);
    return res.status(500).json({ message: "Could not authorize video playback" });
  }
};

// -----------------------------------------------------------------------------
// 7. THUMBNAIL UPLOAD UTILITY
// -----------------------------------------------------------------------------

export const uploadThumbnail = async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ message: "No image data provided" });
    }

    let uploadUrl = "";
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (cloudName && cloudName !== "your_cloud_name") {
      try {
        const result = await cloudinary.uploader.upload(imageBase64, {
          folder: "video_thumbnails",
        });
        uploadUrl = result.secure_url;
      } catch (cloudinaryErr) {
        console.warn("Cloudinary upload fallback:", cloudinaryErr.message);
      }
    }

    if (!uploadUrl) {
      try {
        const bucketName = process.env.SUPABASE_BUCKET || "notes";
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const buffer = Buffer.from(base64Data, "base64");
        const filename = `thumbnails/thumb_${Date.now()}_${Math.random().toString(36).substring(7)}.jpg`;

        const { data, error } = await supabase.storage
          .from(bucketName)
          .upload(filename, buffer, { contentType: "image/jpeg", upsert: true });

        if (!error && data) {
          const { data: publicUrlData } = supabase.storage.from(bucketName).getPublicUrl(filename);
          uploadUrl = publicUrlData?.publicUrl || "";
        }
      } catch (supabaseErr) {}
    }

    if (!uploadUrl) {
      uploadUrl = imageBase64;
    }

    return res.json({ thumbnailUrl: uploadUrl });
  } catch (error) {
    console.error("uploadThumbnail error:", error);
    return res.status(500).json({ message: "Could not upload thumbnail" });
  }
};

// -----------------------------------------------------------------------------
// 8. SUPER ADMIN CONTROLLERS
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
      return res.status(403).json({ message: "Only super admin can update video feature settings" });
    }

    const { instituteId } = req.params;
    const { recordedLecturesFeatureEnabled, releaseVideosFeatureEnabled, maxVideoStorageGb } = req.body;

    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    if (recordedLecturesFeatureEnabled !== undefined) {
      institute.recordedLecturesFeatureEnabled = Boolean(recordedLecturesFeatureEnabled);
    }

    if (releaseVideosFeatureEnabled !== undefined) {
      institute.releaseVideosFeatureEnabled = Boolean(releaseVideosFeatureEnabled);
    }

    if (maxVideoStorageGb !== undefined) {
      institute.maxVideoStorageGb = Math.max(1, Number(maxVideoStorageGb));
      const storageAcc = await getInstituteStorageAccount(instituteId);
      storageAcc.storage.storageLimitBytes = institute.maxVideoStorageGb * 1024 * 1024 * 1024;
      await storageAcc.storage.save();
    }

    await institute.save();

    return res.json({
      message: "Institute video & release settings updated successfully",
      institute: {
        id: institute._id,
        recordedLecturesFeatureEnabled: institute.recordedLecturesFeatureEnabled,
        releaseVideosFeatureEnabled: institute.releaseVideosFeatureEnabled,
        maxVideoStorageGb: institute.maxVideoStorageGb,
      },
    });
  } catch (error) {
    console.error("updateInstituteVideoSettings error:", error);
    return res.status(500).json({ message: "Could not update institute video settings" });
  }
};
