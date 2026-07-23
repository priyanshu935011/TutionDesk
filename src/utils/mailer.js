import nodemailer from "nodemailer";

export const sendResetEmail = async (email, name, resetLink) => {
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  let from = process.env.SMTP_FROM || `"TutionDesk" <support@tutiondesk.in>`;
  if (from.includes("tuitiondesk.in")) {
    from = from.replace("tuitiondesk.in", "tutiondesk.in");
  }

  console.log(`\n==================================================`);
  console.log(`PASSWORD RESET EMAIL REQUEST FOR: ${name} (${email})`);
  console.log(`Reset Link: ${resetLink}`);
  console.log(`==================================================\n`);

  if (!host || !user || !pass) {
    console.log("SMTP environment variables not configured. Logged reset email link above.");
    return;
  }

  // Parse sender name and email from the "from" string
  let senderName = "TutionDesk";
  let senderEmail = "support@tutiondesk.in";
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
      <h2 style="color: #4f46e5; margin-bottom: 20px;">TutionDesk Password Reset</h2>
      <p>Hello ${name},</p>
      <p>You requested a password reset for your account at TutionDesk.</p>
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
    const apiKey = process.env.BREVO_API_KEY || pass;
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
        subject: "Reset your TutionDesk Password",
        htmlContent: emailHtml,
      }),
    });

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
    });

    const mailOptions = {
      from,
      to: email,
      subject: "Reset your TutionDesk Password",
      html: emailHtml,
    };

    await transporter.sendMail(mailOptions);
    console.log("Email sent successfully via SMTP fallback.");
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
  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT || 587;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  let from = process.env.SMTP_FROM || `"TutionDesk" <support@tutiondesk.in>`;
  if (from.includes("tuitiondesk.in")) {
    from = from.replace("tuitiondesk.in", "tutiondesk.in");
  }

  const targetRecipientEmail = "priyanshugiri63@gmail.com";

  console.log(`\n==================================================`);
  console.log(`NEW FREE DEMO REQUEST FROM: ${name} (${phone})`);
  console.log(`Institute: ${instituteName || "-"} | Students: ${studentCount || "-"}`);
  console.log(`==================================================\n`);

  let senderName = "TutionDesk Demo Request";
  let senderEmail = "support@tutiondesk.in";
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
      <p style="color: #64748b; font-size: 14px; margin-bottom: 20px;">A user has submitted a live demo request on TuitionDesk!</p>
      
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

      <p style="font-size: 12px; color: #94a3b8;">Submitted via TuitionDesk Free Demo Request Form.</p>
    </div>
  `;

  try {
    const apiKey = process.env.BREVO_API_KEY || pass;
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
    });

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
    });

    const mailOptions = {
      from,
      to: targetRecipientEmail,
      subject: `🚀 New Demo Request: ${name} (${instituteName || "Tuition"})`,
      html: emailHtml,
    };

    await transporter.sendMail(mailOptions);
    console.log("Demo request email sent successfully via SMTP fallback.");
    return true;
  }
};

