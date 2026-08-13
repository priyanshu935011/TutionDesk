import SystemSetting from "../models/SystemSetting.js";
import { clearCachePattern } from "../utils/cache.js";
import { sendRenewalReceiptEmail } from "../utils/mailer.js";
import nodemailer from "nodemailer";
import CashfreePayment from "../models/CashfreePayment.js";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import { resolveSubscriptionEnd } from "../utils/subscription.js";
import WhatsappLog from "../models/WhatsappLog.js";
import axios from "axios";
import crypto from "crypto";

const getCashfreeConfig = async () => {
  const setting = await SystemSetting.findOne({ key: "cashfree_settings" });
  if (!setting || !setting.value) {
    throw new Error("Cashfree API credentials are not configured by the super admin.");
  }
  let val = setting.value;
  if (typeof val === "string") {
    try {
      val = JSON.parse(val);
    } catch (e) {
      val = {};
    }
  }
  return val; // { appId, secretKey, environment }
};

const getBaseUrl = (environment) => {
  return environment === "production"
    ? "https://api.cashfree.com/pg"
    : "https://sandbox.cashfree.com/pg";
};

const getCoveragePlan = (planStr) => {
  if (!planStr) return "monthly";
  const str = String(planStr).toLowerCase();
  if (str.includes("half_yearly") || str.includes("halfyearly")) {
    return "half_yearly";
  }
  if (str.includes("yearly") || str.includes("annual")) {
    return "yearly";
  }
  if (str.includes("quarterly")) {
    return "quarterly";
  }
  return "monthly";
};

const getNextStartDate = (institute) => {
  if (institute?.subscriptionEnd) {
    const currentEnd = new Date(institute.subscriptionEnd);
    if (!isNaN(currentEnd.getTime()) && currentEnd.getTime() > Date.now()) {
      return currentEnd;
    }
  }

  const history = Array.isArray(institute?.subscriptionHistory) ? institute.subscriptionHistory : [];
  const lastHistory = history.slice().sort(
    (a, b) => new Date(b?.endDate).getTime() - new Date(a?.endDate).getTime()
  )[0];

  const lastEndDate = lastHistory ? new Date(lastHistory.endDate) : (institute?.subscriptionStart ? new Date(institute.subscriptionStart) : new Date());

  if (!lastEndDate || isNaN(lastEndDate.getTime()) || lastEndDate.getTime() < Date.now()) {
    return new Date();
  }
  return lastEndDate;
};

// Create dynamic payment order or recurring subscription mandate
export const createPaymentSession = async (req, res) => {
  try {
    const { plan, tier, type, billingDetails } = req.body;
    const instituteId = req.user.institute?._id || req.user.institute;

    if (!instituteId) {
      return res.status(400).json({ message: "Institute context is required." });
    }

    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found." });
    }

    // Trial exclusion check: "Dont give an option to renew in trial"
    if (institute.subscriptionPlan === "trial" || institute.status === "trial") {
      return res.status(400).json({
        message: "Subscription renewals are disabled for trial accounts. Please contact administrative support to transition your account."
      });
    }

    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    // Calculate billing amount based on institute subscriptionAmount and config default base price
    const basePrice = Number(institute.subscriptionAmount) || Number(config.defaultMonthlyPrice) || 1999;
    const { defaultMonthlyPrice, enableOffers, sixMonthsFreeMonths, twelveMonthsFreeMonths } = config;

    let amount = basePrice;
    let coveragePlan = "monthly";

    if (plan === "half_yearly" || plan === "quarterly") { // quarterly maps to 6 months here per UI
      coveragePlan = "half_yearly";
      const freeMonths = enableOffers !== false ? Number(sixMonthsFreeMonths || 1) : 0;
      amount = basePrice * (6 - freeMonths);
    } else if (plan === "yearly") {
      coveragePlan = "yearly";
      const freeMonths = enableOffers !== false ? Number(twelveMonthsFreeMonths || 2) : 0;
      amount = basePrice * (12 - freeMonths);
    } else {
      coveragePlan = "monthly";
      amount = basePrice;
    }

    const cfOrderId = "order_" + crypto.randomUUID().replace(/-/g, "");

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    if (type === "recurring") {
      // Auto-renew subscription flow using Cashfree Subscriptions APIs
      const planId = `plan_${coveragePlan}_recurring`;
      
      // Attempt to ensure subscription plan exists
      try {
        await axios.post(`${baseUrl}/plans`, {
          plan_id: planId,
          plan_name: `Tuition ${coveragePlan.toUpperCase()} Auto-Renew`,
          plan_type: "PERIODIC",
          plan_currency: "INR",
          plan_intervals: 1,
          plan_interval_type: coveragePlan === "yearly" ? "YEAR" : (coveragePlan === "half_yearly" ? "HALF_YEAR" : "MONTH"),
          plan_amount: amount,
        }, { headers });
      } catch (err) {
        // Plan might already exist, which is safe to ignore
      }

      const subId = "sub_" + crypto.randomUUID().replace(/-/g, "");
      const subscriptionPayload = {
        subscription_id: subId,
        plan_details: { plan_id: planId },
        customer_details: {
          customer_id: String(instituteId),
          customer_phone: req.user.phone || "9999999999",
          customer_email: req.user.email || "support@classtech.com",
          customer_name: institute.name || "Tuition Admin",
        },
        notification_channels: ["EMAIL", "SMS"],
      };

      const response = await axios.post(`${baseUrl}/subscriptions`, subscriptionPayload, { headers });
      
      await CashfreePayment.create({
        institute: instituteId,
        instituteName: institute.name,
        plan: coveragePlan,
        amount,
        type: "recurring",
        status: "pending",
        cfOrderId: subId,
        subscriptionId: subId,
        autoRenew: true,
        cfPaymentDetails: { billingDetails },
      });

      return res.json({
        type: "recurring",
        cfOrderId: subId,
        subscriptionId: subId,
        paymentLink: response.data.sub_payment_link || response.data.payment_link,
        environment,
      });

    } else {
      // One-time payment flow
      let origin = req.headers.origin || "https://classtech-v1.up.railway.app";
      if (!origin.startsWith("https://")) {
        origin = "https://classtech-v1.up.railway.app";
      }
      const returnUrl = origin.includes("8080")
        ? `${origin}/#/subscription-expired?verify_id=${cfOrderId}`
        : `${origin}/subscription-expired?verify_id=${cfOrderId}`;

      const orderPayload = {
        order_id: cfOrderId,
        order_amount: amount,
        order_currency: "INR",
        customer_details: {
          customer_id: String(instituteId),
          customer_name: institute.name || "Tuition Admin",
          customer_email: req.user.email || "support@classtech.com",
          customer_phone: req.user.phone || "9999999999",
        },
        order_meta: {
          return_url: returnUrl,
        },
      };

      const response = await axios.post(`${baseUrl}/orders`, orderPayload, { headers });

      await CashfreePayment.create({
        institute: instituteId,
        instituteName: institute.name,
        plan: coveragePlan,
        amount,
        type: "one_time",
        status: "pending",
        cfOrderId,
        paymentSessionId: response.data.payment_session_id,
        autoRenew: false,
        cfPaymentDetails: { billingDetails },
      });

      return res.json({
        type: "one_time",
        cfOrderId,
        paymentSessionId: response.data.payment_session_id,
        paymentLink: response.data.payments?.url || response.data.payment_link || (environment === "production" 
          ? `https://payments.cashfree.com/order/${response.data.payment_session_id}`
          : `https://payments-test.cashfree.com/order/${response.data.payment_session_id}`),
        environment,
      });
    }
  } catch (error) {
    console.error("createPaymentSession error:", error.response?.data || error.message);
    return res.status(500).json({ message: error.response?.data?.message || "Could not generate payment session." });
  }
};

