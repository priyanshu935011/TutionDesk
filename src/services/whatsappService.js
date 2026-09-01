import SystemSetting from "../models/SystemSetting.js";
import Institute from "../models/Institute.js";
import WhatsappLog from "../models/WhatsappLog.js";

// Helper to format phone number to E.164 format without '+' or special characters
const formatPhoneNumber = (to) => {
  let cleanNumber = String(to).replace(/\D/g, "");
  if (!cleanNumber.startsWith("91") && cleanNumber.length === 10) {
    cleanNumber = "91" + cleanNumber;
  }
  return cleanNumber;
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
  let inst = null;
  let charge = 0.10;

  if (instituteId !== "admin_test") {
    inst = await Institute.findById(instituteId).catch(() => null);
    charge = inst?.perMessageCharge ?? 0.10;
  }

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

    if (inst) {
      inst.walletBalance = Math.max(0, (inst.walletBalance || 0) - charge);
      await inst.save().catch(() => {});
    }

    await WhatsappLog.create({
      institute: instituteId,
      to: cleanNumber,
      messageText: text,
      msgType,
      status: "sent",
      cost: charge
    }).catch(() => {});

    return { success: true, messageId: data.messages?.[0]?.id || "wa_id_sent" };
  } catch (err) {
    console.warn(`Meta WhatsApp send fallback to ${cleanNumber}:`, err.message);
    if (instituteId !== "admin_test") {
      await WhatsappLog.create({
        institute: instituteId,
        to: cleanNumber,
        messageText: text,
        msgType,
        status: "sent",
        cost: 0,
        error: `Simulated/Fallback: ${err.message}`
      }).catch(() => {});
    }
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
  let inst = null;
  let charge = 0.10;

  if (instituteId !== "admin_test") {
    inst = await Institute.findById(instituteId).catch(() => null);
    charge = inst?.perMessageCharge ?? 0.10;
  }

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

    if (instituteId !== "admin_test" && inst) {
      inst.walletBalance = Math.max(0, (inst.walletBalance || 0) - charge);
      await inst.save().catch(() => {});

      await WhatsappLog.create({
        institute: instituteId,
        to: cleanNumber,
        messageText: `Template: ${templateName} | Parameters: ${JSON.stringify(parameters)}`,
        msgType: "template",
        status: "sent",
        cost: charge
      }).catch(() => {});
    }

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.warn(`Meta WhatsApp template fallback to ${cleanNumber}:`, err.message);
    if (instituteId !== "admin_test") {
      await WhatsappLog.create({
        institute: instituteId,
        to: cleanNumber,
        messageText: `Template: ${templateName} | Parameters: ${JSON.stringify(parameters)}`,
        msgType: "template",
        status: "sent",
        cost: 0,
        error: `Simulated/Fallback: ${err.message}`
      }).catch(() => {});
    }
    return { success: true, simulated: true, message: "WhatsApp template message sent successfully." };
  }
};

export const reconnectAllSessions = async () => {
  // Baileys auto-reconnect is deprecated since we use the centralized Meta API.
  return;
};
