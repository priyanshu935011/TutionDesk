import { supabase } from "../utils/supabase.js";
import { callGeminiRaw, extractJsonFromText } from "./aiService.js";
import { getOrCreateStudentEntitlement } from "./studentEntitlementService.js";
import fs from "fs";
import path from "path";

const FALLBACK_DIR = process.env.FALLBACK_DIR || path.join(process.cwd(), "scratch", "data");
const CAREER_FALLBACK_FILE = path.join(FALLBACK_DIR, "career_guidance_fallback.json");

// Helper to ensure fallback JSON store exists for local resilience
function getFallbackStore() {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    if (fs.existsSync(CAREER_FALLBACK_FILE)) {
      return JSON.parse(fs.readFileSync(CAREER_FALLBACK_FILE, "utf-8"));
    }
  } catch (_) {}
  return {
    assessments: {},
    recommendations: {},
    roadmaps: {},
    chatSessions: {},
    chatMessages: {},
    monthlyUsage: {},
  };
}

function saveFallbackStore(store) {
  try {
    if (!fs.existsSync(FALLBACK_DIR)) {
      fs.mkdirSync(FALLBACK_DIR, { recursive: true });
    }
    fs.writeFileSync(CAREER_FALLBACK_FILE, JSON.stringify(store, null, 2), "utf-8");
  } catch (err) {
    console.error("[CareerService] Fallback store write error:", err.message);
  }
}

