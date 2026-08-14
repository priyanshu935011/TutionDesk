import CustomPage from "../models/CustomPage.js";

// Helper to seed default pages if none exist
const seedDefaultPagesIfNeeded = async () => {
  try {
    const count = await CustomPage.countDocuments({});
    if (count === 0) {
      console.log("Seeding default custom pages (Privacy, Terms, User data deletion, FAQ)...");
      const defaultPages = [
        {
          slug: "privacy-policy",
          title: "Privacy Policy",
          isDefault: true,
          isActive: true,
          content: `### Privacy Policy
Last updated: August 2026

At Classtech, accessible from our tuition platforms, one of our main priorities is the privacy of our visitors. This Privacy Policy document contains types of information that is collected and recorded by Classtech and how we use it.

#### 1. Information We Collect
We collect student enrollment data, parent contact phone numbers (for automatic WhatsApp updates), visual attendance logs, score metrics, and uploaded study materials.

#### 2. How We Use Your Information
We use the collected information to:
* Provide, operate, and maintain student dashboards.
* Mark and display monthly attendance records.
* Send automated WhatsApp notifications for fee updates and reschedules.
* Host live WebSockets quizzes.

#### 3. Log Files
Classtech follows a standard procedure of using log files to track error reports and system uptime metrics.

#### 4. Contact Us
If you have additional questions or require more information about our Privacy Policy, do not hesitate to contact your institution admin or the Classtech team.`
        },
        {
          slug: "terms-of-service",
          title: "Terms of Service",
          isDefault: true,
          isActive: true,
          content: `### Terms of Service
Last updated: August 2026

Welcome to Classtech! By accessing our platforms and using our services, you agree to comply with and be bound by the following terms.

#### 1. Account Security
Teachers and Students are responsible for maintaining the confidentiality of their login credentials and are fully responsible for all activities that occur under their accounts.

#### 2. Proper Usage
Institutes must use the Baileys WhatsApp integration responsibly. Automated reminders should follow institute-level guidelines to avoid spamming recipient numbers.

#### 3. Subscription & Billings
Institute accounts operate on a subscription basis managed by the Super Admin. Accounts that exceed their subscription end dates will be subject to temporary lockouts.

#### 4. Content Ownership
Study notes, PDF documents, announcements, and quiz questions uploaded to Classtech remain the intellectual property of their respective creators.`
        },
        {
          slug: "user-data-deletion",
          title: "User Data Deletion",
          isDefault: true,
          isActive: true,
          content: `### User Data Deletion Instructions
Last updated: August 2026

We respect your right to control your personal data. Below are instructions on how to delete your account or purge data collected on Classtech.

#### For Students and Parents
To delete your student profile, attendance logs, and fee history:
1. Contact your respective Tuition Academy administrator.
2. The administrator can delete your profile directly from the **Students** management dashboard.
3. Upon deletion, all associated files, test marks, and attendance logs are permanently deleted from our database.

#### For Institution Admins
If you wish to terminate your Classtech subscription and delete your entire institute record (including all student data, teacher logins, and settings), please email a deletion request to **support@classtech.in**. We will process and confirm your request within 5 business days.`
        },
        {
          slug: "faq",
          title: "Frequently Asked Questions (FAQ)",
          isDefault: true,
          isActive: true,
          content: `### Frequently Asked Questions (FAQ)

#### Q1. How do I access my student portal?
You can log in to your portal by visiting the **Student Portal Login** page and entering the phone number registered with your academy along with your student password.

#### Q2. Can I download study materials on mobile devices?
Yes! Classtech supports direct one-click PDF downloads. You can access the **Study Notes** tab on your mobile dashboard to view and download all uploaded PDFs.

#### Q3. How do I join a live quiz?
When your teacher starts a live quiz session, a socket connection will prompt you on your portal screen. Click **Join Live Quiz** to participate and answer questions in real time.

#### Q4. Why am I not receiving WhatsApp alerts?
WhatsApp alerts are dispatched if your institute admin has configured Meta/Baileys WhatsApp settings. If alerts are delayed, verify your registered contact number with your academy admin.`
        }
      ];

      for (const page of defaultPages) {
        await CustomPage.create(page);
      }
    }
  } catch (err) {
    console.error("Error seeding default pages:", err);
  }
};

