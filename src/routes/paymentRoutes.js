import express from "express";
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
} from "../controllers/paymentController.js";

const router = express.Router();

// Public webhook route (not protected by auth)
router.post("/webhook", handleCashfreeWebhook);

// Protected routes (Tuition Admin / Teachers)
router.post("/create-session", protect, createPaymentSession);
router.post("/verify", protect, verifyPayment);
router.get("/details", protect, getPaymentDetailsForInstitute);

// Protected staff routes (Super Admin / Tech Admin)
router.get("/list", protect, staffOnly, getAllPayments);
router.post("/:id/refund", protect, staffOnly, initiateRefund);
router.post("/:id/cancel-subscription", protect, staffOnly, cancelAutoRenew);
router.get("/settings", protect, staffOnly, getCashfreeSettings);
router.put("/settings", protect, staffOnly, updateCashfreeSettings);
router.post("/test-gateway", protect, staffOnly, testGatewayConnection);

export default router;
