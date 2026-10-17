import express from "express";
import {
  getSalesOverview,
  getSalesLeads,
  createSalesLead,
  updateSalesLead,
  logLeadCall,
  getSalesInstitutes,
  createSalesInstitute,
  topupSalesInstituteWallet,
  topupSalesInstituteAiWallet,
  getPayoutConfig,
  updatePayoutConfig,
} from "../controllers/salesController.js";
import protect from "../middleware/authMiddleware.js";
import staffOnly from "../middleware/staffMiddleware.js";

const router = express.Router();

// Require logged in staff member (sales_person, super_admin, etc.)
router.use(protect, staffOnly);

router.get("/overview", getSalesOverview);
router.get("/leads", getSalesLeads);
router.post("/leads", createSalesLead);
router.put("/leads/:id", updateSalesLead);
router.post("/leads/:id/call", logLeadCall);

router.get("/institutes", getSalesInstitutes);
router.post("/institutes", createSalesInstitute);
router.post("/institutes/:id/wallet-topup", topupSalesInstituteWallet);
router.post("/institutes/:id/ai-wallet-topup", topupSalesInstituteAiWallet);

router.get("/payout-config", getPayoutConfig);
router.put("/payout-config", updatePayoutConfig);

export default router;