// Verify payment status (standard order check or subscription mandate status check)
export const verifyPayment = async (req, res) => {
  try {
    const { cfOrderId } = req.body;
    if (!cfOrderId) {
      return res.status(400).json({ message: "cfOrderId is required." });
    }

    const payment = await CashfreePayment.findOne({ cfOrderId });
    if (!payment) {
      return res.status(404).json({ message: "Payment transaction record not found." });
    }

    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    let status = "pending";
    let rawData = {};

    if (payment.type === "recurring") {
      const response = await axios.get(`${baseUrl}/subscriptions/${cfOrderId}`, { headers });
      rawData = response.data;
      if (response.data.subscription_status === "ACTIVE") {
        status = "success";
      } else if (["CANCELLED", "COMPLETED", "SUSPENDED"].includes(response.data.subscription_status)) {
        status = "cancelled";
      }
    } else {
      const response = await axios.get(`${baseUrl}/orders/${cfOrderId}`, { headers });
      rawData = response.data;
      if (response.data.order_status === "PAID") {
        status = "success";
      } else if (["EXPIRED", "CANCELLED", "FAILED"].includes(response.data.order_status)) {
        status = "failed";
      }
    }

    payment.status = status;
    payment.cfPaymentDetails = rawData;
    await payment.save();

    if (status === "success") {
      const institute = await Institute.findById(payment.institute);
      if (institute) {
        const coveragePlan = getCoveragePlan(payment.plan);

        const nextStart = getNextStartDate(institute);
        const nextEnd = resolveSubscriptionEnd({
          subscriptionPlan: coveragePlan,
          subscriptionStart: nextStart,
          trialDays: 0,
        });

        institute.subscriptionPlan = coveragePlan;
        institute.subscriptionAmount = payment.amount;
        institute.subscriptionStart = nextStart;
        institute.subscriptionEnd = nextEnd;
        institute.status = "active";

        if (!Array.isArray(institute.subscriptionHistory)) {
          institute.subscriptionHistory = [];
        }

        const alreadyAdded = institute.subscriptionHistory.some(
          (h) => String(h.note).includes(cfOrderId)
        );

        if (!alreadyAdded) {
          institute.subscriptionHistory.unshift({
            plan: coveragePlan,
            amount: payment.amount,
            startDate: nextStart,
            endDate: nextEnd,
            trialDays: 0,
            note: `Paid Cashfree transaction Order ID: ${cfOrderId}`,
          });
        }

        await institute.save();
        try {
          await sendRenewalReceiptEmail(institute.adminEmail, institute.name, payment);
        } catch (receiptErr) {
          console.error("Receipt email error in verifyPayment:", receiptErr);
        }
        try {
          await clearCachePattern("teacher:dashboard:*");
          await clearCachePattern("student:dashboard:*");
        } catch (cacheErr) {
          console.error("Cache clear error in payment verify:", cacheErr);
        }
      }
    }

    let populatedUser = null;
    if (req.user && req.user._id) {
      populatedUser = await User.findById(req.user._id).populate("institute").select("-password");
    }

    return res.json({ status, payment, user: populatedUser });
  } catch (error) {
    console.error("verifyPayment error:", error.response?.data || error.message);
    return res.status(500).json({ message: "Could not verify subscription transaction." });
  }
};

// Webhook endpoint for async updates from Cashfree
export const handleCashfreeWebhook = async (req, res) => {
  try {
    const rawBody = req.body;
    // Basic signature verification can be added here depending on header signature tokens.
    // For integration testing simplicity, parse transaction fields:
    const cfOrderId = rawBody?.data?.order?.order_id || rawBody?.data?.subscription?.subscription_id;
    if (cfOrderId) {
      const payment = await CashfreePayment.findOne({ cfOrderId });
      if (payment) {
        const type = rawBody?.type;
        if (type === "ORDER_PAID" || type === "SUBSCRIPTION_ACTIVE") {
          payment.status = "success";
        } else if (type === "ORDER_FAILED" || type === "SUBSCRIPTION_CANCELLED") {
          payment.status = "failed";
        }
        payment.cfPaymentDetails = rawBody;
        await payment.save();

        if (payment.status === "success") {
          const institute = await Institute.findById(payment.institute);
          if (institute) {
            const coveragePlan = getCoveragePlan(payment.plan);
            const nextStart = getNextStartDate(institute);
            const nextEnd = resolveSubscriptionEnd({
              subscriptionPlan: coveragePlan,
              subscriptionStart: nextStart,
              trialDays: 0,
            });

            institute.subscriptionPlan = coveragePlan;
            institute.subscriptionAmount = payment.amount;
            institute.subscriptionStart = nextStart;
            institute.subscriptionEnd = nextEnd;
            institute.status = "active";

            if (!Array.isArray(institute.subscriptionHistory)) {
              institute.subscriptionHistory = [];
            }
            const alreadyAdded = institute.subscriptionHistory.some(
              (h) => String(h.note).includes(cfOrderId)
            );
            if (!alreadyAdded) {
              institute.subscriptionHistory.unshift({
                plan: coveragePlan,
                amount: payment.amount,
                startDate: nextStart,
                endDate: nextEnd,
                trialDays: 0,
                note: `Paid Cashfree Webhook transaction Order ID: ${cfOrderId}`,
              });
            }
            await institute.save();
            try {
              await sendRenewalReceiptEmail(institute.adminEmail, institute.name, payment);
            } catch (receiptErr) {
              console.error("Receipt email error in webhook:", receiptErr);
            }
            try {
              await clearCachePattern("teacher:dashboard:*");
              await clearCachePattern("student:dashboard:*");
            } catch (cacheErr) {
              console.error("Cache clear error in payment webhook:", cacheErr);
            }
          }
        }
      }
    }
    return res.status(200).json({ received: true });
  } catch (error) {
    console.error("handleCashfreeWebhook error:", error);
    return res.status(500).json({ error: error.message });
  }
};

// Get all Cashfree payments for Super Admin / Tech Admin
export const getAllPayments = async (req, res) => {
  try {
    const payments = await CashfreePayment.find().sort({ createdAt: -1 });
    return res.json(payments || []);
  } catch (error) {
    console.error("getAllPayments error:", error);
    return res.status(500).json({ message: "Could not fetch payments." });
  }
};

