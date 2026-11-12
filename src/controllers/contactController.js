import ContactMessage from "../models/ContactMessage.js";
import SystemSetting from "../models/SystemSetting.js";
import ConsentRecord from "../models/ConsentRecord.js";
import { DPDP_NOTICE_VERSION } from "../utils/dpdpConfig.js";
import { maskIp } from "../utils/piiSanitizer.js";

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

/**
 * Detects automated form-bot patterns without blocking genuine human inquiries:
 * - Non-empty hidden honeypot (`companyWebsite`)
 * - Unnaturally fast submission (< 1.5s from form load)
 * - Random mixed-case single-token names like "vBgLmaWALcZRsVUMiUXfCX"
 * - Numeric-only / letterless messages
 * - Gmail dot-trick spam aliases (4+ dots before @gmail.com)
 */
const isSuspiciousBotPayload = ({ name, email, message, companyWebsite, formLoadedAt }) => {
  if (String(companyWebsite || "").trim().length > 0) {
    return { blocked: true, silent: true, reason: "honeypot" };
  }

  if (formLoadedAt !== undefined && formLoadedAt !== null) {
    const loadedTs = Number(formLoadedAt);
    const elapsedMs = Date.now() - loadedTs;
    if (!Number.isFinite(loadedTs) || elapsedMs < 1500 || elapsedMs > 24 * 60 * 60 * 1000) {
      return { blocked: true, silent: true, reason: "timing" };
    }
  }

  const trimmedName = name.trim();
  const hasSpaces = /\s/.test(trimmedName);
  const caseTransitions = (trimmedName.match(/[a-z][A-Z]|[A-Z][a-z][A-Z]/g) || []).length;
  if (!hasSpaces && trimmedName.length >= 12 && caseTransitions >= 4) {
    return { blocked: true, silent: false, message: "Please enter a valid full name." };
  }

  const [localPart = "", domainPart = ""] = email.toLowerCase().split("@");
  const isGmail = domainPart === "gmail.com" || domainPart === "googlemail.com";
  const dotCount = (localPart.match(/\./g) || []).length;
  if (isGmail && dotCount >= 4) {
    return { blocked: true, silent: false, message: "Please use a valid email address." };
  }

  const trimmedMsg = message.trim();
  if (/^\d[\d\s\-()+]*$/.test(trimmedMsg) || !/[a-zA-Z\u0900-\u097F]{2,}/.test(trimmedMsg)) {
    return { blocked: true, silent: false, message: "Please enter a valid message describing your inquiry." };
  }

  return { blocked: false };
};

// Public submission
export const submitContactMessage = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      subject,
      message,
      consentAccepted,
      consentNoticeVersion,
      companyWebsite,
      formLoadedAt,
    } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ message: "Name, email and message are required." });
    }
    if (consentAccepted !== true) {
      return res.status(400).json({ message: "Consent is required to submit your message." });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = phone ? String(phone).trim() : "";
    const cleanSubject = subject ? String(subject).trim().slice(0, 120) : "General Inquiry";
    const cleanMessage = String(message).trim();

    if (cleanName.length < 2 || cleanName.length > 100 || !/[a-zA-Z\u0900-\u097F]/.test(cleanName)) {
      return res.status(400).json({ message: "Please enter a valid name." });
    }
    if (!EMAIL_REGEX.test(cleanEmail) || cleanEmail.length > 150) {
      return res.status(400).json({ message: "Please enter a valid email address." });
    }
    if (cleanMessage.length < 10 || cleanMessage.length > 3000) {
      return res.status(400).json({ message: "Please enter a message of at least 10 characters." });
    }
    if (cleanPhone && (cleanPhone.replace(/\D/g, "").length < 7 || cleanPhone.replace(/\D/g, "").length > 15)) {
      return res.status(400).json({ message: "Please enter a valid phone number." });
    }

    const botCheck = isSuspiciousBotPayload({
      name: cleanName,
      email: cleanEmail,
      message: cleanMessage,
      companyWebsite,
      formLoadedAt,
    });
    if (botCheck.blocked) {
      if (botCheck.silent) {
        return res.status(200).json({
          success: true,
          message: "Your message has been submitted successfully.",
        });
      }
      return res.status(400).json({ message: botCheck.message });
    }

    const newMessage = await ContactMessage.create({
      name: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      subject: cleanSubject,
      message: cleanMessage,
    });

    ConsentRecord.create({
      principalType: "contact",
      principalId: String(newMessage?._id || cleanEmail),
      purpose: "lead_inquiry",
      granted: true,
      noticeVersion: consentNoticeVersion || DPDP_NOTICE_VERSION,
      method: "checkbox_web",
      ipMasked: maskIp(req.ip || ""),
    }).catch(() => {});

    return res.status(201).json({
      success: true,
      message: "Your message has been submitted successfully.",
      data: newMessage,
    });
  } catch (error) {
    console.error("submitContactMessage error:", error);
    return res.status(500).json({ message: "Could not submit contact message." });
  }
};

