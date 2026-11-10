/**
 * DPDP Act 2023 & DPDP Rules 2025 Compliance Configuration
 * Holds itemized Rule 3 notices (English & Hindi), sub-processor disclosures,
 * Grievance Officer details, and retention schedules.
 */

export const DPDP_NOTICE_VERSION = "2026.11-v1";

export const GRIEVANCE_OFFICER = {
  name: process.env.GRIEVANCE_OFFICER_NAME || "Grievance & Data Protection Officer",
  organization: "ClassTech Operating System",
  email: process.env.GRIEVANCE_OFFICER_EMAIL || "privacy@classtech.in",
  phone: process.env.GRIEVANCE_OFFICER_PHONE || "+91-9934597030",
  address: "ClassTech Privacy Office, Bengaluru, Karnataka, India",
  responseSlaDays: 30,
  statutoryMaxDays: 90,
  dpbiEscalationUrl: "https://www.dpb.gov.in",
};

export const DATA_RETENTION_POLICY = {
  securityAccessLogsMinDays: 365, // DPDP Rule 6 mandatory 1-year minimum
  aiHarvestPromptMaxDays: 90,
  inactiveLeadMaxDays: 180,
  inactiveAccountNoticeAdvanceHours: 48, // DPDP Rule 8 mandatory 48h advance warning
  inactiveAccountMaxDays: 1095, // 3 years (Schedule III baseline)
  archivedStudentMaxDays: 365,
  gstTaxLedgerRetainNote:
    "Anonymized GST/fee transaction totals without personal identifiers may be retained strictly to satisfy statutory tax & accounting obligations.",
};

export const SUB_PROCESSORS = [
  {
    name: "Supabase (PostgreSQL & Object Storage)",
    purpose: "Primary database persistence, authentication records, and study materials storage",
    location: "Cloud Infrastructure (Verify India ap-south-1 region)",
  },
  {
    name: "Google Gemini / OpenAI APIs",
    purpose: "AI doubt solving, quiz/notes generation, and pseudonymized institute analytics",
    location: "United States / Global Cloud (Student names & phone numbers tokenized before transfer)",
  },
  {
    name: "Meta WhatsApp Cloud API & TextBee SMS Gateway",
    purpose: "OTP verification, attendance alerts, fee reminders, and pre-deletion notifications",
    location: "Global / India",
  },
  {
    name: "Cashfree Payments",
    purpose: "Subscription checkout, WhatsApp/AI credit wallet top-ups, and GST invoicing",
    location: "India",
  },
  {
    name: "Cloudinary",
    purpose: "Institute logos, profile photos, study notes, and lead attachments",
    location: "Global CDN",
  },
  {
    name: "Firebase Cloud Messaging (Google)",
    purpose: "Academic notices & push alerts to teacher/student mobile devices",
    location: "Global",
  },
  {
    name: "Sentry & PostHog",
    purpose: "Technical error monitoring & product diagnostics (Disabled for minors / Student accounts; zero session replay)",
    location: "EU (Sentry DE) & US (PostHog)",
  },
];

