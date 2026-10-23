import express from "express";
import multer from "multer";
import {
  getSalesOverview,
  getSalesLeads,
  createSalesLead,
  updateSalesLead,
  logLeadCall,
  getSalesInstitutes,
  createSalesInstitute,
  updateSalesInstitute,
  topupSalesInstituteWallet,
  topupSalesInstituteAiWallet,
  createSalesInstituteRechargeLink,
  verifySalesInstituteRecharge,
  getSalesInstituteRechargeHistory,
  getPayoutConfig,
  updatePayoutConfig,
} from "../controllers/salesController.js";
import { uploadInstituteLogo } from "../controllers/adminController.js";
import protect from "../middleware/authMiddleware.js";
import staffOnly from "../middleware/staffMiddleware.js";

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// Require logged in staff member (sales_person, super_admin, etc.)
router.use(protect, staffOnly);

router.get("/overview", getSalesOverview);
router.get("/leads", getSalesLeads);
router.post("/leads", createSalesLead);
router.put("/leads/:id", updateSalesLead);
router.post("/leads/:id/call", logLeadCall);

router.get("/institutes", getSalesInstitutes);
router.post("/institutes", createSalesInstitute);
router.put("/institutes/:id", updateSalesInstitute);
router.post("/institutes/upload-logo", upload.single("logo"), uploadInstituteLogo);
router.post("/institutes/:id/wallet-topup", topupSalesInstituteWallet);
router.post("/institutes/:id/ai-wallet-topup", topupSalesInstituteAiWallet);
router.post("/institutes/:id/create-recharge-link", createSalesInstituteRechargeLink);
router.post("/institutes/:id/verify-recharge", verifySalesInstituteRecharge);
router.get("/institutes/:id/recharge-history", getSalesInstituteRechargeHistory);

router.get("/payout-config", getPayoutConfig);
router.put("/payout-config", updatePayoutConfig);

export default router;
