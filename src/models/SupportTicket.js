import mongoose from "../utils/supabaseModel.js";

const supportTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      default: () => `TKT-${Math.floor(100000 + Math.random() * 900000)}`,
    },
    userId: {
      type: String,
      required: true,
    },
    userName: {
      type: String,
      default: "",
    },
    userPhone: {
      type: String,
      default: "",
    },
    userRole: {
      type: String,
      default: "teacher",
    },
    instituteId: {
      type: String,
      default: "",
    },
    instituteName: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    attachments: {
      type: Array,
      default: [],
    },
    deviceInfo: {
      type: Object,
      default: {},
    },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
      default: "OPEN",
    },
    priority: {
      type: String,
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
    },
    adminReply: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const SupportTicket = mongoose.model("SupportTicket", supportTicketSchema);

export default SupportTicket;
