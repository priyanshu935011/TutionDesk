import nodemailer from "nodemailer";
import SystemSetting from "../models/SystemSetting.js";

export const getSmtpConfig = async () => {
  try {
    const setting = await SystemSetting.findOne({ key: "smtp_settings" });
    if (setting && setting.value) {
      let val = setting.value;
      if (typeof val === "string") {
        try {
          val = JSON.parse(val);
        } catch (e) {
          val = {};
        }
      }
      return {
        host: val.host || process.env.SMTP_HOST,
        port: val.port || process.env.SMTP_PORT || 587,
        user: val.user || process.env.SMTP_USER,
        pass: val.pass || process.env.SMTP_PASS,
        from: val.from || process.env.SMTP_FROM || `"Classtech" <support@classtech.in>`,
        brevoApiKey: val.brevoApiKey || process.env.BREVO_API_KEY
      };
    }
  } catch (error) {
    console.error("Error reading SMTP settings from DB, using fallback:", error);
  }
  return {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || `"Classtech" <support@classtech.in>`,
    brevoApiKey: process.env.BREVO_API_KEY
  };
};

export const sendResetEmail = async (email, name, resetLink) => {
  const config = await getSmtpConfig();
  const host = config.host;
  const port = config.port;
  const user = config.user;
  const pass = config.pass;
  let from = config.from;
  if (from.includes("classtech.in")) {
    from = from.replace("classtech.in", "classtech.in");
  }

  console.log(`\n==================================================`);
  console.log(`PASSWORD RESET EMAIL REQUEST FOR: ${name} (${email})`);
  console.log(`Reset Link: ${resetLink}`);
  console.log(`==================================================\n`);

  if (!host || !user || !pass) {
    console.log("SMTP configurations not complete. Logged reset email link above.");
    return;
  }

  // Parse sender name and email from the "from" string
  let senderName = "Classtech";
  let senderEmail = "support@classtech.in";
  const fromMatch = from.match(/^"([^"]+)"\s*<([^>]+)>$/);
  if (fromMatch) {
    senderName = fromMatch[1];
    senderEmail = fromMatch[2];
  } else {
    const emailOnlyMatch = from.match(/<([^>]+)>/);
    if (emailOnlyMatch) {
      senderEmail = emailOnlyMatch[1];
    } else if (from.includes("@")) {
      senderEmail = from.trim();
    }
  }

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">Classtech Password Reset</h2>
      <p>Hello ${name},</p>
      <p>You requested a password reset for your account at Classtech.</p>
      <p>Please click the button below to reset your password. This link is valid for 1 hour.</p>
      <div style="margin: 30px 0; text-align: center;">
        <a href="${resetLink}" style="background-color: #4f46e5; color: white; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 8px; display: inline-block;">Reset Password</a>
      </div>
      <p>If the button doesn't work, copy and paste the following link into your browser:</p>
      <p style="word-break: break-all; color: #64748b;">${resetLink}</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">If you did not request this password reset, please ignore this email.</p>
    </div>
  `;

  try {
    console.log("Attempting to send email via Brevo HTTP REST API (port 443)...");
    const apiKey = config.brevoApiKey || pass;
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
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [
          {
            email: email,
            name: name,
          },
        ],
        subject: "Reset your Classtech Password",
        htmlContent: emailHtml,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const responseData = await response.json();
      console.log("Email sent successfully via Brevo HTTP API. Message ID:", responseData.messageId);
      return;
    } else {
      const errorText = await response.text();
      console.warn("Brevo HTTP API sending failed, status:", response.status, "body:", errorText);
      throw new Error(`Brevo HTTP API status ${response.status}: ${errorText}`);
    }
  } catch (apiError) {
    console.warn("Brevo HTTP API failed or timed out. Falling back to SMTP connection...", apiError.message);

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: {
        user,
        pass,
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });

    const mailOptions = {
      from,
      to: email,
      subject: "Reset your Classtech Password",
      html: emailHtml,
    };

    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully via SMTP fallback.");
  }
};

export const sendOTPEmail = async (email, name, otp) => {
  const config = await getSmtpConfig();
  const host = config.host;
  const port = config.port;
  const user = config.user;
  const pass = config.pass;
  let from = config.from;
  if (from.includes("classtech.in")) {
    from = from.replace("classtech.in", "classtech.in");
  }

  console.log(`\n==================================================`);
  console.log(`PASSWORD RESET OTP REQUEST FOR: ${name} (${email})`);
  console.log(`OTP Code: ${otp}`);
  console.log(`==================================================\n`);

  if (!host || !user || !pass) {
    console.log("SMTP configurations not complete. Logged OTP code above.");
    return;
  }

  let senderName = "Classtech";
  let senderEmail = "support@classtech.in";
  const fromMatch = from.match(/^"([^"]+)"\s*<([^>]+)>$/);
  if (fromMatch) {
    senderName = fromMatch[1];
    senderEmail = fromMatch[2];
  } else {
    const emailOnlyMatch = from.match(/<([^>]+)>/);
    if (emailOnlyMatch) {
      senderEmail = emailOnlyMatch[1];
    } else if (from.includes("@")) {
      senderEmail = from.trim();
    }
  }

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 16px;">
      <h2 style="color: #4f46e5; margin-bottom: 20px;">Classtech Verification Code</h2>
      <p>Hello ${name},</p>
      <p>Your password reset verification OTP is:</p>
      <div style="margin: 30px 0; text-align: center;">
        <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #4f46e5; background-color: #f3f4f6; padding: 12px 24px; border-radius: 8px; display: inline-block;">${otp}</span>
      </div>
      <p>This code is valid for 10 minutes.</p>
      <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 30px 0;" />
      <p style="font-size: 12px; color: #94a3b8;">If you did not request this OTP, please ignore this email.</p>
    </div>
  `;

  try {
    console.log("Attempting to send OTP email via Brevo HTTP REST API (port 443)...");
    const apiKey = config.brevoApiKey || pass;
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
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [
          {
            email: email,
            name: name,
          },
        ],
        subject: `${otp} is your Classtech OTP`,
        htmlContent: emailHtml,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const responseData = await response.json();
      console.log("OTP Email sent successfully via Brevo HTTP. Message ID:", responseData.messageId);
      return;
    } else {
      const errorText = await response.text();
      throw new Error(`Brevo HTTP API status ${response.status}: ${errorText}`);
    }
  } catch (apiError) {
    console.warn("Brevo HTTP API failed or timed out. Falling back to SMTP connection...", apiError.message);

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: {
        user,
        pass,
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });

    const mailOptions = {
      from,
      to: email,
      subject: `${otp} is your Classtech OTP`,
      html: emailHtml,
    };

    await transporter.sendMail(mailOptions);
    console.log("OTP Email sent successfully via SMTP fallback.");
  }
};

