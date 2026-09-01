import SystemSetting from "../models/SystemSetting.js";
import https from "https";
import crypto from "crypto";

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
        projectId: val.projectId || "",
        clientEmail: val.clientEmail || "",
        privateKey: val.privateKey ? val.privateKey.replace(/\\n/g, "\n") : "",
        serverKey: val.serverKey || "",
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
const getFcmAccessToken = async ({ clientEmail, privateKey }) => {
  try {
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const now = Math.floor(Date.now() / 1000);
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
                resolve(parsed.access_token);
              } else {
                reject(new Error(parsed.error_description || "Failed to get FCM access token"));
              }
            } catch (err) {
              reject(err);
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
 * Dispatch Push Notification via FCM to a target token or list of tokens
 */
export const sendFcmPushNotification = async ({ fcmTokens, title, body, data = {} }) => {
  try {
    if (!fcmTokens) return;
    const tokens = (Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens])
      .map((t) => (t ? String(t).trim() : ""))
      .filter((t) => t.length > 10);

    if (tokens.length === 0) return;

    const fcmConfig = await getFcmSettingsHelper();
    if (!fcmConfig.enabled) {
      return;
    }

    // Modern HTTP v1 API if Service Account is provided
    if (fcmConfig.projectId && fcmConfig.clientEmail && fcmConfig.privateKey) {
      const accessToken = await getFcmAccessToken(fcmConfig);
      const endpoint = `https://fcm.googleapis.com/v1/projects/${fcmConfig.projectId}/messages:send`;

      for (const token of tokens) {
        const payload = JSON.stringify({
          message: {
            token: token,
            notification: {
              title: title,
              body: body,
            },
            data: Object.fromEntries(
              Object.entries(data).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)])
            ),
            android: {
              priority: "high",
              notification: {
                sound: "default",
                channel_id: "high_importance_channel",
              },
            },
          },
        });

        const req = https.request(endpoint, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
        });
        req.on("error", (e) => console.error("FCM send error:", e.message));
        req.write(payload);
        req.end();
      }
    } else if (fcmConfig.serverKey) {
      // Legacy Server Key API
      const endpoint = "https://fcm.googleapis.com/fcm/send";
      for (const token of tokens) {
        const payload = JSON.stringify({
          to: token,
          notification: {
            title,
            body,
            sound: "default",
          },
          data,
          priority: "high",
        });

        const req = https.request(endpoint, {
          method: "POST",
          headers: {
            Authorization: `key=${fcmConfig.serverKey}`,
            "Content-Type": "application/json",
          },
        });
        req.on("error", (e) => console.error("FCM legacy send error:", e.message));
        req.write(payload);
        req.end();
      }
    }
  } catch (err) {
    console.error("sendFcmPushNotification error:", err.message);
  }
};