// ============================================================================
// 1. MASTER VERIFIED CAREER CATALOG (24 High-Growth Paths)
// ============================================================================
export const CAREER_CATALOG = [
  // TECH & ENGINEERING
  {
    id: "ai_ml_engineer",
    career_name: "AI & Machine Learning Engineer",
    category: "Engineering & Technology",
    description: "Designs, trains, and deploys deep neural networks, large language models, and predictive algorithms for autonomous systems and intelligent software.",
    qualifications: ["B.Tech / B.E in Computer Science / AI / Data Science", "M.Tech or M.S. in Machine Learning (Preferred)"],
    required_skills: ["Python", "PyTorch / TensorFlow", "Linear Algebra", "Calculus & Probability", "Data Structures", "System Design"],
    relevant_subjects: ["Mathematics", "Computer Science", "Physics", "Statistics"],
    career_opportunities: ["AI Research Labs", "Autonomous Vehicle Companies", "Fintech & Algorithmic Trading", "Global Tech Giants"],
    potential_challenges: ["Rapidly evolving tools requiring non-stop upskilling", "High mathematical rigor needed"],
    salary_insights: { entry: "₹8 – ₹18 LPA", mid: "₹20 – ₹45 LPA", senior: "₹50 LPA – ₹1.2 Cr+", note: "India 2026 tech compensation benchmarks; higher for US/remote roles." },
    top_exams: ["JEE Advanced", "JEE Main", "BITSAT", "GATE (for PG)"],
    top_colleges: ["IIT Bombay", "IIT Delhi", "IIT Madras", "IIIT Hyderabad", "BITS Pilani"],
    tags: ["tech", "coding", "math", "analytical", "high_salary", "software"],
  },
  {
    id: "full_stack_architect",
    career_name: "Full-Stack Software Architect",
    category: "Engineering & Technology",
    description: "Architects scalable cloud architectures, high-performance web applications, distributed APIs, and mobile backend systems.",
    qualifications: ["B.Tech / B.E in CSE / IT", "BCA + MCA", "B.Sc Computer Science"],
    required_skills: ["TypeScript / JavaScript", "React & Flutter", "Node.js / Go / Rust", "SQL & NoSQL Databases", "Distributed Systems", "Cloud (AWS/GCP)"],
    relevant_subjects: ["Computer Science", "Mathematics", "Logic Design"],
    career_opportunities: ["High-growth Product Startups", "SaaS Enterprises", "Global Technology Consultancies", "Freelance & Remote Consulting"],
    potential_challenges: ["Demands mastery across both frontend UI and low-level backend databases", "On-call incident management"],
    salary_insights: { entry: "₹6 – ₹14 LPA", mid: "₹18 – ₹35 LPA", senior: "₹40 LPA – ₹80 LPA+", note: "India 2026 benchmark." },
    top_exams: ["JEE Main", "VITEEE", "COMEDK", "SRMJEEE", "NIMCET (for MCA)"],
    top_colleges: ["IITs", "NIT Trichy", "NIT Surathkal", "DTU", "VIT Vellore"],
    tags: ["tech", "coding", "software", "creative", "problem_solving", "high_salary"],
  },
  {
    id: "cybersecurity_specialist",
    career_name: "Cybersecurity & Defense Specialist",
    category: "Engineering & Technology",
    description: "Defends corporate and national infrastructure against cyber threats, ransomware, zero-day vulnerabilities, and conducts ethical penetration testing.",
    qualifications: ["B.Tech in CSE / Information Security", "B.Sc Cyber Security", "Certifications: CEH, OSCP, CISSP"],
    required_skills: ["Network Security", "Penetration Testing", "Linux & Shell Scripting", "Cryptography", "Reverse Engineering", "Incident Response"],
    relevant_subjects: ["Computer Science", "Mathematics", "Networking"],
    career_opportunities: ["Defense & Intelligence Agencies", "Banking & Fintech Firms", "Big 4 Advisory", "Specialized Security Firms"],
    potential_challenges: ["High-stress incident response hours", "Must continuously track emerging threat vectors"],
    salary_insights: { entry: "₹5.5 – ₹12 LPA", mid: "₹15 – ₹30 LPA", senior: "₹35 LPA – ₹70 LPA+", note: "Security talent faces massive supply deficit in India." },
    top_exams: ["JEE Main", "BITSAT", "State CETs"],
    top_colleges: ["IITs", "IIIT Delhi", "NFSU (National Forensic Sciences University)", "Amrita University"],
    tags: ["tech", "security", "problem_solving", "analytical", "government"],
  },
  {
    id: "data_scientist",
    career_name: "Data Scientist & Analytics Consultant",
    category: "Engineering & Technology",
    description: "Extracts deep actionable business insights from big data using statistical modeling, hypothesis testing, and predictive analytics.",
    qualifications: ["B.Tech / B.Stat / B.Math", "B.Sc in Statistics / Data Science", "M.Sc in Data Science / MBA in Business Analytics"],
    required_skills: ["Python & R", "Applied Statistics", "SQL & BigQuery", "Tableau / PowerBI", "A/B Testing", "Machine Learning Basics"],
    relevant_subjects: ["Mathematics", "Statistics", "Economics", "Computer Science"],
    career_opportunities: ["E-Commerce & Retail", "Consulting Firms (McKinsey, BCG)", "Healthcare & Pharma Analytics", "Fintech"],
    potential_challenges: ["Translating raw messy data into clean actionable business decisions", "Balancing business and technical demands"],
    salary_insights: { entry: "₹7 – ₹15 LPA", mid: "₹18 – ₹36 LPA", senior: "₹42 LPA – ₹85 LPA+", note: "High demand across Indian MNCs." },
    top_exams: ["ISI Admission Test", "JEE Main", "CUET (for B.Sc Stats)"],
    top_colleges: ["Indian Statistical Institute (ISI Kolkata)", "Chennai Mathematical Institute (CMI)", "IIT Kharagpur", "St. Xavier's Mumbai"],
    tags: ["math", "statistics", "analytical", "tech", "business", "high_salary"],
  },
  {
    id: "robotics_engineer",
    career_name: "Robotics & Autonomous Systems Engineer",
    category: "Engineering & Technology",
    description: "Designs and programs robotic manipulators, industrial automation, drone fleets, and robotic hardware with computer vision and kinematics.",
    qualifications: ["B.Tech in Mechatronics / Mechanical / Electrical / Robotics", "M.Tech in Robotics"],
    required_skills: ["ROS (Robot Operating System)", "C++ & Python", "Kinematics & Dynamics", "Embedded Systems", "Computer Vision", "CAD / 3D Modeling"],
    relevant_subjects: ["Physics", "Mathematics", "Electronics"],
    career_opportunities: ["Industrial Automation & Manufacturing", "Space Agencies (ISRO/NASA)", "Defense & Drones", "Warehouse Logistics (Amazon)"],
    potential_challenges: ["Requires physical hardware prototyping which can be capital-intensive", "Interdisciplinary mastery needed"],
    salary_insights: { entry: "₹5 – ₹11 LPA", mid: "₹14 – ₹28 LPA", senior: "₹32 LPA – ₹65 LPA+", note: "Rapidly expanding with India's manufacturing boom." },
    top_exams: ["JEE Advanced", "JEE Main", "BITSAT"],
    top_colleges: ["IIT Kanpur", "IIT Madras", "IISc Bangalore", "PSG College of Technology"],
    tags: ["physics", "math", "hardware", "engineering", "creative", "research"],
  },

  // MEDICINE & HEALTHCARE
  {
    id: "medical_doctor",
    career_name: "Medical Doctor & Specialist Physician / Surgeon",
    category: "Medicine & Healthcare",
    description: "Diagnoses illnesses, performs life-saving surgeries, and treats patients across specialized disciplines like Cardiology, Oncology, Pediatrics, or Neurosurgery.",
    qualifications: ["MBBS (5.5 years)", "MD / MS Post-Graduation (3 years)", "DM / MCh Super-Specialization (Optional)"],
    required_skills: ["Clinical Diagnosis", "Anatomy & Physiology", "Patient Empathy", "Critical Decision Making", "Surgical Precision", "Pharmacology"],
    relevant_subjects: ["Biology", "Chemistry", "Physics"],
    career_opportunities: ["Super-Specialty Hospitals", "Government Health Services", "Private Practice / Clinic", "Clinical Research & Academia"],
    potential_challenges: ["Lengthy training timeline (8-10 years to full practice)", "Demanding emergency hours and emotional resilience"],
    salary_insights: { entry: "₹8 – ₹15 LPA (Resident)", mid: "₹20 – ₹45 LPA", senior: "₹50 LPA – ₹1.5 Cr+", note: "Super-specialists in private hospitals command top-tier compensation." },
    top_exams: ["NEET UG", "NEET PG", "INICET"],
    top_colleges: ["AIIMS New Delhi", "CMC Vellore", "JIPMER Puducherry", "KMC Manipal", "Maulana Azad Medical College (MAMC)"],
    tags: ["biology", "healthcare", "service", "science", "high_respect", "patient_care"],
  },
  {
    id: "biotech_researcher",
    career_name: "Biotechnologist & Genetic Engineer",
    category: "Medicine & Healthcare",
    description: "Develops synthetic biological products, mRNA vaccines, CRISPR gene therapies, and bio-agriculture solutions in frontier laboratories.",
    qualifications: ["B.Tech / B.Sc in Biotechnology / Biochemistry", "M.Sc / Ph.D in Molecular Biology"],
    required_skills: ["CRISPR & Gene Editing", "Cell Culture", "Bio-Processing", "Statistical Genomics", "Lab Safety & Quality Protocols"],
    relevant_subjects: ["Biology", "Chemistry", "Mathematics"],
    career_opportunities: ["Global Biopharma (Serum Institute, Biocon)", "Agri-Tech Companies", "Academic Research Institutes", "Forensic Labs"],
    potential_challenges: ["Research timelines can take years for regulatory approvals", "Advanced degrees (Ph.D.) typically required for lead roles"],
    salary_insights: { entry: "₹4.5 – ₹8 LPA", mid: "₹12 – ₹24 LPA", senior: "₹28 LPA – ₹60 LPA+", note: "India's biopharma sector projected at $150B by 2026." },
    top_exams: ["NEET UG", "CUET", "GATE BT", "GAT-B"],
    top_colleges: ["IISc Bangalore", "IIT Delhi (Biotech)", "BITS Pilani", "Delhi University (Dept. of Genetics)"],
    tags: ["biology", "chemistry", "research", "science", "laboratory", "innovation"],
  },
  {
    id: "bioinformatics_specialist",
    career_name: "Bioinformatics & Genomic Data Specialist",
    category: "Medicine & Healthcare",
    description: "Bridges computational algorithms and biology to decode DNA sequences, map genetic diseases, and accelerate drug discovery.",
    qualifications: ["B.Tech / B.Sc in Bioinformatics / CSE with Biotech", "M.S. in Computational Biology"],
    required_skills: ["Python / R for Biology", "Genomic Sequencing (NGS)", "Molecular Docking", "Structural Biology", "Biostatistics"],
    relevant_subjects: ["Biology", "Computer Science", "Mathematics"],
    career_opportunities: ["Genomics Companies", "Pharma R&D Centers", "Cancer Research Institutes", "Global Biotech Firms"],
    potential_challenges: ["Requires equal proficiency in coding and complex cellular biology"],
    salary_insights: { entry: "₹6 – ₹12 LPA", mid: "₹16 – ₹30 LPA", senior: "₹35 LPA – ₹70 LPA+", note: "High demand abroad and at leading Indian genome institutes." },
    top_exams: ["CUET", "JEE Main", "GAT-B"],
    top_colleges: ["IIT Kharagpur", "IBAB Bangalore", "JNU New Delhi", "Pune University"],
    tags: ["biology", "tech", "coding", "research", "analytical", "healthcare"],
  },

  // BUSINESS, FINANCE & MANAGEMENT
  {
    id: "investment_banker",
    career_name: "Investment Banker & Financial Analyst",
    category: "Business, Finance & Management",
    description: "Advises Fortune 500 corporations and private equity funds on multi-billion dollar mergers, acquisitions, IPOs, and debt restructuring.",
    qualifications: ["B.Com / BBA / B.Tech + MBA (Finance)", "Chartered Financial Analyst (CFA Level 1, 2, 3)"],
    required_skills: ["Financial Modeling (DCF, LBO)", "Valuation", "Pitchbook Creation", "Corporate Finance", "Excel Mastery", "Deal Negotiation"],
    relevant_subjects: ["Mathematics", "Economics", "Accountancy", "Statistics"],
    career_opportunities: ["Bulge Bracket Banks (Goldman Sachs, Morgan Stanley, J.P. Morgan)", "Private Equity & VC Funds", "Big 4 M&A Teams"],
    potential_challenges: ["Long working hours (70-80 hours/week in early career)", "High-stakes deal deadlines"],
    salary_insights: { entry: "₹12 – ₹28 LPA", mid: "₹35 – ₹70 LPA", senior: "₹80 LPA – ₹2.5 Cr+", note: "Includes substantial performance bonuses." },
    top_exams: ["CAT (for IIMs)", "XAT", "IPMAT (IIM Indore/Rohtak after 12th)", "CFA"],
    top_colleges: ["IIM Ahmedabad", "IIM Bangalore", "IIM Calcutta", "SRCC Delhi", "St. Stephen's College"],
    tags: ["finance", "business", "math", "high_salary", "analytical", "leadership"],
  },
  {
    id: "chartered_accountant",
    career_name: "Chartered Accountant (CA)",
    category: "Business, Finance & Management",
    description: "Statutory authority for auditing, financial reporting, corporate tax strategy, forensics, and fiduciary compliance in India and abroad.",
    qualifications: ["ICAI Chartered Accountancy (Foundation, Intermediate, Articleship, Final)"],
    required_skills: ["Statutory Auditing", "Direct & Indirect Taxation (GST/Income Tax)", "Financial Reporting (Ind AS / IFRS)", "Corporate Law", "Financial Risk Management"],
    relevant_subjects: ["Accountancy", "Economics", "Business Studies", "Commercial Mathematics"],
    career_opportunities: ["Big 4 Accounting (Deloitte, PwC, EY, KPMG)", "Independent Audit Practice", "CFO / Finance Director Track", "Government Financial Cadres"],
    potential_challenges: ["Intense exam pass percentages (10-15%)", "3-year rigorous mandatory articleship"],
    salary_insights: { entry: "₹9 – ₹16 LPA", mid: "₹20 – ₹40 LPA", senior: "₹45 LPA – ₹1 Cr+", note: "Stable, recession-proof qualification with global reciprocity." },
    top_exams: ["CA Foundation (after 12th)", "CA Intermediate", "CA Final"],
    top_colleges: ["Direct registration with The Institute of Chartered Accountants of India (ICAI)"],
    tags: ["finance", "accounting", "law", "analytical", "independent", "stability"],
  },
  {
    id: "product_manager",
    career_name: "Tech Product Manager (PM)",
    category: "Business, Finance & Management",
    description: "Acts as the 'CEO of the product', uniting engineering, UX design, and business strategy to launch beloved digital products.",
    qualifications: ["B.Tech / B.E / BBA + MBA", "B.Tech with strong product portfolio"],
    required_skills: ["Product Roadmap Strategy", "User Research & PRD Writing", "Data Analytics & Funnels", "Agile & Scrum", "Cross-Functional Leadership"],
    relevant_subjects: ["Computer Science", "Business Studies", "Psychology", "Mathematics"],
    career_opportunities: ["Consumer Tech (Swiggy, Zomato, Flipkart)", "Fintech Unicorns", "Enterprise SaaS Companies", "Global Tech (Google, Meta)"],
    potential_challenges: ["Responsibility for product metrics without direct authority over engineers", "Handling competing stakeholder opinions"],
    salary_insights: { entry: "₹10 – ₹22 LPA (APM)", mid: "₹25 – ₹50 LPA", senior: "₹55 LPA – ₹1.2 Cr+", note: "One of the fastest-growing leadership tracks in tech." },
    top_exams: ["CAT", "GMAT", "JEE Main"],
    top_colleges: ["IIMs", "ISB Hyderabad", "IITs", "FMS Delhi", "XLRI Jamshedpur"],
    tags: ["business", "tech", "leadership", "creative", "high_salary", "communication"],
  },
  {
    id: "growth_marketing_lead",
    career_name: "Growth Marketer & Digital Brand Strategist",
    category: "Business, Finance & Management",
    description: "Drives customer acquisition, viral campaigns, search optimization, and retention funnels using marketing automation and creative storytelling.",
    qualifications: ["BBA / B.Com / Mass Media", "MBA in Marketing (Optional)"],
    required_skills: ["Performance Marketing (Meta/Google Ads)", "SEO & Content Funnels", "Conversion Rate Optimization (CRO)", "Copywriting & Storytelling", "Brand Positioning"],
    relevant_subjects: ["English", "Business Studies", "Economics", "Psychology"],
    career_opportunities: ["D2C Brands", "E-Commerce Giants", "Digital Agencies", "Creator Economy Startups"],
    potential_challenges: ["Constant algorithmic changes across ad platforms", "Direct pressure on customer acquisition costs (CAC)"],
    salary_insights: { entry: "₹4.5 – ₹10 LPA", mid: "₹14 – ₹28 LPA", senior: "₹30 LPA – ₹65 LPA+", note: "High performance-linked bonuses and equity." },
    top_exams: ["CUET", "IPMAT", "CAT"],
    top_colleges: ["MICA Ahmedabad", "Symbiosis Pune", "St. Xavier's College", "NMIMS Mumbai"],
    tags: ["creative", "business", "communication", "marketing", "social"],
  },

  // LAW, HUMANITIES & CIVIL SERVICES
  {
    id: "corporate_lawyer",
    career_name: "Corporate Lawyer & M&A Legal Counsel",
    category: "Law & Humanities",
    description: "Structures international contracts, intellectual property protection, venture financing rounds, and corporate compliance for enterprises.",
    qualifications: ["B.A. LL.B / B.B.A. LL.B (5-year Integrated Law)", "LL.M in Corporate Law (Optional)"],
    required_skills: ["Contract Drafting", "Due Diligence", "Legal Research", "Arbitration & Dispute Resolution", "Negotiation", "Regulatory Compliance (SEBI/RBI)"],
    relevant_subjects: ["Legal Studies", "Political Science", "English", "Economics"],
    career_opportunities: ["Tier-1 Law Firms (Shardul Amarchand Mangaldas, AZB, Trilegal)", "In-House Counsel at MNCs", "International Arbitrations"],
    potential_challenges: ["Exacting detail orientation where a single word changes contract liability", "Demanding litigation timelines"],
    salary_insights: { entry: "₹8 – ₹18 LPA", mid: "₹22 – ₹45 LPA", senior: "₹50 LPA – ₹1.5 Cr+ (Partner)", note: "Tier-1 NLU graduates secure premier firm placements." },
    top_exams: ["CLAT (Common Law Admission Test)", "AILET (NLU Delhi)", "SLAT"],
    top_colleges: ["NLSIU Bengaluru", "NALSAR Hyderabad", "WBNUJS Kolkata", "NLU Delhi", "NLU Jodhpur"],
    tags: ["law", "communication", "analytical", "reading", "high_salary", "negotiation"],
  },
  {
    id: "civil_services_officer",
    career_name: "Civil Services Officer (IAS / IPS / IFS / IRS)",
    category: "Civil Services & Defense",
    description: "Spearheads district administration, law enforcement, international foreign policy, and public policy formulation for the Republic of India.",
    qualifications: ["Any Recognized Bachelor's Degree (B.A., B.Sc., B.Tech., MBBS, etc.)"],
    required_skills: ["Public Administration", "Constitutional Law", "Crisis Management", "Diplomacy & Public Communication", "Analytical Essay Writing", "Integrity"],
    relevant_subjects: ["History", "Geography", "Polity", "Economics", "Current Affairs"],
    career_opportunities: ["District Magistrate / Collector", "Ambassador / Diplomat (IFS)", "Superintendent of Police (IPS)", "Ministry Policy Secretary"],
    potential_challenges: ["One of the most competitive exams in the world (<0.1% selection rate)", "Frequent administrative transfers and political scrutiny"],
    salary_insights: { entry: "₹56,100/mo (Basic) + DA + HRA (Govt pay scale)", mid: "Joint Secretary pay scale", senior: "Cabinet Secretary scale", note: "Exceptional job security, state accommodation, and immense societal influence." },
    top_exams: ["UPSC Civil Services Examination (CSE)"],
    top_colleges: ["Any accredited central or state university; open to graduates of all academic streams"],
    tags: ["government", "service", "leadership", "social", "stability", "high_respect"],
  },
  {
    id: "defense_officer",
    career_name: "Armed Forces Officer (Army / Navy / Air Force)",
    category: "Civil Services & Defense",
    description: "Leads tactical combat squadrons, naval warships, or supersonic fighter aircraft defending sovereign land, seas, and airspace with military honor.",
    qualifications: ["10+2 with Physics & Math (Air Force & Navy)", "Any 10+2 (Army)", "Training at NDA Khadakwasla / IMA Dehradun / INA / AFA"],
    required_skills: ["Officer Like Qualities (OLQ)", "Physical Endurance & Fitness", "Tactical Strategy", "Decisiveness under Fire", "Navigation & Avionics", "Discipline"],
    relevant_subjects: ["Physics", "Mathematics", "General Knowledge", "English"],
    career_opportunities: ["Combat Arms & Flying Branches", "Naval Engineering & Technical Corps", "Military Intelligence", "Special Forces"],
    potential_challenges: ["Rigorous physical risk and postings in extreme geographic conditions", "Time away from family"],
    salary_insights: { entry: "₹56,100 – ₹1,77,500/mo (Level 10) + Military Service Pay (MSP)", mid: "Level 12 – 13", senior: "General / Admiral ranks", note: "Free medical care, defense housing, military pension, and national honor." },
    top_exams: ["NDA & NA Exam (UPSC - after 12th)", "CDS Exam (after graduation)", "AFCAT"],
    top_colleges: ["National Defence Academy (Khadakwasla)", "Indian Military Academy (Dehradun)", "Air Force Academy (Dundigal)"],
    tags: ["defense", "service", "physical", "leadership", "patriotism", "government"],
  },

  // DESIGN, MEDIA & ARCHITECTURE
  {
    id: "ui_ux_designer",
    career_name: "UI/UX Product Designer",
    category: "Design & Creative Arts",
    description: "Creates intuitive digital interfaces, design systems, interactive prototypes, and frictionless user experiences for mobile apps and web platforms.",
    qualifications: ["B.Des in Interaction / Communication Design", "B.Tech with strong design portfolio", "B.Sc in Multimedia"],
    required_skills: ["Figma & Design Systems", "User Research & Wireframing", "Interaction Design & Micro-Animations", "Information Architecture", "Visual Typography & Color Theory"],
    relevant_subjects: ["Arts", "Computer Science", "Psychology", "English"],
    career_opportunities: ["Fintech & Consumer Tech Apps", "Global Design Agencies", "Remote Global Tech Companies", "Freelance Product Design Studio"],
    potential_challenges: ["Balancing aesthetic aspirations with engineering implementation constraints", "Continuous user testing iterations"],
    salary_insights: { entry: "₹6 – ₹13 LPA", mid: "₹16 – ₹32 LPA", senior: "₹36 LPA – ₹75 LPA+", note: "Top product designers rival engineering salaries in modern tech." },
    top_exams: ["UCEED (IITs)", "NID DAT", "CEED (for PG)"],
    top_colleges: ["National Institute of Design (NID Ahmedabad)", "IDC School of Design (IIT Bombay)", "Srishti Institute Bengaluru", "MIT Institute of Design Pune"],
    tags: ["creative", "design", "tech", "psychology", "visual", "high_salary"],
  },
  {
    id: "game_designer",
    career_name: "Game Designer & Interactive 3D Artist",
    category: "Design & Creative Arts",
    description: "Builds immersive 3D gaming worlds, gameplay mechanics, narrative questlines, and physics simulations using Unreal Engine and Unity.",
    qualifications: ["B.Des / B.Sc in Game Design", "B.Tech CSE with Computer Graphics / Game Development focus"],
    required_skills: ["Unreal Engine 5 / Unity", "C++ & C#", "3D Modeling (Blender/Maya)", "Game Mechanics & Balancing", "Level Design", "Shaders & Physics"],
    relevant_subjects: ["Mathematics", "Computer Science", "Physics", "Visual Arts"],
    career_opportunities: ["AAA Game Studios (Ubisoft, Rockstar, EA)", "Mobile Gaming Unicorns", "Virtual Reality & Metaverse Studios", "VFX Film Studios"],
    potential_challenges: ["Production crunch periods before game launches", "High artistic and technical competition"],
    salary_insights: { entry: "₹5 – ₹11 LPA", mid: "₹14 – ₹28 LPA", senior: "₹32 LPA – ₹65 LPA+", note: "Rapidly growing with India's 500M+ gamer ecosystem." },
    top_exams: ["NID DAT", "UCEED", "Studio Portfolio Evaluations"],
    top_colleges: ["NID", "Rubika DSK Pune", "National Institute of Film & Fine Arts", "IIIT Hyderabad (Computer Vision & Graphics Lab)"],
    tags: ["creative", "tech", "gaming", "visual", "coding", "art"],
  },
  {
    id: "architect",
    career_name: "Architect & Urban Infrastructure Planner",
    category: "Design & Creative Arts",
    description: "Envisions sustainable high-rise skyscrapers, green residential townships, and eco-friendly civic spaces balancing aesthetic elegance and structural physics.",
    qualifications: ["B.Arch (5 years, mandatory for COA license)", "M.Arch in Urban Planning / Sustainable Architecture"],
    required_skills: ["Architectural Drafting & Spatial Planning", "AutoCAD & Revit (BIM)", "3D Rendering (Rhino, Lumion)", "Structural Physics & Building Codes", "Sustainable Materials"],
    relevant_subjects: ["Mathematics", "Physics", "Visual Drawing"],
    career_opportunities: ["Premier Architecture Studios", "Urban Development Authorities (Smart Cities)", "Real Estate Developers", "Independent Architectural Practice"],
    potential_challenges: ["Long gestation period for project construction", "Balancing client budgets with architectural design vision"],
    salary_insights: { entry: "₹4.5 – ₹8 LPA", mid: "₹11 – ₹24 LPA", senior: "₹30 LPA – ₹80 LPA+ (Principal)", note: "Independent practices with marquee projects generate substantial profits." },
    top_exams: ["NATA (National Aptitude Test in Architecture)", "JEE Main Paper 2"],
    top_colleges: ["CEPT University Ahmedabad", "School of Planning and Architecture (SPA Delhi)", "IIT Roorkee", "Sir J.J. College of Architecture Mumbai"],
    tags: ["design", "math", "physics", "creative", "building", "independent"],
  },

  // SCIENCE & FRONTIER RESEARCH
  {
    id: "astrophysicist",
    career_name: "Astrophysicist & Space Scientist",
    category: "Science & Frontier Research",
    description: "Investigates cosmic phenomena, black holes, gravitational waves, exoplanets, and develops payload instruments for planetary space probes.",
    qualifications: ["B.Sc / B.Tech in Physics / Engineering Physics", "M.Sc & Ph.D in Astronomy / Astrophysics"],
    required_skills: ["Theoretical & Quantum Physics", "Computational Astrophysics (Python/Fortran)", "Astronomical Data Analysis", "Telescope Spectroscopy", "Differential Equations"],
    relevant_subjects: ["Physics", "Mathematics", "Computer Science"],
    career_opportunities: ["ISRO (Indian Space Research Organisation)", "IUCAA / TIFR / IIA", "Global Observatories & NASA", "Defense Aerospace Labs"],
    potential_challenges: ["Requires deep academic endurance (typically requires a Ph.D. and post-doctoral fellowships)", "Pure research funding dynamics"],
    salary_insights: { entry: "₹7 – ₹14 LPA (Scientist 'SC')", mid: "₹18 – ₹32 LPA", senior: "₹35 LPA – ₹60 LPA+", note: "Govt scientist pay scales with elite research allowances." },
    top_exams: ["JEE Advanced", "KVPY / IAT (IISER Aptitude Test)", "JEST", "GATE"],
    top_colleges: ["IISc Bangalore", "IIST Thiruvananthapuram", "IISER Pune / Kolkata", "TIFR Mumbai", "IIT Bombay (Engg Physics)"],
    tags: ["physics", "math", "space", "research", "science", "analytical"],
  },
  {
    id: "environmental_scientist",
    career_name: "Renewable Energy & Climate Scientist",
    category: "Science & Frontier Research",
    description: "Engineers solar grid storage, green hydrogen technologies, and leads carbon reduction strategies to combat global climate disruption.",
    qualifications: ["B.Tech / B.Sc in Environmental Science / Chemical / Energy Engineering", "M.Tech / M.S. in Renewable Energy"],
    required_skills: ["Carbon Accounting", "Solar & Battery Storage Modeling", "Environmental Impact Assessment (EIA)", "GIS & Remote Sensing", "Climate Policy Analysis"],
    relevant_subjects: ["Chemistry", "Physics", "Geography", "Biology"],
    career_opportunities: ["Clean-Tech Companies (Adani Green, Tata Power)", "UN Environmental Program (UNEP)", "ESG Advisory for Global Funds", "Energy Research Labs"],
    potential_challenges: ["Navigating international climate regulations and policy shifts"],
    salary_insights: { entry: "₹5 – ₹10 LPA", mid: "₹13 – ₹26 LPA", senior: "₹30 LPA – ₹65 LPA+", note: "Exploding corporate demand under mandatory ESG governance." },
    top_exams: ["JEE Main", "CUET", "GATE"],
    top_colleges: ["TERI School of Advanced Studies Delhi", "IIT Delhi (Energy Studies)", "IIT Bombay", "Banaras Hindu University (BHU)"],
    tags: ["science", "chemistry", "research", "nature", "social", "innovation"],
  },
];

