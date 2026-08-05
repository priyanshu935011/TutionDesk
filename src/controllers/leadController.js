import crypto from "crypto";
import Lead from "../models/Lead.js";
import Institute from "../models/Institute.js";
import User from "../models/User.js";
import LeadForm from "../models/LeadForm.js";
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

Log in to your Classtech dashboard to view and follow up on this lead.`;

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

export const getLeadForms = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const forms = await LeadForm.find({ institute: instituteId }).sort({ createdAt: -1 });
    return res.json(forms);
  } catch (error) {
    console.error("getLeadForms error:", error);
    return res.status(500).json({ message: "Could not fetch lead forms" });
  }
};

export const createLeadForm = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const { name, title, description, fields } = req.body;

    if (!name || !title) {
      return res.status(400).json({ message: "Form name and display title are required" });
    }

    const form = await LeadForm.create({
      institute: instituteId,
      name: name.trim(),
      title: title.trim(),
      description: description ? description.trim() : "",
      fields: Array.isArray(fields) && fields.length > 0 ? fields : undefined,
    });

    return res.status(201).json(form);
  } catch (error) {
    console.error("createLeadForm error:", error);
    return res.status(500).json({ message: "Could not create lead form" });
  }
};

export const updateLeadForm = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const { name, title, description, fields } = req.body;

    const form = await LeadForm.findOne({ _id: req.params.id, institute: instituteId });
    if (!form) {
      return res.status(404).json({ message: "Lead form not found" });
    }

    if (name) form.name = name.trim();
    if (title) form.title = title.trim();
    if (description !== undefined) form.description = description.trim();
    if (fields) form.fields = fields;

    await form.save();
    return res.json(form);
  } catch (error) {
    console.error("updateLeadForm error:", error);
    return res.status(500).json({ message: "Could not update lead form" });
  }
};

export const deleteLeadForm = async (req, res) => {
  try {
    const instituteId = req.user.institute?._id || req.user.institute;
    const form = await LeadForm.findOneAndDelete({ _id: req.params.id, institute: instituteId });
    if (!form) {
      return res.status(404).json({ message: "Lead form not found" });
    }

    // Clean up associated leads form link
    await Lead.updateMany({ leadFormId: req.params.id }, { $set: { leadFormId: "" } });

    return res.json({ message: "Lead form deleted successfully" });
  } catch (error) {
    console.error("deleteLeadForm error:", error);
    return res.status(500).json({ message: "Could not delete lead form" });
  }
};

export const getPublicLeadForm = async (req, res) => {
  try {
    const form = await LeadForm.findById(req.params.id).populate("institute", "name logoUrl themeColor");
    if (!form) {
      return res.status(404).json({ message: "Lead form not found" });
    }
    return res.json(form);
  } catch (error) {
    console.error("getPublicLeadForm error:", error);
    return res.status(500).json({ message: "Could not fetch public lead form details" });
  }
};

export const submitPublicLead = async (req, res) => {
  try {
    const form = await LeadForm.findById(req.params.id).populate("institute");
    if (!form) {
      return res.status(404).json({ message: "Lead form not found" });
    }

    const { name, phone, email, course, message } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ message: "Name is required." });
    }
    if (!phone || !phone.trim()) {
      return res.status(400).json({ message: "Phone number is required." });
    }

    const lead = await Lead.create({
      institute: form.institute._id,
      name: name.trim(),
      phone: phone.trim(),
      email: email ? email.trim().toLowerCase() : "",
      course: course ? course.trim() : "",
      message: message ? message.trim() : "",
      source: form.name,
      leadFormId: form._id,
      status: "new",
    });

    // Send WhatsApp notification alert
    setImmediate(async () => {
      try {
        let adminPhone = form.institute.adminPhone?.trim();
        if (!adminPhone && form.institute.adminUser) {
          const adminUser = await User.findById(form.institute.adminUser).select("phone");
          adminPhone = adminUser?.phone?.trim();
        }

        if (adminPhone) {
          const alertMessage = `🔥 *New Form Lead Scan Received!*
          
👤 *Name:* ${lead.name}
📱 *Phone:* ${lead.phone}
${lead.email ? `📧 *Email:* ${lead.email}\n` : ""}${lead.course ? `📚 *Course:* ${lead.course}\n` : ""}${lead.message ? `💬 *Message:* ${lead.message}\n` : ""}🌐 *QR Form Source:* ${form.name}

Log in to your dashboard to review this lead.`;

          await sendMessage(String(form.institute._id), adminPhone, alertMessage);
        }
      } catch (wErr) {
        console.error("WhatsApp public lead notification alert error:", wErr.message);
      }
    });

    return res.status(201).json({
      success: true,
      message: "Lead submitted successfully!",
    });
  } catch (error) {
    console.error("submitPublicLead error:", error);
    return res.status(500).json({ message: "Could not submit inquiry." });
  }
};
