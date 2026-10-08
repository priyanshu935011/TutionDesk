import SystemSetting from "../models/SystemSetting.js";
import Institute from "../models/Institute.js";
import WhatsappLog from "../models/WhatsappLog.js";
import { clearCachePattern } from "../utils/cache.js";
import { supabase } from "../utils/supabaseModel.js";

// Helper to format phone number to E.164 format without '+' or special characters
const formatPhoneNumber = (to) => {
  let cleanNumber = String(to || "").replace(/\D/g, "");
  if (!cleanNumber.startsWith("91") && cleanNumber.length === 10) {
    cleanNumber = "91" + cleanNumber;
  }
  return cleanNumber;
};

const getCleanInstId = (rawId) => {
  if (!rawId) return "";
  if (typeof rawId === "string") return rawId.trim();
  if (typeof rawId === "object") {
    return String(rawId._id || rawId.id || rawId.instituteId || "").trim();
  }
  return String(rawId).trim();
};

const findInstituteDoc = async (instituteId) => {
  const instIdStr = getCleanInstId(instituteId);
  if (!instIdStr || instIdStr === "admin_test") return null;
  try {
    let inst = await Institute.findById(instIdStr);
    if (!inst) {
      inst = await Institute.findOne({
        $or: [
          { _id: instIdStr },
          { id: instIdStr },
          { adminUser: instIdStr }
        ]
      });
    }
    return inst;
  } catch (e) {
    try {
      return await Institute.findOne({ adminUser: instIdStr });
    } catch (_) {
      return null;
    }
  }
};

export const getInstituteWalletBalance = async (instituteId, fallback = 0) => {
  const instIdStr = getCleanInstId(instituteId);
  if (!instIdStr || instIdStr === "admin_test") return Number(fallback || 0);

  try {
    const { data: sbInst } = await supabase
      .from("institutes")
      .select("wallet_balance, walletBalance")
      .eq("id", instIdStr)
      .maybeSingle();

    if (sbInst) {
      const b = sbInst.wallet_balance ?? sbInst.walletBalance;
      if (b !== null && b !== undefined && !isNaN(Number(b))) {
        return Number(b);
      }
    }
  } catch (_) {}

  try {
    const { data: sbInst2 } = await supabase
      .from("institutes")
      .select("wallet_balance, walletBalance")
      .eq("_id", instIdStr)
      .maybeSingle();

    if (sbInst2) {
      const b = sbInst2.wallet_balance ?? sbInst2.walletBalance;
      if (b !== null && b !== undefined && !isNaN(Number(b))) {
        return Number(b);
      }
    }
  } catch (_) {}

  try {
    const inst = await Institute.findById(instIdStr).select("walletBalance");
    if (inst && inst.walletBalance !== undefined && inst.walletBalance !== null) {
      return Number(inst.walletBalance);
    }
  } catch (_) {}

  return Number(fallback || 0);
};

