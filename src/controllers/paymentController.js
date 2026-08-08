import SystemSetting from "../models/SystemSetting.js";
import { clearCachePattern } from "../utils/cache.js";
import CashfreePayment from "../models/CashfreePayment.js";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import { resolveSubscriptionEnd } from "../utils/subscription.js";
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
    const { plan, tier, type } = req.body;
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
          return_url: `${process.env.CLIENT_URL || "http://localhost:5173"}/subscription-expired?verify_id=${cfOrderId}`,
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
      });

      return res.json({
        type: "one_time",
        cfOrderId,
        paymentSessionId: response.data.payment_session_id,
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
        // Extract plain plan coverage cycle (monthly, quarterly, yearly)
        const parts = payment.plan.split("_");
        const coveragePlan = parts[1] || "monthly";

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
            const parts = payment.plan.split("_");
            const coveragePlan = parts[1] || "monthly";
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
    });
  } catch (error) {
    console.error("getPaymentDetailsForInstitute error:", error);
    return res.status(500).json({ message: "Could not fetch payment configuration details." });
  }
};
