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
  getActivityLogs,
  topupInstituteWallet,
  updateInstituteMessageCharge,
  getGlobalWalletSettings,
  updateGlobalWalletSettings,
} from "../controllers/adminController.js";
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

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

router.use(protect, staffOnly);

router.get("/overview", getAdminOverview);
router.get("/uptime", getUptimeOverview);
router.get("/system-logs", getSystemLogs);
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
router.post("/institutes/:id/wallet-topup", topupInstituteWallet);
router.post("/institutes/:id/message-charge", updateInstituteMessageCharge);
router.put("/institutes/:id/message-charge", updateInstituteMessageCharge);
router.get("/global-wallet-settings", getGlobalWalletSettings);
router.post("/global-wallet-settings", updateGlobalWalletSettings);
router.put("/global-wallet-settings", updateGlobalWalletSettings);
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

router.get("/activity-logs", getActivityLogs);

export default router;
