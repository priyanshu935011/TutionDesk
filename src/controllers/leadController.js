import crypto from "crypto";
import Lead from "../models/Lead.js";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import { sendMessage } from "../services/whatsappService.js";

const generateApiKey = () => {
  return "td_lead_" + crypto.randomBytes(16).toString("hex");
};

export const submitLead = async (req, res) => {
  try {
    const apiKey =
      req.body?.apiKey ||
      req.query?.apiKey ||
      req.headers["x-lead-key"] ||
      req.headers["x-api-key"];

    const instituteIdParam = req.body?.instituteId || req.query?.instituteId;

    let institute = null;

    if (apiKey) {
      institute = await Institute.findOne({ leadApiKey: apiKey });
    }

    if (!institute && instituteIdParam) {
      institute = await Institute.findById(instituteIdParam);
    }

    if (!institute) {
      return res.status(401).json({
        message: "Invalid Lead API Key or Institute ID. Please verify your lead form integration key.",
      });
    }

    // Verify if leads feature is allowed for this institute
    if (institute.allowedFeatures && !institute.allowedFeatures.includes("leads")) {
      return res.status(403).json({
        message: "Website leads integration feature is not enabled for this institute.",
      });
    }

    const { name, phone, email, course, message, source } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Student or parent name is required." });
    }

    if (!phone || !phone.trim()) {
      return res.status(400).json({ message: "Contact phone number is required." });
    }

    const lead = await Lead.create({
      institute: institute._id,
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : "",
      course: course ? course.trim() : "",
      message: message ? message.trim() : "",
      source: source ? source.trim() : "External Website",
      status: "new",
    });

    // Asynchronously dispatch WhatsApp lead alert to institute owner / admin phone
    setImmediate(async () => {
      try {
        let adminPhone = institute.adminPhone?.trim();
        if (!adminPhone && institute.adminUser) {
          const adminUser = await User.findById(institute.adminUser).select("phone");
          adminPhone = adminUser?.phone?.trim();
        }

        if (adminPhone) {
          const alertMessage = `🔥 *New Website Lead Received!*

👤 *Name:* ${lead.name}
📱 *Phone:* ${lead.phone}
${lead.email ? `📧 *Email:* ${lead.email}\n` : ""}${lead.course ? `📚 *Course Interest:* ${lead.course}\n` : ""}${lead.message ? `💬 *Message:* ${lead.message}\n` : ""}🌐 *Source:* ${lead.source}

Log in to your TuitionDesk dashboard to view and follow up on this lead.`;

          await sendMessage(String(institute._id), adminPhone, alertMessage);
          console.log(`WhatsApp lead alert sent to institute (${adminPhone}) for lead ${lead.name}`);
        }
      } catch (wErr) {
        console.error("WhatsApp lead alert error:", wErr.message);
      }
    });

    return res.status(201).json({
      success: true,
      message: "Inquiry submitted successfully! The tuition team will contact you shortly.",
      leadId: lead._id,
    });
  } catch (error) {
    console.error("submitLead error:", error);
    return res.status(500).json({ message: "Could not submit inquiry. Please try again." });
  }
};

export const getLeads = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    if (!instituteId) {
      return res.status(400).json({ message: "Institute not associated with user" });
    }

    const leads = await Lead.find({ institute: instituteId }).sort({ createdAt: -1 });
    return res.json(leads);
  } catch (error) {
    console.error("getLeads error:", error);
    return res.status(500).json({ message: "Could not fetch leads" });
  }
};

export const updateLead = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const { status, notes, name, phone, email, course } = req.body;

    const lead = await Lead.findOne({ _id: req.params.id, institute: instituteId });
    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    if (status && ["new", "contacted", "demo_scheduled", "enrolled", "rejected"].includes(status)) {
      lead.status = status;
    }

    if (notes !== undefined) lead.notes = notes;
    if (name) lead.name = name;
    if (phone) lead.phone = phone;
    if (email !== undefined) lead.email = email;
    if (course !== undefined) lead.course = course;

    await lead.save();
    return res.json(lead);
  } catch (error) {
    console.error("updateLead error:", error);
    return res.status(500).json({ message: "Could not update lead" });
  }
};

export const deleteLead = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const lead = await Lead.findOneAndDelete({ _id: req.params.id, institute: instituteId });

    if (!lead) {
      return res.status(404).json({ message: "Lead not found" });
    }

    return res.json({ message: "Lead deleted successfully" });
  } catch (error) {
    console.error("deleteLead error:", error);
    return res.status(500).json({ message: "Could not delete lead" });
  }
};

export const getLeadApiKey = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const institute = await Institute.findById(instituteId);

    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    if (!institute.leadApiKey) {
      institute.leadApiKey = generateApiKey();
      await institute.save();
    }

    return res.json({ apiKey: institute.leadApiKey });
  } catch (error) {
    console.error("getLeadApiKey error:", error);
    return res.status(500).json({ message: "Could not fetch lead API key" });
  }
};

export const regenerateLeadApiKey = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const institute = await Institute.findById(instituteId);

    if (!institute) {
      return res.status(404).json({ message: "Institute not found" });
    }

    institute.leadApiKey = generateApiKey();
    await institute.save();

    return res.json({
      message: "Lead API key regenerated successfully!",
      apiKey: institute.leadApiKey,
    });
  } catch (error) {
    console.error("regenerateLeadApiKey error:", error);
    return res.status(500).json({ message: "Could not regenerate lead API key" });
  }
};
