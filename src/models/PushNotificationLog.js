import mongoose from "../utils/supabaseModel.js";

const pushNotificationLogSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    body: {
      type: String,
      required: true,
      trim: true,
    },
    imageUrl: {
      type: String,
      default: "",
    },
    actionUrl: {
      type: String,
      default: "",
    },
    templateType: {
      type: String,
      enum: ["announcement", "alert", "fee", "exam", "festive", "motivation", "custom"],
      default: "custom",
    },
    targetAudience: {
      type: String,
      enum: ["all", "students", "teachers", "institutes", "specific_institutes", "specific_students", "criteria"],
      default: "all",
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    targetCount: {
      type: Number,
      default: 0,
    },
    successCount: {
      type: Number,
      default: 0,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["sent", "partial", "failed"],
      default: "sent",
    },
    priority: {
      type: String,
      enum: ["high", "normal"],
      default: "high",
    },
    sentBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    sentByName: {
      type: String,
      default: "Super Admin",
    },
  },
  {
    timestamps: true,
  }
);

const PushNotificationLog = mongoose.model("PushNotificationLog", pushNotificationLogSchema);

export default PushNotificationLog;
