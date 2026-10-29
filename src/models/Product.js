import mongoose from "../utils/supabaseModel.js";

const productSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    mrp: {
      type: Number,
      default: 0,
      min: 0,
    },
    productType: {
      type: String,
      enum: ["test_series", "notes", "bundle", "digital", "offline"],
      default: "test_series",
    },
    category: {
      type: String,
      default: "General",
      trim: true,
    },
    thumbnail: {
      type: String,
      default: "",
    },
    images: {
      type: [String],
      default: [],
    },
    isDigital: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["active", "draft", "archived"],
      default: "active",
    },
    featured: {
      type: Boolean,
      default: false,
    },
    // Connected digital items
    testSeriesIds: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "TestSeries",
      },
    ],
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
      default: [], // [{ type: "test_series"|"notes"|"digital", id: String, title: String, url: String }]
    },
    // Future-proof offline / physical delivery fields
    stockQuantity: {
      type: Number,
      default: 100,
    },
    weightKg: {
      type: Number,
      default: 0.5,
    },
    sku: {
      type: String,
      default: "",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

const Product = mongoose.model("Product", productSchema);

export default Product;
