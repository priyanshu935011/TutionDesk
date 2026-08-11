import express from "express";
import multer from "multer";
import protect from "../middleware/authMiddleware.js";
import staffOnly from "../middleware/staffMiddleware.js";
import {
  createPaymentSession,
  verifyPayment,
  handleCashfreeWebhook,
  getAllPayments,
  initiateRefund,
  cancelAutoRenew,
  getCashfreeSettings,
  updateCashfreeSettings,
  testGatewayConnection,
  getPaymentDetailsForInstitute,
  getSmtpSettings,
  updateSmtpSettings,
  testSmtpConnection,
  getGstSettings,
  updateGstSettings,
  getReceiptDesignSettings,
  updateReceiptDesignSettings,
  getSmtpRenewalSettings,
  updateSmtpRenewalSettings,
  testSmtpRenewalConnection,
  previewReceipt,
  uploadSignatoryImage,
  getAdsSettings,
  updateAdsSettings,
  getWebsiteSettings,
  updateWebsiteSettings,
  getWalletInfo,
  getWhatsappLogs,
  createWalletRechargeSession,
  verifyWalletRecharge,
} from "../controllers/paymentController.js";

const upload = multer({ storage: multer.memoryStorage() });
const router = express.Router();

// Public webhook route (not protected by auth)
router.post("/webhook", handleCashfreeWebhook);

// Protected routes (Tuition Admin / Teachers)
router.post("/create-session", protect, createPaymentSession);
router.post("/verify", protect, verifyPayment);
router.get("/details", protect, getPaymentDetailsForInstitute);
router.get("/wallet-info", protect, getWalletInfo);
router.get("/whatsapp-logs", protect, getWhatsappLogs);
router.post("/wallet-recharge/session", protect, createWalletRechargeSession);
router.post("/wallet-recharge/verify", protect, verifyWalletRecharge);

// Protected staff routes (Super Admin / Tech Admin)
router.get("/list", protect, staffOnly, getAllPayments);
router.post("/:id/refund", protect, staffOnly, initiateRefund);
router.post("/:id/cancel-subscription", protect, staffOnly, cancelAutoRenew);
router.get("/settings", protect, staffOnly, getCashfreeSettings);
router.put("/settings", protect, staffOnly, updateCashfreeSettings);
router.post("/test-gateway", protect, staffOnly, testGatewayConnection);

// SMTP configuration routes
router.get("/smtp-settings", protect, staffOnly, getSmtpSettings);
router.put("/smtp-settings", protect, staffOnly, updateSmtpSettings);
router.post("/test-smtp", protect, staffOnly, testSmtpConnection);

// GST configuration routes
router.get("/gst-settings", protect, staffOnly, getGstSettings);
router.put("/gst-settings", protect, staffOnly, updateGstSettings);

// Receipt design configuration routes
router.get("/receipt-design", protect, staffOnly, getReceiptDesignSettings);
router.put("/receipt-design", protect, staffOnly, updateReceiptDesignSettings);
router.post("/receipt-design/upload-signature", protect, staffOnly, upload.single("signature"), uploadSignatoryImage);
router.get("/preview-receipt", protect, staffOnly, previewReceipt);

// Dedicated SMTP Renewal routes
router.get("/smtp-renewal-settings", protect, staffOnly, getSmtpRenewalSettings);
router.put("/smtp-renewal-settings", protect, staffOnly, updateSmtpRenewalSettings);
router.post("/test-smtp-renewal", protect, staffOnly, testSmtpRenewalConnection);

// Ads configuration routes
router.get("/ads-settings", protect, staffOnly, getAdsSettings);
router.put("/ads-settings", protect, staffOnly, updateAdsSettings);

// Custom Website settings / Meta tags routes
router.get("/website-settings", protect, staffOnly, getWebsiteSettings);
router.put("/website-settings", protect, staffOnly, updateWebsiteSettings);

export default router;
