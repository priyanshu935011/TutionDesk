import crypto from "crypto";
import axios from "axios";
import Product from "../models/Product.js";
import Order from "../models/Order.js";
import StudentAddress from "../models/StudentAddress.js";
import TestSeries from "../models/TestSeries.js";
import Note from "../models/Note.js";
import Student from "../models/Student.js";
import SystemSetting from "../models/SystemSetting.js";
import cloudinary from "../utils/cloudinary.js";
import { getCashfreeConfig, checkCashfreeOrderStatus } from "./paymentController.js";
import { callGeminiApi, extractJsonFromText } from "../services/aiService.js";

const getBaseUrl = (environment) => {
  return environment === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
};

// -------------------------------------------------------------
// SUPER ADMIN: PRODUCTS MANAGEMENT
// -------------------------------------------------------------

export const getAdminProducts = async (req, res) => {
  try {
    const { type, category, status, search } = req.query;
    const filter = {};

    if (type && type !== "all") filter.productType = type;
    if (category && category !== "all") filter.category = category;
    if (status && status !== "all") filter.status = status;
    if (search && search.trim()) {
      filter.title = { $regex: search.trim(), $options: "i" };
    }

    const products = await Product.find(filter).sort({ createdAt: -1 });
    res.json({ products: products || [] });
  } catch (err) {
    console.error("getAdminProducts error:", err);
    res.status(500).json({ message: "Failed to fetch products", error: err.message });
  }
};

export const getLockedTestSeries = async (req, res) => {
  try {
    // Only return platform/super-admin test series that are locked
    const filter = {
      isLocked: true,
      $or: [{ institute: null }, { institute: { $exists: false } }],
    };
    let testSeries = await TestSeries.find(filter).sort({ title: 1 });
    testSeries = (testSeries || []).filter((t) => !t.institute || t.institute === "null");

    res.json({
      testSeries: testSeries.map((t) => ({
        id: t._id || t.id,
        _id: t._id || t.id,
        title: t.title,
        category: t.category,
        subject: t.subject || "General",
        topic: t.topic || "General",
        difficulty: t.difficulty || "Medium",
        totalMarks: t.totalMarks,
        questionsCount: Array.isArray(t.questions) ? t.questions.length : 0,
      })),
    });
  } catch (err) {
    console.error("getLockedTestSeries error:", err);
    res.status(500).json({ message: "Failed to fetch locked test series", error: err.message });
  }
};

