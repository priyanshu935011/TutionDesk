import express from "express";
import { getDashboard } from "../controllers/dashboardController.js";
import { getInstituteStoragePacks, purchaseInstituteStoragePack } from "../controllers/adminController.js";
import protect from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/", protect, getDashboard);
router.get("/storage-packs", protect, getInstituteStoragePacks);
router.post("/storage-packs/purchase", protect, purchaseInstituteStoragePack);

export default router;
