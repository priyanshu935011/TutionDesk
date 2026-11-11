import axios from "axios";
import SystemSetting from "../models/SystemSetting.js";
import SmsOtpLog from "../models/SmsOtpLog.js";
import { maskPhone } from "./piiSanitizer.js";

const logSmsOtpSent = (phone, provider = "textbee") => {
  SmsOtpLog.create({
    phoneMasked: maskPhone(phone || ""),
    provider,
    status: "sent",
    createdAt: new Date(),
  }).catch(() => {});
};

const DEFAULT_BASE_URL = "https://api.textbee.dev/api/v1";
const DEFAULT_OTP_TEMPLATE = "Your ClassTech verification code is {otp}. Valid for 5 minutes.";

/**
 * Format any phone number into standard E.164 international format (+[country_code][number])
 * Defaults to India (+91) for 10-digit mobile numbers.
 */
export const formatToE164 = (phone) => {
  if (!phone) return "";
  const str = phone.toString().trim();
  if (str.startsWith("+")) {
    return "+" + str.slice(1).replace(/\D/g, "");
  }
  const digits = str.replace(/\D/g, "");
  if (digits.length === 10) {
    return "+91" + digits;
  }
  if (digits.length === 12 && digits.startsWith("91")) {
    return "+" + digits;
  }
  return "+" + digits;
};

/**
 * Replace placeholders like {otp}, {code}, {OTP} in message template
 */
export const buildOtpMessage = (template, otp) => {
  const tpl = (template || "").trim() || DEFAULT_OTP_TEMPLATE;
  if (/\{otp\}|\{code\}/i.test(tpl)) {
    return tpl.replace(/\{otp\}/gi, otp).replace(/\{code\}/gi, otp);
  }
  return `${tpl} - Code: ${otp}`;
};

/**
 * Fetch TextBee SMS settings from SystemSetting or process.env
 */