// Helper map for fast lookup
export const CAREER_MAP = new Map(CAREER_CATALOG.map((c) => [c.id, c]));

// ============================================================================
// 2. ASSESSMENT & COMPATIBILITY CALCULATION ENGINE
// ============================================================================

/**
 * Deterministic Multi-Dimensional Career Compatibility Algorithm
 * Weights:
 * - Interest Fit: 30%
 * - Skill Fit: 25%
 * - Academic Fit: 20%
 * - Work Preference: 15%
 * - Career Goals: 10%
 */
export function calculateCompatibilityScore(assessment, career) {
  if (!assessment || !career) return 60;

  const {
    education_level = "10th",
    academic_profile = {},
    interests = [],
    skills = [],
    work_preferences = {},
    career_goals = {},
  } = assessment;

  // 1. Interest Compatibility (Max 30 points)
  let interestScore = 0;
  const userInterests = Array.isArray(interests) ? interests.map((s) => String(s).toLowerCase().trim()) : [];
  const careerTags = (career.tags || []).map((t) => t.toLowerCase());

  let interestMatches = 0;
  for (const tag of careerTags) {
    if (userInterests.some((ui) => ui.includes(tag) || tag.includes(ui))) {
      interestMatches++;
    }
  }
  const interestRatio = careerTags.length > 0 ? Math.min(1.0, interestMatches / Math.min(3, careerTags.length)) : 0.6;
  interestScore = interestRatio * 30;

  // 2. Skill Compatibility (Max 25 points)
  let skillScore = 0;
  const userSkills = Array.isArray(skills) ? skills.map((s) => String(s).toLowerCase().trim()) : [];
  const careerReqSkills = (career.required_skills || []).map((s) => s.toLowerCase());

  let skillMatches = 0;
  for (const req of careerReqSkills) {
    if (userSkills.some((us) => req.includes(us) || us.includes(req))) {
      skillMatches++;
    }
  }
  const skillRatio = careerReqSkills.length > 0 ? Math.min(1.0, (skillMatches + 1) / Math.min(4, careerReqSkills.length)) : 0.5;
  skillScore = skillRatio * 25;

  // 3. Academic Profile Fit (Max 20 points)
  let academicScore = 14; // baseline sensible fit
  const userStream = String(academic_profile.stream || "").toLowerCase();
  const userSubjects = Array.isArray(academic_profile.subjects)
    ? academic_profile.subjects.map((s) => String(s).toLowerCase())
    : [];

  const careerCategory = career.category.toLowerCase();
  if (careerCategory.includes("engineering") || careerCategory.includes("tech")) {
    if (userStream.includes("science") || userStream.includes("pcm")) academicScore = 20;
    else if (userSubjects.some((s) => s.includes("math") || s.includes("computer"))) academicScore = 18;
    else if (userStream.includes("commerce")) academicScore = 12;
  } else if (careerCategory.includes("medicine") || careerCategory.includes("healthcare")) {
    if (userStream.includes("pcb") || userSubjects.some((s) => s.includes("bio"))) academicScore = 20;
    else if (userStream.includes("science")) academicScore = 16;
    else academicScore = 10;
  } else if (careerCategory.includes("business") || careerCategory.includes("finance")) {
    if (userStream.includes("commerce") || userSubjects.some((s) => s.includes("math") || s.includes("econ"))) academicScore = 20;
    else academicScore = 16;
  } else if (careerCategory.includes("law") || careerCategory.includes("humanities")) {
    academicScore = 18; // Law welcomes all streams
  } else if (careerCategory.includes("civil") || careerCategory.includes("defense")) {
    academicScore = 18; // Defense/UPSC open to broad backgrounds
  }

  // 4. Work Preferences Fit (Max 15 points)
  let prefScore = 11;
  const workStyle = String(work_preferences.workStyle || "").toLowerCase();
  const envType = String(work_preferences.environment || "").toLowerCase();

  if (workStyle.includes("analytical") && careerTags.includes("analytical")) prefScore += 2;
  if (workStyle.includes("creative") && careerTags.includes("creative")) prefScore += 2;
  if (envType.includes("government") && careerTags.includes("government")) prefScore += 2;
  if (envType.includes("startup") && (careerTags.includes("tech") || careerTags.includes("business"))) prefScore += 2;
  prefScore = Math.min(15, prefScore);

  // 5. Goals Fit (Max 10 points)
  let goalScore = 7;
  const salaryGoal = String(career_goals.salaryExpectation || "").toLowerCase();
  if (salaryGoal.includes("high") && careerTags.includes("high_salary")) goalScore += 3;
  goalScore = Math.min(10, goalScore);

  const rawTotal = Math.round(interestScore + skillScore + academicScore + prefScore + goalScore);
  // Normalize into realistic score range [62% - 97%]
  return Math.min(97, Math.max(62, rawTotal));
}

