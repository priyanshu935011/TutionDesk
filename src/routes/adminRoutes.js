import express from "express";
import multer from "multer";
import {
  createInstitute,
  deleteInstitute,
  getAdminOverview,
  getInstituteDetail,
  getUptimeOverview,
  renewInstituteSubscription,
  updateInstitute,
  approveInstitutePayout,
  getAdminTeachers,
  getAdminStudents,
  updateAdminTeacher,
  deleteAdminTeacher,
  updateAdminStudent,
  deleteAdminStudent,
  uploadInstituteLogo,
  getDemoAccounts,
  createDemoAccount,
  updateDemoCredentials,
  getInstituteFullAnalytics,
  getSystemLogs,
  clearSystemLogs,
  markSystemLogAsRead,
  markAllSystemLogsAsRead,
  updateTuitionWebsite,
  getWhatsAppCredentialsTemplate,
  updateWhatsAppCredentialsTemplate,
  getWhatsAppGlobalTemplates,
  updateWhatsAppGlobalTemplates,
  sendWhatsAppTestMessage,
  getMetaWhatsAppSettings,
  updateMetaWhatsAppSettings,
  getFcmSettings,
  updateFcmSettings,
  getStaff,
  createStaff,
  updateStaff,
  deleteStaff,
  getStaffDetails,
  assignManagerStaff,
  getActivityLogs,
  topupInstituteWallet,
  updateInstituteMessageCharge,
  getGlobalWalletSettings,
  updateGlobalWalletSettings,
  flushSystemCache,
  getAdminAiSettings,
  updateAdminAiSettings,
  topupInstituteAiWallet,
  updateInstituteAiConfig,
  getAdminFestivalTheme,
  updateAdminFestivalTheme,
  getAiHarvestLogs,
  getTextBeeSettings,
  updateTextBeeSettings,
  sendTextBeeTestSms,
  getTextBeeDevices,
  getSuperAdminTuitionsList,
  switchSuperAdminInstitute,
} from "../controllers/adminController.js";
import {
  sendBroadcastNotification,
  getPushNotificationHistory,
  getPushNotificationStats,
  testPushNotification,
  registerUserFcmToken,
  unregisterUserFcmToken,
} from "../controllers/pushNotificationController.js";
import protect from "../middleware/authMiddleware.js";
import staffOnly from "../middleware/staffMiddleware.js";
import {
  getAdminPages,
  createAdminPage,
  updateAdminPage,
  deleteAdminPage,
} from "../controllers/pageController.js";
import {
  getContactMessages,
  markContactMessageRead,
  deleteContactMessage,
  updateContactDetails,
} from "../controllers/contactController.js";
import {
  getLeadFolders,
  getAdminLeads,
  createAdminLead,
  updateAdminLead,
  deleteAdminLead,
  assignTerritory,
  bulkImportAdminLeads,
  aiHuntAdminLeads,
  aiImportAdminLeads,
} from "../controllers/adminLeadsController.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect, staffOnly);

// Super Admin Tuition Switching Routes (Strictly Super Admin Only)
router.get("/tuitions-list", getSuperAdminTuitionsList);
router.post("/switch-institute/:id", switchSuperAdminInstitute);

router.get("/overview", getAdminOverview);
router.get("/uptime", getUptimeOverview);
router.get("/system-logs", getSystemLogs);
router.get("/ai-harvest-logs", getAiHarvestLogs);
router.delete("/system-logs", clearSystemLogs);
router.put("/system-logs/read-all", markAllSystemLogsAsRead);
router.put("/system-logs/:id/read", markSystemLogAsRead);

router.get("/contact-messages", getContactMessages);
router.put("/contact-messages/:id/read", markContactMessageRead);
router.delete("/contact-messages/:id", deleteContactMessage);
router.put("/contact-details", updateContactDetails);

router.get("/whatsapp-template", getWhatsAppCredentialsTemplate);
router.put("/whatsapp-template", updateWhatsAppCredentialsTemplate);

router.get("/whatsapp-global-templates", getWhatsAppGlobalTemplates);
router.put("/whatsapp-global-templates", updateWhatsAppGlobalTemplates);
router.post("/whatsapp-send-test", sendWhatsAppTestMessage);

router.get("/whatsapp-settings", getMetaWhatsAppSettings);
router.put("/whatsapp-settings", updateMetaWhatsAppSettings);