export const sendDemoRequestEmail = async ({
  name,
  phone,
  email,
  instituteName,
  tuitionType,
  studentCount,
  preferredTime,
  notes,
}) => {
  const config = await getSmtpConfig();
  const host = config.host;
  const port = config.port;
  const user = config.user;
  const pass = config.pass;
  let from = config.from;
  if (from.includes("classtech.in")) {
    from = from.replace("classtech.in", "classtech.in");
  }

  const targetRecipientEmail = "priyanshugiri63@gmail.com";

  console.log(`\n==================================================`);
  console.log(`NEW FREE DEMO REQUEST FROM: ${name} (${phone})`);
  console.log(`Institute: ${instituteName || "-"} | Students: ${studentCount || "-"}`);
  console.log(`==================================================\n`);

  let senderName = "Classtech Demo Request";
  let senderEmail = "support@classtech.in";
  const fromMatch = from.match(/^"([^"]+)"\s*<([^>]+)>$/);
  if (fromMatch) {
    senderName = fromMatch[1];
    senderEmail = fromMatch[2];
  } else if (from.includes("@")) {
    senderEmail = from.trim();
  }

  const emailHtml = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff;">
      <h2 style="color: #4f46e5; margin-bottom: 8px; font-size: 20px;">🚀 New Free Demo Request</h2>
      <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">A user has submitted a live demo request on Classtech!</p>
      
      <div style="background-color: #f8fafc; padding: 20px; border-radius: 14px; margin-bottom: 20px; border: 1px solid #f1f5f9; font-size: 14px; color: #334155; line-height: 1.6;">
        <p style="margin: 4px 0;"><strong>Full Name:</strong> ${name}</p>
        <p style="margin: 4px 0;"><strong>Phone Number:</strong> <a href="tel:${phone}" style="color: #4f46e5; font-weight: bold;">${phone}</a></p>
        <p style="margin: 4px 0;"><strong>Email Address:</strong> ${email || "Not provided"}</p>
        <p style="margin: 4px 0;"><strong>Tuition / Coaching Name:</strong> ${instituteName || "Not provided"}</p>
        <p style="margin: 4px 0;"><strong>Tuition Type:</strong> ${tuitionType || "Solo / Academy"}</p>
        <p style="margin: 4px 0;"><strong>Estimated Students:</strong> ${studentCount || "Not specified"}</p>
        <p style="margin: 4px 0;"><strong>Preferred Call Time:</strong> ${preferredTime || "Anytime"}</p>
        ${notes ? `<p style="margin: 4px 0;"><strong>Notes / Requests:</strong> ${notes}</p>` : ""}
      </div>

      <p style="font-size: 12px; color: #94a3b8;">Submitted via Classtech Free Demo Request Form.</p>
    </div>
  `;

  try {
    const apiKey = config.brevoApiKey || pass;
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
        sender: {
          name: senderName,
          email: senderEmail,
        },
        to: [
          {
            email: targetRecipientEmail,
            name: "Priyanshu Giri",
          },
        ],
        subject: `🚀 New Demo Request: ${name} (${instituteName || "Tuition"})`,
        htmlContent: emailHtml,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const responseData = await response.json();
      console.log("Demo request email sent successfully via Brevo HTTP API. Message ID:", responseData.messageId);
      return true;
    } else {
      const errorText = await response.text();
      console.warn("Brevo HTTP API demo email failed, status:", response.status, "body:", errorText);
      throw new Error(`Brevo HTTP API status ${response.status}: ${errorText}`);
    }
  } catch (apiError) {
    console.warn("Brevo HTTP API failed. Falling back to SMTP connection for demo request email...", apiError.message);

    if (!host || !user || !pass) {
      console.log("SMTP not configured. Logged demo request above.");
      return true;
    }

    const transporter = nodemailer.createTransport({
      host,
      port: Number(port),
      secure: Number(port) === 465,
      auth: {
        user,
        pass,
      },
      connectionTimeout: 8000,
      greetingTimeout: 8000,
      socketTimeout: 8000,
    });

    await transporter.sendMail(mailOptions);
    console.log("Demo request email sent successfully via SMTP fallback.");
    return true;
  }
};

export const sendRenewalReceiptEmail = async (recipientEmail, instituteName, payment) => {
  try {
    const gstSetting = await SystemSetting.findOne({ key: "gst_settings" });
    let rawSeller = gstSetting?.value || {
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
      signatureUrl: "",
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

    const smtpRenewalSetting = await SystemSetting.findOne({ key: "smtp_renewal_settings" });
    let config;
    if (smtpRenewalSetting && smtpRenewalSetting.value && smtpRenewalSetting.value.useDedicatedSmtp) {
      const val = smtpRenewalSetting.value;
      config = {
        host: val.host || process.env.SMTP_HOST,
        port: val.port || process.env.SMTP_PORT || 587,
        user: val.user || process.env.SMTP_USER,
        pass: val.pass || process.env.SMTP_PASS,
        from: val.from || process.env.SMTP_FROM || `"Classtech Billing" <support@classtech.in>`,
        brevoApiKey: val.brevoApiKey || process.env.BREVO_API_KEY
      };
    } else {
      config = await getSmtpConfig();
    }

    const host = config.host;
    const port = config.port;
    const user = config.user;
    const pass = config.pass;
    const from = config.from;
    const apiKey = config.brevoApiKey || pass;

    const billing = payment.cfPaymentDetails?.billingDetails || {};
    const buyerName = billing.name || instituteName;
    const buyerGstin = billing.gstin || "N/A";
    const buyerAddress = billing.address || "N/A";
    const buyerState = billing.state || "Maharashtra";

    const totalAmount = Number(payment.amount) || 0;
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

    const invoiceDate = new Date(payment.updatedAt || payment.createdAt || Date.now()).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 650px; margin: 0 auto; padding: 25px; border: 1px solid #e2e8f0; border-radius: 20px; background-color: #ffffff; color: #1e293b; line-height: 1.5;">
        
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
            ${buyerGstin && buyerGstin !== "N/A" ? `<div style="color: #0f172a; margin-top: 4px;">GSTIN: <strong>${buyerGstin}</strong></div>` : ""}
          </div>
          <div style="text-align: right;">
            <span style="color: #94a3b8; text-transform: uppercase; font-weight: bold; font-size: 10px;">Invoice Details</span>
            <div style="color: #64748b; margin-top: 4px;">Receipt ID: <strong style="color: #0f172a;">${payment.cfOrderId}</strong></div>
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
                <strong style="color: #0f172a; text-transform: capitalize;">Classtech Subscription Plan (${payment.plan})</strong><br/>
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

    let sent = false;
    if (config.brevoApiKey || (pass && pass.startsWith("xkeysib-"))) {
      try {
        console.log("Sending receipt email via Brevo HTTP REST API (port 443)...");
        const response = await fetch("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            "accept": "application/json",
            "content-type": "application/json",
            "api-key": apiKey,
          },
          body: JSON.stringify({
            sender: {
              name: seller.companyName,
              email: "support@classtech.in",
            },
            to: [
              {
                email: recipientEmail,
                name: buyerName,
              },
            ],
            subject: `Receipt for subscription renewal - Order: ${payment.cfOrderId}`,
            htmlContent: emailHtml,
          }),
        });

        if (response.ok) {
          console.log("Receipt email sent successfully via Brevo HTTP API.");
          sent = true;
        }
      } catch (brevoErr) {
        console.error("Receipt email send failed via Brevo HTTP:", brevoErr.message);
      }
    }

    if (!sent) {
      console.log("Sending receipt email via Nodemailer SMTP fallback...");
      const transporter = nodemailer.createTransport({
        host,
        port: Number(port),
        secure: Number(port) === 465,
        auth: {
          user,
          pass,
        },
        connectionTimeout: 8000,
        greetingTimeout: 8000,
        socketTimeout: 8000,
      });

      const mailOptions = {
        from,
        to: recipientEmail,
        subject: `Receipt for subscription renewal - Order: ${payment.cfOrderId}`,
        html: emailHtml,
      };

      await transporter.sendMail(mailOptions);
      console.log("Receipt email sent successfully via SMTP fallback.");
    }
    return true;
  } catch (error) {
    console.error("sendRenewalReceiptEmail error:", error.message);
    return false;
  }
};

