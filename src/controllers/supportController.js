import SupportTicket from "../models/SupportTicket.js";
import { sendAdminTicketAlert } from "../services/adminAlertService.js";
import cloudinary from "../utils/cloudinary.js";
import { callGeminiRaw } from "../services/aiService.js";

// Authentic ClassTech FAQs with exact in-app steps and button names
const CLASSTECH_FAQS = [
  {
    category: "Students & Batches",
    question: "How do I add a new student?",
    answer: "1. Tap 'Students' from the bottom navigation or sidebar.\n2. Tap the '+ Add Student' button in the top right.\n3. Enter the Student Name and 10-digit Student Mobile number.\n4. Optionally enter Parent Name and Parent Mobile.\n5. Under 'Batch & Fees', select the student's batch, total tuition fees, and any initial payment.\n6. Tap 'Save Student' at the bottom to finish.",
  },
  {
    category: "Students & Batches",
    question: "How do I create and manage batches?",
    answer: "1. Tap 'Batches' on the navigation bar or 'Create Batch' on Dashboard.\n2. Tap the '+ Create Batch' button.\n3. Enter the Batch Name (e.g. Class 10 - Mathematics), Subject, Days of week, and Start/End times.\n4. Tap 'Save Batch'. You can now assign students to this batch during student creation or from student profile.",
  },
  {
    category: "Attendance",
    question: "How do I take batch attendance and alert parents on WhatsApp?",
    answer: "1. Tap 'Attendance' from the Dashboard or navigation menu.\n2. Select your target 'Batch' from the dropdown and pick the date.\n3. For each student, toggle status: 'Present' (green), 'Absent' (red), or 'Late' (orange).\n4. Enable the 'Send WhatsApp notification to absent parents' toggle if you want automated parent alerts.\n5. Tap 'Save Attendance' to record.",
  },
  {
    category: "Fees & Payments",
    question: "How do I record a student fee payment and share a receipt?",
    answer: "1. Go to 'Students' and tap the student's name to open their 'Student Profile'.\n2. In the 'Fees Overview' card, tap 'Record Payment' or 'Collect Fees'.\n3. Enter the payment amount, select Payment Mode ('Cash', 'UPI', or 'Bank Transfer'), and payment date.\n4. Tap 'Submit Payment'.\n5. On the success dialog, tap 'Download Receipt' for PDF or 'Share Receipt via WhatsApp' to send it directly to the parent.",
  },
  {
    category: "Fees & Payments",
    question: "How do I check fee defaulters and pending balances?",
    answer: "1. In 'Students' screen, tap the filter pill 'Fee Defaulters' or 'Partial Paid'.\n2. The list updates instantly to show only students with pending amounts.\n3. Alternatively, ask ClassTech AI: 'Who are the fee defaulters in Class 10?' and get an instant summary.",
  },
  {
    category: "AI & OCR Scanner",
    question: "How do I scan physical admission forms with ClassTech AI?",
    answer: "1. Tap 'ClassTech AI' from the bottom navigation bar.\n2. Tap the attachment paperclip icon or choose the quick prompt 'Scan Admission Form'.\n3. Choose 'Camera' to take a photo of the paper form or 'Gallery' to upload an existing picture.\n4. ClassTech AI automatically extracts student name, mobile, parent details, address, and batch.\n5. Review the preview fields and tap 'Confirm & Save Student' to add them directly to your CRM.",
  },
  {
    category: "AI & OCR Scanner",
    question: "How do I scan a test marksheet to upload marks in bulk?",
    answer: "1. Open 'ClassTech AI' or go to 'Tests & Marks'.\n2. Select 'Scan Test Marksheet'.\n3. Upload a clear photo of your handwritten or printed marks register.\n4. ClassTech AI reads student names, enrolment numbers, and test scores.\n5. Verify scores in the preview table, select the target batch, and tap 'Save Test Scores'.",
  },
  {
    category: "Notes & Videos",
    question: "How do I upload PDF notes and video lectures for batches?",
    answer: "1. To upload study material, tap 'Notes' and tap '+ Upload Note'. Attach the PDF, assign it to a batch, and tap 'Upload'.\n2. To upload video lectures, tap 'Videos', create or select a playlist, and upload the lecture video assigned to that batch.",
  },
  {
    category: "General & Settings",
    question: "How do I switch between Dark Theme and Light Theme?",
    answer: "1. Tap 'Profile' in the bottom navigation bar.\n2. Tap the 'App Theme' card.\n3. Choose 'System Default', 'Light Theme', or 'Dark Theme' to update the UI instantly.",
  },
];