router.get("/fcm-settings", getFcmSettings);
router.put("/fcm-settings", updateFcmSettings);

// TextBee SMS Gateway Routes
router.get("/textbee-settings", getTextBeeSettings);
router.put("/textbee-settings", updateTextBeeSettings);
router.post("/textbee/test-sms", sendTextBeeTestSms);
router.get("/textbee/devices", getTextBeeDevices);

// Push Notification Studio Routes
router.post("/push-notifications/broadcast", sendBroadcastNotification);
router.get("/push-notifications/history", getPushNotificationHistory);
router.get("/push-notifications/stats", getPushNotificationStats);
router.post("/push-notifications/test", testPushNotification);
router.post("/fcm-token", registerUserFcmToken);
router.post("/fcm-token/unregister", unregisterUserFcmToken);
router.delete("/fcm-token", unregisterUserFcmToken);

router.get("/demo-accounts", getDemoAccounts);
router.post("/demo-accounts", createDemoAccount);
router.put("/demo-accounts/:id", updateDemoCredentials);

router.route("/teachers")
  .get(getAdminTeachers);
router.route("/teachers/:id")
  .put(updateAdminTeacher)
  .delete(deleteAdminTeacher);

router.route("/students")
  .get(getAdminStudents);
router.route("/students/:id")
  .put(updateAdminStudent)
  .delete(deleteAdminStudent);

router.get("/institutes/:id", getInstituteDetail);
router.get("/institutes/:id/analytics", getInstituteFullAnalytics);
router.post("/institutes/:id/website", updateTuitionWebsite);
router.post("/institutes", createInstitute);
router.put("/institutes/:id", updateInstitute);
router.post("/institutes/upload-logo", upload.single("logo"), uploadInstituteLogo);
router.post("/institutes/:id/renew", renewInstituteSubscription);
router.post("/institutes/:id/approve-payout", approveInstitutePayout);
router.post("/institutes/:id/wallet-topup", topupInstituteWallet);
router.post("/institutes/:id/message-charge", updateInstituteMessageCharge);
router.put("/institutes/:id/message-charge", updateInstituteMessageCharge);
router.post("/institutes/:id/ai-wallet-topup", topupInstituteAiWallet);
router.post("/institutes/:id/ai-config", updateInstituteAiConfig);
router.put("/institutes/:id/ai-config", updateInstituteAiConfig);
router.get("/global-wallet-settings", getGlobalWalletSettings);
router.post("/global-wallet-settings", updateGlobalWalletSettings);
router.put("/global-wallet-settings", updateGlobalWalletSettings);
router.get("/ai-settings", getAdminAiSettings);
router.post("/ai-settings", updateAdminAiSettings);
router.put("/ai-settings", updateAdminAiSettings);
router.get("/festival-theme", getAdminFestivalTheme);
router.post("/festival-theme", updateAdminFestivalTheme);
router.put("/festival-theme", updateAdminFestivalTheme);
router.post("/flush-cache", flushSystemCache);
router.get("/flush-cache", flushSystemCache);
router.delete("/institutes/:id", deleteInstitute);

// Custom Pages Routes
router.route("/pages")
  .get(getAdminPages)
  .post(createAdminPage);

router.route("/pages/:id")
  .put(updateAdminPage)
  .delete(deleteAdminPage);

// Staff Team management & audit activity logs
router.route("/staff")
  .get(getStaff)
  .post(createStaff);

router.route("/staff/:id")
  .put(updateStaff)
  .delete(deleteStaff);

router.get("/staff/:id/details", getStaffDetails);
router.put("/staff/:id/assign-team", assignManagerStaff);

router.get("/activity-logs", getActivityLogs);

// Super Admin Leads Management & Territory Folder Structure
router.get("/leads/folders", getLeadFolders);
router.get("/leads", getAdminLeads);
router.post("/leads", createAdminLead);
router.put("/leads/:id", updateAdminLead);
router.delete("/leads/:id", deleteAdminLead);
router.post("/leads/assign-territory", assignTerritory);
router.post("/leads/bulk-import", bulkImportAdminLeads);
router.post("/leads/ai-hunt", aiHuntAdminLeads);
router.post("/leads/ai-import", aiImportAdminLeads);

export default router;