export const createAdminProduct = async (req, res) => {
  try {
    const {
      title,
      description,
      price,
      mrp,
      productType,
      category,
      thumbnail,
      images,
      isDigital,
      status,
      featured,
      testSeriesIds,
      notesPdfUrl,
      notesTitle,
      digitalFileUrl,
      bundleItems,
      stockQuantity,
      weightKg,
      sku,
    } = req.body;

    if (!title || !title.trim()) {
      return res.status(400).json({ message: "Product title is required" });
    }
    if (price === undefined || price === null || isNaN(Number(price))) {
      return res.status(400).json({ message: "A valid price is required" });
    }

    let resolvedPdfUrl = notesPdfUrl || "";
    // Handle PDF upload if multipart file was provided
    if (req.file && req.file.buffer) {
      try {
        const b64 = `data:${req.file.mimetype || "application/pdf"};base64,${req.file.buffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          resource_type: "raw",
          folder: "store_notes",
        });
        resolvedPdfUrl = uploadRes.secure_url || uploadRes.url || resolvedPdfUrl;
      } catch (uploadErr) {
        console.warn("Cloudinary notes upload warning:", uploadErr.message);
      }
    }

    const resolvedProductType = productType || "test_series";
    const resolvedIsDigital =
      isDigital !== undefined ? (isDigital === true || isDigital === "true") : resolvedProductType !== "offline";

    const parsedTestSeriesIds = Array.isArray(testSeriesIds)
      ? testSeriesIds
      : typeof testSeriesIds === "string" && testSeriesIds.trim()
      ? testSeriesIds.split(",").map((s) => s.trim()).filter(Boolean)
      : [];

    let parsedBundleItems = [];
    if (Array.isArray(bundleItems)) {
      parsedBundleItems = bundleItems;
    } else if (typeof bundleItems === "string") {
      try {
        parsedBundleItems = JSON.parse(bundleItems);
      } catch (_) {}
    }

    const product = await Product.create({
      title: title.trim(),
      description: description || "",
      price: Number(price),
      mrp: Number(mrp || price),
      productType: resolvedProductType,
      category: category || "General",
      thumbnail: thumbnail || "",
      images: Array.isArray(images) ? images : [],
      isDigital: resolvedIsDigital,
      status: status || "active",
      featured: featured === true || featured === "true",
      testSeriesIds: parsedTestSeriesIds,
      notesPdfUrl: resolvedPdfUrl,
      notesTitle: notesTitle || title.trim(),
      digitalFileUrl: digitalFileUrl || "",
      bundleItems: parsedBundleItems,
      stockQuantity: Number(stockQuantity || 100),
      weightKg: Number(weightKg || 0.5),
      sku: sku || `SKU-${Date.now().toString().slice(-6)}`,
      createdBy: req.user?._id || null,
    });

    res.status(201).json({
      message: "Product created successfully",
      product,
    });
  } catch (err) {
    console.error("createAdminProduct error:", err);
    res.status(500).json({ message: "Failed to create product", error: err.message });
  }
};

export const updateAdminProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const updateData = { ...req.body };

    // Handle optional file replacement
    if (req.file && req.file.buffer) {
      try {
        const b64 = `data:${req.file.mimetype || "application/pdf"};base64,${req.file.buffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          resource_type: "raw",
          folder: "store_notes",
        });
        updateData.notesPdfUrl = uploadRes.secure_url || uploadRes.url;
      } catch (uploadErr) {
        console.warn("Cloudinary notes upload warning:", uploadErr.message);
      }
    }

    if (updateData.price !== undefined) updateData.price = Number(updateData.price);
    if (updateData.mrp !== undefined) updateData.mrp = Number(updateData.mrp);
    if (updateData.stockQuantity !== undefined) updateData.stockQuantity = Number(updateData.stockQuantity);
    if (updateData.weightKg !== undefined) updateData.weightKg = Number(updateData.weightKg);

    const product = await Product.findByIdAndUpdate(id, updateData, { new: true });
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }

    res.json({ message: "Product updated successfully", product });
  } catch (err) {
    console.error("updateAdminProduct error:", err);
    res.status(500).json({ message: "Failed to update product", error: err.message });
  }
};

export const deleteAdminProduct = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findByIdAndDelete(id);
    if (!product) {
      return res.status(404).json({ message: "Product not found" });
    }
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    console.error("deleteAdminProduct error:", err);
    res.status(500).json({ message: "Failed to delete product", error: err.message });
  }
};

export const generateProductDescription = async (req, res) => {
  try {
    const { title, productType, category, details } = req.body;
    if (!title) {
      return res.status(400).json({ message: "Product title is required to generate description" });
    }

    const prompt = `You are a high-performing e-commerce copywriter specialized in educational courses, test series, notes, and study books.
Write an enticing, structured, and conversion-focused product description for:
- Title: "${title}"
- Product Type: "${productType || "Test Series"}"
- Target Category / Exam: "${category || "General"}"
- Additional Context / Details: "${details || "High-quality academic preparation material"}"

Include:
1. An engaging 2-3 sentence overview highlighting student benefit and exam readiness.
2. "Key Highlights" (4-5 bullet points covering syllabus coverage, real exam pattern, question variety, and self-assessment).
3. "Who is this for?" (1 sentence specifying target grade/aspirants).
4. "What you receive" (clarity on instant digital access or physical doorstep delivery).

Keep the tone encouraging, professional, and crisp. Use clean markdown formatting with headers and bold text.`;

    const generated = await callGeminiApi({
      prompt,
      systemInstruction: "You are an elite educational copywriter for student test series and study material stores.",
      temperature: 0.4,
    });

    res.json({ description: generated || "" });
  } catch (err) {
    console.error("generateProductDescription error:", err);
    res.status(500).json({ message: "Failed to generate AI description", error: err.message });
  }
};

// -------------------------------------------------------------
// SUPER ADMIN: ORDERS & FULFILLMENT
// -------------------------------------------------------------