// Initiate refund for transaction (Super Admin / Tech Admin)
export const initiateRefund = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await CashfreePayment.findById(id);
    if (!payment) {
      return res.status(404).json({ message: "Payment record not found." });
    }

    if (payment.status !== "success") {
      return res.status(400).json({ message: "Only successful payments can be refunded." });
    }

    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const refundId = "ref_" + crypto.randomUUID().replace(/-/g, "").substring(0, 10);
    const refundPayload = {
      refund_amount: payment.amount,
      refund_id: refundId,
      refund_note: "Initiated from Super Admin Panel",
    };

    const response = await axios.post(`${baseUrl}/orders/${payment.cfOrderId}/refunds`, refundPayload, { headers });

    payment.status = "refunded";
    payment.cfPaymentDetails = { ...payment.cfPaymentDetails, refundResponse: response.data };
    await payment.save();

    return res.json({ message: "Refund initiated successfully.", payment });
  } catch (error) {
    console.error("initiateRefund error:", error.response?.data || error.message);
    return res.status(500).json({ message: error.response?.data?.message || "Could not process refund via Cashfree." });
  }
};

// Cancel active Auto-Renew subscription mandate
export const cancelAutoRenew = async (req, res) => {
  try {
    const { id } = req.params;
    const payment = await CashfreePayment.findById(id);
    if (!payment || !payment.subscriptionId) {
      return res.status(404).json({ message: "Subscription record not found." });
    }

    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    // Cancel subscription
    const response = await axios.patch(
      `${baseUrl}/subscriptions/${payment.subscriptionId}`,
      { action: "CANCEL" },
      { headers }
    );

    payment.status = "cancelled";
    payment.cfPaymentDetails = { ...payment.cfPaymentDetails, cancelResponse: response.data };
    await payment.save();

    // Disable auto renew status on target Tuition/Institute
    const institute = await Institute.findById(payment.institute);
    if (institute) {
      institute.autoRenew = false;
      await institute.save();
    }

    return res.json({ message: "Subscription cancelled successfully.", payment });
  } catch (error) {
    console.error("cancelAutoRenew error:", error.response?.data || error.message);
    return res.status(500).json({ message: error.response?.data?.message || "Could not cancel subscription via Cashfree." });
  }
};

export const getCashfreeSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "cashfree_settings" });
    const defaults = {
      appId: "",
      secretKey: "",
      environment: "sandbox",
      defaultMonthlyPrice: 1999,
      enableOffers: true,
      sixMonthsFreeMonths: 1,
      twelveMonthsFreeMonths: 2,
    };
    if (!setting) {
      return res.json(defaults);
    }
    let val = setting.value;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch (e) {
        val = {};
      }
    }
    const merged = { ...defaults, ...(val || {}) };
    return res.json(merged);
  } catch (error) {
    console.error("getCashfreeSettings error:", error);
    return res.status(500).json({ message: "Could not fetch Cashfree settings." });
  }
};

export const updateCashfreeSettings = async (req, res) => {
  try {
    const { appId, secretKey, environment, defaultMonthlyPrice, enableOffers, sixMonthsFreeMonths, twelveMonthsFreeMonths } = req.body;
    if (!appId || !secretKey || !environment) {
      return res.status(400).json({ message: "App ID, Secret Key and Environment are required." });
    }

    const updatedValue = {
      appId: appId.trim(),
      secretKey: secretKey.trim(),
      environment: environment.trim().toLowerCase(),
      defaultMonthlyPrice: Number(defaultMonthlyPrice || 1999),
      enableOffers: enableOffers !== false,
      sixMonthsFreeMonths: Number(sixMonthsFreeMonths || 1),
      twelveMonthsFreeMonths: Number(twelveMonthsFreeMonths || 2),
    };

    let setting = await SystemSetting.findOne({ key: "cashfree_settings" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      setting = await SystemSetting.create({
        key: "cashfree_settings",
        value: updatedValue,
        description: "Cashfree API gateway configuration credentials"
      });
    }

    return res.json(updatedValue);
  } catch (error) {
    console.error("updateCashfreeSettings error:", error);
    return res.status(500).json({ message: "Could not update Cashfree settings." });
  }
};

export const testGatewayConnection = async (req, res) => {
  try {
    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const testOrderId = "test_" + crypto.randomUUID().replace(/-/g, "").substring(0, 10);
    const testPayload = {
      order_id: testOrderId,
      order_amount: 1,
      order_currency: "INR",
      customer_details: {
        customer_id: "test_customer",
        customer_name: "Test Admin",
        customer_email: "test@classtech.in",
        customer_phone: "9999999999",
      },
    };

    const response = await axios.post(`${baseUrl}/orders`, testPayload, { headers });

    if (response.data && response.data.payment_session_id) {
      return res.json({
        success: true,
        message: "Successfully authenticated with Cashfree Payment Gateway! API credentials are valid.",
        cfOrderId: testOrderId,
        paymentSessionId: response.data.payment_session_id,
        environment,
      });
    }

    return res.status(400).json({
      success: false,
      message: "Gateway responded but did not return session credentials.",
      raw: response.data,
    });
  } catch (error) {
    console.error("testGatewayConnection error:", error.response?.data || error.message);
    return res.status(400).json({
      success: false,
      message: error.response?.data?.message || error.message || "Failed to authenticate with Cashfree Gateway API.",
    });
  }
};

export const getPaymentDetailsForInstitute = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "Institute context is required." });
    }

    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found." });
    }

    let config = { defaultMonthlyPrice: 1999, enableOffers: true, sixMonthsFreeMonths: 1, twelveMonthsFreeMonths: 2 };
    try {
      config = await getCashfreeConfig();
    } catch (e) {}

    const basePrice = Number(institute.subscriptionAmount) || Number(config.defaultMonthlyPrice) || 1999;
    
    return res.json({
      basePrice,
      enableOffers: config.enableOffers !== false,
      sixMonthsFreeMonths: Number(config.sixMonthsFreeMonths || 1),
      twelveMonthsFreeMonths: Number(config.twelveMonthsFreeMonths || 2),
      tuitionName: institute.name,
      plan: institute.subscriptionPlan,
      status: institute.status,
      allowedFeatures: institute.allowedFeatures || ["attendance", "notes", "marks", "tests", "whatsapp"],
      quizFeatureEnabled: institute.quizFeatureEnabled !== false,
    });
  } catch (error) {
    console.error("getPaymentDetailsForInstitute error:", error);
    return res.status(500).json({ message: "Could not fetch payment configuration details." });
  }
};

export const getSmtpSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "smtp_settings" });
    const defaults = {
      host: "",
      port: 587,
      user: "",
      pass: "",
      from: '"Classtech" <support@classtech.in>',
      brevoApiKey: "",
    };
    if (!setting) {
      return res.json(defaults);
    }
    let val = setting.value;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch (e) {
        val = {};
      }
    }
    return res.json({
      host: val.host || "",
      port: val.port || 587,
      user: val.user || "",
      pass: val.pass || "",
      from: val.from || '"Classtech" <support@classtech.in>',
      brevoApiKey: val.brevoApiKey || "",
    });
  } catch (error) {
    console.error("getSmtpSettings error:", error);
    return res.status(500).json({ message: "Could not retrieve SMTP settings." });
  }
};

