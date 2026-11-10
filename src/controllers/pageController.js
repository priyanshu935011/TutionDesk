import CustomPage from "../models/CustomPage.js";

const DPDP_DEFAULT_PAGES = [
  {
    slug: "privacy-policy",
    title: "Privacy Policy",
    isDefault: true,
    isActive: true,
    content: `### Privacy Policy (DPDP Act, 2023 & DPDP Rules, 2025 Compliant)
Last updated: November 2026 | Notice Version: 2026.11-v1

At **ClassTech Operating System**, we process personal data strictly in compliance with India's **Digital Personal Data Protection (DPDP) Act, 2023** and **DPDP Rules, 2025**.

#### 1. Role Clarification (Data Fiduciary vs. Data Processor)
* **For Coaching Institutes, Educators & Website Visitors:** ClassTech acts as the **Data Fiduciary** for account registration, login OTP, subscriptions, wallet recharges, and inquiry leads.
* **For Enrolled Students & Parents:** Your respective Coaching Institute is the primary **Data Fiduciary**, and ClassTech acts as their **Data Processor** under a binding B2B Data Processing Addendum (DPA).

#### 2. Itemized Data Collected & Specific Purposes (Rule 3)
* **Educators & Staff:** Name, phone, email, academy details, password hash, and device push tokens — for workspace provisioning, OTP authentication, and billing.
* **Students & Guardians:** Student name, DOB/minor status, enrollment number, phone, parent/guardian name & contact, attendance logs, marks, and fee records — solely for academic operations and parent alerts.
* **ClassTech AI:** Educational doubts and institute intelligence queries — student names and phone numbers are **tokenized/pseudonymized** before external LLM processing.

#### 3. Children's Data & Strict Ad/Tracking Ban (Section 9 & Rule 10)
* Learners under 18 require **Verifiable Parental Consent** (verified via Guardian OTP) prior to optional AI Tutor processing.
* We **do not** run behavioral analytics (PostHog), session replay (Sentry Replay), or Google AdSense ads on Student accounts.

#### 4. Sub-Processors & Security Safeguards (Rule 6)
Data is protected with verified JWT authentication, role-based tenant isolation, TLS/encryption, PII-masked system logs, and strict sub-processor contracts (Supabase, Google/OpenAI, Meta WhatsApp/TextBee, Cashfree, Cloudinary, Firebase). Security access logs are retained for at least **1 year**.

#### 5. Data Retention & Principal Rights (Rules 8 & 14)
You can **access/export**, **correct**, **withdraw consent**, or **permanently erase** your data anytime via your Profile **DPDP Privacy Center**. Automated inactivity purges include a mandatory **48-hour advance notice**.

#### 6. Grievance Officer & DPBI Escalation (Section 13)
**Grievance Officer:** privacy@classtech.in | +91-9934597030 (Response SLA: 30 days; statutory max: 90 days). Unresolved complaints may be escalated to the **Data Protection Board of India (dpb.gov.in)**.`
  },
  {
    slug: "terms-of-service",
    title: "Terms of Service & B2B DPA",
    isDefault: true,
    isActive: true,
    content: `### Terms of Service & B2B Data Processing Addendum (DPA)
Last updated: November 2026

Welcome to ClassTech! By creating an account or accessing our platforms, you agree to these Terms and, for Coaching Institutes/Educators, the **DPDP B2B Data Processing Addendum (DPA)** below.

#### 1. Account Security & Lawful Use
Teachers, Institute Admins, and Students are responsible for maintaining credential confidentiality. Institutes must obtain lawful notice and verifiable parental consent (where students are under 18) prior to uploading learner records or enabling automated WhatsApp/AI features.

#### 2. Data Processing Addendum (Institute as Fiduciary / ClassTech as Processor)
* **Instructions & Minimization:** ClassTech processes student/parent data solely to provide attendance, fee, test, video, notice, and AI services configured by the Institute.
* **Sub-Processors & Safeguards (Rule 6):** ClassTech enforces JWT signature verification, role-based tenant isolation, PII-masked error logs, and LLM PII tokenization.
* **Breach Notification (Rule 7):** ClassTech will notify affected Institute Administrators promptly upon discovering any confirmed security breach to support immediate DPBI and 72-hour Data Principal notifications.
* **Cascade Deletion (Rule 8):** Upon institute termination or valid deletion request, ClassTech executes cascade deletion/anonymization of personal records within statutory timelines (retaining anonymized GST accounting figures only where legally mandated).

#### 3. Subscription, Wallets & Content Ownership
All notes, lectures, and test content uploaded by Educators remain their intellectual property.`
  },
  {
    slug: "user-data-deletion",
    title: "User Data Deletion",
    isDefault: true,
    isActive: true,
    content: `### User Data Deletion & DPDP Rights Instructions (Section 12)
Last updated: November 2026

We provide instant self-service and assisted erasure workflows in compliance with Section 12 and Rule 8 of the DPDP framework.

#### Option 1: Instant Self-Service Privacy Center (Web & Mobile App)
1. Sign in to your **Educator / Institute Profile** or **Student Portal Profile**.
2. Open the **DPDP Privacy & Rights Center** section.
3. Click **Export My Data (JSON)** to download a copy of your data, or **Delete Account & Erase Data** to trigger complete cascade deletion across student records, attendance logs, test attempts, AI prompts, push tokens, and uploaded photos (only anonymized GST invoice totals may remain where mandated by Indian tax laws).

#### Option 2: Request via Grievance Officer
Email **privacy@classtech.in** or file a ticket in the in-app Grievance Center. All erasure requests are processed within our 30-day SLA (and strictly within statutory timelines).`
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

#### Q3. How do I verify Parental Consent for minor students under DPDP?
Parents or guardians can verify consent in seconds via **6-digit SMS or Email OTP** inside **Student Profile -> DPDP Privacy & Rights Center**.

#### Q4. How do I export or permanently delete my personal data?
Visit **Profile -> DPDP Privacy & Rights Center** in the web portal or mobile app to download a JSON summary, withdraw optional consents, file a grievance, or erase your account.`
  }
];

const seedDefaultPagesIfNeeded = async () => {
  try {
    const count = await CustomPage.countDocuments({});
    if (count === 0) {
      console.log("Seeding default DPDP custom pages...");
      for (const page of DPDP_DEFAULT_PAGES) {
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
      const fallback = DPDP_DEFAULT_PAGES.find((p) => p.slug === slug);
      if (fallback) return res.json(fallback);
      return res.status(404).json({ message: "Page not found." });
    }
    // Auto-upgrade unmodified legacy August 2026 default boilerplate pages
    if (page.isDefault && typeof page.content === "string" && page.content.includes("Last updated: August 2026")) {
      const updatedDefault = DPDP_DEFAULT_PAGES.find((p) => p.slug === slug);
      if (updatedDefault) {
        const plain = typeof page.toObject === "function" ? page.toObject() : { ...page };
        return res.json({ ...plain, title: updatedDefault.title, content: updatedDefault.content });
      }
    }
    return res.json(page);
  } catch (err) {
    console.error("getPublicPageBySlug error:", err);
    return res.status(500).json({ message: "Could not fetch page details." });
  }
};