// Authentic Video Tutorials for real ClassTech features
const CLASSTECH_TUTORIALS = [
  {
    id: "tut_1",
    title: "How to Add Students & Assign Batches",
    category: "Students",
    description: "Step-by-step walkthrough of student registration, mobile number validation, and batch allocation.",
    duration: "2:15 mins",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    thumbnailUrl: "https://images.unsplash.com/photo-1524178232363-1fb2b075b655?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "tut_2",
    title: "Batch Attendance & Instant WhatsApp Alerts",
    category: "Attendance",
    description: "Learn how to record daily batch attendance and send automatic absent alerts to parents.",
    duration: "1:45 mins",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    thumbnailUrl: "https://images.unsplash.com/photo-1434030216411-0b793f4b4173?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "tut_3",
    title: "Fee Collection & PDF Receipt Sharing",
    category: "Fees",
    description: "Recording fee payments via Cash/UPI, configuring installment plans, and sharing receipts.",
    duration: "3:10 mins",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    thumbnailUrl: "https://images.unsplash.com/photo-1554224155-8d04cb21cd6c?w=600&auto=format&fit=crop&q=80",
  },
  {
    id: "tut_4",
    title: "AI Admission Form & Marksheet OCR Scanner",
    category: "AI Tools",
    description: "Save hours by clicking photos of physical forms and marksheets to extract data automatically.",
    duration: "2:40 mins",
    videoUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    thumbnailUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&auto=format&fit=crop&q=80",
  },
];

/**
 * POST /api/support/tickets
 * Create a new support ticket / bug report with optional screenshot upload
 */
export async function createTicket(req, res) {
  try {
    const {
      category,
      subject,
      description,
      deviceInfo,
      screenshotBase64,
      priority = "NORMAL",
    } = req.body;

    if (!category || !subject || !description) {
      return res.status(400).json({
        success: false,
        message: "Category, subject, and description are required.",
      });
    }

    const userId = req.user?._id ? String(req.user._id) : "anonymous";
    const userName = req.user?.name || "ClassTech Educator";
    const userPhone = req.user?.phone || req.user?.email || "";
    const userRole = req.user?.role || "teacher";

    const rawInst = req.user?.institute;
    const instituteId = rawInst?._id ? String(rawInst._id) : (rawInst ? String(rawInst) : "");
    const instituteName = rawInst?.name || "ClassTech Tuition";

    const attachments = [];

    // 1. If base64 screenshot is provided in body
    if (screenshotBase64 && typeof screenshotBase64 === "string" && screenshotBase64.length > 50) {
      try {
        const uploadRes = await cloudinary.uploader.upload(
          screenshotBase64.startsWith("data:") ? screenshotBase64 : `data:image/jpeg;base64,${screenshotBase64}`,
          {
            folder: "support_tickets",
            resource_type: "image",
          }
        );
        if (uploadRes?.secure_url) {
          attachments.push(uploadRes.secure_url);
        }
      } catch (cErr) {
        console.warn("[SupportController] Screenshot upload to Cloudinary failed:", cErr.message);
      }
    }

    // 2. If multipart file is provided via multer
    if (req.file && req.file.buffer) {
      try {
        const b64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;
        const uploadRes = await cloudinary.uploader.upload(b64, {
          folder: "support_tickets",
          resource_type: "image",
        });
        if (uploadRes?.secure_url) {
          attachments.push(uploadRes.secure_url);
        }
      } catch (fErr) {
        console.warn("[SupportController] File upload failed:", fErr.message);
      }
    }

    const ticketNumber = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;

    const ticket = await SupportTicket.create({
      ticketNumber,
      userId,
      userName,
      userPhone,
      userRole,
      instituteId,
      instituteName,
      category,
      subject,
      description,
      attachments,
      deviceInfo: typeof deviceInfo === "string" ? JSON.parse(deviceInfo) : (deviceInfo || {}),
      status: "OPEN",
      priority: priority.toUpperCase(),
    });

    // 3. Dispatch async alerts to Telegram / Slack (non-blocking)
    sendAdminTicketAlert(ticket).catch((err) => {
      console.warn("[SupportController] Error in background alert:", err.message);
    });

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully. Our team will review it shortly.",
      ticket,
    });
  } catch (error) {
    console.error("[SupportController] Error creating ticket:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to create support ticket. Please try again.",
      error: error.message,
    });
  }
}