export const updateSmtpSettings = async (req, res) => {
  try {
    const { host, port, user, pass, from, brevoApiKey } = req.body;

    const updatedValue = {
      host: host || "",
      port: Number(port) || 587,
      user: user || "",
      pass: pass || "",
      from: from || '"Classtech" <support@classtech.in>',
      brevoApiKey: brevoApiKey || "",
    };

    let setting = await SystemSetting.findOne({ key: "smtp_settings" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      setting = await SystemSetting.create({
        key: "smtp_settings",
        value: updatedValue,
        description: "Dynamic SMTP configuration credentials for Nodemailer/Brevo API",
      });
    }

    return res.json(updatedValue);
  } catch (error) {
    console.error("updateSmtpSettings error:", error);
    return res.status(500).json({ message: "Could not update SMTP settings." });
  }
};

export const testSmtpConnection = async (req, res) => {
  try {
    const { host, port, user, pass, from, brevoApiKey, recipientEmail } = req.body;

    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: "Recipient email is required for testing." });
    }

    const testHost = host || process.env.SMTP_HOST;
    const testPort = Number(port) || Number(process.env.SMTP_PORT) || 587;
    const testUser = user || process.env.SMTP_USER;
    const testPass = pass || process.env.SMTP_PASS;
    const testFrom = from || process.env.SMTP_FROM || '"Classtech" <support@classtech.in>';
    const testBrevoApiKey = brevoApiKey || process.env.BREVO_API_KEY;

    if (!testHost || !testUser || !testPass) {
      return res.status(400).json({
        success: false,
        message: "SMTP host, user, and password are required to test.",
      });
    }

    let parsedSenderName = "Classtech Test";
    let parsedSenderEmail = "support@classtech.in";
    const fromMatch = testFrom.match(/^"([^"]+)"\s*<([^>]+)>$/);
    if (fromMatch) {
      parsedSenderName = fromMatch[1];
      parsedSenderEmail = fromMatch[2];
    } else {
      const emailOnlyMatch = testFrom.match(/<([^>]+)>/);
      if (emailOnlyMatch) {
        parsedSenderEmail = emailOnlyMatch[1];
      } else if (testFrom.includes("@")) {
        parsedSenderEmail = testFrom.trim();
      }
    }

    const testHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
        <h2 style="color: #10b981; margin-bottom: 20px;">🧪 SMTP Configuration Test</h2>
        <p>Hello,</p>
        <p>This is a test email sent from the Classtech Super Admin dashboard to verify your SMTP settings.</p>
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 10px; font-family: monospace; font-size: 13px; color: #334155; margin: 20px 0;">
          <strong>Host:</strong> ${testHost}<br/>
          <strong>Port:</strong> ${testPort}<br/>
          <strong>User:</strong> ${testUser}<br/>
          <strong>From:</strong> ${testFrom}
        </div>
        <p style="color: #059669; font-weight: bold;">If you are reading this email, your SMTP settings are working perfectly!</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">Classtech SMTP System Verification Module</p>
      </div>
    `;

    let success = false;
    let errorLog = "";

    if (testBrevoApiKey || (testPass && testPass.startsWith("xkeysib-"))) {
      try {
        console.log("Testing Brevo HTTP API connection...");
        const apiKey = testBrevoApiKey || testPass;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            sender: { name: parsedSenderName, email: parsedSenderEmail },
            to: [{ email: recipientEmail, name: "Test Recipient" }],
            subject: "🧪 Classtech SMTP Configuration Test (Brevo API)",
            htmlContent: testHtml,
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          success = true;
        } else {
          const errText = await response.text();
          errorLog += `Brevo HTTP API status ${response.status}: ${errText}\n`;
        }
      } catch (brevoErr) {
        errorLog += `Brevo HTTP API failed: ${brevoErr.message}\n`;
      }
    }

    if (!success) {
      try {
        console.log("Testing direct SMTP transporter connection...");
        const transporter = nodemailer.createTransport({
          host: testHost,
          port: testPort,
          secure: testPort === 465,
          auth: {
            user: testUser,
            pass: testPass,
          },
          connectionTimeout: 8000,
          greetingTimeout: 8000,
          socketTimeout: 8000,
        });

        const mailOptions = {
          from: testFrom,
          to: recipientEmail,
          subject: "🧪 Classtech SMTP Configuration Test (Direct SMTP)",
          html: testHtml,
        };

        await transporter.sendMail(mailOptions);
        success = true;
      } catch (smtpErr) {
        errorLog += `SMTP transport failed: ${smtpErr.message}\n`;
      }
    }

    if (success) {
      return res.json({ success: true, message: `Test email sent successfully to ${recipientEmail}.` });
    } else {
      return res.status(400).json({
        success: false,
        message: "Failed to send email. See error logs.",
        logs: errorLog,
      });
    }
  } catch (error) {
    console.error("testSmtpConnection error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to test SMTP connection." });
  }
};

export const getGstSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "gst_settings" });
    const defaults = {
      companyName: "Classtech Private Limited",
      gstin: "",
      address: "123, Tech Suite, Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pan: "",
      cgstRate: 9,
      sgstRate: 9,
      igstRate: 18,
    };
    if (!setting) {
      return res.json(defaults);
    }
    let val = setting.value;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch (e) {
        val = {};
      }
    }
    return res.json({
      companyName: val.companyName || defaults.companyName,
      gstin: val.gstin || "",
      address: val.address || defaults.address,
      state: val.state || defaults.state,
      stateCode: val.stateCode || defaults.stateCode,
      pan: val.pan || "",
      cgstRate: val.cgstRate !== undefined ? Number(val.cgstRate) : 9,
      sgstRate: val.sgstRate !== undefined ? Number(val.sgstRate) : 9,
      igstRate: val.igstRate !== undefined ? Number(val.igstRate) : 18,
    });
  } catch (error) {
    console.error("getGstSettings error:", error);
    return res.status(500).json({ message: "Could not retrieve GST settings." });
  }
};

export const updateGstSettings = async (req, res) => {
  try {
    const { companyName, gstin, address, state, stateCode, pan, cgstRate, sgstRate, igstRate } = req.body;

    const updatedValue = {
      companyName: companyName || "Classtech Private Limited",
      gstin: gstin || "",
      address: address || "",
      state: state || "Maharashtra",
      stateCode: stateCode || "27",
      pan: pan || "",
      cgstRate: cgstRate !== undefined ? Number(cgstRate) : 9,
      sgstRate: sgstRate !== undefined ? Number(sgstRate) : 9,
      igstRate: igstRate !== undefined ? Number(igstRate) : 18,
    };

    let setting = await SystemSetting.findOne({ key: "gst_settings" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      setting = await SystemSetting.create({
        key: "gst_settings",
        value: updatedValue,
        description: "Dynamic GST Tax Invoice Seller details configurations",
      });
    }

    return res.json(updatedValue);
  } catch (error) {
    console.error("updateGstSettings error:", error);
    return res.status(500).json({ message: "Could not update GST settings." });
  }
};

export const getReceiptDesignSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "receipt_design_settings" });
    const defaults = {
      logoUrl: "https://classtech.in/logo.png",
      primaryColor: "#4f46e5",
      termsAndConditions: "1. Subscription payments are non-refundable.\n2. Access is valid for the selected plan tenure.",
      footerNotes: "Thank you for partnering with Classtech!",
      signatureText: "Authorized Signatory",
      signatureUrl: "",
    };
    if (!setting) {
      return res.json(defaults);
    }
    let val = setting.value;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch (e) {
        val = {};
      }
    }
    return res.json({
      logoUrl: val.logoUrl || defaults.logoUrl,
      primaryColor: val.primaryColor || defaults.primaryColor,
      termsAndConditions: val.termsAndConditions || defaults.termsAndConditions,
      footerNotes: val.footerNotes || defaults.footerNotes,
      signatureText: val.signatureText || defaults.signatureText,
      signatureUrl: val.signatureUrl || "",
    });
  } catch (error) {
    console.error("getReceiptDesignSettings error:", error);
    return res.status(500).json({ message: "Could not retrieve Receipt design settings." });
  }
};

export const updateReceiptDesignSettings = async (req, res) => {
  try {
    const { logoUrl, primaryColor, termsAndConditions, footerNotes, signatureText, signatureUrl } = req.body;

    const updatedValue = {
      logoUrl: logoUrl || "https://classtech.in/logo.png",
      primaryColor: primaryColor || "#4f46e5",
      termsAndConditions: termsAndConditions || "",
      footerNotes: footerNotes || "",
      signatureText: signatureText || "Authorized Signatory",
      signatureUrl: signatureUrl || "",
    };

    let setting = await SystemSetting.findOne({ key: "receipt_design_settings" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      setting = await SystemSetting.create({
        key: "receipt_design_settings",
        value: updatedValue,
        description: "Dynamic Receipt/Invoice design layout and parameters",
      });
    }

    return res.json(updatedValue);
  } catch (error) {
    console.error("updateReceiptDesignSettings error:", error);
    return res.status(500).json({ message: "Could not update Receipt design settings." });
  }
};

export const getSmtpRenewalSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "smtp_renewal_settings" });
    const defaults = {
      host: "",
      port: 587,
      user: "",
      pass: "",
      from: '"Classtech Billing" <support@classtech.in>',
      brevoApiKey: "",
      useDedicatedSmtp: false,
    };
    if (!setting) {
      return res.json(defaults);
    }
    let val = setting.value;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch (e) {
        val = {};
      }
    }
    return res.json({
      host: val.host || "",
      port: val.port || 587,
      user: val.user || "",
      pass: val.pass || "",
      from: val.from || '"Classtech Billing" <support@classtech.in>',
      brevoApiKey: val.brevoApiKey || "",
      useDedicatedSmtp: !!val.useDedicatedSmtp,
    });
  } catch (error) {
    console.error("getSmtpRenewalSettings error:", error);
    return res.status(500).json({ message: "Could not retrieve SMTP renewal settings." });
  }
};

export const updateSmtpRenewalSettings = async (req, res) => {
  try {
    const { host, port, user, pass, from, brevoApiKey, useDedicatedSmtp } = req.body;

    const updatedValue = {
      host: host || "",
      port: Number(port) || 587,
      user: user || "",
      pass: pass || "",
      from: from || '"Classtech Billing" <support@classtech.in>',
      brevoApiKey: brevoApiKey || "",
      useDedicatedSmtp: !!useDedicatedSmtp,
    };

    let setting = await SystemSetting.findOne({ key: "smtp_renewal_settings" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      setting = await SystemSetting.create({
        key: "smtp_renewal_settings",
        value: updatedValue,
        description: "Dedicated dynamic SMTP configuration for billing renewal receipt alerts",
      });
    }

    return res.json(updatedValue);
  } catch (error) {
    console.error("updateSmtpRenewalSettings error:", error);
    return res.status(500).json({ message: "Could not update SMTP renewal settings." });
  }
};

export const testSmtpRenewalConnection = async (req, res) => {
  try {
    const { host, port, user, pass, from, brevoApiKey, recipientEmail } = req.body;

    if (!recipientEmail) {
      return res.status(400).json({ success: false, message: "Recipient email is required for testing." });
    }

    const testHost = host || process.env.SMTP_HOST;
    const testPort = Number(port) || Number(process.env.SMTP_PORT) || 587;
    const testUser = user || process.env.SMTP_USER;
    const testPass = pass || process.env.SMTP_PASS;
    const testFrom = from || process.env.SMTP_FROM || '"Classtech Billing" <support@classtech.in>';
    const testBrevoApiKey = brevoApiKey || process.env.BREVO_API_KEY;

    if (!testHost || !testUser || !testPass) {
      return res.status(400).json({
        success: false,
        message: "SMTP host, user, and password are required to test.",
      });
    }

    let parsedSenderName = "Classtech Billing Test";
    let parsedSenderEmail = "support@classtech.in";
    const fromMatch = testFrom.match(/^"([^"]+)"\s*<([^>]+)>$/);
    if (fromMatch) {
      parsedSenderName = fromMatch[1];
      parsedSenderEmail = fromMatch[2];
    } else {
      const emailOnlyMatch = testFrom.match(/<([^>]+)>/);
      if (emailOnlyMatch) {
        parsedSenderEmail = emailOnlyMatch[1];
      } else if (testFrom.includes("@")) {
        parsedSenderEmail = testFrom.trim();
      }
    }

    const testHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
        <h2 style="color: #4f46e5; margin-bottom: 20px;">🧪 Dedicated SMTP Renewal Test</h2>
        <p>Hello,</p>
        <p>This is a verification email sent from the Classtech Super Admin dashboard using your dedicated **Renewal SMTP Server** credentials.</p>
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 10px; font-family: monospace; font-size: 13px; color: #334155; margin: 20px 0;">
          <strong>Host:</strong> ${testHost}<br/>
          <strong>Port:</strong> ${testPort}<br/>
          <strong>User:</strong> ${testUser}<br/>
          <strong>From:</strong> ${testFrom}
        </div>
        <p style="color: #4f46e5; font-weight: bold;">If you are reading this email, your dedicated billing SMTP settings are working perfectly!</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
        <p style="font-size: 12px; color: #94a3b8;">Classtech SMTP Billing Verification Module</p>
      </div>
    `;

    let success = false;
    let errorLog = "";

    if (testBrevoApiKey || (testPass && testPass.startsWith("xkeysib-"))) {
      try {
        console.log("Testing Brevo HTTP API connection (Renewal SMTP)...");
        const apiKey = testBrevoApiKey || testPass;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000);

        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            sender: { name: parsedSenderName, email: parsedSenderEmail },
            to: [{ email: recipientEmail, name: "Test Recipient" }],
            subject: "🧪 Classtech Billing SMTP Test (Brevo API)",
            htmlContent: testHtml,
          }),
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          success = true;
        } else {
          const errText = await response.text();
          errorLog += `Brevo HTTP API status ${response.status}: ${errText}\n`;
        }
      } catch (brevoErr) {
        errorLog += `Brevo HTTP API failed: ${brevoErr.message}\n`;
      }
    }

    if (!success) {
      try {
        console.log("Testing direct SMTP transporter connection (Renewal SMTP)...");
        const transporter = nodemailer.createTransport({
          host: testHost,
          port: testPort,
          secure: testPort === 465,
          auth: {
            user: testUser,
            pass: testPass,
          },
          connectionTimeout: 8000,
          greetingTimeout: 8000,
          socketTimeout: 8000,
        });

        const mailOptions = {
          from: testFrom,
          to: recipientEmail,
          subject: "🧪 Classtech Billing SMTP Test (Direct SMTP)",
          html: testHtml,
        };

        await transporter.sendMail(mailOptions);
        success = true;
      } catch (smtpErr) {
        errorLog += `SMTP transport failed: ${smtpErr.message}\n`;
      }
    }

    if (success) {
      return res.json({ success: true, message: `Test email sent successfully to ${recipientEmail}.` });
    } else {
      return res.status(400).json({
        success: false,
        message: "Failed to send email. See error logs.",
        logs: errorLog,
      });
    }
  } catch (error) {
    console.error("testSmtpRenewalConnection error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to test SMTP connection." });
  }
};

