import ContactMessage from "../models/ContactMessage.js";

// Public submission
export const submitContactMessage = async (req, res) => {
  try {
    const { name, email, phone, subject, message } = req.body;
    if (!name || !email || !message) {
      return res.status(400).json({ message: "Name, email and message are required." });
    }

    const newMessage = await ContactMessage.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone ? phone.trim() : "",
      subject: subject ? subject.trim() : "General Inquiry",
      message: message.trim(),
    });

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