export const getAdminOrders = async (req, res) => {
  try {
    const { paymentStatus, fulfillmentStatus, search } = req.query;
    const filter = {};

    if (paymentStatus && paymentStatus !== "all") filter.paymentStatus = paymentStatus;
    if (fulfillmentStatus && fulfillmentStatus !== "all") filter.fulfillmentStatus = fulfillmentStatus;
    if (search && search.trim()) {
      filter.$or = [
        { orderNumber: { $regex: search.trim(), $options: "i" } },
        { studentName: { $regex: search.trim(), $options: "i" } },
        { studentPhone: { $regex: search.trim(), $options: "i" } },
        { studentEmail: { $regex: search.trim(), $options: "i" } },
      ];
    }

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders: orders || [] });
  } catch (err) {
    console.error("getAdminOrders error:", err);
    res.status(500).json({ message: "Failed to fetch orders", error: err.message });
  }
};

export const updateOrderTracking = async (req, res) => {
  try {
    const { id } = req.params;
    const { carrier, trackingNumber, trackingUrl, fulfillmentStatus, adminNotes } = req.body;

    const order = await Order.findById(id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    if (carrier !== undefined) order.carrier = carrier;
    if (trackingNumber !== undefined) order.trackingNumber = trackingNumber;
    if (trackingUrl !== undefined) order.trackingUrl = trackingUrl;
    if (adminNotes !== undefined) order.adminNotes = adminNotes;

    if (fulfillmentStatus) {
      order.fulfillmentStatus = fulfillmentStatus;
      if (fulfillmentStatus === "shipped" && !order.shippedAt) {
        order.shippedAt = new Date();
      }
      if (fulfillmentStatus === "delivered" && !order.deliveredAt) {
        order.deliveredAt = new Date();
      }
    }

    await order.save();
    res.json({ message: "Order tracking updated successfully", order });
  } catch (err) {
    console.error("updateOrderTracking error:", err);
    res.status(500).json({ message: "Failed to update tracking", error: err.message });
  }
};

// -------------------------------------------------------------
// SUPER ADMIN: ANALYTICS & TRANSACTIONS
// -------------------------------------------------------------

export const getAdminAnalytics = async (req, res) => {
  try {
    const { period, startDate, endDate } = req.query; // "day", "week", "month", "year", "custom"
    const now = new Date();
    let filterStart = new Date();

    if (period === "day") {
      filterStart.setHours(0, 0, 0, 0);
    } else if (period === "week") {
      filterStart.setDate(now.getDate() - 7);
    } else if (period === "year") {
      filterStart.setFullYear(now.getFullYear() - 1);
    } else if (period === "custom" && startDate) {
      filterStart = new Date(startDate);
    } else {
      // default "month"
      filterStart.setDate(now.getDate() - 30);
    }

    let filterEnd = now;
    if (period === "custom" && endDate) {
      filterEnd = new Date(endDate);
      filterEnd.setHours(23, 59, 59, 999);
    }

    const allOrders = await Order.find({
      paymentStatus: "paid",
    });

    const filteredOrders = (allOrders || []).filter((o) => {
      const orderDate = new Date(o.createdAt || o.created_at);
      return orderDate >= filterStart && orderDate <= filterEnd;
    });

    let totalRevenue = 0;
    let digitalSales = 0;
    let offlineSales = 0;
    const productSalesMap = {};

    filteredOrders.forEach((o) => {
      const amt = Number(o.totalAmount || 0);
      totalRevenue += amt;

      let isOrderOffline = false;
      (o.items || []).forEach((item) => {
        if (item.isDigital === false || item.productType === "offline") {
          isOrderOffline = true;
        }
        const title = item.title || "Unknown Product";
        productSalesMap[title] = (productSalesMap[title] || 0) + (Number(item.price) * Number(item.quantity || 1));
      });

      if (isOrderOffline) {
        offlineSales += amt;
      } else {
        digitalSales += amt;
      }
    });

    const totalOrders = filteredOrders.length;
    const averageOrderValue = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

    // Top products
    const topProducts = Object.entries(productSalesMap)
      .map(([title, revenue]) => ({ title, revenue }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 5);

    res.json({
      period: period || "month",
      totalRevenue,
      totalOrders,
      averageOrderValue,
      digitalSales,
      offlineSales,
      topProducts,
    });
  } catch (err) {
    console.error("getAdminAnalytics error:", err);
    res.status(500).json({ message: "Failed to calculate analytics", error: err.message });
  }
};

export const getAdminTransactions = async (req, res) => {
  try {
    const orders = await Order.find({}).sort({ createdAt: -1 });
    const transactions = (orders || []).map((o) => ({
      id: o._id || o.id,
      orderNumber: o.orderNumber,
      studentName: o.studentName,
      studentPhone: o.studentPhone,
      amount: o.totalAmount,
      currency: o.currency || "INR",
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod || "cashfree",
      cfOrderId: o.cfOrderId,
      cfPaymentId: o.cfPaymentId,
      createdAt: o.createdAt || o.created_at,
    }));

    res.json({ transactions });
  } catch (err) {
    console.error("getAdminTransactions error:", err);
    res.status(500).json({ message: "Failed to fetch transactions", error: err.message });
  }
};

export const getStoreSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "store_settings" });
    const defaults = {
      isStoreEnabled: true,
      storeName: "ClassTech Store",
      searchPlaceholder: "Search for Study Material",
      logoUrl: "",
      defaultGoal: "NEET",
      goalsList: [
        { title: "NEET", desc: "UG Medical Entrance", emoji: "🔬" },
        { title: "JEE", desc: "Main & Advanced Engineering", emoji: "⚛️" },
        { title: "Class 10", desc: "Board Exam Prep & Foundation", emoji: "🎓" },
        { title: "Class 12", desc: "Board + CUET Preparation", emoji: "📚" },
        { title: "UG Entrance", desc: "CUET, Nursing & Defense", emoji: "🏛️" },
        { title: "All Categories", desc: "Explore entire store catalog", emoji: "✨" },
      ],
      flashSaleEnabled: true,
      flashSaleTitle: "FLASH SALE",
      flashSaleSubtitle: "STARTS ON 30TH OCT",
      flashSaleHours: 17,
      flashSaleMinutes: 29,
      flashSaleSeconds: 38,
      quickCategories: [
        { emoji: "🎓", title: "UG Entrance\nExams", filterType: "category", filterValue: "UG Entrance", isActive: true },
        { emoji: "🏛️", title: "PG/Govt\nEntrance...", filterType: "category", filterValue: "Govt Exams", isActive: true },
        { emoji: "🏫", title: "School Prep\nBooks", filterType: "category", filterValue: "School Prep", isActive: true },
        { emoji: "✏️", title: "Stationery &\nKits", filterType: "type", filterValue: "offline", isActive: true },
        { emoji: "📝", title: "Test Series\nPacks", filterType: "type", filterValue: "test_series", isActive: true },
        { emoji: "📄", title: "Revision\nPDF Notes", filterType: "type", filterValue: "notes", isActive: true },
      ],
      slides: [
        {
          id: "slide_1",
          headline: "NEET\nMODULES",
          tag: "COMPLETE THEORY & MCQ SETS",
          buttonText: "Order Today!",
          category: "NEET",
          productType: "all",
          theme: "emerald",
          isActive: true,
        },
        {
          id: "slide_2",
          headline: "ALL-INDIA\nTEST SERIES",
          tag: "EXAM MOCKS WITH INSTANT RANK",
          buttonText: "Explore Tests",
          category: "All",
          productType: "test_series",
          theme: "royal_violet",
          isActive: true,
        },
        {
          id: "slide_3",
          headline: "TOPPER'S\nREVISION PDF",
          tag: "HANDWRITTEN CHAPTER MINDMAPS",
          buttonText: "View Notes",
          category: "All",
          productType: "notes",
          theme: "amber",
          isActive: true,
        },
      ],
      dealOfTheDayEnabled: true,
      dealOfTheDayTitle: "Deal of the Day",
      dealBadgeText: "MULTICOLOUR EDITION",
      deliveryFeeOffline: 50,
      freeDeliveryThreshold: 499,
      supportEmail: "support@classtech.in",
      supportPhone: "919999999999",
    };

    const saved = setting?.value || {};
    const merged = { ...defaults, ...saved };
    res.json({ settings: merged });
  } catch (err) {
    console.error("getStoreSettings error:", err);
    res.status(500).json({ message: "Failed to get store settings", error: err.message });
  }
};

