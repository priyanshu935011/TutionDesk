import mongoose from "../utils/supabaseModel.js";

// DPDP Rule 6 requires retention of access and processing logs for at least 1 year (365 days).
const dataAccessLogSchema = new mongoose.Schema(
  {
    actorId: {
      type: String,
      default: "",
    },
    actorRole: {
      type: String,
      default: "",
    },
    instituteId: {
      type: String,
      default: "",
    },
    action: {
      type: String,
      required: true,
    },
    targetType: {
      type: String,
      default: "",
    },
    targetId: {
      type: String,
      default: "",
    },
    ipMasked: {
      type: String,
      default: "",
    },
    details: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

const DataAccessLog = mongoose.model("DataAccessLog", dataAccessLogSchema);
export default DataAccessLog;
