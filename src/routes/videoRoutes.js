import express from "express";
import {
  getBunnySettings,
  updateBunnySettings,
  updateInstituteVideoSettings,
  initVideoUpload,
  completeVideoUpload,
  checkVideoStatus,
  handleBunnyWebhook,
  getTeacherVideos,
  updateVideoLecture,
  archiveVideoLecture,
  restoreVideoLecture,
  deleteVideoLecture,
  getVideoPlaylists,
  createVideoPlaylist,
  updateVideoPlaylist,
  getPlaylistVideos,
  createVideoRelease,
  getVideoReleases,
  revokeVideoRelease,
  getStudentReleasedLectures,
  getStudentPlaybackAuthorization,
  recordStudentWatchProgress,
  getVideoWatchAnalytics,
  uploadThumbnail,
} from "../controllers/videoController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

// Public Webhook from Bunny Stream
router.post("/bunny/webhook", express.json(), handleBunnyWebhook);

// Protected API Routes
router.use(protect);

// Super Admin Settings
router.get("/super-admin/bunny-settings", getBunnySettings);
router.put("/super-admin/bunny-settings", updateBunnySettings);
router.put("/super-admin/institute-settings/:instituteId", updateInstituteVideoSettings);

// Direct Upload Flow
router.post("/upload/init", initVideoUpload);
router.post("/bunny/signature", initVideoUpload); // Legacy compatibility alias
router.post("/upload/complete", completeVideoUpload);
router.get("/teacher/:id/status", checkVideoStatus);

// Teacher Video Management & Search
router.get("/teacher", getTeacherVideos);
router.get("/teacher/:id/analytics", getVideoWatchAnalytics);
router.put("/teacher/:id", updateVideoLecture);
router.post("/teacher/:id/archive", archiveVideoLecture);
router.post("/teacher/:id/restore", restoreVideoLecture);
router.delete("/teacher/:id", deleteVideoLecture);
router.post("/thumbnail", uploadThumbnail);

// Playlists
router.get("/playlists", getVideoPlaylists);
router.get("/playlist", getVideoPlaylists);
router.post("/playlists", createVideoPlaylist);
router.post("/playlist", createVideoPlaylist);
router.put("/playlists/:id", updateVideoPlaylist);
router.put("/playlist/:id", updateVideoPlaylist);
router.get("/playlists/:id/videos", getPlaylistVideos);
router.get("/playlist/:id/videos", getPlaylistVideos);

// Video Releases
router.post("/releases", createVideoRelease);
router.get("/releases", getVideoReleases);
router.post("/releases/:id/revoke", revokeVideoRelease);

// Student Released Lectures & Playback Authorization
router.get("/student/released", getStudentReleasedLectures);
router.get("/student", getStudentReleasedLectures); // Legacy compatibility alias
router.get("/student/:id/playback", getStudentPlaybackAuthorization);
router.post("/student/watch-progress", recordStudentWatchProgress);
router.post("/student/:id/watch-progress", recordStudentWatchProgress);

export default router;