// Admin handlers
export const getAdminPages = async (req, res) => {
  try {
    await seedDefaultPagesIfNeeded();
    const pages = await CustomPage.find({}).sort({ createdAt: -1 });
    return res.json(pages);
  } catch (err) {
    console.error("getAdminPages error:", err);
    return res.status(500).json({ message: "Could not fetch custom pages." });
  }
};

export const createAdminPage = async (req, res) => {
  try {
    const { slug, title, content, isActive } = req.body;
    if (!slug || !title || !content) {
      return res.status(400).json({ message: "Slug, title, and content are required." });
    }

    const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
    const existing = await CustomPage.findOne({ slug: cleanSlug });
    if (existing) {
      return res.status(400).json({ message: "A page with this slug already exists." });
    }

    const page = await CustomPage.create({
      slug: cleanSlug,
      title: title.trim(),
      content: content.trim(),
      isActive: isActive !== undefined ? isActive : true,
      isDefault: false,
    });

    return res.status(201).json(page);
  } catch (err) {
    console.error("createAdminPage error:", err);
    return res.status(500).json({ message: "Could not create custom page." });
  }
};

export const updateAdminPage = async (req, res) => {
  try {
    const { slug, title, content, isActive } = req.body;
    const page = await CustomPage.findById(req.params.id);
    if (!page) {
      return res.status(404).json({ message: "Page not found." });
    }

    if (slug && slug.toLowerCase() !== page.slug) {
      const cleanSlug = slug.toLowerCase().replace(/[^a-z0-9-_]/g, "-");
      const existing = await CustomPage.findOne({ slug: cleanSlug });
      if (existing && String(existing._id) !== String(page._id)) {
        return res.status(400).json({ message: "A page with this slug already exists." });
      }
      page.slug = cleanSlug;
    }

    if (title) page.title = title.trim();
    if (content !== undefined) page.content = content.trim();
    if (isActive !== undefined) page.isActive = isActive;

    await page.save();
    return res.json(page);
  } catch (err) {
    console.error("updateAdminPage error:", err);
    return res.status(500).json({ message: "Could not update custom page." });
  }
};

export const deleteAdminPage = async (req, res) => {
  try {
    const page = await CustomPage.findById(req.params.id);
    if (!page) {
      return res.status(404).json({ message: "Page not found." });
    }
    if (page.isDefault) {
      return res.status(400).json({ message: "Default system pages cannot be deleted." });
    }

    await CustomPage.findByIdAndDelete(req.params.id);
    return res.json({ message: "Custom page deleted successfully." });
  } catch (err) {
    console.error("deleteAdminPage error:", err);
    return res.status(500).json({ message: "Could not delete custom page." });
  }
};

// Public handlers
export const getPublicPages = async (req, res) => {
  try {
    await seedDefaultPagesIfNeeded();
    const pages = await CustomPage.find({ isActive: true }).select("slug title isDefault");
    return res.json(pages);
  } catch (err) {
    console.error("getPublicPages error:", err);
    return res.status(500).json({ message: "Could not fetch public pages." });
  }
};

export const getPublicPageBySlug = async (req, res) => {
  try {
    await seedDefaultPagesIfNeeded();
    const { slug } = req.params;
    const page = await CustomPage.findOne({ slug, isActive: true });
    if (!page) {
      return res.status(404).json({ message: "Page not found." });
    }
    return res.json(page);
  } catch (err) {
    console.error("getPublicPageBySlug error:", err);
    return res.status(500).json({ message: "Could not fetch page details." });
  }
};