// Admin list
export const getContactMessages = async (req, res) => {
  try {
    const messages = await ContactMessage.find().sort({ createdAt: -1 });
    return res.json(messages);
  } catch (error) {
    console.error("getContactMessages error:", error);
    return res.status(500).json({ message: "Could not load contact messages." });
  }
};

// Admin mark read
export const markContactMessageRead = async (req, res) => {
  try {
    const { id } = req.params;
    const updated = await ContactMessage.findByIdAndUpdate(
      id,
      { status: "read" },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ message: "Contact message not found." });
    }
    return res.json({ message: "Message marked as read.", data: updated });
  } catch (error) {
    console.error("markContactMessageRead error:", error);
    return res.status(500).json({ message: "Could not mark message as read." });
  }
};

// Admin delete
export const deleteContactMessage = async (req, res) => {
  try {
    const { id } = req.params;
    const deleted = await ContactMessage.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Contact message not found." });
    }
    return res.json({ message: "Message deleted successfully." });
  } catch (error) {
    console.error("deleteContactMessage error:", error);
    return res.status(500).json({ message: "Could not delete contact message." });
  }
};

const DEFAULT_CONTACT_DETAILS = {
  phone: "",
  email: "",
  companyName: "",
  address: ""
};

export const getContactDetails = async (req, res) => {
  try {
    const setting = await SystemSetting.findOne({ key: "contact_details" });
    if (!setting) {
      return res.json(DEFAULT_CONTACT_DETAILS);
    }

    let rawValue = setting.value;
    if (typeof rawValue === "string") {
      try {
        rawValue = JSON.parse(rawValue);
      } catch (e) {
        rawValue = {};
      }
    }

    const merged = { ...DEFAULT_CONTACT_DETAILS, ...(rawValue || {}) };
    return res.json(merged);
  } catch (error) {
    console.error("getContactDetails error:", error);
    return res.status(500).json({ message: "Could not fetch contact details." });
  }
};

export const updateContactDetails = async (req, res) => {
  try {
    const { phone, email, address, companyName } = req.body;
    if (!phone || !email || !address) {
      return res.status(400).json({ message: "Phone, email and address are required." });
    }

    const updatedValue = {
      phone: phone.trim(),
      email: email.trim().toLowerCase(),
      companyName: companyName ? companyName.trim() : "Classtech",
      address: address.trim(),
    };

    let setting = await SystemSetting.findOne({ key: "contact_details" });
    if (setting) {
      setting.value = updatedValue;
      if (typeof setting.markModified === "function") {
        setting.markModified("value");
      }
      await setting.save();
    } else {
      setting = await SystemSetting.create({
        key: "contact_details",
        value: updatedValue,
        description: "System website contact coordinates"
      });
    }

    return res.json(updatedValue);
  } catch (error) {
    console.error("updateContactDetails error:", error);
    return res.status(500).json({ message: "Could not update contact details." });
  }
};