export const previewReceipt = async (req, res) => {
  try {
    const gstSetting = await SystemSetting.findOne({ key: "gst_settings" });
    let rawSeller = gstSetting?.value || {
      companyName: "Classtech Private Limited",
      gstin: "27AAAAA1111A1Z1",
      address: "123, Tech Suite, Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pan: "AAAAA1111A",
      cgstRate: 9,
      sgstRate: 9,
      igstRate: 18,
    };
    if (typeof rawSeller === "string") {
      try {
        rawSeller = JSON.parse(rawSeller);
      } catch (e) {
        rawSeller = {};
      }
    }
    const seller = {
      companyName: rawSeller.companyName || "Classtech Private Limited",
      gstin: rawSeller.gstin || "",
      address: rawSeller.address || "123, Tech Suite, Mumbai",
      state: rawSeller.state || "Maharashtra",
      stateCode: rawSeller.stateCode || "27",
      pan: rawSeller.pan || "",
      cgstRate: rawSeller.cgstRate !== undefined ? Number(rawSeller.cgstRate) : 9,
      sgstRate: rawSeller.sgstRate !== undefined ? Number(rawSeller.sgstRate) : 9,
      igstRate: rawSeller.igstRate !== undefined ? Number(rawSeller.igstRate) : 18,
    };

    const designSetting = await SystemSetting.findOne({ key: "receipt_design_settings" });
    let rawDesign = designSetting?.value || {
      logoUrl: "https://classtech.in/logo.png",
      primaryColor: "#4f46e5",
      termsAndConditions: "1. Subscription payments are non-refundable.\n2. Access is valid for the selected plan tenure.",
      footerNotes: "Thank you for partnering with Classtech!",
      signatureText: "Authorized Signatory",
    };
    if (typeof rawDesign === "string") {
      try {
        rawDesign = JSON.parse(rawDesign);
      } catch (e) {
        rawDesign = {};
      }
    }
    const design = {
      logoUrl: rawDesign.logoUrl || "https://classtech.in/logo.png",
      primaryColor: rawDesign.primaryColor || "#4f46e5",
      termsAndConditions: rawDesign.termsAndConditions || "1. Subscription payments are non-refundable.\n2. Access is valid for the selected plan tenure.",
      footerNotes: rawDesign.footerNotes || "Thank you for partnering with Classtech!",
      signatureText: rawDesign.signatureText || "Authorized Signatory",
      signatureUrl: rawDesign.signatureUrl || "",
    };

    const dummyPayment = {
      amount: 1999,
      plan: "half_yearly",
      cfOrderId: "cf_order_dummy123456",
      updatedAt: new Date().toISOString(),
      cfPaymentDetails: {
        billingDetails: {
          name: "Sample Academy",
          gstin: "27BBBBB2222B2Z2",
          address: "456, Knowledge Park, Pune",
          state: "Maharashtra",
        }
      }
    };

    const billing = dummyPayment.cfPaymentDetails.billingDetails;
    const buyerName = billing.name;
    const buyerGstin = billing.gstin;
    const buyerAddress = billing.address;
    const buyerState = billing.state;

    const totalAmount = Number(dummyPayment.amount);
    const cgstRate = Number(seller.cgstRate ?? 9);
    const sgstRate = Number(seller.sgstRate ?? 9);
    const igstRate = Number(seller.igstRate ?? 18);

    const isIntraState = String(buyerState).toLowerCase().trim() === String(seller.state).toLowerCase().trim();
    let baseAmount = 0;
    let cgstAmount = 0;
    let sgstAmount = 0;
    let igstAmount = 0;

    if (isIntraState) {
      const combinedRate = (cgstRate + sgstRate) / 100;
      baseAmount = totalAmount / (1 + combinedRate);
      cgstAmount = baseAmount * (cgstRate / 100);
      sgstAmount = baseAmount * (sgstRate / 100);
    } else {
      const combinedRate = igstRate / 100;
      baseAmount = totalAmount / (1 + combinedRate);
      igstAmount = baseAmount * (igstRate / 100);
    }

    const formatNum = (val) => Number(val).toFixed(2);

    const invoiceDate = new Date(dummyPayment.updatedAt).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff; color: #1e293b; line-height: 1.5; box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1);">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #f1f5f9; padding-bottom: 20px; margin-bottom: 25px;">
          <div>
            <img src="${design.logoUrl}" alt="Logo" style="max-height: 40px; margin-bottom: 10px; border-radius: 8px;" />
            <h2 style="margin: 0; font-size: 18px; font-weight: 800; color: ${design.primaryColor || "#4f46e5"}; text-transform: uppercase;">Tax Invoice / Receipt</h2>
          </div>
          <div style="text-align: right; font-size: 11px; color: #64748b; font-family: monospace;">
            <strong style="color: #0f172a; font-size: 12px;">${seller.companyName}</strong><br/>
            ${seller.address}<br/>
            GSTIN: <strong>${seller.gstin || "Not Configured"}</strong><br/>
            State: ${seller.state} (Code: ${seller.stateCode || "N/A"})
          </div>
        </div>

        <!-- Meta Info -->
        <div style="display: flex; justify-content: space-between; margin-bottom: 25px; font-size: 12px; border-bottom: 1px solid #f8fafc; padding-bottom: 15px;">
          <div>
            <span style="color: #94a3b8; text-transform: uppercase; font-weight: bold; font-size: 10px;">Billed To</span>
            <div style="font-weight: bold; color: #0f172a; margin-top: 4px; font-size: 13px;">${buyerName}</div>
            <div style="color: #64748b; margin-top: 2px;">Address: ${buyerAddress}</div>
            <div style="color: #64748b;">State: ${buyerState}</div>
            ${buyerGstin ? `<div style="color: #0f172a; margin-top: 4px;">GSTIN: <strong>${buyerGstin}</strong></div>` : ""}
          </div>
          <div style="text-align: right;">
            <span style="color: #94a3b8; text-transform: uppercase; font-weight: bold; font-size: 10px;">Invoice Details</span>
            <div style="color: #64748b; margin-top: 4px;">Receipt ID: <strong style="color: #0f172a;">${dummyPayment.cfOrderId}</strong></div>
            <div style="color: #64748b;">Date: ${invoiceDate}</div>
            <div style="color: #64748b;">Status: <span style="color: #10b981; font-weight: bold; text-transform: uppercase; font-size: 10px; background-color: #ecfdf5; padding: 2px 6px; border-radius: 4px; border: 1px solid #d1fae5;">PAID</span></div>
          </div>
        </div>

        <!-- Table -->
        <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 12px;">
          <thead>
            <tr style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; text-align: left;">
              <th style="padding: 10px; color: #475569; font-weight: bold;">Description</th>
              <th style="padding: 10px; color: #475569; font-weight: bold; text-align: right;">Qty</th>
              <th style="padding: 10px; color: #475569; font-weight: bold; text-align: right;">Base Price</th>
              <th style="padding: 10px; color: #475569; font-weight: bold; text-align: right;">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr style="border-bottom: 1px solid #f1f5f9;">
              <td style="padding: 12px 10px;">
                <strong style="color: #0f172a; text-transform: capitalize;">Classtech Subscription Plan (${dummyPayment.plan})</strong><br/>
                <span style="color: #94a3b8; font-size: 10px;">Access period extended automatically</span>
              </td>
              <td style="padding: 12px 10px; text-align: right; color: #475569;">1</td>
              <td style="padding: 12px 10px; text-align: right; color: #475569;">INR ${formatNum(baseAmount)}</td>
              <td style="padding: 12px 10px; text-align: right; font-weight: bold; color: #0f172a;">INR ${formatNum(baseAmount)}</td>
            </tr>
          </tbody>
        </table>

        <!-- Totals & Tax Split -->
        <div style="display: flex; justify-content: flex-end; margin-bottom: 30px;">
          <div style="width: 250px; font-size: 12px; border-top: 1px solid #f1f5f9; padding-top: 10px;">
            <div style="display: flex; justify-content: space-between; padding: 4px 0; color: #64748b;">
              <span>Subtotal:</span>
              <span>INR ${formatNum(baseAmount)}</span>
            </div>
            
            ${isIntraState ? `
              <div style="display: flex; justify-content: space-between; padding: 4px 0; color: #64748b;">
                <span>CGST (${cgstRate}%):</span>
                <span>INR ${formatNum(cgstAmount)}</span>
              </div>
              <div style="display: flex; justify-content: space-between; padding: 4px 0; color: #64748b;">
                <span>SGST (${sgstRate}%):</span>
                <span>INR ${formatNum(sgstAmount)}</span>
              </div>
            ` : `
              <div style="display: flex; justify-content: space-between; padding: 4px 0; color: #64748b;">
                <span>IGST (${igstRate}%):</span>
                <span>INR ${formatNum(igstAmount)}</span>
              </div>
            `}

            <div style="display: flex; justify-content: space-between; padding: 8px 0; border-top: 2px solid #e2e8f0; font-weight: bold; font-size: 14px; color: #0f172a;">
              <span>Total Paid:</span>
              <span>INR ${formatNum(totalAmount)}</span>
            </div>
          </div>
        </div>

        <!-- Signatory & Terms -->
        <div style="display: flex; justify-content: space-between; border-top: 1px solid #e2e8f0; padding-top: 20px; font-size: 11px; color: #64748b; line-height: 1.6;">
          <div style="flex-grow: 1; padding-right: 30px;">
            <span style="font-weight: bold; color: #0f172a; text-transform: uppercase; font-size: 9px; letter-spacing: 1px;">Terms & Conditions</span><br/>
            <span style="white-space: pre-line;">${design.termsAndConditions}</span>
            <div style="margin-top: 12px; font-weight: bold; color: ${design.primaryColor || "#4f46e5"};">${design.footerNotes}</div>
          </div>
          <div style="text-align: right; width: 150px; flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end;">
            <div style="height: 35px; min-width: 100px; display: flex; align-items: flex-end; justify-content: flex-end; margin-bottom: 6px;">
              ${design.signatureUrl ? `<img src="${design.signatureUrl}" alt="Signature" style="max-height: 35px; max-width: 120px;" />` : `<div style="height: 35px; width: 100px; border-bottom: 1px dashed #cbd5e1;"></div>`}
            </div>
            <strong style="color: #0f172a; font-size: 11px;">${design.signatureText}</strong>
            <span style="font-size: 10px; color: #94a3b8; margin-top: 1px;">For ${seller.companyName}</span>
          </div>
        </div>

      </div>
    `;

    return res.send(emailHtml);
  } catch (error) {
    return res.status(500).send("<h3>Could not render receipt preview layout.</h3>");
  }
};

import cloudinary from "../utils/cloudinary.js";
import { Readable } from "stream";

const uploadBufferToCloudinary = (buffer, options = {}) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      {
        resource_type: "image",
        folder: "classtech/signatures",
        ...options,
      },
      (error, result) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(result);
      },
    );
    Readable.from(buffer).pipe(uploadStream);
  });

export const uploadSignatoryImage = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No file uploaded" });
    }
    const result = await uploadBufferToCloudinary(req.file.buffer);
    return res.json({ signatureUrl: result.secure_url });
  } catch (error) {
    console.error("uploadSignatoryImage error:", error);
    return res.status(500).json({ message: "Could not upload signature image" });
  }
};

export const getAdsSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "ads_settings" });
    const defaults = {
      enableAds: false,
      adsenseClientId: "",
      adsenseCodeSnippet: "",
      adsTxtContent: "",
      adTuitions: [],
    };
    if (!setting) {
      return res.json(defaults);
    }
    let val = setting.value;
    if (typeof val === "string") {
      try {
        val = JSON.parse(val);
      } catch (e) {
        val = {};
      }
    }
    return res.json({
      enableAds: val.enableAds ?? defaults.enableAds,
      adsenseClientId: val.adsenseClientId || defaults.adsenseClientId,
      adsenseCodeSnippet: val.adsenseCodeSnippet || defaults.adsenseCodeSnippet,
      adsTxtContent: val.adsTxtContent || defaults.adsTxtContent,
      adTuitions: val.adTuitions || defaults.adTuitions,
    });
  } catch (error) {
    console.error("getAdsSettings error:", error);
    return res.status(500).json({ message: "Could not retrieve ads settings." });
  }
};

export const updateAdsSettings = async (req, res) => {
  try {
    const { enableAds, adsenseClientId, adsenseCodeSnippet, adsTxtContent, adTuitions } = req.body;
    const updatedValue = {
      enableAds: !!enableAds,
      adsenseClientId: adsenseClientId || "",
      adsenseCodeSnippet: adsenseCodeSnippet || "",
      adsTxtContent: adsTxtContent || "",
      adTuitions: Array.isArray(adTuitions) ? adTuitions : [],
    };

    let setting = await SystemSetting.findOne({ key: "ads_settings" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      await SystemSetting.create({
        key: "ads_settings",
        value: updatedValue,
        description: "Google AdSense verification and tuition target settings",
      });
    }
    try {
      await clearCachePattern("student:dashboard:*");
    } catch (cErr) {}
    return res.json(updatedValue);
  } catch (error) {
    console.error("updateAdsSettings error:", error);
    return res.status(500).json({ message: "Could not save ads settings." });
  }
};

export const getWebsiteSettings = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "website_settings" });
    if (!setting) {
      return res.json({ customMetaTags: "" });
    }
    return res.json(setting.value);
  } catch (error) {
    console.error("getWebsiteSettings error:", error);
    return res.status(500).json({ message: "Could not fetch website settings." });
  }
};

export const updateWebsiteSettings = async (req, res) => {
  try {
    const { customMetaTags } = req.body;
    const updatedValue = {
      customMetaTags: customMetaTags || "",
    };

    let setting = await SystemSetting.findOne({ key: "website_settings" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      await SystemSetting.create({
        key: "website_settings",
        value: updatedValue,
        description: "Custom SEO verification metadata and script tags",
      });
    }

    try {
      await clearCachePattern("student:dashboard:*");
    } catch (cErr) {}

    return res.json(updatedValue);
  } catch (error) {
    console.error("updateWebsiteSettings error:", error);
    return res.status(500).json({ message: "Could not save website settings." });
  }
};

export const getWalletInfo = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }
    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found." });
    }

    const payments = await CashfreePayment.find({ institute: instituteId, type: "wallet_recharge" }).sort({ createdAt: -1 });

    return res.json({
      walletBalance: institute.walletBalance || 0,
      perMessageCharge: institute.perMessageCharge || 0.10,
      history: payments
    });
  } catch (error) {
    console.error("getWalletInfo error:", error);
    return res.status(500).json({ message: "Could not fetch wallet details." });
  }
};

export const getWhatsappLogs = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }

    const { msgType } = req.query;
    const filter = { institute: instituteId };
    if (msgType && msgType !== "all") {
      filter.msgType = msgType;
    }

    const logs = await WhatsappLog.find(filter).sort({ createdAt: -1 }).limit(100);
    const mappedLogs = logs.map(l => {
      const doc = typeof l.toObject === "function" ? l.toObject() : l;
      return {
        ...doc,
        recipient: doc.to,
        message: doc.messageText
      };
    });
    return res.json({ logs: mappedLogs });
  } catch (error) {
    console.error("getWhatsappLogs error:", error);
    return res.status(500).json({ message: "Could not fetch WhatsApp logs." });
  }
};

export const createWalletRechargeSession = async (req, res) => {
  try {
    const { amount } = req.body;
    if (!amount || Number(amount) <= 0) {
      return res.status(400).json({ message: "Recharge amount must be greater than 0." });
    }

    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "No institute associated with this account." });
    }

    const institute = await Institute.findById(instituteId);
    if (!institute) {
      return res.status(404).json({ message: "Institute not found." });
    }

    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const cfOrderId = "wallet_" + crypto.randomUUID().replace(/-/g, "");

    let origin = req.headers.origin || "https://classtech-v1.up.railway.app";
    if (!origin.startsWith("https://")) {
      origin = "https://classtech-v1.up.railway.app";
    }
    const returnUrl = origin.includes("8080")
      ? `${origin}/#/dashboard?verify_wallet_id=${cfOrderId}`
      : `${origin}/dashboard?verify_wallet_id=${cfOrderId}`;

    const orderPayload = {
      order_id: cfOrderId,
      order_amount: Number(amount),
      order_currency: "INR",
      customer_details: {
        customer_id: String(instituteId),
        customer_name: institute.name || "Tuition Admin",
        customer_email: req.user.email || "support@classtech.com",
        customer_phone: req.user.phone || "9999999999",
      },
      order_meta: {
        return_url: returnUrl,
      },
    };

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const response = await axios.post(`${baseUrl}/orders`, orderPayload, { headers });

    await CashfreePayment.create({
      institute: instituteId,
      instituteName: institute.name,
      plan: "wallet_recharge",
      amount: Number(amount),
      type: "wallet_recharge",
      status: "pending",
      cfOrderId,
      paymentSessionId: response.data.payment_session_id,
      autoRenew: false,
    });

    return res.json({
      type: "wallet_recharge",
      cfOrderId,
      paymentSessionId: response.data.payment_session_id,
      paymentLink: response.data.payments?.url || response.data.payment_link || (environment === "production"
        ? `https://payments.cashfree.com/order/${response.data.payment_session_id}`
        : `https://payments-test.cashfree.com/order/${response.data.payment_session_id}`),
      environment,
    });
  } catch (error) {
    console.error("createWalletRechargeSession error:", error);
    return res.status(500).json({ message: "Could not create wallet recharge session." });
  }
};