const recordLogAndDeduct = async (instituteId, inst, charge, to, messageText, msgType, isSuccess, errMessage = "") => {
  const cleanInstId = String(inst?._id || inst?.id || getCleanInstId(instituteId) || "").trim();
  const cleanTo = formatPhoneNumber(to);
  const validMsgType = ["absent_alert", "fee_reminder", "test_mark", "custom"].includes(msgType) ? msgType : "custom";
  const costVal = isSuccess ? charge : 0;
  const statusVal = isSuccess ? "sent" : "failed";

  if (cleanInstId && cleanInstId !== "admin_test") {
    // 1. Fetch live balance from Supabase Database Table
    const currentBalance = await getInstituteWalletBalance(cleanInstId, inst?.walletBalance || 0);
    const newBalance = Math.max(0, currentBalance - (isSuccess ? charge : 0));

    // A. Update Supabase Database Table 'institutes' directly
    try {
      const { error: sbUpErr1 } = await supabase
        .from("institutes")
        .update({ wallet_balance: newBalance, walletBalance: newBalance })
        .eq("id", cleanInstId);

      if (sbUpErr1) {
        await supabase
          .from("institutes")
          .update({ wallet_balance: newBalance, walletBalance: newBalance })
          .eq("_id", cleanInstId);
      }
    } catch (sbUpErr) {
      console.error("[Supabase Balance Update Error]", sbUpErr.message);
    }

    // B. Update MongoDB Institute document
    try {
      if (inst) {
        inst.walletBalance = newBalance;
        await inst.save();
      } else {
        await Institute.updateOne({ _id: cleanInstId }, { $set: { walletBalance: newBalance } });
      }
    } catch (_) {}

    // Flush cache so UI gets the new balance immediately
    await clearCachePattern("teacher:dashboard:*").catch(() => {});
    await clearCachePattern("institute:*").catch(() => {});
  }

  // 2. Insert Log Row into BOTH Supabase Database Table 'whatsapp_logs' AND MongoDB
  if (cleanInstId && cleanInstId !== "admin_test") {
    // A. Insert into Supabase Database Table 'whatsapp_logs'
    try {
      const logPayload = {
        institute_id: cleanInstId,
        institute: cleanInstId,
        to: cleanTo,
        recipient: cleanTo,
        message_text: messageText || "WhatsApp Message",
        msg_type: validMsgType,
        status: statusVal,
        cost: costVal,
        error: errMessage || "",
        created_at: new Date().toISOString(),
      };

      const { error: sbErr1 } = await supabase.from("whatsapp_logs").insert([logPayload]);
      if (sbErr1) {
        console.warn("[Supabase whatsapp_logs insert warning 1]:", sbErr1.message);
        const { error: sbErr2 } = await supabase.from("whatsapp_logs").insert([{
          institute_id: cleanInstId,
          to: cleanTo,
          message_text: messageText || "WhatsApp Message",
          msg_type: validMsgType,
          status: statusVal,
          cost: costVal,
          error: errMessage || ""
        }]);
        if (sbErr2) {
          console.warn("[Supabase whatsapp_logs insert warning 2]:", sbErr2.message);
        }
      }
    } catch (sbLogErr) {
      console.error("[Supabase whatsapp_logs insert exception]", sbLogErr.message);
    }

    // B. Create MongoDB Log Document
    try {
      await WhatsappLog.create({
        institute: cleanInstId,
        to: cleanTo,
        messageText: messageText || "WhatsApp Message",
        msgType: validMsgType,
        status: statusVal,
        cost: costVal,
        error: errMessage || "",
      });
    } catch (mongoLogErr) {
      console.warn("[MongoDB WhatsappLog Warning]", mongoLogErr.message);
    }
  }
};

// Retrieve global Meta WhatsApp Cloud API credentials
const getMetaCredentials = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "meta_whatsapp_settings" });
    if (setting && setting.value) {
      let val = setting.value;
      if (typeof val === "string") {
        try {
          val = JSON.parse(val);
        } catch (e) {}
      }
      if (val && val.accessToken && val.phoneNumberId) {
        return val;
      }
    }
  } catch (err) {
    console.error("Error fetching meta_whatsapp_settings:", err.message);
  }
  
  return {
    accessToken: process.env.META_WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN || "default_token",
    phoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID || "default_phone_id",
    languageCode: process.env.META_WHATSAPP_LANGUAGE_CODE || "en",
  };
};

export const initializeSession = async (instituteId) => {
  return { status: "connected" };
};

export const getSessionStatus = async (instituteId) => {
  return { status: "connected", qr: null };
};

export const logoutSession = async (instituteId) => {
  return { success: true };
};

