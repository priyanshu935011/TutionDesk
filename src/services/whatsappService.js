import SystemSetting from "../models/SystemSetting.js";

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
  return null;
};

export const initializeSession = async (instituteId) => {
  const creds = await getMetaCredentials();
  if (creds) {
    return { status: "connected" };
  }
  return { status: "disconnected", qr: null };
};

export const getSessionStatus = async (instituteId) => {
  const creds = await getMetaCredentials();
  if (creds) {
    return { status: "connected", qr: null };
  }
  return { status: "disconnected", qr: null };
};

export const logoutSession = async (instituteId) => {
  return { success: true };
};

export const sendMessage = async (instituteId, to, text) => {
  const creds = await getMetaCredentials();
  if (!creds) {
    console.warn(`WhatsApp skip send to ${to}: Meta Cloud API not configured.`);
    return { success: false, message: "Meta API not configured." };
  }

  const cleanNumber = formatPhoneNumber(to);
  const { accessToken, phoneNumberId } = creds;

  console.log(`Sending Meta WhatsApp message to ${cleanNumber}...`);

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
        type: "text",
        text: {
          preview_url: false,
          body: text
        }
      })
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || "Failed to send WhatsApp message via Meta API");
    }

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.error(`Meta WhatsApp send text error to ${cleanNumber}:`, err.message);
    throw err;
  }
};

export const sendDocument = async (instituteId, to, fileBuffer, fileName, caption = "") => {
  const creds = await getMetaCredentials();
  if (!creds) {
    console.warn(`WhatsApp skip document send to ${to}: Meta Cloud API not configured.`);
    return { success: false, message: "Meta API not configured." };
  }

  const cleanNumber = formatPhoneNumber(to);
  const { accessToken, phoneNumberId } = creds;

  console.log(`Uploading Meta WhatsApp media file ${fileName}...`);

  try {
    // 1. Upload the PDF file buffer to Meta media endpoint
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

    // 2. Send the document message referencing the media ID
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
    console.error(`Meta WhatsApp send document error to ${cleanNumber}:`, err.message);
    throw err;
  }
};

export const sendTemplateMessage = async (instituteId, to, templateName, parameters) => {
  const creds = await getMetaCredentials();
  if (!creds) {
    console.warn(`WhatsApp template skip to ${to}: Meta Cloud API not configured.`);
    return { success: false, message: "Meta API not configured." };
  }

  const cleanNumber = formatPhoneNumber(to);
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

    return { success: true, messageId: data.messages?.[0]?.id };
  } catch (err) {
    console.error(`Meta WhatsApp template error to ${cleanNumber}:`, err.message);
    throw err;
  }
};

export const reconnectAllSessions = async () => {
  // Baileys auto-reconnect is deprecated since we use the centralized Meta API.
  return;
};