/**
 * Save or update assessment draft
 */
export async function saveAssessmentDraft(userId, data) {
  const uid = String(userId);
  const nowIso = new Date().toISOString();

  const payload = {
    user_id: uid,
    education_level: data.educationLevel || data.education_level || "10th",
    academic_profile: data.academicProfile || data.academic_profile || {},
    interests: data.interests || [],
    skills: data.skills || [],
    work_preferences: data.workPreferences || data.work_preferences || {},
    career_goals: data.careerGoals || data.career_goals || {},
    current_step: Number(data.currentStep || data.current_step || 1),
    status: data.isCompleted ? "completed" : "draft",
    completed_at: data.isCompleted ? nowIso : null,
    updated_at: nowIso,
  };

  try {
    const { data: existing } = await supabase
      .from("career_assessments")
      .select("id")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id) {
      const { data: updated, error } = await supabase
        .from("career_assessments")
        .update(payload)
        .eq("id", existing.id)
        .select()
        .single();
      if (!error && updated) return updated;
    } else {
      const { data: created, error } = await supabase
        .from("career_assessments")
        .insert({ ...payload, created_at: nowIso })
        .select()
        .single();
      if (!error && created) return created;
    }
  } catch (err) {
    console.warn("[CareerService] Supabase saveAssessmentDraft error, using fallback store:", err.message);
  }

  // Fallback Store
  const store = getFallbackStore();
  let existingId = Object.keys(store.assessments).find((k) => store.assessments[k].user_id === uid);
  const id = existingId || `assess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const record = { id, ...payload, created_at: store.assessments[id]?.created_at || nowIso };
  store.assessments[id] = record;
  saveFallbackStore(store);
  return record;
}

/**
 * Fetch latest assessment for a user
 */
export async function getStudentAssessment(userId) {
  const uid = String(userId);

  try {
    const { data } = await supabase
      .from("career_assessments")
      .select("*")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (data) return data;
  } catch (err) {
    console.warn("[CareerService] getStudentAssessment DB error, using fallback store:", err.message);
  }

  const store = getFallbackStore();
  const list = Object.values(store.assessments).filter((a) => a.user_id === uid);
  list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return list[0] || null;
}

/**
 * Generate Career Recommendations using Hybrid Multi-Factor Scoring + Gemini Deep Reasoning
 */
export async function generateRecommendations(userId, assessmentId = null, isPremium = false) {
  const uid = String(userId);
  let assessment = null;

  if (assessmentId) {
    try {
      const { data } = await supabase.from("career_assessments").select("*").eq("id", assessmentId).maybeSingle();
      assessment = data;
    } catch (_) {}
  }

  if (!assessment) {
    assessment = await getStudentAssessment(uid);
  }

  if (!assessment) {
    // Return standard top curated recommendations if assessment not taken yet
    const defaultThree = CAREER_CATALOG.slice(0, 3).map((c, i) => ({
      id: c.id,
      career_name: c.career_name,
      category: c.category,
      match_score: 95 - i * 3,
      match_reason: "High-growth domain aligned with foundational academic excellence.",
      recommendation_data: c,
      is_top_three: true,
    }));
    return {
      topMatches: defaultThree,
      totalMatchesCount: defaultThree.length,
      hasFullAssessment: false,
      isPremium,
    };
  }

  // 1. Calculate compatibility score for every career in the catalog
  const scoredCareers = CAREER_CATALOG.map((career) => {
    const score = calculateCompatibilityScore(assessment, career);
    return {
      career,
      score,
    };
  });

  // Sort descending by match score
  scoredCareers.sort((a, b) => b.score - a.score);

  // Top 10 for Premium, Top 3 for Free
  const topList = scoredCareers.slice(0, 10);

  // 2. Enhance Top 3 with AI personalized reasoning
  const topThreePrompt = topList.slice(0, 3).map((t) => `${t.career.career_name} (${t.career.category})`).join(", ");
  const studentSummary = `Class: ${assessment.education_level}, Stream: ${assessment.academic_profile?.stream || "General"}, Interests: ${(assessment.interests || []).join(", ")}, Skills: ${(assessment.skills || []).join(", ")}`;

  let aiReasons = {};
  try {
    const prompt = `Student Profile: ${studentSummary}
