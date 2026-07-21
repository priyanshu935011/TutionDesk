import mongoose from "../utils/supabaseModel.js";

const uptimeEventSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["up", "down"],
      required: true,
    },
    reason: {
      type: String,
      trim: true,
      default: "",
    },
    startedAt: {
      type: Date,
      required: true,
    },
    endedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

uptimeEventSchema.virtual("durationMinutes").get(function durationMinutes() {
  if (!this.endedAt) {
    return 0;
  }

  return Math.max(0, Math.round((this.endedAt.getTime() - this.startedAt.getTime()) / 60000));
});

const UptimeEvent = mongoose.model("UptimeEvent", uptimeEventSchema);

export default UptimeEvent;
