import express from "express";
import jwt from "jsonwebtoken";
import multer from "multer";
import protect from "../middleware/authMiddleware.js";
import protectStudent from "../middleware/studentAuthMiddleware.js";
import {
  getAdminProducts,
  getLockedTestSeries,
  createAdminProduct,
  updateAdminProduct,
  deleteAdminProduct,
  generateProductDescription,
  getAdminOrders,
  updateOrderTracking,
  getAdminAnalytics,
  getAdminTransactions,
  getStoreSettings,
  updateStoreSettings,
  getStoreProducts,
  getStoreProductById,
  getStudentAddresses,
  createStudentAddress,
  updateStudentAddress,
  deleteStudentAddress,
  storeCheckout,
  verifyStorePayment,
  getStudentOrders,
} from "../controllers/storeController.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB for notes PDF
});
const productUpload = upload.fields([
  { name: "notesFile", maxCount: 1 },
  { name: "thumbnailFile", maxCount: 1 },
]);

const router = express.Router();

const studentAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.decode(token);
      if (decoded && decoded.role && decoded.role !== "student") {
        return protect(req, res, next);
      }
    } catch (_) {}
  }
  return protectStudent(req, res, next);
};

// ---------------- PUBLIC / STORE FRONT (Accessible to students/visitors) ----------------
router.get("/products", getStoreProducts);
router.get("/products/:id", getStoreProductById);
router.get("/settings", getStoreSettings);

// ---------------- STUDENT PROTECTED STORE ROUTES ----------------
router.get("/student/orders", studentAuth, getStudentOrders);
router.get("/student/addresses", studentAuth, getStudentAddresses);
router.post("/student/addresses", studentAuth, createStudentAddress);
router.put("/student/addresses/:id", studentAuth, updateStudentAddress);
router.delete("/student/addresses/:id", studentAuth, deleteStudentAddress);
router.post("/checkout", studentAuth, storeCheckout);
router.post("/verify-payment", studentAuth, verifyStorePayment);

// ---------------- SUPER ADMIN STORE MANAGEMENT ----------------
router.use("/admin", protect);

// Products
router.get("/admin/products", getAdminProducts);
router.get("/admin/locked-test-series", getLockedTestSeries);
router.post("/admin/products", productUpload, createAdminProduct);
router.put("/admin/products/:id", productUpload, updateAdminProduct);
router.delete("/admin/products/:id", deleteAdminProduct);
router.post("/admin/generate-description", generateProductDescription);

// Orders & Fulfillment
router.get("/admin/orders", getAdminOrders);
router.put("/admin/orders/:id/tracking", updateOrderTracking);

// Analytics, Transactions & Settings
router.get("/admin/analytics", getAdminAnalytics);
router.get("/admin/transactions", getAdminTransactions);
router.get("/admin/settings", getStoreSettings);
router.put("/admin/settings", updateStoreSettings);

export default router;