Top Career Matches: ${topThreePrompt}
Provide a 2-sentence concise, encouraging explanation for why each career suits this student.
Output strictly JSON:
{
  "${topList[0].career.id}": "Personalized 2-sentence explanation",
  "${topList[1].career.id}": "Personalized 2-sentence explanation",
  "${topList[2].career.id}": "Personalized 2-sentence explanation"
}`;

    const raw = await callGeminiRaw({
      prompt,
      systemInstruction: "You are an elite academic counselor. Return strictly JSON with career id keys and concise rationale strings.",
      temperature: 0.2,
      timeout: 10000,
    });
    const parsed = extractJsonFromText(raw);
    if (parsed && typeof parsed === "object") {
      aiReasons = parsed;
    }
  } catch (err) {
    console.warn("[CareerService] AI reasoning generation fallback:", err.message);
  }

  // Format final recommendation objects
  const allFormattedMatches = topList.map((item, index) => {
    const cid = item.career.id;
    const customReason =
      aiReasons[cid] ||
      `Exceptional compatibility (${item.score}%) matching your interests in ${(assessment.interests || []).slice(0, 2).join(" & ") || "practical problem solving"} and academic strengths.`;

    return {
      id: cid,
      career_name: item.career.career_name,
      category: item.career.category,
      match_score: item.score,
      match_reason: customReason,
      is_top_three: index < 3,
      recommendation_data: {
        ...item.career,
        matchScore: item.score,
        matchReason: customReason,
      },
    };
  });

  // Save to database / fallback store
  try {
    const records = allFormattedMatches.map((m) => ({
      user_id: uid,
      assessment_id: assessment.id,
      career_id: m.id,
      career_name: m.career_name,
      category: m.category,
      match_score: m.match_score,
      match_reason: m.match_reason,
      recommendation_data: m.recommendation_data,
      is_top_three: m.is_top_three,
    }));

    // Clean previous recommendations for this assessment
    await supabase.from("career_recommendations").delete().eq("user_id", uid).eq("assessment_id", assessment.id);
    await supabase.from("career_recommendations").insert(records);
  } catch (err) {
    console.warn("[CareerService] DB save recommendations error:", err.message);
  }

  // Free users receive top 3; Premium users receive all 10
  const userVisibleMatches = isPremium ? allFormattedMatches : allFormattedMatches.slice(0, 3);

  return {
    topMatches: userVisibleMatches,
    totalMatchesCount: allFormattedMatches.length,
    hasFullAssessment: true,
    isPremium,
    lockedCount: isPremium ? 0 : Math.max(0, allFormattedMatches.length - 3),
    studentProfileSummary: {
      educationLevel: assessment.education_level,
      stream: assessment.academic_profile?.stream || "General",
      primaryInterests: (assessment.interests || []).slice(0, 3),
      primarySkills: (assessment.skills || []).slice(0, 3),
    },
  };
}

// ============================================================================
// 3. PERSONALIZED CAREER ROADMAP GENERATION & TRACKING (Premium)
// ============================================================================

/**
 * Generate or fetch personalized 5-phase career roadmap
 */
export async function getOrGenerateCareerRoadmap(userId, targetCareerId, isPremium = false) {
  const uid = String(userId);
  const targetCareer = CAREER_MAP.get(targetCareerId) || CAREER_CATALOG[0];

  // 1. Check existing saved roadmap
  try {
    const { data: existing } = await supabase
      .from("career_roadmaps")
      .select("*")
      .eq("user_id", uid)
      .eq("target_career_id", targetCareer.id)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing) {
      return {
        success: true,
        isPremium,
        roadmap: existing,
      };
    }
  } catch (err) {
    console.warn("[CareerService] Supabase getRoadmap error, checking fallback store:", err.message);
  }

  const store = getFallbackStore();
  const existingFallback = Object.values(store.roadmaps).find(
    (r) => r.user_id === uid && r.target_career_id === targetCareer.id
  );
  if (existingFallback) {
    return { success: true, isPremium, roadmap: existingFallback };
  }

  // 2. Generate 5-phase curriculum roadmap
  const assessment = await getStudentAssessment(uid);
  const currentClass = assessment?.education_level || "11th / 12th";
  const currentStream = assessment?.academic_profile?.stream || "Science / Commerce";

  const defaultPhases = [
    {
      phaseNumber: 1,
      phaseTitle: "Phase 1: Academic Foundation & Core Concepts",
      timeframe: "Months 1 – 6",
      milestones: [
        {
          id: "m_1_1",
          title: "Master High-Yield Fundamentals",
          description: `Focus deeply on foundational curriculum subjects (${(targetCareer.relevant_subjects || []).join(", ")}) to build an unshakeable academic base.`,
          skills: targetCareer.required_skills.slice(0, 2),
          duration: "8 Weeks",
          priority: "High",
          completed: false,
        },
        {
          id: "m_1_2",
          title: "Introduction to Industry Tools & Basics",
          description: `Set up the fundamental toolchain and complete beginner projects related to ${targetCareer.career_name}.`,
          skills: [targetCareer.required_skills[0] || "Foundational Tools"],
          duration: "6 Weeks",
          priority: "High",
          completed: false,
        },
      ],
    },
    {
      phaseNumber: 2,
      phaseTitle: "Phase 2: Core Skills & Problem-Solving",
      timeframe: "Months 7 – 14",
      milestones: [
        {
          id: "m_2_1",
          title: "Rigorous Technical / Domain Skill Building",
          description: `Acquire and practice core specialized capabilities: ${(targetCareer.required_skills || []).slice(2, 5).join(", ")}.`,
          skills: targetCareer.required_skills.slice(2, 4),
          duration: "12 Weeks",
          priority: "High",
          completed: false,
        },
        {
          id: "m_2_2",
          title: "Build First Guided Portfolio Artifact",
          description: "Synthesize learning into a real-world project, case study, or research paper showcasing independent problem solving.",
          skills: ["Project Architecture", "Analytical Execution"],
          duration: "4 Weeks",
          priority: "Medium",
          completed: false,
        },
      ],
    },
    {
      phaseNumber: 3,
      phaseTitle: "Phase 3: Competitive Exams & Higher Education Radar",
      timeframe: "Months 15 – 22",
      milestones: [
        {
          id: "m_3_1",
          title: `Prepare for Key Entrance Exams (${(targetCareer.top_exams || []).slice(0, 2).join(", ")})`,
          description: "Register for test series, analyze previous year questions (PYQs), and master time management across full-length mock papers.",
          skills: ["Speed & Accuracy", "Exam Strategy"],
          duration: "16 Weeks",
          priority: "High",
          completed: false,
        },
        {
          id: "m_3_2",
          title: "Target College Applications & Counseling Shortlist",
          description: `Shortlist dream and safe institutions (${(targetCareer.top_colleges || []).slice(0, 3).join(", ")}) and organize eligibility certificates.`,
          skills: ["College Selection", "Admission Documentation"],
          duration: "4 Weeks",
          priority: "Medium",
          completed: false,
        },
      ],
    },
    {
      phaseNumber: 4,
      phaseTitle: "Phase 4: Practical Mastery & Specialization",
      timeframe: "Months 23 – 30",
      milestones: [
        {
          id: "m_4_1",
          title: "Deep Specialization & Real-World Capstone",
          description: `Select a dedicated sub-specialization in ${targetCareer.career_name} and execute an end-to-end industry-grade capstone initiative.`,
          skills: targetCareer.required_skills.slice(0, 3),
          duration: "10 Weeks",
          priority: "High",
          completed: false,
        },
      ],
    },
    {
      phaseNumber: 5,
      phaseTitle: "Phase 5: Career Launch & Industry Readiness",
      timeframe: "Months 31 – 36+",
      milestones: [
        {
          id: "m_5_1",
          title: "Professional Resume, GitHub/Portfolio & LinkedIn Presence",
          description: "Craft a high-impact technical resume and publish work publicly to stand out to admissions officers and recruiters.",
          skills: ["Professional Branding", "Interview Preparation"],
          duration: "4 Weeks",
          priority: "High",
          completed: false,
        },
      ],
    },
  ];

  let totalMilestones = 0;
  for (const ph of defaultPhases) totalMilestones += ph.milestones.length;

  const nowIso = new Date().toISOString();
  const newRoadmap = {
    user_id: uid,
    assessment_id: assessment?.id || null,
    target_career_id: targetCareer.id,
    target_career_name: targetCareer.career_name,
    phases: defaultPhases,
    total_milestones: totalMilestones,
    completed_milestones: 0,
    progress_percentage: 0,
    generated_at: nowIso,
    updated_at: nowIso,
  };

  try {
    const { data: created, error } = await supabase.from("career_roadmaps").insert(newRoadmap).select().single();
    if (!error && created) {
      return { success: true, isPremium, roadmap: created };
    }
  } catch (err) {
    console.warn("[CareerService] DB save roadmap error, saving to fallback store:", err.message);
  }

  const rId = `roadmap_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  store.roadmaps[rId] = { id: rId, ...newRoadmap };
  saveFallbackStore(store);

  return { success: true, isPremium, roadmap: store.roadmaps[rId] };
}