export const updateStoreSettings = async (req, res) => {
  try {
    const { settings } = req.body;
    let setting = await SystemSetting.findOne({ key: "store_settings" });
    if (!setting) {
      setting = await SystemSetting.create({
        key: "store_settings",
        value: settings,
      });
    } else {
      setting.value = { ...setting.value, ...settings };
      await setting.save();
    }
    res.json({ message: "Store settings updated successfully", settings: setting.value });
  } catch (err) {
    console.error("updateStoreSettings error:", err);
    res.status(500).json({ message: "Failed to update store settings", error: err.message });
  }
};

// -------------------------------------------------------------
// STUDENT & PUBLIC: STORE FRONT
// -------------------------------------------------------------

export const getStoreProducts = async (req, res) => {
  try {
    const { category, type, search } = req.query;
    const filter = { status: "active" };

    if (category && category !== "All") filter.category = category;
    if (type && type !== "all") filter.productType = type;
    if (search && search.trim()) {
      filter.title = { $regex: search.trim(), $options: "i" };
    }

    const products = await Product.find(filter).sort({ featured: -1, createdAt: -1 });

    // Derive list of unique categories
    const allActive = await Product.find({ status: "active" });
    const categoriesSet = new Set(["All"]);
    allActive.forEach((p) => {
      if (p.category) categoriesSet.add(p.category);
    });

    res.json({
      products: products || [],
      categories: Array.from(categoriesSet),
    });
  } catch (err) {
    console.error("getStoreProducts error:", err);
    res.status(500).json({ message: "Failed to fetch store products", error: err.message });
  }
};

