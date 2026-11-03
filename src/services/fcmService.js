import SystemSetting from "../models/SystemSetting.js";
import https from "https";
import crypto from "crypto";

// In-memory cache for OAuth2 access token
let cachedOAuth = {
  token: null,
  expiresAt: 0,
};

/**
 * Helper to get active FCM configuration set by Super Admin
 */
export const getFcmSettingsHelper = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "fcm_settings" });
    if (setting && setting.value) {
      let val = setting.value;
      if (typeof val === "string") {
        try {
          val = JSON.parse(val);
        } catch (_) {}
      }
      return {
        projectId: String(val.projectId || "").trim(),
        clientEmail: String(val.clientEmail || "").trim(),
        privateKey: val.privateKey ? String(val.privateKey).replace(/\\n/g, "\n").trim() : "",
        serverKey: String(val.serverKey || "").trim(),
        enabled: val.enabled !== false,
      };
    }
  } catch (e) {
    console.error("getFcmSettingsHelper error:", e.message);
  }
  return { projectId: "", clientEmail: "", privateKey: "", serverKey: "", enabled: false };
};

/**
 * Generate OAuth2 Bearer token for FCM HTTP v1 API
 */
export const getFcmAccessToken = async ({ clientEmail, privateKey }) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    // Reuse cached token if valid for at least another 90 seconds
    if (cachedOAuth.token && cachedOAuth.expiresAt > now + 90) {
      return cachedOAuth.token;
    }

    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const claim = Buffer.from(
      JSON.stringify({
        iss: clientEmail,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        exp: now + 3600,
        iat: now,
      })
    ).toString("base64url");

    const signatureInput = `${header}.${claim}`;
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signatureInput);
    const signature = signer.sign(privateKey, "base64url");

    const jwtToken = `${signatureInput}.${signature}`;

    return new Promise((resolve, reject) => {
      const postData = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwtToken,
      }).toString();

      const req = https.request(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            try {
              const parsed = JSON.parse(data);
              if (parsed.access_token) {
                cachedOAuth.token = parsed.access_token;
                cachedOAuth.expiresAt = now + (Number(parsed.expires_in) || 3600);
                resolve(parsed.access_token);
              } else {
                reject(new Error(parsed.error_description || parsed.error || "Failed to get FCM access token"));
              }
            } catch (err) {
              reject(new Error(`Failed to parse OAuth response: ${err.message}`));
            }
          });
        }
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });
  } catch (err) {
    throw err;
  }
};

/**
 * Test stored or provided FCM credentials
 */
export const testFcmCredentials = async (overrideConfig = null) => {
  try {
    const fcmConfig = overrideConfig || (await getFcmSettingsHelper());
    if (fcmConfig.projectId && fcmConfig.clientEmail && fcmConfig.privateKey) {
      const token = await getFcmAccessToken(fcmConfig);
      return {
        success: true,
        type: "v1",
        message: "Firebase Service Account authenticated successfully! OAuth2 access token verified.",
      };
    } else if (fcmConfig.serverKey) {
      return new Promise((resolve) => {
        const payload = JSON.stringify({ registration_ids: ["dry_run_test_token"], dry_run: true });
        const req = https.request(
          "https://fcm.googleapis.com/fcm/send",
          {
            method: "POST",
            headers: {
              Authorization: `key=${fcmConfig.serverKey}`,
              "Content-Type": "application/json",
            },
          },
          (res) => {
            if (res.statusCode === 200 || res.statusCode === 400) {
              resolve({
                success: true,
                type: "legacy",
                message: "FCM Legacy Server Key authenticated successfully!",
              });
            } else if (res.statusCode === 401) {
              resolve({
                success: false,
                message: "FCM Server Key is unauthorized (HTTP 401). Please check the serverKey.",
              });
            } else {
              resolve({
                success: false,
                message: `FCM returned HTTP ${res.statusCode}`,
              });
            }
          }
        );
        req.on("error", (e) => resolve({ success: false, message: e.message }));
        req.write(payload);
        req.end();
      });
    }
    return {
      success: false,
      message: "No FCM credentials configured. Provide Service Account credentials or Server Key in Settings.",
    };
  } catch (err) {
    return {
      success: false,
      message: `FCM test failed: ${err.message}`,
    };
  }
};

/**
 * Dispatch Push Notification via FCM to a target token or list of tokens
 */