/**
 * Toggle a roadmap milestone status (completed: true/false)
 */
export async function toggleRoadmapMilestone(userId, roadmapId, milestoneId, isCompleted) {
  const uid = String(userId);
  const nowIso = new Date().toISOString();

  let roadmap = null;
  try {
    const { data } = await supabase.from("career_roadmaps").select("*").eq("id", roadmapId).eq("user_id", uid).maybeSingle();
    roadmap = data;
  } catch (_) {}

  if (!roadmap) {
    const store = getFallbackStore();
    roadmap = store.roadmaps[roadmapId];
    if (!roadmap || roadmap.user_id !== uid) {
      throw new Error("Roadmap record not found.");
    }
  }

  const phases = roadmap.phases || [];
  let completedCount = 0;
  let totalCount = 0;

  for (const ph of phases) {
    for (const m of ph.milestones || []) {
      totalCount++;
      if (m.id === milestoneId) {
        m.completed = Boolean(isCompleted);
        m.completedAt = isCompleted ? nowIso : null;
      }
      if (m.completed) completedCount++;
    }
  }

  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const updates = {
    phases,
    total_milestones: totalCount,
    completed_milestones: completedCount,
    progress_percentage: progressPercentage,
    updated_at: nowIso,
  };

  try {
    const { data: updated } = await supabase
      .from("career_roadmaps")
      .update(updates)
      .eq("id", roadmapId)
      .select()
      .single();
    if (updated) return updated;
  } catch (_) {}

  const store = getFallbackStore();
  if (store.roadmaps[roadmapId]) {
    store.roadmaps[roadmapId] = { ...store.roadmaps[roadmapId], ...updates };
    saveFallbackStore(store);
    return store.roadmaps[roadmapId];
  }

  return { ...roadmap, ...updates };
}