export const getStoreProductById = async (req, res) => {
  try {
    const { id } = req.params;
    const product = await Product.findById(id);
    if (!product || product.status === "archived") {
      return res.status(404).json({ message: "Product not found" });
    }

    // If product contains test series IDs, load their titles and question counts for clarity
    let attachedTestSeries = [];
    if (Array.isArray(product.testSeriesIds) && product.testSeriesIds.length > 0) {
      attachedTestSeries = await TestSeries.find({
        _id: { $in: product.testSeriesIds },
      }).select("title category totalMarks durationMinutes");
    }

    res.json({
      product,
      attachedTestSeries,
    });
  } catch (err) {
    console.error("getStoreProductById error:", err);
    res.status(500).json({ message: "Failed to fetch product details", error: err.message });
  }
};

// -------------------------------------------------------------
// STUDENT: SAVED ADDRESSES
// -------------------------------------------------------------

export const getStudentAddresses = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    if (!studentId) {
      return res.status(401).json({ message: "Unauthorized student" });
    }

    const addresses = await StudentAddress.find({ studentId }).sort({ isDefault: -1, createdAt: -1 });
    res.json({ addresses: addresses || [] });
  } catch (err) {
    console.error("getStudentAddresses error:", err);
    res.status(500).json({ message: "Failed to fetch saved addresses", error: err.message });
  }
};

export const createStudentAddress = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    if (!studentId) {
      return res.status(401).json({ message: "Unauthorized student" });
    }

    const {
      fullName,
      phone,
      alternatePhone,
      addressLine1,
      addressLine2,
      city,
      state,
      pincode,
      landmark,
      isDefault,
    } = req.body;

    if (!fullName || !phone || !addressLine1 || !city || !state || !pincode) {
      return res.status(400).json({ message: "Please provide all required address fields." });
    }

    // If marked default, unset other defaults
    if (isDefault) {
      const existing = await StudentAddress.find({ studentId });
      for (const addr of existing || []) {
        if (addr.isDefault) {
          addr.isDefault = false;
          await addr.save();
        }
      }
    }

    const newAddress = await StudentAddress.create({
      studentId,
      fullName: fullName.trim(),
      phone: phone.trim(),
      alternatePhone: (alternatePhone || "").trim(),
      addressLine1: addressLine1.trim(),
      addressLine2: (addressLine2 || "").trim(),
      city: city.trim(),
      state: state.trim(),
      pincode: pincode.trim(),
      landmark: (landmark || "").trim(),
      isDefault: isDefault === true,
    });

    res.status(201).json({ message: "Address saved successfully", address: newAddress });
  } catch (err) {
    console.error("createStudentAddress error:", err);
    res.status(500).json({ message: "Failed to save address", error: err.message });
  }
};

