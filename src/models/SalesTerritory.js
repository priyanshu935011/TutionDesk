import mongoose from "../utils/supabaseModel.js";

const salesTerritorySchema = new mongoose.Schema(
  {
    state: {
      type: String,
      required: true,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
      default: "", // empty string means entire state
    },
    salesPersonId: {
      type: String,
      required: true,
    },
    salesPersonName: {
      type: String,
      default: "",
    },
    assignedBy: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

const SalesTerritory = mongoose.model("SalesTerritory", salesTerritorySchema);

export default SalesTerritory;