export const sendFcmPushNotification = async ({
  fcmTokens,
  title,
  body,
  imageUrl = "",
  actionUrl = "",
  data = {},
  priority = "high",
}) => {
  try {
    if (!fcmTokens) return { targetCount: 0, successCount: 0, failureCount: 0 };
    const tokens = (Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens])
      .map((t) => (t ? String(t).trim() : ""))
      .filter((t) => t.length > 10);

    const uniqueTokens = Array.from(new Set(tokens));
    if (uniqueTokens.length === 0) {
      return { targetCount: 0, successCount: 0, failureCount: 0 };
    }

    const fcmConfig = await getFcmSettingsHelper();
    if (!fcmConfig.enabled) {
      console.log("FCM Push Notifications disabled in System Settings.");
      return { targetCount: uniqueTokens.length, successCount: 0, failureCount: 0, message: "Disabled" };
    }

    let successCount = 0;
    let failureCount = 0;
    const errors = [];

    // Modern HTTP v1 API
    if (fcmConfig.projectId && fcmConfig.clientEmail && fcmConfig.privateKey) {
      const accessToken = await getFcmAccessToken(fcmConfig);
      const endpoint = `https://fcm.googleapis.com/v1/projects/${fcmConfig.projectId}/messages:send`;

      const notificationPayload = {
        title: String(title || "").trim(),
        body: String(body || "").trim(),
        ...(imageUrl ? { image: String(imageUrl).trim() } : {}),
      };

      const mergedData = {
        title: String(title || "").trim(),
        body: String(body || "").trim(),
        ...(actionUrl ? { actionUrl: String(actionUrl).trim() } : {}),
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])
        ),
      };

      // Send to tokens with concurrency limit
      const sendSingle = (token) => {
        return new Promise((resolve) => {
          const payload = JSON.stringify({
            message: {
              token: token,
              notification: notificationPayload,
              data: mergedData,
              android: {
                priority: priority === "high" ? "HIGH" : "NORMAL",
                notification: {
                  sound: "default",
                  channel_id: "high_importance_channel",
                  notification_priority: priority === "high" ? "PRIORITY_HIGH" : "PRIORITY_DEFAULT",
                  ...(imageUrl ? { image: String(imageUrl).trim() } : {}),
                },
              },
              webpush: {
                notification: {
                  icon: "/logo.png",
                  badge: "/logo.png",
                  ...(imageUrl ? { image: String(imageUrl).trim() } : {}),
                },
              },
            },
          });

          const req = https.request(
            endpoint,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${accessToken}`,
                "Content-Type": "application/json",
              },
            },
            (res) => {
              let resBody = "";
              res.on("data", (c) => (resBody += c));
              res.on("end", () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                  resolve({ success: true });
                } else {
                  resolve({ success: false, status: res.statusCode, body: resBody });
                }
              });
            }
          );
          req.on("error", (e) => resolve({ success: false, error: e.message }));
          req.write(payload);
          req.end();
        });
      };

      // Process in batches of 25
      const chunkSize = 25;
      for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
        const chunk = uniqueTokens.slice(i, i + chunkSize);
        const results = await Promise.allSettled(chunk.map((t) => sendSingle(t)));
        for (const r of results) {
          if (r.status === "fulfilled" && r.value.success) {
            successCount++;
          } else {
            failureCount++;
            if (r.status === "fulfilled" && r.value.body) {
              errors.push(r.value.body.substring(0, 150));
            } else if (r.status === "rejected") {
              errors.push(r.reason?.message || "Send failed");
            }
          }
        }
      }
    } else if (fcmConfig.serverKey) {
      // Legacy Server Key API (supports batch registration_ids up to 1000 per request)
      const endpoint = "https://fcm.googleapis.com/fcm/send";
      const chunkSize = 500;

      for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
        const chunk = uniqueTokens.slice(i, i + chunkSize);
        const payload = JSON.stringify({
          registration_ids: chunk,
          notification: {
            title: String(title || "").trim(),
            body: String(body || "").trim(),
            sound: "default",
            ...(imageUrl ? { image: String(imageUrl).trim() } : {}),
          },
          data: {
            title: String(title || "").trim(),
            body: String(body || "").trim(),
            ...(actionUrl ? { actionUrl: String(actionUrl).trim() } : {}),
            ...data,
          },
          priority: priority === "high" ? "high" : "normal",
        });

        await new Promise((resolve) => {
          const req = https.request(
            endpoint,
            {
              method: "POST",
              headers: {
                Authorization: `key=${fcmConfig.serverKey}`,
                "Content-Type": "application/json",
              },
            },
            (res) => {
              let resData = "";
              res.on("data", (c) => (resData += c));
              res.on("end", () => {
                try {
                  const parsed = JSON.parse(resData);
                  successCount += Number(parsed.success || 0);
                  failureCount += Number(parsed.failure || 0);
                } catch (_) {
                  if (res.statusCode === 200) successCount += chunk.length;
                  else failureCount += chunk.length;
                }
                resolve();
              });
            }
          );
          req.on("error", (e) => {
            console.error("FCM legacy send error:", e.message);
            failureCount += chunk.length;
            errors.push(e.message);
            resolve();
          });
          req.write(payload);
          req.end();
        });
      }
    } else {
      console.warn("FCM Push skipped: No credentials configured (project credentials or serverKey missing).");
      return { targetCount: uniqueTokens.length, successCount: 0, failureCount: uniqueTokens.length, message: "No credentials" };
    }

    return {
      targetCount: uniqueTokens.length,
      successCount,
      failureCount,
      errors: errors.slice(0, 5),
    };
  } catch (err) {
    console.error("sendFcmPushNotification error:", err.message);
    return { targetCount: 0, successCount: 0, failureCount: 0, error: err.message };
  }
};