export const updateStudentAddress = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    const { id } = req.params;

    const address = await StudentAddress.findById(id);
    if (!address || String(address.studentId) !== String(studentId)) {
      return res.status(404).json({ message: "Address not found" });
    }

    if (req.body.isDefault) {
      const existing = await StudentAddress.find({ studentId });
      for (const addr of existing || []) {
        if (String(addr._id || addr.id) !== String(id) && addr.isDefault) {
          addr.isDefault = false;
          await addr.save();
        }
      }
    }

    Object.assign(address, req.body);
    await address.save();

    res.json({ message: "Address updated successfully", address });
  } catch (err) {
    console.error("updateStudentAddress error:", err);
    res.status(500).json({ message: "Failed to update address", error: err.message });
  }
};

export const deleteStudentAddress = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    const { id } = req.params;

    const address = await StudentAddress.findById(id);
    if (!address || String(address.studentId) !== String(studentId)) {
      return res.status(404).json({ message: "Address not found" });
    }

    await StudentAddress.findByIdAndDelete(id);
    res.json({ message: "Address deleted successfully" });
  } catch (err) {
    console.error("deleteStudentAddress error:", err);
    res.status(500).json({ message: "Failed to delete address", error: err.message });
  }
};

// -------------------------------------------------------------
// STUDENT: CHECKOUT & PAYMENT INTEGRATION (CASHFREE)
// -------------------------------------------------------------

export const storeCheckout = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    if (!studentId) {
      return res.status(401).json({ message: "Unauthorized student" });
    }

    const student = await Student.findById(studentId);
    if (!student) {
      return res.status(404).json({ message: "Student record not found" });
    }

    const { items, shippingAddress } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: "Cart items cannot be empty" });
    }

    // Verify products and calculate total
    let totalAmount = 0;
    const formattedItems = [];
    let hasOfflineItem = false;

    for (const cartItem of items) {
      const prodId = cartItem.productId || cartItem.id;
      const product = await Product.findById(prodId);
      if (!product || product.status !== "active") {
        return res.status(400).json({ message: `Product "${cartItem.title || prodId}" is currently unavailable.` });
      }

      const qty = Math.max(1, Number(cartItem.quantity || 1));
      const price = Number(product.price);
      totalAmount += price * qty;

      if (!product.isDigital || product.productType === "offline") {
        hasOfflineItem = true;
      }

      formattedItems.push({
        productId: product._id || product.id,
        title: product.title,
        price,
        quantity: qty,
        productType: product.productType,
        isDigital: product.isDigital,
        testSeriesIds: (product.testSeriesIds || []).map(String),
        notesPdfUrl: product.notesPdfUrl || "",
        notesTitle: product.notesTitle || product.title,
        digitalFileUrl: product.digitalFileUrl || "",
        bundleItems: product.bundleItems || [],
      });
    }

    // If offline items exist, validate shipping address
    if (hasOfflineItem) {
      if (!shippingAddress || !shippingAddress.fullName || !shippingAddress.phone || !shippingAddress.addressLine1 || !shippingAddress.pincode) {
        return res.status(400).json({
          message: "Shipping address with full name, phone, address line, and pincode is required for physical delivery items.",
        });
      }
    }

    // Generate unique order number
    const orderNumber = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
    const cfOrderId = "store_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);

    // Create Cashfree Order
    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const studentPhone = String(student.phone || student.mobileNumber || "9999999999").replace(/\D/g, "").slice(-10);
    const studentEmail = student.email || "student@classtech.in";
    const studentName = student.name || "Student";

    const payload = {
      order_id: cfOrderId,
      order_amount: totalAmount,
      order_currency: "INR",
      customer_details: {
        customer_id: String(student._id || student.id),
        customer_name: studentName,
        customer_email: studentEmail,
        customer_phone: studentPhone.length === 10 ? studentPhone : "9999999999",
      },
      order_meta: {
        return_url: `${process.env.FRONTEND_URL || "https://app.classtech.in"}/store/order-status?order_id=${cfOrderId}`,
      },
      order_note: `ClassTech Store Order #${orderNumber}`,
    };

    let paymentSessionId = "";
    try {
      const cfRes = await axios.post(`${baseUrl}/orders`, payload, { headers });
      paymentSessionId = cfRes.data?.payment_session_id || "";
    } catch (cfErr) {
      console.error("Cashfree create order error:", cfErr.response?.data || cfErr.message);
      return res.status(500).json({
        message: "Failed to initiate Cashfree payment gateway",
        details: cfErr.response?.data?.message || cfErr.message,
      });
    }

    // Save initial Order
    const order = await Order.create({
      orderNumber,
      studentId: student._id || student.id,
      studentName,
      studentEmail,
      studentPhone,
      instituteId: student.institute || student.user || null,
      items: formattedItems,
      totalAmount,
      currency: "INR",
      paymentStatus: "pending",
      paymentMethod: "cashfree",
      cfOrderId,
      fulfillmentStatus: "unfulfilled",
      shippingAddress: shippingAddress || {},
    });

    res.json({
      success: true,
      orderNumber,
      orderId: order._id || order.id,
      cfOrderId,
      paymentSessionId,
      totalAmount,
    });
  } catch (err) {
    console.error("storeCheckout error:", err);
    res.status(500).json({ message: "Failed to create checkout session", error: err.message });
  }
};

