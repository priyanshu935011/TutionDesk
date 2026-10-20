import axios from "axios";

/**
 * Dispatch instant admin notifications to Telegram and/or Slack
 * when a teacher or staff member raises a support ticket / bug report.
 */
export async function sendAdminTicketAlert(ticket) {
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;

  const {
    ticketNumber,
    userName,
    userPhone,
    userRole,
    instituteName,
    category,
    subject,
    description,
    deviceInfo,
    attachments,
    priority,
  } = ticket;

  const deviceStr = deviceInfo
    ? `${deviceInfo.platform || "Device"} • App v${deviceInfo.appVersion || "1.0.0"}`
    : "Not specified";

  const attachmentUrls = Array.isArray(attachments) && attachments.length > 0
    ? attachments.map((a, i) => `[Attachment ${i + 1}](${a})`).join(", ")
    : "None";

  // 1. Telegram Dispatch
  if (telegramToken && telegramChatId) {
    try {
      const telegramText = 
`🚨 *New ClassTech Support Ticket*
━━━━━━━━━━━━━━━━━━━━
🎫 *Ticket:* #${ticketNumber || "N/A"}
👤 *User:* ${userName || "Educator"} (${userRole || "Teacher"})
📞 *Phone:* ${userPhone || "Not provided"}
🏫 *Institute:* ${instituteName || "ClassTech Tuition"}
📂 *Category:* ${category || "General"}
⚡ *Priority:* ${priority || "NORMAL"}
━━━━━━━━━━━━━━━━━━━━
📌 *Subject:* ${subject}
📝 *Description:*
${description}

📱 *Device:* ${deviceStr}
📎 *Attachments:* ${attachmentUrls}
━━━━━━━━━━━━━━━━━━━━`;

      await axios.post(
        `https://api.telegram.org/bot${telegramToken}/sendMessage`,
        {
          chat_id: telegramChatId,
          text: telegramText,
          parse_mode: "Markdown",
          disable_web_page_preview: false,
        },
        { timeout: 8000 }
      );
      console.log(`[AdminAlertService] Telegram notification sent for ticket #${ticketNumber}`);
    } catch (teleErr) {
      console.warn("[AdminAlertService] Telegram alert failed:", teleErr.message);
    }
  }

  // 2. Slack Webhook Dispatch
  if (slackWebhookUrl) {
    try {
      const slackPayload = {
        text: `🚨 *New Support Ticket #${ticketNumber}* - ${subject}`,
        blocks: [
          {
            type: "header",
            text: {
              type: "plain_text",
              text: `🚨 New Support Ticket: #${ticketNumber}`,
              emoji: true,
            },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*User:*\n${userName || "Educator"} (${userPhone || "N/A"})` },
              { type: "mrkdwn", text: `*Institute:*\n${instituteName || "ClassTech Tuition"}` },
              { type: "mrkdwn", text: `*Category:*\n${category}` },
              { type: "mrkdwn", text: `*Priority:*\n${priority || "NORMAL"}` },
              { type: "mrkdwn", text: `*Device:*\n${deviceStr}` },
              { type: "mrkdwn", text: `*Attachments:*\n${attachmentUrls}` },
            ],
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Subject:* ${subject}\n*Description:*\n>${description.replace(/\n/g, "\n>")}`,
            },
          },
        ],
      };

      await axios.post(slackWebhookUrl, slackPayload, { timeout: 8000 });
      console.log(`[AdminAlertService] Slack webhook dispatched for ticket #${ticketNumber}`);
    } catch (slackErr) {
      console.warn("[AdminAlertService] Slack alert failed:", slackErr.message);
    }
  }
}
