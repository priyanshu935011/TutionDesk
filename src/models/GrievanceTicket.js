import mongoose from "../utils/supabaseModel.js";

const grievanceTicketSchema = new mongoose.Schema(
  {
    ticketNumber: {
      type: String,
      required: true,
    },
    principalType: {
      type: String,
      enum: ["teacher", "institute_admin", "student", "parent", "user"],
      default: "user",
    },
    principalId: {
      type: String,
      default: "",
    },
    instituteId: {
      type: String,
      default: "",
    },
    name: {
      type: String,
      default: "",
    },
    email: {
      type: String,
      default: "",
    },
    phone: {
      type: String,
      default: "",
    },
    category: {
      type: String,
      enum: [
        "access_request",
        "correction",
        "erasure",
        "consent_withdrawal",
        "breach_concern",
        "child_data",
        "other",
      ],
      default: "other",
    },
    subject: {
      type: String,
      default: "DPDP Data Rights Request",
    },
    description: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["open", "in_progress", "resolved", "escalated"],
      default: "open",
    },
    resolutionNotes: {
      type: String,
      default: "",
    },
    assignedOfficer: {
      type: String,
      default: "Data Protection & Grievance Officer",
    },
    slaDeadline: {
      type: Date,
      default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
    resolvedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const GrievanceTicket = mongoose.model("GrievanceTicket", grievanceTicketSchema);
export default GrievanceTicket;