export const getTextBeeConfig = async () => {
  let dbConfig = null;
  try {
    const setting = await SystemSetting.findOne({ key: "textbee_sms_settings" });
    if (setting && setting.value) {
      let val = setting.value;
      if (typeof val === "string") {
        try { val = JSON.parse(val); } catch (_) {}
      }
      dbConfig = typeof val === "object" ? val : null;
    }
  } catch (err) {
    console.warn("[TextBee] Could not load DB settings:", err.message);
  }

  const apiKey = (dbConfig?.apiKey || process.env.TEXTBEE_API_KEY || "").trim();
  const deviceId = (dbConfig?.deviceId || process.env.TEXTBEE_DEVICE_ID || "").trim();
  const messageTemplate = (dbConfig?.messageTemplate || process.env.TEXTBEE_OTP_TEMPLATE || DEFAULT_OTP_TEMPLATE).trim();
  const baseUrl = (dbConfig?.baseUrl || process.env.TEXTBEE_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  const enabled = dbConfig?.enabled !== false;

  return {
    apiKey,
    deviceId,
    messageTemplate,
    baseUrl,
    enabled,
    isConfigured: Boolean(apiKey),
  };
};

/**
 * Fetch list of connected Android devices from TextBee account
 * @param {string} [apiKeyOverride] - Optional API key override
 */
export const fetchTextBeeDevices = async (apiKeyOverride) => {
  const config = await getTextBeeConfig();
  const apiKey = (apiKeyOverride || config.apiKey || "").trim();

  if (!apiKey) {
    throw new Error("TextBee API key is required to fetch devices.");
  }

  const url = `${config.baseUrl}/gateway/devices`;
  console.log(`[TextBee] Fetching connected devices from ${url}...`);

  const response = await axios.get(url, {
    headers: {
      "x-api-key": apiKey,
    },
    timeout: 12000,
  });

  const rawData = response.data;
  // Raw data can be an array directly or { data: [...] }
  const devices = Array.isArray(rawData)
    ? rawData
    : Array.isArray(rawData?.data)
    ? rawData.data
    : rawData?.devices || [];

  return devices;
};

/**
 * Send an arbitrary custom SMS via TextBee Gateway
 * @param {string} phoneNumber - Recipient phone number
 * @param {string} message - Message text
 * @param {object} [options] - Optional overrides (apiKey, deviceId)
 */
export const sendCustomSMS = async (phoneNumber, message, options = {}) => {
  const config = await getTextBeeConfig();
  const apiKey = (options.apiKey || config.apiKey || "").trim();
  const deviceId = (options.deviceId || config.deviceId || "").trim();
  const baseUrl = (options.baseUrl || config.baseUrl || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");

  if (!apiKey) {
    throw new Error("TextBee API key is not configured. Please set your API key in Super Admin > SMS Gateway.");
  }

  const formattedRecipient = formatToE164(phoneNumber);
  if (!formattedRecipient || formattedRecipient.length < 11) {
    throw new Error(`Invalid mobile number format: "${phoneNumber}". Please provide a valid 10-digit phone number.`);
  }

  const payload = {
    recipients: [formattedRecipient],
    message: String(message || "").trim(),
  };

  if (deviceId) {
    payload.deviceId = deviceId;
  }

  console.log(`[TextBee] Sending SMS to ${formattedRecipient} (device: ${deviceId || "default"})...`);

  try {
    const response = await axios.post(`${baseUrl}/gateway/send-sms`, payload, {
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      timeout: 15000,
    });

    const data = response.data;
    console.log(`[TextBee] SMS delivered successfully to ${formattedRecipient}:`, data);
    return {
      success: true,
      provider: "textbee",
      recipient: formattedRecipient,
      data,
    };
  } catch (error) {
    const errorMsg =
      error.response?.data?.message ||
      error.response?.data?.error ||
      error.message ||
      "Failed to deliver SMS via TextBee.";
    console.error(`[TextBee] Failed to send SMS to ${formattedRecipient}:`, errorMsg);
    throw new Error(errorMsg);
  }
};

/**
 * Primary OTP Sender: Sends OTP via TextBee SMS Gateway
 * Supports dynamic message templates and automatic E.164 phone formatting.
 *
 * @param {string} phoneNumber - 10-digit mobile number or full international format
 * @param {string} otp - 6-digit OTP code
 * @param {object|string} [optionsOrTemplate] - Optional custom message template or options
 */
export const sendSMSOTP = async (phoneNumber, otp, optionsOrTemplate = {}) => {
  const cleanPhone = (phoneNumber || "").toString().replace(/\D/g, "");
  const mobileNumber = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

  if (!mobileNumber || mobileNumber.length < 10) {
    throw new Error("Please enter a valid 10-digit mobile number.");
  }

  const config = await getTextBeeConfig();
  const template =
    typeof optionsOrTemplate === "string"
      ? optionsOrTemplate
      : optionsOrTemplate?.template || config.messageTemplate;

  const finalMessage = buildOtpMessage(template, otp);

  // 1. Try sending via TextBee if configured
  if (config.isConfigured && config.enabled !== false) {
    try {
      const res = await sendCustomSMS(phoneNumber, finalMessage, {
        apiKey: config.apiKey,
        deviceId: config.deviceId,
        baseUrl: config.baseUrl,
      });
      logSmsOtpSent(mobileNumber, "textbee");
      return res;
    } catch (textbeeErr) {
      console.error("[sendSMSOTP] TextBee gateway failed:", textbeeErr.message);

      // If Hanu OTP fallback key is explicitly defined in environment, attempt secondary fallback
      if (process.env.HANU_OTP_API_KEY) {
        console.warn("[sendSMSOTP] Falling back to secondary Hanu OTP API...");
        try {
          const hanuUrl = `https://api.hanuotp.in/sms-otp.php?number=${mobileNumber}&OTP=${otp}&apikey=${process.env.HANU_OTP_API_KEY}&templatesid=default`;
          const hanuRes = await axios.get(hanuUrl, { timeout: 10000 });
          logSmsOtpSent(mobileNumber, "hanu");
          return hanuRes.data;
        } catch (_) {}
      }

      throw textbeeErr;
    }
  }

  // 2. If TextBee is not configured, check for Hanu OTP fallback
  if (process.env.HANU_OTP_API_KEY) {
    console.warn("[sendSMSOTP] TextBee not configured, using HANU_OTP_API_KEY fallback...");
    const apiKey = process.env.HANU_OTP_API_KEY;
    const url = `https://api.hanuotp.in/sms-otp.php?number=${mobileNumber}&OTP=${otp}&apikey=${apiKey}&templatesid=default`;
    const response = await axios.get(url, { timeout: 10000 });
    logSmsOtpSent(mobileNumber, "hanu");
    return response.data;
  }

  // If neither is configured, throw clear actionable message for super admin
  throw new Error("SMS Gateway is not configured. Please configure your TextBee API Key and Device ID in Super Admin.");
};