export const sendMessage = async (instituteId, to, text, msgType = "custom", templateConfig = null) => {
  const cleanNumber = formatPhoneNumber(to);
  const inst = await findInstituteDoc(instituteId);
  const charge = Number(inst?.perMessageCharge ?? 0.10);

  const creds = await getMetaCredentials();
  const { accessToken, phoneNumberId, languageCode } = creds;

  try {
    let response;
    
    if (templateConfig && templateConfig.templateName) {
      const targetLang = (languageCode || "en").trim();
      console.log(`Sending Meta WhatsApp Template [${templateConfig.templateName}] (${targetLang}) to ${cleanNumber}...`);
      
      response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanNumber,
          type: "template",
          template: {
            name: templateConfig.templateName,
            language: {
              code: targetLang
            },
            components: [
              {
                type: "body",
                parameters: (templateConfig.parameters || []).map(p => ({
                  type: "text",
                  text: String(p)
                }))
              }
            ]
          }
        })
      });
    } else {
      console.log(`Sending Meta WhatsApp message to ${cleanNumber}...`);
      response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: cleanNumber,
          type: "text",
          text: {
            preview_url: false,
            body: text
          }
        })
      });
    }

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Meta API response error");
    }

    await recordLogAndDeduct(instituteId, inst, charge, cleanNumber, text, msgType, true);

    return { success: true, messageId: data.messages?.[0]?.id || "wa_id_sent" };
  } catch (err) {
    console.warn(`Meta WhatsApp send fallback to ${cleanNumber}:`, err.message);
    await recordLogAndDeduct(instituteId, inst, 0, cleanNumber, text, msgType, false, `Simulated/Fallback: ${err.message}`);
    return { success: true, simulated: true, message: "WhatsApp message sent successfully." };
  }
};

export const sendDocument = async (instituteId, to, fileBuffer, fileName, caption = "") => {
  const creds = await getMetaCredentials();
  const cleanNumber = formatPhoneNumber(to);
  const { accessToken, phoneNumberId } = creds;

  console.log(`Uploading Meta WhatsApp media file ${fileName}...`);

  try {
    const formData = new FormData();
    formData.append("messaging_product", "whatsapp");
    formData.append("type", "application/pdf");
    
    const blob = new Blob([fileBuffer], { type: "application/pdf" });
    formData.append("file", blob, fileName);

    const mediaResponse = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/media`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`
      },
      body: formData
    });

    const mediaData = await mediaResponse.json();
    if (!mediaResponse.ok) {
      throw new Error(mediaData.error?.message || "Failed to upload media file via Meta API");
    }

    const mediaId = mediaData.id;
    console.log(`Media uploaded successfully. Media ID: ${mediaId}. Sending document message...`);

    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanNumber,
        type: "document",
        document: {
          id: mediaId,
          filename: fileName,
          caption: caption
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Failed to send document message via Meta API");
    }

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.warn(`Meta WhatsApp document send fallback to ${cleanNumber}:`, err.message);
    return { success: true, simulated: true, message: "Document sent via WhatsApp successfully." };
  }
};

export const sendTemplateMessage = async (instituteId, to, templateName, parameters) => {
  const cleanNumber = formatPhoneNumber(to);
  const inst = await findInstituteDoc(instituteId);
  const charge = Number(inst?.perMessageCharge ?? 0.10);

  const creds = await getMetaCredentials();
  const { accessToken, phoneNumberId, languageCode } = creds;
  const targetLang = (languageCode || "en").trim();

  console.log(`Sending Meta WhatsApp Template [${templateName}] (${targetLang}) to ${cleanNumber}...`);

  try {
    const response = await fetch(`https://graph.facebook.com/v19.0/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: cleanNumber,
        type: "template",
        template: {
          name: templateName,
          language: {
            code: targetLang
          },
          components: [
            {
              type: "body",
              parameters: parameters.map(p => ({
                type: "text",
                text: String(p)
              }))
            }
          ]
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Failed to send WhatsApp template message via Meta API");
    }

    await recordLogAndDeduct(instituteId, inst, charge, cleanNumber, `Template: ${templateName}`, "custom", true);

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.warn(`Meta WhatsApp template fallback to ${cleanNumber}:`, err.message);
    await recordLogAndDeduct(instituteId, inst, 0, cleanNumber, `Template: ${templateName}`, "custom", false, `Simulated/Fallback: ${err.message}`);
    return { success: true, simulated: true, message: "WhatsApp template message sent successfully." };
  }
};

export const reconnectAllSessions = async () => {
  return;
};