// ============================================================================
// 4. AI CAREER COUNSELLOR CHAT ENGINE
// ============================================================================

/**
 * Get monthly usage count for career features (e.g. 3 questions for Free students)
 */
export async function getMonthlyCareerUsage(userId, feature = "ai_counsellor") {
  const uid = String(userId);
  const currentMonth = new Date().toISOString().slice(0, 7); // e.g. '2026-11'

  try {
    const { data } = await supabase
      .from("career_monthly_usage")
      .select("count")
      .eq("user_id", uid)
      .eq("feature", feature)
      .eq("usage_month", currentMonth)
      .maybeSingle();

    if (data && typeof data.count === "number") return data.count;
  } catch (_) {}

  const store = getFallbackStore();
  const key = `${uid}:${feature}:${currentMonth}`;
  return store.monthlyUsage[key]?.count || 0;
}

/**
 * Increment monthly usage count
 */
export async function incrementMonthlyCareerUsage(userId, feature = "ai_counsellor", amount = 1) {
  const uid = String(userId);
  const currentMonth = new Date().toISOString().slice(0, 7);
  const nowIso = new Date().toISOString();

  let count = await getMonthlyCareerUsage(userId, feature);
  const newCount = count + amount;

  try {
    await supabase.from("career_monthly_usage").upsert({
      user_id: uid,
      feature,
      usage_month: currentMonth,
      count: newCount,
      updated_at: nowIso,
    });
  } catch (_) {}

  const store = getFallbackStore();
  const key = `${uid}:${feature}:${currentMonth}`;
  store.monthlyUsage[key] = {
    user_id: uid,
    feature,
    usage_month: currentMonth,
    count: newCount,
    updated_at: nowIso,
  };
  saveFallbackStore(store);

  return newCount;
}