export function buildDpdpNotice(lang = "en") {
  const isHindi = lang === "hi";
  const summary = isHindi
    ? "यह सूचना डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम, 2023 की धारा 5 एवं नियम 3 के अंतर्गत प्रदान की जाती है।"
    : "Provided under Section 5 of the DPDP Act, 2023 and Rule 3 of the DPDP Rules, 2025 prior to collecting personal data.";

  const itemizedPurposes = isHindi
    ? [
        {
          purpose: "खाता पंजीकरण एवं प्रमाणीकरण (OTP/पासवर्ड)",
          purposeTitle: "खाता पंजीकरण एवं प्रमाणीकरण (OTP/पासवर्ड)",
          dataCategories: "नाम, मोबाइल नंबर, ईमेल, संस्थान का नाम, डिवाइस पुश टोकन",
          purposeDescription: "स्पष्ट सहमति एवं आवश्यक सेवा निष्पादन",
          basis: "स्पष्ट सहमति एवं आवश्यक सेवा निष्पादन",
          required: true,
        },
        {
          purpose: "छात्र एवं अभिभावक शैक्षणिक प्रबंधन (बच्चों का डेटा — धारा 9)",
          purposeTitle: "छात्र एवं अभिभावक शैक्षणिक प्रबंधन (बच्चों का डेटा — धारा 9)",
          dataCategories: "छात्र का नाम, नामांकन संख्या, उपस्थिति, अंक, शुल्क इतिहास, माता-पिता/अभिभावक का नाम एवं फ़ोन",
          purposeDescription: "18 वर्ष से कम आयु के छात्रों के लिए सत्यापनीय अभिभावक सहमति (OTP) एवं चौथी अनुसूची शैक्षणिक छूट",
          basis: "18 वर्ष से कम आयु के छात्रों के लिए सत्यापनीय अभिभावक सहमति (OTP) एवं चौथी अनुसूची शैक्षणिक छूट",
          required: true,
        },
        {
          purpose: "शुल्क संग्रह एवं चालान",
          purposeTitle: "शुल्क संग्रह एवं चालान",
          dataCategories: "भुगतान राशि, तारीख, भुगतान माध्यम (Cash/Online/Cheque/Card), कर रिकॉर्ड",
          purposeDescription: "सेवा एवं वैधानिक कर/लेखा दायित्व",
          basis: "सेवा एवं वैधानिक कर/लेखा दायित्व",
          required: true,
        },
        {
          purpose: "ClassTech AI (संदेह समाधान एवं शैक्षणिक विश्लेषण)",
          purposeTitle: "ClassTech AI (संदेह समाधान एवं शैक्षणिक विश्लेषण)",
          dataCategories: "छद्मनामित शैक्षणिक संदर्भ (छात्र नाम/फ़ोन बाहरी AI को भेजने से पहले टोकन में बदले जाते हैं)",
          purposeDescription: "वैकल्पिक सहमति — प्रोफ़ाइल से कभी भी वापस ली जा सकती है",
          basis: "वैकल्पिक सहमति — प्रोफ़ाइल से कभी भी वापस ली जा सकती है",
          required: false,
        },
      ]
    : [
        {
          purpose: "Educator & Staff Account Registration, Login OTP & Workspace Access",
          purposeTitle: "Educator & Staff Account Registration, Login OTP & Workspace Access",
          dataCategories: "Full name, mobile number, email address, institute name, encrypted password hash, session & push tokens",
          purposeDescription: "Free, specific affirmative consent & SaaS workspace delivery",
          basis: "Free, specific affirmative consent & SaaS workspace delivery",
          required: true,
        },
        {
          purpose: "Student Enrollment, Attendance, Marks, Notes & Parent Communication (Minor Data — Sec 9 / Rule 10)",
          purposeTitle: "Student Enrollment, Attendance, Marks, Notes & Parent Communication (Sec 9 / Rule 10)",
          dataCategories: "Student name, DOB/minor status, enrollment number, phone, parent/guardian name & contact, attendance & test scores",
          purposeDescription: "Verifiable Parental Consent (via Guardian OTP) for <18 learners + Rule 12 Fourth Schedule core educational activities",
          basis: "Verifiable Parental Consent (via Guardian OTP) for <18 learners + Rule 12 Fourth Schedule core educational activities",
          required: true,
        },
        {
          purpose: "Fee Ledger, Receipts, Wallet Recharges & GST Accounting",
          purposeTitle: "Fee Ledger, Receipts, Wallet Recharges & GST Accounting",
          dataCategories: "Fee plan, amounts paid/pending, payment mode, transaction IDs, GST/billing address where entered",
          purposeDescription: "Service delivery & statutory tax/accounting retention obligations",
          basis: "Service delivery & statutory tax/accounting retention obligations",
          required: true,
        },
        {
          purpose: "ClassTech AI Tools & Doubt Solver (Optional Processing)",
          purposeTitle: "ClassTech AI Tools & Doubt Solver (Optional Processing)",
          dataCategories: "Chat queries, uploaded worksheet/form images, and pseudonymized cohort metrics (student names & phones tokenized before external LLM calls)",
          purposeDescription: "Explicit optional consent (+ Verifiable Parental Consent for <18 students); revocable anytime",
          basis: "Explicit optional consent (+ Verifiable Parental Consent for <18 students); revocable anytime",
          required: false,
        },
        {
          purpose: "WhatsApp / SMS Alerts & Inquiry Leads",
          purposeTitle: "WhatsApp / SMS Alerts & Inquiry Leads",
          dataCategories: "Recipient phone, inquiry name, course interest, notification delivery logs",
          purposeDescription: "Specific consent at form submission; promotional/alert consents independently revocable",
          basis: "Specific consent at form submission; promotional/alert consents independently revocable",
          required: false,
        },
      ];

  const rightsSummary = isHindi
    ? [
        "डेटा सारांश प्राप्त करने एवं तृतीय पक्ष सूची देखने का अधिकार (धारा 11)",
        "गलत डेटा सुधारने एवं पूर्ण डेटा मिटाने का अधिकार (धारा 12)",
        "दी गई सहमति को आसानी से वापस लेने का अधिकार (धारा 6(4))",
        "शिकायत अधिकारी से 30 दिनों (अधिकतम 90 दिनों) में निवारण एवं DPBI के समक्ष अपील का अधिकार (धारा 13)",
      ]
    : [
        "Right to Access a summary of your personal data & shared third-party processors (Sec 11 / Rule 14)",
        "Right to Correction, Completion & Erasure of personal data once purpose ends (Sec 12 / Rule 8)",
        "Right to Withdraw Consent as easily as granted via Profile Privacy Center (Sec 6(4))",
        "Right to Grievance Redressal within SLA (and up to DPBI at https://www.dpb.gov.in if unresolved) (Sec 13)",
        "Children's Safeguard (Sec 9): No behavioral tracking, session replay, or targeted advertising (AdSense disabled for student accounts)",
      ];

  const childrenNotice = isHindi
    ? "धारा 9 नाबालिग सुरक्षा: 18 वर्ष से कम छात्रों के लिए कोई व्यवहारिक ट्रैकिंग, सेशन रीप्ले या लक्षित विज्ञापन (AdSense) नहीं चलाया जाता।"
    : "DPDP Section 9 Safeguard: Behavioral tracking, session replay, and targeted advertising (AdSense) are strictly disabled for student accounts; minor AI usage requires Guardian OTP verification.";

  const boardEscalation = isHindi
    ? `यदि 30 दिनों के भीतर समाधान नहीं होता है, तो आप डेटा संरक्षण बोर्ड ऑफ इंडिया (${GRIEVANCE_OFFICER.dpbiEscalationUrl}) के समक्ष शिकायत दर्ज कर सकते हैं।`
    : `If unresolved within 30 days (statutory max ${GRIEVANCE_OFFICER.statutoryMaxDays} days), you may escalate to the Data Protection Board of India at ${GRIEVANCE_OFFICER.dpbiEscalationUrl}.`;

  return {
    version: DPDP_NOTICE_VERSION,
    language: isHindi ? "hi" : "en",
    title: isHindi
      ? "डिजिटल व्यक्तिगत डेटा संरक्षण (DPDP) अधिनियम 2023 एवं नियम 2025 — गोपनीयता सूचना"
      : "Digital Personal Data Protection (DPDP) Act 2023 & Rules 2025 — Itemized Privacy Notice",
    summary,
    intro: summary,
    childrenNotice,
    boardEscalation,
    grievanceOfficer: GRIEVANCE_OFFICER,
    retentionPolicy: DATA_RETENTION_POLICY,
    subProcessors: SUB_PROCESSORS,
    itemizedPurposes,
    items: itemizedPurposes,
    rightsSummary,
    rights: rightsSummary,
  };
}