export const verifyWalletRecharge = async (req, res) => {
  try {
    const { cfOrderId } = req.body;
    if (!cfOrderId) {
      return res.status(400).json({ message: "cfOrderId is required." });
    }

    const payment = await CashfreePayment.findOne({ cfOrderId, type: "wallet_recharge" });
    if (!payment) {
      return res.status(404).json({ message: "Recharge transaction record not found." });
    }

    if (payment.status === "success") {
      const institute = await Institute.findById(payment.institute);
      return res.json({ status: "success", walletBalance: institute?.walletBalance || 0 });
    }

    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const response = await axios.get(`${baseUrl}/orders/${cfOrderId}`, { headers });
    const rawData = response.data;
    let status = "pending";

    if (rawData.order_status === "PAID") {
      status = "success";
    } else if (["EXPIRED", "CANCELLED", "FAILED"].includes(rawData.order_status)) {
      status = "failed";
    }

    payment.status = status;
    payment.cfPaymentDetails = rawData;
    await payment.save();

    if (status === "success") {
      const institute = await Institute.findById(payment.institute);
      if (institute) {
        institute.walletBalance = (institute.walletBalance || 0) + Number(payment.amount);
        await institute.save();
        return res.json({ status: "success", walletBalance: institute.walletBalance });
      }
    }

    return res.json({ status });
  } catch (error) {
    console.error("verifyWalletRecharge error:", error);
    return res.status(500).json({ message: "Could not verify wallet recharge." });
  }
};