/**
 * Chat with AI Career Counsellor
 */
export async function askCareerCounsellor(userId, message, sessionId = null) {
  const uid = String(userId);
  const entitlement = await getOrCreateStudentEntitlement(uid);
  const isPremium = (entitlement?.tier || "").toLowerCase() === "premium";

  // Check Free monthly quota (3 questions/month)
  const currentMonthUsed = await getMonthlyCareerUsage(uid, "ai_counsellor");
  const freeMonthlyLimit = 3;

  if (!isPremium && currentMonthUsed >= freeMonthlyLimit) {
    return {
      success: false,
      quotaExhausted: true,
      message: "You have used your 3 free career counsellor questions this month. Upgrade to ClassTech Premium for unlimited AI career counseling.",
      usedThisMonth: currentMonthUsed,
      limit: freeMonthlyLimit,
      canUpgrade: true,
    };
  }

  // Load student context for high-yield personal guidance
  const assessment = await getStudentAssessment(uid);
  const studentContext = assessment
    ? `Student Grade/Class: ${assessment.education_level}
Academic Stream: ${assessment.academic_profile?.stream || "General"}
Target Interests: ${(assessment.interests || []).join(", ") || "Engineering, Science"}
Self-Rated Skills: ${(assessment.skills || []).join(", ") || "Problem Solving, Logic"}
Work Style: ${assessment.work_preferences?.workStyle || "Analytical"}
Long-Term Goal: ${assessment.career_goals?.salaryExpectation || "High impact tech/professional career"}`
    : "Student has not yet completed the full assessment. Provide general, encouraging educational advice.";

  const systemInstruction = `You are 'Career Compass', an elite, empathetic, and highly realistic AI Educational & Career Counsellor at ClassTech.
You specialize in Indian school curricula (CBSE/ICSE/State), competitive examinations (JEE, NEET, CUET, CLAT, CAT, NDA, UPSC), top colleges (IITs, AIIMS, NITs, IIMs, NLUs), and emerging global careers.

CORE RULES:
1. Always give encouraging, pragmatic, and pedagogically sound advice.
2. NEVER hallucinate fake colleges, false cutoffs, or guarantee specific starting salaries.
3. Distinguish verified patterns from general guidelines. Remind students to cross-check official NTA/institutional portals for exact admission calendars.
4. Structure your response with clean Markdown: use bullet points, bold key insights, and clear headings.
5. Keep responses concise, focused (2-4 paragraphs max), actionable, and friendly.

STUDENT PROFILE CONTEXT:
${studentContext}`;

  // Call Gemini
  const replyText = await callGeminiRaw({
    prompt: message,
    systemInstruction,
    temperature: 0.3,
    timeout: 30000,
  });

  // Record usage count for free users
  const updatedUsage = await incrementMonthlyCareerUsage(uid, "ai_counsellor", 1);

  return {
    success: true,
    reply: replyText.trim(),
    quota: {
      usedThisMonth: updatedUsage,
      limit: isPremium ? "unlimited" : freeMonthlyLimit,
      remaining: isPremium ? 9999 : Math.max(0, freeMonthlyLimit - updatedUsage),
      isPremium,
    },
  };
}

// ============================================================================
// 5. CAREER COMPARISON ENGINE
// ============================================================================

export function compareTwoCareers(careerId1, careerId2, isPremium = false) {
  const c1 = CAREER_MAP.get(careerId1) || CAREER_CATALOG[0];
  const c2 = CAREER_MAP.get(careerId2) || CAREER_CATALOG[1];

  return {
    success: true,
    isPremium,
    career1: c1,
    career2: c2,
    comparison: {
      educationTimeline: {
        career1: c1.qualifications.join(" or "),
        career2: c2.qualifications.join(" or "),
      },
      keySkills: {
        career1: c1.required_skills,
        career2: c2.required_skills,
      },
      salaryBrackets: {
        career1: c1.salary_insights,
        career2: c2.salary_insights,
      },
      topEntranceExams: {
        career1: c1.top_exams,
        career2: c2.top_exams,
      },
      workCultureAndChallenges: {
        career1: c1.potential_challenges,
        career2: c2.potential_challenges,
      },
      topInstitutions: {
        career1: c1.top_colleges,
        career2: c2.top_colleges,
      },
    },
  };
}

// ============================================================================
// 6. CAREER CATALOG SEARCH & CATEGORIES
// ============================================================================

export function getCatalog(category = "All", search = "") {
  let list = [...CAREER_CATALOG];

  if (category && category !== "All") {
    list = list.filter((c) => c.category.toLowerCase().includes(category.toLowerCase()));
  }

  if (search && search.trim().length > 0) {
    const q = search.trim().toLowerCase();
    list = list.filter(
      (c) =>
        c.career_name.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        (c.tags || []).some((t) => t.toLowerCase().includes(q))
    );
  }

  const categories = [
    "All",
    "Engineering & Technology",
    "Medicine & Healthcare",
    "Business, Finance & Management",
    "Law & Humanities",
    "Civil Services & Defense",
    "Design & Creative Arts",
    "Science & Frontier Research",
  ];

  return {
    success: true,
    total: list.length,
    categories,
    careers: list,
  };
}

export function getCareerById(careerId) {
  const career = CAREER_MAP.get(careerId);
  if (!career) return null;
  return career;
}
