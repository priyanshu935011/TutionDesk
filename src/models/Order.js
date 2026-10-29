import mongoose from "../utils/supabaseModel.js";

const orderItemSchema = new mongoose.Schema({
  productId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
  },
  title: {
    type: String,
    required: true,
  },
  price: {
    type: Number,
    required: true,
  },
  quantity: {
    type: Number,
    default: 1,
  },
  productType: {
    type: String,
    default: "test_series",
  },
  isDigital: {
    type: Boolean,
    default: true,
  },
  testSeriesIds: {
    type: [String],
    default: [],
  },
  notesPdfUrl: {
    type: String,
    default: "",
  },
  notesTitle: {
    type: String,
    default: "",
  },
  digitalFileUrl: {
    type: String,
    default: "",
  },
  bundleItems: {
    type: Array,
    default: [],
  },
});

const orderSchema = new mongoose.Schema(
  {
    orderNumber: {
      type: String,
      required: true,
      unique: true,
    },
    studentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    studentName: {
      type: String,
      default: "",
    },
    studentEmail: {
      type: String,
      default: "",
    },
    studentPhone: {
      type: String,
      default: "",
    },
    instituteId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Institute",
      default: null,
    },
    items: [orderItemSchema],
    totalAmount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "paid", "failed", "refunded"],
      default: "pending",
    },
    paymentMethod: {
      type: String,
      default: "cashfree",
    },
    cfOrderId: {
      type: String,
      default: "",
    },
    cfPaymentId: {
      type: String,
      default: "",
    },
    fulfillmentStatus: {
      type: String,
      enum: ["unfulfilled", "fulfilled", "processing", "shipped", "delivered", "cancelled"],
      default: "unfulfilled",
    },
    shippingAddress: {
      fullName: { type: String, default: "" },
      phone: { type: String, default: "" },
      alternatePhone: { type: String, default: "" },
      addressLine1: { type: String, default: "" },
      addressLine2: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      pincode: { type: String, default: "" },
      landmark: { type: String, default: "" },
    },
    carrier: {
      type: String,
      default: "",
    },
    trackingNumber: {
      type: String,
      default: "",
    },
    trackingUrl: {
      type: String,
      default: "",
    },
    shippedAt: {
      type: Date,
      default: null,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    adminNotes: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const Order = mongoose.model("Order", orderSchema);

export default Order;
