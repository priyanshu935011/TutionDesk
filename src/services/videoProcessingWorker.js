import axios from "axios";
import VideoLecture from "../models/VideoLecture.js";
import { getBunnySettingsHelper } from "../controllers/videoController.js";
import { readFallbackData } from "../utils/supabaseModel.js";
import { clearCachePattern } from "../utils/cache.js";

let isWorkerRunning = false;

export const processPendingVideosBatch = async () => {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    const bunny = await getBunnySettingsHelper();
    if (!bunny.apiKey || !bunny.libraryId) {
      return;
    }

    // 1. Fetch DB videos with status PROCESSING or UPLOADING (limit to 100)
    let processingVideos = [];
    try {
      processingVideos = await VideoLecture.find({
        status: { $in: ["PROCESSING", "UPLOADING"] },
      }).limit(100);
    } catch (dbErr) {
      console.warn("[VideoWorker] DB query warning:", dbErr.message);
    }

    // 2. Also check fallback JSON storage for any processing items
    try {
      const fallbackList = readFallbackData("video_lectures");
      const existingKeySet = new Set(
        (processingVideos || []).map((v) => {
          const vObj = typeof v.toObject === "function" ? v.toObject() : v;
          return String(vObj._id || vObj.id || vObj.bunnyVideoId || "").trim();
        }).filter(Boolean)
      );

      for (const fbItem of fallbackList) {
        if (processingVideos.length >= 100) break;
        const st = String(fbItem.status || "").toUpperCase();
        if (st === "PROCESSING" || st === "UPLOADING") {
          const fbId = String(fbItem._id || fbItem.id || "").trim();
          const fbBunnyId = String(fbItem.bunnyVideoId || fbItem.bunny_video_id || "").trim();
          if ((fbId && !existingKeySet.has(fbId)) || (fbBunnyId && !existingKeySet.has(fbBunnyId))) {
            processingVideos.push(fbItem);
            if (fbId) existingKeySet.add(fbId);
            if (fbBunnyId) existingKeySet.add(fbBunnyId);
          }
        }
      }
    } catch (fbErr) {
      console.warn("[VideoWorker] Fallback check warning:", fbErr.message);
    }

    if (!processingVideos || processingVideos.length === 0) {
      return;
    }

    let hasUpdates = false;

    for (const vDoc of processingVideos) {
      const bunnyVideoId = String(vDoc.bunnyVideoId || vDoc.bunny_video_id || vDoc._id || vDoc.id || "").trim();
      if (!bunnyVideoId) continue;

      try {
        const bRes = await axios.get(
          `https://video.bunnycdn.com/library/${bunny.libraryId}/videos/${bunnyVideoId}`,
          {
            headers: {
              AccessKey: bunny.apiKey,
              accept: "application/json",
            },
            timeout: 8000,
          }
        );

        const bData = bRes.data;
        const bStatus = bData.status; // 0=Created, 1=Uploaded, 2=Processing, 3=Transcoding, 4=Finished, 5=Error
        const progress = Number(bData.encodeProgress || 0);

        const isReady = bStatus === 4 || bStatus === 3 || progress >= 99;
        const isFailed = bStatus === 5;
        const finalStatus = isReady ? "READY" : isFailed ? "FAILED" : "PROCESSING";
        const finalProgress = isReady ? 100 : isFailed ? 0 : Math.max(Number(vDoc.processingProgress || 10), progress);

        let changed = false;

        if (vDoc.status !== finalStatus) {
          vDoc.status = finalStatus;
          changed = true;
        }
        if (vDoc.processingProgress !== finalProgress) {
          vDoc.processingProgress = finalProgress;
          changed = true;
        }
        if (bData.length > 0 && Number(vDoc.durationSeconds || 0) !== bData.length) {
          vDoc.durationSeconds = bData.length;
          changed = true;
        }
        if (bData.storageSize > 0 && Number(vDoc.storageSizeBytes || 0) !== bData.storageSize) {
          vDoc.storageSizeBytes = bData.storageSize;
          changed = true;
        }

        if (changed) {
          hasUpdates = true;
          if (typeof vDoc.save === "function") {
            try {
              await vDoc.save();
            } catch (saveErr) {
              console.warn(`[VideoWorker] Save failed for ${bunnyVideoId}:`, saveErr.message);
            }
          }
        }
      } catch (reqErr) {
        if (reqErr.response?.status !== 404) {
          console.warn(`[VideoWorker] Bunny status fetch warning for video ${bunnyVideoId}:`, reqErr.message);
        }
      }
    }

    if (hasUpdates) {
      try {
        await clearCachePattern("*");
      } catch (_) {}
    }
  } catch (err) {
    console.error("[VideoWorker] Global batch execution error:", err.message);
  } finally {
    isWorkerRunning = false;
  }
};

export const startVideoProcessingWorker = (intervalMs = 10000) => {
  console.log(`[VideoWorker] Starting global video processing worker (interval: ${intervalMs / 1000}s, batch limit: 100)...`);
  
  setTimeout(() => {
    processPendingVideosBatch();
  }, 2000);

  setInterval(() => {
    processPendingVideosBatch();
  }, intervalMs);
};