export const verifyStorePayment = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    const { orderId, cfOrderId } = req.body;

    const order = await Order.findOne({
      $or: [{ _id: orderId }, { cfOrderId }],
    });

    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    const config = await getCashfreeConfig();
    const cfStatus = await checkCashfreeOrderStatus(order.cfOrderId || cfOrderId, config);

    if (cfStatus?.status === "PAID" || cfStatus?.order_status === "PAID") {
      order.paymentStatus = "paid";
      order.cfPaymentId = cfStatus?.payment_id || cfStatus?.cf_payment_id || order.cfOrderId;

      let hasOffline = false;

      // Grant instant digital access to student
      for (const item of order.items || []) {
        if (item.isDigital === false || item.productType === "offline") {
          hasOffline = true;
          continue;
        }

        // 1. If it includes PDF notes, create a student note record
        if (item.notesPdfUrl) {
          try {
            await Note.create({
              institute: order.instituteId || null,
              createdBy: req.user?._id || order.studentId,
              title: item.notesTitle || item.title,
              pdfUrl: item.notesPdfUrl,
              pdfPublicId: `store_purchased_${order.orderNumber}`,
              targetType: "student",
              students: [order.studentId],
              category: "Store Notes",
              type: "Chapter Notes",
            });
          } catch (nErr) {
            console.warn("Failed to create note record for purchased item:", nErr.message);
          }
        }

        // 2. If it's a bundle with items
        if (Array.isArray(item.bundleItems)) {
          for (const bItem of item.bundleItems) {
            if (bItem.type === "notes" && bItem.url) {
              try {
                await Note.create({
                  institute: order.instituteId || null,
                  createdBy: req.user?._id || order.studentId,
                  title: bItem.title || "Bundle Notes",
                  pdfUrl: bItem.url,
                  pdfPublicId: `store_bundle_${order.orderNumber}`,
                  targetType: "student",
                  students: [order.studentId],
                  category: "Store Notes",
                  type: "Chapter Notes",
                });
              } catch (_) {}
            }
          }
        }
      }

      order.fulfillmentStatus = hasOffline ? "processing" : "fulfilled";
      await order.save();

      return res.json({
        success: true,
        message: "Payment verified successfully! Your digital items are now unlocked.",
        order,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Payment is not marked as completed by Cashfree.",
      status: cfStatus?.status || cfStatus?.order_status || "PENDING",
    });
  } catch (err) {
    console.error("verifyStorePayment error:", err);
    res.status(500).json({ message: "Failed to verify store payment", error: err.message });
  }
};

export const getStudentOrders = async (req, res) => {
  try {
    const studentId = req.student?._id || req.user?._id;
    if (!studentId) {
      return res.status(401).json({ message: "Unauthorized student" });
    }

    const orders = await Order.find({ studentId }).sort({ createdAt: -1 });
    res.json({ orders: orders || [] });
  } catch (err) {
    console.error("getStudentOrders error:", err);
    res.status(500).json({ message: "Failed to fetch student orders", error: err.message });
  }
};
