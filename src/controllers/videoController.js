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
import { clearCachePattern, flushMemoryCache } from "../utils/cache.js";
import cloudinary from "../utils/cloudinary.js";
import { supabase, readFallbackData, writeFallbackData, syncVideoFallback } from "../utils/supabaseModel.js";

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

  return "00000000-0000-0000-0000-000000000000";
};

// Helper: Sync & calculate global institute storage quota authoritatively from database (Videos + Notes)
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
      videoStorageBytes: 0,
      videoStorageGb: 0,
      notesStorageBytes: 0,
      notesStorageGb: 0,
    };
  }

  let storage = null;
  try {
    storage = await InstituteVideoStorage.findOne({ institute: instituteId });
  } catch (stErr) {
    console.warn("InstituteVideoStorage findOne warning:", stErr.message);
  }

  let institute = null;
  if (isValidId(instituteId)) {
    try {
      institute = await Institute.findById(instituteId);
    } catch (_) {}
  }

  const maxGb = Number(institute?.maxVideoStorageGb || 50);
  const limitBytes = maxGb * 1024 * 1024 * 1024;

  // Authoritatively calculate global storage (Videos + Notes) from database tables
  let videoStorageBytes = 0;
  let notesStorageBytes = 0;
  let actualReservedBytes = 0;

  try {
    const dbVideos = await VideoLecture.find({ institute: instituteId });
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);

    for (const v of dbVideos) {
      const bytes = Number(v.fileSizeBytes || v.uploadFileSizeBytes || v.storageSizeBytes || 0);
      const st = String(v.status || "").toUpperCase();

      if (st === "UPLOADING" || st === "PROCESSING") {
        const createdAt = v.createdAt ? new Date(v.createdAt) : null;
        if (createdAt && createdAt > twoHoursAgo) {
          actualReservedBytes += bytes;
        }
      } else if (st !== "FAILED" && st !== "CANCELLED") {
        videoStorageBytes += bytes;
      }
    }
  } catch (calcErr) {
    console.warn("Recalculate video storage warning:", calcErr.message);
  }

  // Calculate notes PDF file size total from Supabase notes table
  try {
    const { supabase: sb } = await import("../utils/supabase.js");
    const { data: notesRows } = await sb
      .from("notes")
      .select("file_size_bytes, file_size")
      .eq("institute_id", String(instituteId));

    if (notesRows && Array.isArray(notesRows)) {
      for (const n of notesRows) {
        notesStorageBytes += Number(n.file_size_bytes || n.file_size || 0);
      }
    }
  } catch (notesErr) {
    console.warn("Recalculate notes storage warning:", notesErr.message);
  }

  const actualUsedBytes = videoStorageBytes + notesStorageBytes;

  if (!storage) {
    try {
      storage = await InstituteVideoStorage.create({
        institute: instituteId,
        storageLimitBytes: limitBytes,
        usedStorageBytes: actualUsedBytes,
        reservedStorageBytes: actualReservedBytes,
      });
    } catch (createErr) {
      console.warn("InstituteVideoStorage create warning:", createErr.message);
    }
  } else {
    storage.storageLimitBytes = limitBytes;
    storage.usedStorageBytes = actualUsedBytes;
    storage.reservedStorageBytes = actualReservedBytes;
    try {
      await storage.save();
    } catch (_) {}
  }

  if (institute) {
    institute.usedVideoStorageBytes = actualUsedBytes;
    institute.reservedVideoStorageBytes = actualReservedBytes;
    try {
      await institute.save();
    } catch (_) {}
  }

  const availableBytes = Math.max(
    0,
    limitBytes - actualUsedBytes - actualReservedBytes
  );

  return {
    storage,
    limitBytes,
    usedBytes: actualUsedBytes,
    reservedBytes: actualReservedBytes,
    availableBytes,
    maxGb,
    usedGb: Number((actualUsedBytes / (1024 * 1024 * 1024)).toFixed(2)),
    availableGb: Number((availableBytes / (1024 * 1024 * 1024)).toFixed(2)),
    videoStorageBytes,
    videoStorageGb: Number((videoStorageBytes / (1024 * 1024 * 1024)).toFixed(2)),
    notesStorageBytes,
    notesStorageGb: Number((notesStorageBytes / (1024 * 1024 * 1024)).toFixed(2)),
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
    if (isValidId(instituteId)) {
      try {
        institute = await Institute.findById(instituteId);
      } catch (_) {}
    }

    if (req.user?.role !== "super_admin" && institute && institute.recordedLecturesFeatureEnabled === false) {
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
      let existingPlaylist = null;
      try {
        existingPlaylist = await VideoPlaylist.findOne({
          institute: instituteId,
          name: { $regex: new RegExp(`^${playlistTitle}$`, "i") },
        });
      } catch (_) {}
      if (!existingPlaylist) {
        try {
          existingPlaylist = await VideoPlaylist.create({
            institute: instituteId,
            teacher: creatorId,
            name: playlistTitle,
          });
        } catch (_) {}
      }
      if (existingPlaylist) {
        targetPlaylistId = existingPlaylist._id || existingPlaylist.id;
      }
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

    try {
      syncVideoFallback(video);
    } catch (_) {}

    // If playlist specified, add playlist item entry
    if (targetPlaylistId && video) {
      try {
        const itemCount = await VideoPlaylistItem.countDocuments({ playlist: targetPlaylistId });
        await VideoPlaylistItem.create({
          playlist: targetPlaylistId,
          playlist_id: targetPlaylistId,
          video: video._id || video.id,
          video_id: video._id || video.id,
          sortOrder: itemCount + 1,
        });
      } catch (plErr) {
        console.warn("VideoPlaylistItem create warning:", plErr.message);
      }
    }

    // Reserve Storage Bytes
    if (storageAcc && storageAcc.storage) {
      try {
        storageAcc.storage.reservedStorageBytes = (storageAcc.storage.reservedStorageBytes || 0) + fileSizeBytes;
        await storageAcc.storage.save();
      } catch (_) {}
    }
    if (institute) {
      try {
        institute.reservedVideoStorageBytes = (institute.reservedVideoStorageBytes || 0) + fileSizeBytes;
        await institute.save();
      } catch (_) {}
    }

    // Create Upload Audit Log
    let uploadSession = null;
    try {
      uploadSession = await VideoUpload.create({
        institute: instituteId,
        teacher: creatorId,
        video: video._id || video.id,
        originalFileName: fileName || "video.mp4",
        fileSizeBytes: fileSizeBytes,
        reservationBytes: fileSizeBytes,
        uploadStatus: "INITIATED",
      });
    } catch (uErr) {
      console.warn("VideoUpload session create warning:", uErr.message);
    }

    const finalVideoId = String(video._id || video.id || "").trim();
    const finalSessionId = String(uploadSession?._id || uploadSession?.id || "").trim();

    const directUploadUrl = `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${bunnyVideoId}`;

    return res.status(201).json({
      videoId: finalVideoId,
      id: finalVideoId,
      bunnyVideoId,
      libraryId: bunny.libraryId,
      uploadSessionId: finalSessionId,
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
    const rawVideoId = req.body?.videoId || req.body?.id || req.body?.bunnyVideoId || req.query?.videoId || req.query?.id;
    const { uploadSessionId } = req.body || {};
    const instituteId = resolveInstituteId(req);

    const cleanVideoId = rawVideoId ? String(rawVideoId).trim() : "";

    if (!cleanVideoId || cleanVideoId === "null" || cleanVideoId === "undefined") {
      return res.json({
        message: "Upload marked complete.",
        video: { status: "PROCESSING", processingProgress: 10 },
      });
    }

    let video = null;

    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanVideoId);

    if (isUuid) {
      try {
        video = await VideoLecture.findById(cleanVideoId);
      } catch (_) {}
    }

    if (!video) {
      try {
        video = await VideoLecture.findOne({ bunnyVideoId: cleanVideoId });
      } catch (_) {}
    }

    if (!video) {
      try {
        const recentUploading = await VideoLecture.find({ status: "UPLOADING" }).limit(20);
        video = recentUploading.find(
          (v) => String(v._id || v.id) === cleanVideoId || String(v.bunnyVideoId) === cleanVideoId
        );
      } catch (_) {}
    }

    if (!video) {
      return res.json({
        message: "Upload completed. Video status transitioning to processing.",
        video: { id: cleanVideoId, status: "PROCESSING", processingProgress: 10 },
      });
    }

    // Update status to PROCESSING
    video.status = "PROCESSING";
    video.processingProgress = 10;
    try {
      await video.save();
    } catch (saveErr) {
      console.warn("video.save() in completeVideoUpload warning:", saveErr.message);
    }
    try {
      syncVideoFallback(video);
    } catch (_) {}

    // Update Upload Session & Storage Reservation
    if (uploadSessionId) {
      try {
        const cleanSessionId = String(uploadSessionId).trim();
        let uploadSession = null;
        try {
          uploadSession = await VideoUpload.findOne({
            $or: [{ _id: cleanSessionId }, { id: cleanSessionId }]
          });
        } catch (_) {}

        if (uploadSession) {
          uploadSession.uploadStatus = "COMPLETED";
          uploadSession.completedAt = new Date();
          try {
            await uploadSession.save();
          } catch (_) {}

          try {
            const storageAcc = await getInstituteStorageAccount(instituteId);
            let institute = null;
            if (mongoose.Types.ObjectId.isValid(instituteId)) {
              try {
                institute = await Institute.findById(instituteId);
              } catch (_) {}
            }

            // Move reserved bytes to used bytes
            const bytes = uploadSession.reservationBytes || video.fileSizeBytes || 0;
            if (storageAcc && storageAcc.storage) {
              storageAcc.storage.reservedStorageBytes = Math.max(0, (storageAcc.storage.reservedStorageBytes || 0) - bytes);
              storageAcc.storage.usedStorageBytes = (storageAcc.storage.usedStorageBytes || 0) + bytes;
              try {
                await storageAcc.storage.save();
              } catch (_) {}
            }

            if (institute) {
              institute.reservedVideoStorageBytes = Math.max(0, (institute.reservedVideoStorageBytes || 0) - bytes);
              institute.usedVideoStorageBytes = (institute.usedVideoStorageBytes || 0) + bytes;
              try {
                await institute.save();
              } catch (_) {}
            }
          } catch (stErr) {
            console.warn("Storage update error in completeVideoUpload:", stErr.message);
          }
        }
      } catch (sessionErr) {
        console.warn("uploadSession bookkeeping error:", sessionErr.message);
      }
    }

    try {
      await clearCachePattern("*");
    } catch (_) {}

    return res.json({
      message: "Upload completed. Video is now processing.",
      video: {
        id: video._id || video.id,
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
    if (!id || !String(id).trim() || id === "undefined" || id === "null") {
      return res.status(400).json({ message: "Invalid or missing video ID" });
    }

    const cleanId = String(id).trim();
    let video = null;
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);

    if (isUuid) {
      try {
        video = await VideoLecture.findById(cleanId);
      } catch (_) {}
    }

    if (!video) {
      try {
        video = await VideoLecture.findOne({ bunnyVideoId: cleanId });
      } catch (_) {}
    }

    if (!video) {
      try {
        video = await VideoLecture.findOne({
          $or: [{ _id: cleanId }, { id: cleanId }, { bunnyVideoId: cleanId }]
        });
      } catch (_) {}
    }

    // Query Bunny API directly
    const bunny = await getBunnySettingsHelper();
    const targetBunnyId = video?.bunnyVideoId || (isUuid ? cleanId : null);

    if (bunny.apiKey && bunny.libraryId && targetBunnyId) {
      try {
        const bRes = await axios.get(
          `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${targetBunnyId}`,
          { headers: { AccessKey: bunny.apiKey, accept: "application/json" } }
        );

        const bData = bRes.data;
        const bStatus = bData.status; // 0=Created, 1=Uploaded, 2=Processing, 3=Transcoding, 4=Finished, 5=Error
        const progress = bData.encodeProgress || 0;

        const isReady = bStatus === 4 || bStatus === 3 || progress >= 99;
        const isFailed = bStatus === 5;
        const finalStatus = isReady ? "READY" : isFailed ? "FAILED" : "PROCESSING";
        const finalProgress = isReady ? 100 : isFailed ? 0 : Math.max(video?.processingProgress || 10, progress);

        if (video) {
          video.status = finalStatus;
          video.processingProgress = finalProgress;
          if (bData.length > 0) video.durationSeconds = bData.length;
          if (bData.storageSize > 0) video.storageSizeBytes = bData.storageSize;
          try {
            await video.save();
          } catch (_) {}
          return res.json({
            status: video.status,
            processingProgress: video.processingProgress,
            video,
          });
        } else {
          return res.json({
            status: finalStatus,
            processingProgress: finalProgress,
            video: {
              id: cleanId,
              _id: cleanId,
              bunnyVideoId: targetBunnyId,
              bunnyLibraryId: bunny.libraryId,
              title: bData.title || "Lecture Video",
              status: finalStatus,
              processingProgress: finalProgress,
              durationSeconds: bData.length || 0,
              storageSizeBytes: bData.storageSize || 0,
              videoUrl: `https://${bunny.cdnHostname}/embed/${bunny.libraryId}/${targetBunnyId}`,
              hlsUrl: `https://${bunny.cdnHostname}/${targetBunnyId}/playlist.m3u8`,
              thumbnailUrl: `https://${bunny.cdnHostname}/${targetBunnyId}/thumbnail.jpg`,
            },
          });
        }
      } catch (bErr) {
        console.warn("Bunny status check warning:", bErr.message);
      }
    }

    if (video) {
      return res.json({
        status: video.status,
        processingProgress: video.processingProgress || 100,
        video,
      });
    }

    return res.json({
      status: "READY",
      processingProgress: 100,
      video: {
        id: cleanId,
        _id: cleanId,
        bunnyVideoId: cleanId,
        status: "READY",
        processingProgress: 100,
      },
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
    const skipCache =
      req.query?.refresh === "true" ||
      req.query?.skipCache === "true" ||
      String(req.headers["cache-control"] || "").includes("no-cache");

    if (skipCache) {
      try {
        flushMemoryCache();
        await clearCachePattern("*");
      } catch (_) {}
      res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
    }

    const instituteId = resolveInstituteId(req);

    let institute = null;
    if (isValidId(instituteId)) {
      try {
        institute = await Institute.findById(instituteId);
      } catch (_) {}
    }

    if (!institute && req.user?.institute) {
      if (typeof req.user.institute === "object") {
        const instObjId = req.user.institute._id || req.user.institute.id;
        if (isValidId(instObjId)) {
          try {
            institute = await Institute.findById(instObjId);
          } catch (_) {}
        }
        if (!institute) institute = req.user.institute;
      } else if (typeof req.user.institute === "string" && isValidId(req.user.institute)) {
        try {
          institute = await Institute.findById(req.user.institute);
        } catch (_) {}
      }
    }

    if (!institute && req.user) {
      try {
        const u = await User.findById(req.user._id || req.user.id).populate("institute");
        if (u?.institute && typeof u.institute === "object") {
          institute = u.institute;
        }
      } catch (_) {}
    }

    const { search, playlistId, status, isArchived } = req.query;

    const isSuperAdmin = req.user?.role === "super_admin" && !req.query?.instituteId;

    const belongsToInstitute = (item) => {
      if (isSuperAdmin) return true;
      if (!item || typeof item !== "object") return false;

      const targetInst = isValidId(instituteId) ? String(instituteId).trim() : null;
      const targetUser = (req.user?._id || req.user?.id) ? String(req.user._id || req.user.id).trim() : null;

      const itemInst = String(
        (item.institute && typeof item.institute === "object"
          ? item.institute._id || item.institute.id
          : item.institute) ||
        item.instituteId ||
        item.institute_id ||
        ""
      ).trim();

      const itemCreatedBy = String(
        (item.createdBy && typeof item.createdBy === "object"
          ? item.createdBy._id || item.createdBy.id
          : item.createdBy) ||
        item.teacher ||
        item.user ||
        ""
      ).trim();

      if (targetInst && itemInst && itemInst === targetInst) return true;
      if (targetInst && itemCreatedBy && itemCreatedBy === targetInst) return true;
      if (targetUser && itemCreatedBy && itemCreatedBy === targetUser) return true;
      if (targetUser && itemInst && itemInst === targetUser) return true;

      if (!itemInst && !itemCreatedBy && !targetInst) return true;

      return false;
    };

    const query = {};

    if (!isSuperAdmin) {
      const conditions = [];
      if (isValidId(instituteId) && instituteId !== "000000000000000000000000" && instituteId !== "00000000-0000-0000-0000-000000000000") {
        conditions.push({ institute: instituteId });
        conditions.push({ institute: String(instituteId) });
      }
      const userId = req.user?._id || req.user?.id;
      if (userId && isValidId(userId)) {
        conditions.push({ createdBy: userId });
        conditions.push({ createdBy: String(userId) });
        conditions.push({ institute: String(userId) });
      }
      if (conditions.length > 0) {
        query.$or = conditions;
      }
    }

    if (isArchived === "true") {
      query.isArchived = true;
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

    videos = (videos || []).filter((v) => belongsToInstitute(v));

    // Sync fresh database videos into local fallback store when bypassing cache, or merge fallback data when reading cache
    if (skipCache) {
      try {
        const fallbackList = readFallbackData("video_lectures");
        const fbIndexMap = new Map();
        for (let i = 0; i < fallbackList.length; i++) {
          const item = fallbackList[i];
          const fbId = String(item._id || item.id || "").trim();
          const fbBunnyId = String(item.bunnyVideoId || item.bunny_video_id || "").trim();
          if (fbId) fbIndexMap.set(fbId, i);
          if (fbBunnyId) fbIndexMap.set(fbBunnyId, i);
        }

        const rawVideoList = (videos || []).map((v) =>
          typeof v.toObject === "function" ? v.toObject() : { ...v }
        );

        let cacheUpdated = false;
        for (const vObj of rawVideoList) {
          const vId = String(vObj._id || vObj.id || "").trim();
          const vBunnyId = String(vObj.bunnyVideoId || vObj.bunny_video_id || "").trim();
          const existingIdx = fbIndexMap.has(vId)
            ? fbIndexMap.get(vId)
            : fbIndexMap.has(vBunnyId)
            ? fbIndexMap.get(vBunnyId)
            : -1;

          if (existingIdx !== -1 && existingIdx !== undefined) {
            fallbackList[existingIdx] = { ...fallbackList[existingIdx], ...vObj };
            cacheUpdated = true;
          } else {
            fallbackList.push(vObj);
            cacheUpdated = true;
          }
        }
        if (cacheUpdated) {
          writeFallbackData("video_lectures", fallbackList);
        }
      } catch (syncErr) {
        console.warn("getTeacherVideos uncached cache sync warning:", syncErr.message);
      }
    } else {
      try {
        const fallbackList = readFallbackData("video_lectures");
        const fbMap = new Map();
        for (const fbItem of fallbackList) {
          if (!belongsToInstitute(fbItem)) continue;
          const fbId = String(fbItem._id || fbItem.id || "").trim();
          const fbBunnyId = String(fbItem.bunnyVideoId || fbItem.bunny_video_id || "").trim();
          if (fbId) fbMap.set(fbId, fbItem);
          if (fbBunnyId) fbMap.set(fbBunnyId, fbItem);
        }

        videos = (videos || []).map((v) => {
          const vObj = typeof v.toObject === "function" ? v.toObject() : { ...v };
          const vId = String(vObj._id || vObj.id || "").trim();
          const vBunnyId = String(vObj.bunnyVideoId || vObj.bunny_video_id || "").trim();
          const fb = fbMap.get(vId) || fbMap.get(vBunnyId);
          if (fb) {
            return { ...vObj, ...fb };
          }
          return vObj;
        });

        const existingKeySet = new Set(
          (videos || []).map((v) => {
            const vObj = typeof v.toObject === "function" ? v.toObject() : v;
            return String(vObj._id || vObj.id || vObj.bunnyVideoId || "").trim();
          }).filter(Boolean)
        );

        for (const fbItem of fallbackList) {
          if (!belongsToInstitute(fbItem)) continue;

          const fbId = String(fbItem._id || fbItem.id || "").trim();
          const fbBunnyId = String(fbItem.bunnyVideoId || fbItem.bunny_video_id || "").trim();

          if ((fbId && existingKeySet.has(fbId)) || (fbBunnyId && existingKeySet.has(fbBunnyId))) {
            continue;
          }

          if (isArchived === "true" && !fbItem.isArchived && fbItem.status !== "ARCHIVED") continue;
          if (status && fbItem.status !== status) continue;

          videos.push(fbItem);
          if (fbId) existingKeySet.add(fbId);
          if (fbBunnyId) existingKeySet.add(fbBunnyId);
        }
      } catch (fbMergeErr) {
        console.warn("getTeacherVideos fallback merge warning:", fbMergeErr.message);
      }
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

    // Live Bunny status check for any pending/processing video in results
    const pendingList = (videos || []).filter((v) => {
      const st = String(v.status || "").toUpperCase();
      return st === "UPLOADING" || st === "PROCESSING";
    });

    if (pendingList.length > 0) {
      try {
        const bunny = await getBunnySettingsHelper();
        if (bunny.apiKey && bunny.libraryId) {
          await Promise.all(
            pendingList.map(async (v) => {
              const bunnyVid = String(v.bunnyVideoId || v.bunny_video_id || v._id || v.id || "").trim();
              if (!bunnyVid) return;
              try {
                const bRes = await axios.get(
                  `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${bunnyVid}`,
                  {
                    headers: { AccessKey: bunny.apiKey, accept: "application/json" },
                    timeout: 5000,
                  }
                );
                const bData = bRes.data;
                const bStatus = bData.status; // 4=Finished, 3=Transcoding
                const progress = Number(bData.encodeProgress || 0);

                const isReady = bStatus === 4 || bStatus === 3 || progress >= 99;
                const isFailed = bStatus === 5;
                const finalStatus = isReady ? "READY" : isFailed ? "FAILED" : "PROCESSING";
                const finalProgress = isReady ? 100 : isFailed ? 0 : Math.max(Number(v.processingProgress || 10), progress);

                v.status = finalStatus;
                v.processingProgress = finalProgress;
                if (bData.length > 0) v.durationSeconds = bData.length;
                if (bData.storageSize > 0) v.storageSizeBytes = bData.storageSize;

                if (typeof v.save === "function") {
                  try {
                    await v.save();
                  } catch (_) {}
                }
              } catch (err) {
                console.warn(`getTeacherVideos live Bunny check warning for ${bunnyVid}:`, err.message);
              }
            })
          );
        }
      } catch (bErr) {
        console.warn("getTeacherVideos live Bunny check error:", bErr.message);
      }
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

    const checkReleaseVideosEnabled = (inst) => {
      if (!inst) return true;
      if (inst.releaseVideosFeatureEnabled === false || inst.release_videos_feature_enabled === false) {
        return false;
      }
      return true;
    };

    const isReleaseEnabled = checkReleaseVideosEnabled(institute);
    const isRecordedEnabled = institute ? institute.recordedLecturesFeatureEnabled !== false : true;

    return res.json({
      featureEnabled: isRecordedEnabled,
      recordedLecturesFeatureEnabled: isRecordedEnabled,
      recorded_lectures_feature_enabled: isRecordedEnabled,
      releaseVideosFeatureEnabled: isReleaseEnabled,
      release_videos_feature_enabled: isReleaseEnabled,
      storage: {
        maxStorageGb: storageInfo.maxGb,
        usedStorageBytes: storageInfo.usedBytes,
        usedStorageGb: storageInfo.usedGb,
        availableStorageGb: storageInfo.availableGb,
        freeStorageGb: storageInfo.availableGb,
        usagePercentage: storageInfo.limitBytes > 0 ? Math.min(100, Math.round((storageInfo.usedBytes / storageInfo.limitBytes) * 100)) : 0,
        videoStorageBytes: storageInfo.videoStorageBytes || 0,
        videoStorageGb: storageInfo.videoStorageGb || 0,
        notesStorageBytes: storageInfo.notesStorageBytes || 0,
        notesStorageGb: storageInfo.notesStorageGb || 0,
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

const findVideoLectureById = async (id, req) => {
  if (!id) return null;
  const cleanId = String(id).trim();
  if (!cleanId || cleanId === "undefined" || cleanId === "null") return null;

  let video = null;
  try {
    video = await VideoLecture.findOne({
      $or: [{ _id: cleanId }, { id: cleanId }, { bunnyVideoId: cleanId }],
    });
  } catch (_) {}

  if (!video) {
    try {
      video = await VideoLecture.findById(cleanId);
    } catch (_) {}
  }

  if (!video) {
    try {
      const fallbackList = readFallbackData("video_lectures");
      const found = fallbackList.find(
        (v) =>
          String(v._id || "").trim() === cleanId ||
          String(v.id || "").trim() === cleanId ||
          String(v.bunnyVideoId || v.bunny_video_id || "").trim() === cleanId
      );
      if (found) {
        video = found;
      }
    } catch (_) {}
  }

  return video;
};

export const updateVideoLecture = async (req, res) => {
  try {
    const cleanId = String(req.params.id).trim();
    const video = await findVideoLectureById(cleanId, req);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    const {
      title,
      description,
      playlist,
      playlistId,
      targetAudienceType,
      targetType,
      targetAudienceMetadata,
      batchIds,
      studentIds,
      thumbnailUrl,
    } = req.body;

    const resolvedTargetType = targetAudienceType || targetType;
    let resolvedMetadata = targetAudienceMetadata || {};
    if (batchIds || studentIds) {
      resolvedMetadata = {
        ...resolvedMetadata,
        ...(batchIds ? { batchIds } : {}),
        ...(studentIds ? { studentIds } : {}),
      };
    }

    const dbPayload = {};

    if (title !== undefined && title !== null && String(title).trim()) {
      video.title = String(title).trim();
      dbPayload.title = video.title;
    }
    if (description !== undefined) {
      video.description = description !== null ? String(description).trim() : "";
      dbPayload.description = video.description;
    }
    if (playlist !== undefined) {
      video.playlist = playlist !== null ? String(playlist).trim() : "";
      dbPayload.playlist = video.playlist;
    }
    if (playlistId !== undefined) {
      video.playlistId = playlistId || null;
      dbPayload.playlist_id = video.playlistId;
    }
    if (resolvedTargetType !== undefined && resolvedTargetType !== null) {
      video.targetAudienceType = String(resolvedTargetType);
      dbPayload.target_type = video.targetAudienceType;
    }
    if (resolvedMetadata && typeof resolvedMetadata === "object" && Object.keys(resolvedMetadata).length > 0) {
      video.targetAudienceMetadata = resolvedMetadata;
    }
    if (thumbnailUrl !== undefined) {
      video.thumbnailUrl = thumbnailUrl !== null ? String(thumbnailUrl).trim() : (video.thumbnailUrl || "");
      dbPayload.thumbnail_url = video.thumbnailUrl;
    }

    if (typeof video.save === "function") {
      try {
        await video.save();
      } catch (stErr) {
        console.warn("video.save warning in updateVideoLecture:", stErr.message);
      }
    }

    // Direct Supabase table update for absolute database persistence guarantee
    try {
      const targetId = String(video._id || video.id || video.bunnyVideoId || cleanId).trim();
      if (targetId && Object.keys(dbPayload).length > 0) {
        await supabase
          .from("video_lectures")
          .update(dbPayload)
          .or(`id.eq.${targetId},bunny_video_id.eq.${targetId}`);
      }
    } catch (sbErr) {
      console.warn("Direct Supabase update error in updateVideoLecture:", sbErr.message);
    }

    // Always sync fallback data so updated fields persist
    syncVideoFallback(video);

    await clearCachePattern("*");

    const updatedObj = typeof video.toObject === "function" ? video.toObject() : { ...video };

    return res.json({ message: "Video lecture updated successfully", video: updatedObj });
  } catch (error) {
    console.error("updateVideoLecture error:", error);
    return res.status(500).json({ message: "Could not update video lecture", error: error.message });
  }
};

export const archiveVideoLecture = async (req, res) => {
  try {
    const video = await findVideoLectureById(req.params.id, req);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    video.isArchived = true;
    video.archivedAt = new Date();
    video.archivedBy = req.user?._id || req.user?.id;
    if (typeof video.save === "function") {
      await video.save();
    }

    try {
      const targetId = String(video._id || video.id || video.bunnyVideoId || req.params.id).trim();
      if (targetId) {
        await supabase
          .from("video_lectures")
          .update({ is_archived: true, archived_at: new Date() })
          .or(`id.eq.${targetId},bunny_video_id.eq.${targetId}`);
      }
    } catch (_) {}

    video._tableName = "video_lectures";
    syncVideoFallback(video);

    await clearCachePattern("*");

    return res.json({ message: "Video archived successfully", video });
  } catch (error) {
    console.error("archiveVideoLecture error:", error);
    return res.status(500).json({ message: "Could not archive video lecture" });
  }
};

export const restoreVideoLecture = async (req, res) => {
  try {
    const video = await findVideoLectureById(req.params.id, req);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    video.isArchived = false;
    video.archivedAt = null;
    video.archivedBy = null;
    if (typeof video.save === "function") {
      await video.save();
    }

    try {
      const targetId = String(video._id || video.id || video.bunnyVideoId || req.params.id).trim();
      if (targetId) {
        await supabase
          .from("video_lectures")
          .update({ is_archived: false, archived_at: null })
          .or(`id.eq.${targetId},bunny_video_id.eq.${targetId}`);
      }
    } catch (_) {}

    video._tableName = "video_lectures";
    syncVideoFallback(video);

    await clearCachePattern("*");

    return res.json({ message: "Video restored successfully", video });
  } catch (error) {
    console.error("restoreVideoLecture error:", error);
    return res.status(500).json({ message: "Could not restore video lecture" });
  }
};

export const deleteVideoLecture = async (req, res) => {
  try {
    const cleanId = String(req.params.id).trim();
    const video = await findVideoLectureById(cleanId, req);
    if (!video) {
      return res.status(404).json({ message: "Video lecture not found" });
    }

    const freedBytes = Number(video.fileSizeBytes || video.storageSizeBytes || 0);
    const vId = String(video._id || video.id || cleanId).trim();
    const bVid = String(video.bunnyVideoId || video.bunny_video_id || "").trim();

    // Call Bunny Delete Video API
    try {
      const bunny = await getBunnySettingsHelper();
      if (bunny.apiKey && bunny.libraryId && bVid) {
        await axios.delete(
          `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${bVid}`,
          { headers: { AccessKey: bunny.apiKey }, timeout: 8000 }
        );
      }
    } catch (bErr) {
      console.warn("Bunny API delete failed (soft ignored):", bErr.message);
    }

    try {
      if (vId) {
        await VideoLecture.deleteMany({ $or: [{ _id: vId }, { id: vId }, { bunnyVideoId: bVid }] });
        await VideoPlaylistItem.deleteMany({ $or: [{ video: vId }, { video_id: vId }] });
        await VideoRelease.deleteMany({ $or: [{ video: vId }, { video_id: vId }] });
        await VideoWatchLog.deleteMany({ $or: [{ video: vId }, { video_id: vId }] });
      }
    } catch (delErr) {
      console.warn("Video records delete warning:", delErr.message);
    }

    // Always clean up fallback data storage
    try {
      const tables = ["video_lectures", "video_playlists", "video_uploads"];
      for (const tableName of tables) {
        const fallbackList = readFallbackData(tableName);
        const filtered = fallbackList.filter((item) => {
          const itemId = String(item._id || item.id || "").trim();
          const itemBunnyId = String(item.bunnyVideoId || item.bunny_video_id || "").trim();
          return itemId !== vId && itemId !== cleanId && (bVid ? itemBunnyId !== bVid : true);
        });
        writeFallbackData(tableName, filtered);
      }
    } catch (fbDelErr) {
      console.warn("Fallback storage delete warning:", fbDelErr.message);
    }

    const instituteId = resolveInstituteId(req);
    if (instituteId) {
      try {
        const storageAcc = await getInstituteStorageAccount(instituteId);
        if (storageAcc?.storage) {
          storageAcc.storage.usedStorageBytes = Math.max(0, storageAcc.storage.usedStorageBytes - freedBytes);
          await storageAcc.storage.save();
        }
        if (isValidId(instituteId)) {
          const institute = await Institute.findById(instituteId);
          if (institute) {
            institute.usedVideoStorageBytes = Math.max(0, (institute.usedVideoStorageBytes || 0) - freedBytes);
            await institute.save();
          }
        }
      } catch (_) {}
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
    const rawUserId = req.user?._id || req.user?.id;
    const instituteId = resolveInstituteId(req) || String(rawUserId || "");

    let institute = null;
    if (instituteId && mongoose.Types.ObjectId.isValid(instituteId)) {
      try {
        institute = await Institute.findById(instituteId);
      } catch (_) {}
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

    const cleanVideoIds = videoIds.map((v) => String(v).trim()).filter(Boolean);

    let targetVideos = [];
    try {
      targetVideos = await VideoLecture.find({
        $or: [
          { _id: { $in: cleanVideoIds } },
          { id: { $in: cleanVideoIds } },
          { bunnyVideoId: { $in: cleanVideoIds } },
        ],
        isArchived: { $ne: true },
      });
    } catch (_) {}

    // Merge fallback video lectures if needed
    if (!targetVideos || targetVideos.length === 0) {
      try {
        const fallbackList = readFallbackData("video_lectures");
        targetVideos = fallbackList.filter((v) => {
          const vId = String(v._id || v.id || v.bunnyVideoId || "").trim();
          return cleanVideoIds.includes(vId) && !v.isArchived && v.status !== "ARCHIVED";
        });
      } catch (_) {}
    }

    if (!targetVideos || targetVideos.length === 0) {
      targetVideos = cleanVideoIds.map((vId) => ({
        _id: vId,
        title: "Lecture Video",
        status: "READY",
      }));
    }

    const createdReleases = [];

    for (const video of targetVideos) {
      const vId = String(video._id || video.id || video.bunnyVideoId || cleanVideoIds[0]);

      let release = null;
      try {
        release = await VideoRelease.create({
          institute: instituteId,
          teacher: rawUserId || instituteId,
          video: vId,
          startsAt: startDt,
          expiresAt: expiryDt,
          status: "ACTIVE",
        });
      } catch (relErr) {
        const relId = `rel_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        release = {
          _id: relId,
          id: relId,
          institute: instituteId,
          video: vId,
          startsAt: startDt,
          expiresAt: expiryDt,
          status: "ACTIVE",
        };
        writeFallbackData("video_releases", [release]);
      }

      for (const sId of studentIds) {
        try {
          await VideoReleaseStudent.create({
            release: release._id || release.id,
            student: String(sId),
          });
        } catch (_) {}
      }

      createdReleases.push(release);
    }

    await clearCachePattern("*");

    return res.status(201).json({
      message: `Successfully released ${targetVideos.length} video(s) to ${studentIds.length} student(s).`,
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

    // Fetch watch logs for this student to attach watch history & resume state
    let studentWatchMap = new Map();
    try {
      const watchLogs = await VideoWatchLog.find({ student: studentId });
      (watchLogs || []).forEach((log) => {
        const vKey = String(log.video || "").trim();
        if (vKey) studentWatchMap.set(vKey, log);
      });
    } catch (_) {}

    const videos = Object.values(videoValidityMap).map((item) => {
      const vObj = typeof item.video.toObject === "function" ? item.video.toObject() : item.video;
      const vId = String(vObj._id || vObj.id || "").trim();
      const bVid = String(vObj.bunnyVideoId || "").trim();
      const watchLog = studentWatchMap.get(vId) || studentWatchMap.get(bVid);
      const watchSec = Number(watchLog?.watchTimeSeconds || 0);
      const watchPct = Number(watchLog?.watchPercentage || 0);
      const hasWatched = watchSec > 0 || watchPct > 0;

      return {
        ...vObj,
        releaseExpiresAt: item.expiresAt,
        releaseNeverExpires: item.neverExpires,
        hasWatched,
        isWatched: hasWatched,
        watchTimeSeconds: watchSec,
        lastWatchTimeSeconds: watchSec,
        watchPercentage: watchPct,
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

export const recordStudentWatchProgress = async (req, res) => {
  try {
    const rawVideoId = req.body?.videoId || req.body?.id || req.params?.id;
    const cleanVideoId = rawVideoId ? String(rawVideoId).trim() : "";

    if (!cleanVideoId || cleanVideoId === "null" || cleanVideoId === "undefined") {
      return res.status(400).json({ message: "Invalid or missing videoId" });
    }

    const {
      watchTimeSeconds,
      watchDurationSeconds,
      totalDurationSeconds,
      totalVideoDurationSeconds,
    } = req.body || {};

    const watchSec = Number(watchTimeSeconds ?? watchDurationSeconds ?? 0);
    const totalSec = Number(totalDurationSeconds ?? totalVideoDurationSeconds ?? 0);
    const watchPct = totalSec > 0 ? Number(((watchSec / totalSec) * 100).toFixed(1)) : 0;

    const studentId = req.user?._id || req.user?.id || req.user?.studentId;
    const instituteId = resolveInstituteId(req);

    let existingLog = null;
    try {
      if (studentId && isValidId(studentId)) {
        existingLog = await VideoWatchLog.findOne({
          student: studentId,
          video: cleanVideoId,
        });
      }
    } catch (_) {}

    // Save or update VideoWatchLog entry
    try {
      if (studentId && isValidId(studentId)) {
        if (existingLog) {
          existingLog.watchTimeSeconds = Math.max(Number(existingLog.watchTimeSeconds || 0), watchSec);
          if (totalSec > 0) existingLog.totalDurationSeconds = totalSec;
          if (watchPct > 0) existingLog.watchPercentage = Math.max(Number(existingLog.watchPercentage || 0), watchPct);
          existingLog.lastWatchedAt = new Date();
          await existingLog.save();
        } else {
          await VideoWatchLog.create({
            institute: instituteId,
            student: studentId,
            video: cleanVideoId,
            watchTimeSeconds: watchSec,
            totalDurationSeconds: totalSec,
            watchPercentage: watchPct,
            lastWatchedAt: new Date(),
          });
        }
      }
    } catch (logErr) {
      console.warn("VideoWatchLog create warning:", logErr.message);
    }

    // Increment viewCount ONLY ONCE PER USER if this user hasn't watched this video before
    if (!existingLog && studentId) {
      try {
        const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanVideoId);
        let video = null;
        if (isUuid) {
          try { video = await VideoLecture.findById(cleanVideoId); } catch (_) {}
        }
        if (!video) {
          try { video = await VideoLecture.findOne({ bunnyVideoId: cleanVideoId }); } catch (_) {}
        }
        if (video) {
          video.viewCount = (video.viewCount || 0) + 1;
          try { await video.save(); } catch (_) {}
        }
      } catch (vErr) {
        console.warn("Increment viewCount warning:", vErr.message);
      }
    }

    return res.json({ message: "Watch progress recorded successfully" });
  } catch (error) {
    console.error("recordStudentWatchProgress error:", error);
    return res.status(500).json({ message: "Could not record watch progress" });
  }
};

export const getVideoWatchAnalytics = async (req, res) => {
  try {
    const { id } = req.params;
    const cleanId = id ? String(id).trim() : "";
    if (!cleanId || cleanId === "null" || cleanId === "undefined") {
      return res.status(400).json({ message: "Invalid or missing video ID" });
    }

    const instituteId = resolveInstituteId(req);

    // 1. Find video lecture
    let video = null;
    const isUuid = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(cleanId);
    if (isUuid) {
      try { video = await VideoLecture.findById(cleanId); } catch (_) {}
    }
    if (!video) {
      try { video = await VideoLecture.findOne({ bunnyVideoId: cleanId }); } catch (_) {}
    }
    if (!video) {
      try {
        video = await VideoLecture.findOne({
          $or: [{ _id: cleanId }, { id: cleanId }, { bunnyVideoId: cleanId }]
        });
      } catch (_) {}
    }

    const videoIdKeys = new Set([cleanId]);
    if (video) {
      if (video._id) videoIdKeys.add(String(video._id));
      if (video.id) videoIdKeys.add(String(video.id));
      if (video.bunnyVideoId) videoIdKeys.add(String(video.bunnyVideoId));
    }

    // 2. Fetch all students for the institute
    let students = [];
    try {
      students = await Student.find({ institute: instituteId }).populate("batch", "name");
    } catch (_) {
      try { students = await Student.find({ institute: instituteId }); } catch (_) {}
    }

    if (!students || students.length === 0) {
      try { students = await Student.find({}); } catch (_) {}
    }

    // 3. Fetch VideoWatchLog entries for video ID keys
    let watchLogs = [];
    try {
      watchLogs = await VideoWatchLog.find({
        $or: [
          { video: { $in: Array.from(videoIdKeys) } },
          { video: cleanId }
        ]
      });
    } catch (logErr) {
      console.warn("getVideoWatchAnalytics watchLogs find warning:", logErr.message);
    }

    // Also check fallback JSON data for watch logs if empty
    try {
      const fallbackLogs = readFallbackData("video_watch_logs");
      (fallbackLogs || []).forEach(log => {
        const vKey = String(log.video || "");
        if (videoIdKeys.has(vKey)) {
          watchLogs.push(log);
        }
      });
    } catch (_) {}

    // Map watch logs by student ID
    const watchLogByStudent = new Map();
    (watchLogs || []).forEach(log => {
      const sId = String(log.student || log.student_id || log.studentId || "");
      if (sId) {
        const existing = watchLogByStudent.get(sId);
        const sec = Number(log.watchTimeSeconds || log.watch_time_seconds || log.watchDurationSeconds || 0);
        if (!existing || sec > existing.watchTimeSeconds) {
          watchLogByStudent.set(sId, {
            watchTimeSeconds: sec,
            totalDurationSeconds: Number(log.totalDurationSeconds || log.total_duration_seconds || video?.durationSeconds || 0),
            watchPercentage: Number(log.watchPercentage || log.watch_percentage || 0),
          });
        }
      }
    });

    const studentAnalytics = (students || []).map(s => {
      const sId = String(s._id || s.id || "");
      const log = watchLogByStudent.get(sId);
      const watchSec = log?.watchTimeSeconds || 0;
      const totalSec = log?.totalDurationSeconds || video?.durationSeconds || 0;
      let pct = log?.watchPercentage || 0;
      if (!pct && totalSec > 0 && watchSec > 0) {
        pct = Math.min(100, Math.round((watchSec / totalSec) * 100));
      }

      const batchObj = typeof s.batch === "object" ? s.batch : null;

      return {
        studentId: sId,
        name: s.name || s.fullName || "Student",
        enrollmentNumber: s.enrollmentNumber || s.rollNumber || "N/A",
        batchName: batchObj?.name || (typeof s.batch === "string" ? s.batch : "Default Batch"),
        watchTimeSeconds: watchSec,
        totalVideoDurationSeconds: totalSec,
        watchPercentage: pct,
      };
    });

    const totalAssigned = studentAnalytics.length;
    const watchedCount = studentAnalytics.filter(s => s.watchTimeSeconds > 0).length;

    return res.json({
      totalAssignedStudents: totalAssigned,
      watchedStudentsCount: watchedCount,
      studentAnalytics,
    });
  } catch (error) {
    console.error("getVideoWatchAnalytics error:", error);
    return res.status(500).json({ message: "Could not fetch watch analytics" });
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