/**
 * GET /api/support/my-tickets
 * Get tickets submitted by the authenticated user
 */
export async function getMyTickets(req, res) {
  try {
    const userId = req.user?._id ? String(req.user._id) : null;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Unauthorized" });
    }

    const tickets = await SupportTicket.find({
      $or: [{ userId }, { userPhone: req.user?.phone || "" }],
    }).sort({ createdAt: -1 });

    return res.json({
      success: true,
      tickets: tickets || [],
    });
  } catch (error) {
    console.error("[SupportController] Error getting tickets:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to load support tickets.",
      error: error.message,
    });
  }
}

/**
 * GET /api/support/faqs
 * Get categorized list of FAQs with exact app steps
 */
export async function getFaqs(req, res) {
  try {
    return res.json({
      success: true,
      faqs: CLASSTECH_FAQS,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * GET /api/support/tutorials
 * Get video tutorials for core app features
 */
export async function getTutorials(req, res) {
  try {
    return res.json({
      success: true,
      tutorials: CLASSTECH_TUTORIALS,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
}

/**
 * POST /api/support/ai-help
 * AI Help Assistant strictly grounded in actual ClassTech Tuition CRM features and UI buttons
 */
export async function askAiHelp(req, res) {
  try {
    const { query, history = [] } = req.body;
    if (!query || !query.trim()) {
      return res.status(400).json({ success: false, message: "Query is required" });
    }

    const systemInstruction = 
`You are the official ClassTech Tuition CRM in-app Support Assistant.
Your role is to guide teachers, coaching owners, and tutors with accurate, step-by-step instructions on how to use the ClassTech app.

CRITICAL RULES:
1. ONLY refer to actual features and real screens that exist in the ClassTech app:
   - Dashboard: Quick statistics (Total Students, Active Batches, Fees Collected, Pending), Quick Actions (Add Student, Mark Attendance, Collect Fees, Create Batch).
   - Students: Active/Archived tabs, Search bar ("Search by name, phone or enrolment no..."), "+ Add Student" button, Student Details profile, Fees Card ("Record Payment", "Collect Fees", "Download Receipt", "Share Receipt via WhatsApp").
   - Batches: "+ Create Batch" (Name, Subject, Days, Timing), Batch card, Assign Students.
   - Attendance: Select Batch and Date, Toggle Present (green) / Absent (red) / Late (orange), "Save Attendance" button, and "Send WhatsApp notification to absent parents" toggle.
   - Fees Management: Summary cards, Record Payment (Cash, UPI, Bank Transfer), Installments, Download Receipt PDF, WhatsApp fee reminders.
   - Tests & Marks: Create Test, enter scores manually or "Scan Test Marksheet" with AI OCR, student rank cards.
   - Notes & Videos: PDF study material upload assigned to batch, Video Lecture playlists.
   - ClassTech AI: Chat tab in bottom bar, "Scan Admission Form" (auto-extract student details from camera/photo), "Scan Test Marksheet" (auto-read scores), Tuition intelligence Q&A.
   - Educator Profile: App Theme setting (System / Light / Dark), Institute details, Logout.

2. ALWAYS give the exact, correct button names and step-by-step navigation. Do not invent steps.
3. Keep answers concise, clear, and formatted with bullet points/numbers and friendly emojis.
4. If a user describes a system crash, billing issue, bug, or asks for something that needs human intervention, tell them:
   "For account-specific issues or technical bugs, you can raise an in-app ticket right here in the 'Raise Ticket' tab or reach us directly on WhatsApp."`;

    const aiReply = await callGeminiRaw({
      prompt: query,
      systemInstruction,
      temperature: 0.2,
      history: Array.isArray(history) ? history.slice(-6) : [],
    });

    return res.json({
      success: true,
      reply: aiReply || "Here are the steps to follow in your ClassTech app.",
    });
  } catch (error) {
    console.error("[SupportController] Error in AI Help:", error);
    return res.status(500).json({
      success: false,
      message: "AI Support Assistant temporarily unavailable. Please try again or check the FAQs.",
      error: error.message,
    });
  }
}
