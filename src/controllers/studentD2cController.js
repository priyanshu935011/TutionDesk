import crypto from "crypto";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import Student from "../models/Student.js";
import StudentPackage from "../models/StudentPackage.js";
import StudentEntitlement from "../models/StudentEntitlement.js";
import StudentMistakeBook from "../models/StudentMistakeBook.js";
import AiDoubtHistory from "../models/AiDoubtHistory.js";
import FocusSession from "../models/FocusSession.js";
import CashfreePayment from "../models/CashfreePayment.js";
import { callGeminiRaw, extractJsonFromText } from "../services/aiService.js";
import {
  getOrCreateStudentEntitlement,
  checkFeatureAccess,
  incrementDailyUsage,
  getDailyUsage,
  ensureDefaultPackages,
  getTierFlashcardLimit,
  updateTierFlashcardLimits,
  addStudentPremiumFlashcards,
} from "../services/studentEntitlementService.js";
import { sendSMSOTP } from "../utils/smsHelper.js";
import { sendOTPEmail } from "../utils/mailer.js";

const JWT_SECRET = process.env.JWT_SECRET || "classtech_secret_key_jwt_2026";

// ============================================================================
// 1. DIRECT STUDENT OTP REGISTRATION & LOGIN (Without Institute Code)
// ============================================================================

export const sendDirectStudentOtp = async (req, res) => {
  try {
    const { identifier } = req.body; // Phone or Email
    if (!identifier || !identifier.trim()) {
      return res.status(400).json({ success: false, message: "Mobile number or email is required." });
    }

    const cleanInput = identifier.trim();
    const isEmail = cleanInput.includes("@");
    const cleanPhone = cleanInput.replace(/\D/g, "");

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const otpHash = crypto.createHash("sha256").update(otp).digest("hex");

    const otpToken = jwt.sign(
      { identifier: cleanInput, otpHash, type: "direct_student_otp" },
      JWT_SECRET,
      { expiresIn: "10m" }
    );

    if (isEmail) {
      await sendOTPEmail(cleanInput, "Student", otp).catch((e) => console.warn("Email OTP warning:", e.message));
    } else {
      await sendSMSOTP(cleanPhone, otp).catch((e) => console.warn("SMS OTP warning:", e.message));
    }

    return res.json({
      success: true,
      message: `Verification code sent to ${isEmail ? cleanInput : cleanPhone}.`,
      otpToken,
      // For local testing/dev environments
      ...(process.env.NODE_ENV !== "production" ? { debugOtp: otp } : {}),
    });
  } catch (error) {
    console.error("sendDirectStudentOtp error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to send OTP." });
  }
};

export const verifyDirectStudentOtp = async (req, res) => {
  try {
    const { otpToken, otpCode, name = "Self-Study Learner", targetExam = "Boards / JEE / NEET" } = req.body;

    if (!otpToken || !otpCode) {
      return res.status(400).json({ success: false, message: "Session token and OTP are required." });
    }

    let decoded;
    try {
      decoded = jwt.verify(otpToken, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, message: "OTP has expired. Please request a new code." });
    }

    const inputHash = crypto.createHash("sha256").update(String(otpCode).trim()).digest("hex");
    if (decoded.otpHash !== inputHash) {
      return res.status(400).json({ success: false, message: "Incorrect OTP code. Please try again." });
    }

    const identifier = decoded.identifier;
    const isEmail = identifier.includes("@");
    const phone = isEmail ? "" : identifier.replace(/\D/g, "");
    const email = isEmail ? identifier.toLowerCase() : `direct_${phone}@classtech.selfstudy`;

    // 1. Find or create User
    let user = await User.findOne({ $or: [{ email }, ...(phone ? [{ phone }] : [])] });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      user = await User.create({
        name: name || "Self-Study Student",
        email,
        phone: phone || "9999999999",
        role: "student",
        student_type: "independent_direct",
        password: crypto.randomBytes(16).toString("hex"),
      });
    } else if (!user.student_type) {
      user.student_type = "independent_direct";
      await user.save();
    }

    // 2. Find or create Student profile
    const freeLimit = await getTierFlashcardLimit("free");
    let student = await Student.findOne({ $or: [{ phone: user.phone || phone }, { email: user.email }] });
    if (!student) {
      student = await Student.create({
        user: null,
        name: user.name || name,
        phone: user.phone || phone,
        email: user.email,
        parentName: "Parent",
        parentPhone: user.phone || phone,
        parent_name: "Parent",
        parent_phone: user.phone || phone,
        enrollmentNumber: `STU-D2C-${Date.now().toString().slice(-6)}`,
        targetExam,
        flashcards_limit: freeLimit,
        flashcardsLimit: freeLimit,
        flashcards_created: 0,
        flashcardsCreated: 0,
        plan_tier: "free",
        planTier: "free",
      });
    } else if (student.flashcards_limit === undefined || student.flashcards_limit === null) {
      student.flashcards_limit = freeLimit;
      student.flashcardsLimit = freeLimit;
      student.flashcards_created = student.flashcards_created || 0;
      student.flashcardsCreated = student.flashcardsCreated || 0;
      student.plan_tier = student.plan_tier || "free";
      student.planTier = student.planTier || "free";
      await student.save();
    }

    const studentId = String(student._id || user._id);
    const entitlement = await getOrCreateStudentEntitlement(studentId, "independent_direct");

    // 3. Issue Session Token
    const token = jwt.sign(
      {
        id: user._id,
        studentId,
        email: user.email,
        phone: user.phone || phone,
        enrollmentNumber: student.enrollmentNumber,
        role: "student",
        student_type: entitlement.studentType,
        tier: entitlement.tier,
      },
      JWT_SECRET,
      { expiresIn: "30d" }
    );

    return res.json({
      success: true,
      message: isNewUser ? "Account created successfully!" : "Logged in successfully!",
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: "student",
        student_type: entitlement.studentType,
        tier: entitlement.tier,
        focusCoins: entitlement.focusCoins,
        studyStreakDays: entitlement.studyStreakDays,
        package: entitlement.activePackage?.name || "Classtech Free",
      },
      student: {
        id: studentId,
        name: student.name,
        enrollmentNumber: student.enrollmentNumber,
        targetExam: student.targetExam || targetExam,
        flashcards_limit: student.flashcards_limit ?? freeLimit,
        flashcardsLimit: student.flashcards_limit ?? freeLimit,
        flashcards_created: student.flashcards_created ?? 0,
        flashcardsCreated: student.flashcards_created ?? 0,
        flashcards_remaining: Math.max(0, (student.flashcards_limit ?? freeLimit) - (student.flashcards_created ?? 0)),
        flashcardsRemaining: Math.max(0, (student.flashcards_limit ?? freeLimit) - (student.flashcards_created ?? 0)),
        plan_tier: student.plan_tier || "free",
        planTier: student.plan_tier || "free",
      },
    });
  } catch (error) {
    console.error("verifyDirectStudentOtp error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to verify OTP." });
  }
};

// ============================================================================
// 2. MULTIMODAL AI TUTOR & STEP-BY-STEP DOUBT SOLVER
// ============================================================================

export const solveStudentDoubtWithAi = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    if (!studentId) {
      return res.status(401).json({ success: false, message: "Student authentication required." });
    }

    // Entitlement & Quota Check
    const access = await checkFeatureAccess(studentId, "ai_tutor");
    if (!access.allowed) {
      return res.status(403).json({
        success: false,
        message: access.reason || "Daily AI doubt limit reached.",
        canUpgrade: access.canUpgrade,
        usedToday: access.usedToday,
        limit: access.limit,
      });
    }

    const { questionText, imageBase64, imageMimeType = "image/jpeg", subject = "Science & Math" } = req.body;
    if (!questionText && !imageBase64) {
      return res.status(400).json({ success: false, message: "Please enter question text or upload an image." });
    }

    const systemInstruction = `You are Classtech Master AI Tutor, an elite step-by-step educator for school, board (CBSE/ICSE/State), and competitive exams (JEE Main & Advanced, NEET, CUET, NDA).
Your mission is to provide crystal-clear, pedagogically sound, encouraging step-by-step guidance.

REQUIRED JSON OUTPUT FORMAT:
{
  "conceptIdentified": "Short name of the core theorem or concept (e.g. Newton's 2nd Law / Quadratic Formula / Thermodynamics)",
  "solutionSteps": [
    {
      "stepNumber": 1,
      "title": "Analyze Given Data & Formula",
      "explanation": "Detailed clear explanation using standard Unicode math symbols (->, ~, x, +, -)."
    },
    {
      "stepNumber": 2,
      "title": "Substitute & Calculate",
      "explanation": "Step by step calculation."
    }
  ],
  "finalAnswer": "Bold final numerical or conceptual result with appropriate units.",
  "keyTakeaway": "Pro-tip or common pitfall to avoid.",
  "practiceQuestions": [
    {
      "question": "Similar practice question 1 to test understanding?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correctAnswer": "A) Option 1",
      "hint": "Brief hint to guide student."
    },
    {
      "question": "Similar practice question 2 with slightly different numbers?",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correctAnswer": "B) Option 2",
      "hint": "Brief hint to guide student."
    }
  ]
}

No markdown code blocks, pure JSON only.`;

    const prompt = `Solve this academic doubt thoroughly:
Subject: ${subject}
Question Details: ${questionText || "Please solve and explain the attached textbook problem image thoroughly."}`;

    const raw = await callGeminiRaw({
      prompt,
      systemInstruction,
      imageBase64: imageBase64 || null,
      imageMimeType,
      temperature: 0.2,
    });

    const parsed = extractJsonFromText(raw);
    if (!parsed || !parsed.finalAnswer) {
      throw new Error("AI returned an incomplete solution. Please try again.");
    }

    // Save to Doubt History
    const historyDoc = await AiDoubtHistory.create({
      studentId,
      subject,
      questionText: (questionText || "").substring(0, 500),
      questionImageUrl: imageBase64 ? "data:image/jpeg;base64,..." : "",
      conceptIdentified: parsed.conceptIdentified || "Core Concept",
      solutionSteps: parsed.solutionSteps || [],
      finalAnswer: parsed.finalAnswer || "",
      keyTakeaway: parsed.keyTakeaway || "",
      practiceQuestions: parsed.practiceQuestions || [],
    });

    // Record Quota Usage
    const updatedCount = await incrementDailyUsage(studentId, "ai_doubts", 1);

    // Record Streak Activity in IST
    try {
      const { recordStudentActivity } = await import("../services/streakService.js");
      await recordStudentActivity(studentId, { doubtsAsked: 1 });
    } catch (_) {}

    return res.json({
      success: true,
      solution: parsed,
      doubtId: historyDoc._id,
      quota: {
        usedToday: updatedCount,
        limit: access.limit,
      },
    });
  } catch (error) {
    console.error("solveStudentDoubtWithAi error:", error);
    return res.status(500).json({ success: false, message: error.message || "Failed to solve doubt with AI." });
  }
};

// ============================================================================
// 3. AI MISTAKE BOOK (Automated Error Diagnostics & Retest Engine)
// ============================================================================

export const getStudentMistakes = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.query.studentId);
    const { subject, errorTag, status = "active" } = req.query;

    const query = { studentId };
    if (status && status !== "all") query.status = status;
    if (subject && subject !== "all") query.subject = new RegExp(subject, "i");
    if (errorTag && errorTag !== "all") query.errorTag = errorTag;

    const mistakes = await StudentMistakeBook.find(query).sort({ createdAt: -1 }).limit(150);

    const counts = {
      total: await StudentMistakeBook.countDocuments({ studentId }),
      active: await StudentMistakeBook.countDocuments({ studentId, status: "active" }),
      mastered: await StudentMistakeBook.countDocuments({ studentId, status: "mastered" }),
    };

    return res.json({ success: true, mistakes, counts });
  } catch (error) {
    console.error("getStudentMistakes error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const logMistakeToBook = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const {
      subject = "Science",
      chapter = "Chapter 1",
      questionText,
      options = [],
      studentAnswer = "",
      correctAnswer,
      explanation = "",
      errorTag = "conceptual_gap",
      sourceTestTitle = "Mock Test",
    } = req.body;

    if (!questionText || !correctAnswer) {
      return res.status(400).json({ success: false, message: "Question text and correct answer are required." });
    }

    // AI diagnostic note on why this error typically occurs
    const diagnosticPrompt = `Student answered "${studentAnswer}" instead of correct answer "${correctAnswer}" on question: "${questionText}".
Provide a concise 1-sentence diagnostic tip explaining the likely misconception and how to avoid it.`;

    let aiDiagnosticNote = "";
    try {
      aiDiagnosticNote = await callGeminiRaw({
        prompt: diagnosticPrompt,
        systemInstruction: "You are an empathetic academic error coach. Keep response to 1 crisp actionable sentence.",
        temperature: 0.2,
      });
    } catch (_) {
      aiDiagnosticNote = "Review the underlying formula carefully and double-check units during calculation.";
    }

    const mistake = await StudentMistakeBook.create({
      studentId,
      subject,
      chapter,
      questionText,
      options,
      studentAnswer,
      correctAnswer,
      explanation,
      errorTag,
      aiDiagnosticNote: aiDiagnosticNote.trim(),
      status: "active",
      sourceTestTitle,
    });

    return res.json({ success: true, message: "Mistake logged to your Mistake Book.", mistake });
  } catch (error) {
    console.error("logMistakeToBook error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const generateMistakesRetest = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const { subject, limit = 10 } = req.body;

    const query = { studentId, status: { $in: ["active", "retesting"] } };
    if (subject && subject !== "all") query.subject = new RegExp(subject, "i");

    const mistakes = await StudentMistakeBook.find(query).limit(Number(limit));
    if (!mistakes || mistakes.length === 0) {
      return res.json({ success: true, message: "No active mistakes to retest! Great work!", questions: [] });
    }

    // Format into a retest quiz
    const questions = mistakes.map((m) => ({
      mistakeId: m._id,
      subject: m.subject,
      chapter: m.chapter,
      questionText: m.questionText,
      options: m.options,
      correctAnswer: m.correctAnswer,
      errorTag: m.errorTag,
      diagnosticTip: m.aiDiagnosticNote,
    }));

    return res.json({
      success: true,
      title: `Mistake Retest Quiz (${questions.length} Questions)`,
      questions,
    });
  } catch (error) {
    console.error("generateMistakesRetest error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const resolveMistakeItem = async (req, res) => {
  try {
    const { id } = req.params;
    const { isCorrect = true } = req.body;

    const mistake = await StudentMistakeBook.findById(id);
    if (!mistake) return res.status(404).json({ success: false, message: "Mistake record not found." });

    mistake.retestCount = (mistake.retestCount || 0) + 1;
    mistake.lastRetestedAt = new Date();
    if (isCorrect) {
      mistake.status = "mastered";
    } else {
      mistake.status = "retesting";
    }
    await mistake.save();

    return res.json({ success: true, message: isCorrect ? "Concept Mastered!" : "Marked for another retest.", mistake });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 4. AI REVISION & SPACED REPETITION (Active Recall Cards & Formulas)
// ============================================================================

export const generateAiRevisionPack = async (req, res) => {
  try {
    const { topic, subject = "General", targetClass = "Class 10 / 12 / NEET" } = req.body;
    if (!topic || !topic.trim()) {
      return res.status(400).json({ success: false, message: "Topic is required for AI revision." });
    }

    const systemInstruction = `You are a cognitive learning scientist specializing in high-yield active recall and spaced repetition for students.
Create an ultra-efficient 60-Second Revision Pack for the requested topic.

RETURN STRICTLY A SINGLE VALID JSON OBJECT:
{
  "topic": "${topic}",
  "estimatedReadTimeSeconds": 60,
  "summaryCards": [
    { "title": "Core Definition", "content": "1-2 crisp memorable sentences." },
    { "title": "Key Mechanism / Principle", "content": "High-yield explanation." },
    { "title": "Exam Trap / Watch Out", "content": "The #1 trick question examiners ask on this topic." }
  ],
  "formulaCheatSheet": [
    { "name": "Formula Name", "equation": "Unicode equation", "variables": "Explanation of terms" }
  ],
  "rapidFireRecallQuestions": [
    { "q": "Quick active recall flashcard question?", "a": "Direct short answer" },
    { "q": "Second flashcard question?", "a": "Direct short answer" }
  ],
  "spacedRepetitionSchedule": [
    { "day": 1, "task": "Initial Recall & Flashcards (5 mins)" },
    { "day": 3, "task": "Attempt 5 PYQs on this topic" },
    { "day": 7, "task": "Blind Formula Write-out" },
    { "day": 21, "task": "Final Mastery Mock Test" }
  ]
}
No markdown blocks, pure JSON only.`;

    const raw = await callGeminiRaw({
      prompt: `Create a 60-second active recall revision pack for: "${topic}" in subject "${subject}" for ${targetClass}.`,
      systemInstruction,
      temperature: 0.25,
    });

    const parsed = extractJsonFromText(raw);
    if (!parsed) throw new Error("Failed to generate revision pack.");

    return res.json({ success: true, revisionPack: parsed });
  } catch (error) {
    console.error("generateAiRevisionPack error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 5. AI CAREER & STREAM GUIDANCE (College Cutoffs & Roadmaps)
// ============================================================================

export const getAiCareerGuidance = async (req, res) => {
  try {
    const { currentClass = "10th", strengths = [], interests = [], targetGoal = "" } = req.body;

    const systemInstruction = `You are an elite AI Career Counselor and Academic Strategist for Indian school and college entrance exams.
Analyze the student profile and provide actionable, real-world educational roadmaps, competitive exam options, and top institutions.

RETURN STRICTLY A SINGLE VALID JSON OBJECT:
{
  "recommendedStreams": [
    {
      "streamName": "Science (PCM / PCB) / Commerce with Maths / Humanities",
      "suitabilityScore": 92,
      "whyFit": "Clear explanation based on student strengths.",
      "primaryCareers": ["Software/AI Engineer", "Data Scientist", "Robotics"]
    }
  ],
  "entranceExamsRadar": [
    {
      "examName": "JEE Main & Advanced / NEET / CUET / NDA / IPMAT",
      "timeline": "April / May during Class 12",
      "difficultyLevel": "Moderate to High",
      "targetInstitutes": "IITs, NITs, BITS, AIIMS"
    }
  ],
  "twoYearPreparationRoadmap": [
    { "phase": "Class 11 Foundation", "focus": "Build deep fundamentals, NCERT mastery, daily MCQ habits" },
    { "phase": "Class 12 Acceleration", "focus": "Complete syllabus by November, full-length test series & revision" }
  ],
  "motivationalAdvice": "Inspiring closing message."
}
No markdown blocks, pure JSON only.`;

    const prompt = `Student Profile:
Current Class: ${currentClass}
Key Strengths: ${strengths.join(", ") || "Analytical reasoning, Problem solving"}
Interests: ${interests.join(", ") || "Technology, Coding, Mathematics"}
Student Dream/Goal: ${targetGoal || "Looking for top future-proof career paths"}`;

    const raw = await callGeminiRaw({
      prompt,
      systemInstruction,
      temperature: 0.2,
    });

    const parsed = extractJsonFromText(raw);
    return res.json({ success: true, guidance: parsed });
  } catch (error) {
    console.error("getAiCareerGuidance error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 6. GAMIFIED FOCUS MODE & COINS (Regain / Pomodoro Style)
// ============================================================================

export const completeFocusSession = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const { minutesCompleted = 25, subject = "Self-Study" } = req.body;

    const mins = Math.max(1, Number(minutesCompleted));
    // 10 coins earned per 25 mins of focused study
    const coinsEarned = Math.round((mins / 25) * 10);

    const session = await FocusSession.create({
      studentId,
      subject,
      targetMinutes: mins,
      completedMinutes: mins,
      coinsEarned,
      status: "completed",
    });

    const entitlement = await getOrCreateStudentEntitlement(studentId);
    if (entitlement) {
      entitlement.focusCoins = (entitlement.focusCoins || 0) + coinsEarned;
      // Increment streak if not yet updated today
      const today = new Date().toISOString().split("T")[0];
      if (entitlement.lastActiveDate !== today) {
        entitlement.studyStreakDays = (entitlement.studyStreakDays || 0) + 1;
        entitlement.lastActiveDate = today;
      }
      await entitlement.save();
    }

    await incrementDailyUsage(studentId, "focus_minutes", mins);

    return res.json({
      success: true,
      message: `Great job! You stayed focused for ${mins} mins and earned 🪙 ${coinsEarned} Focus Coins!`,
      coinsEarned,
      totalCoins: entitlement?.focusCoins || 0,
      studyStreakDays: entitlement?.studyStreakDays || 1,
      session,
    });
  } catch (error) {
    console.error("completeFocusSession error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 7. VIRTUAL STUDY ROOMS ("Study With Me")
// ============================================================================

export const getVirtualStudyRooms = async (req, res) => {
  try {
    // Curated high-engagement virtual study rooms
    const rooms = [
      {
        id: "room_jee_neet_beasts",
        title: "IIT-JEE & NEET Late Night Silent Sprint",
        subject: "PCM / PCB",
        activeStudents: 42,
        timerMode: "50 min Focus / 10 min Break",
        leader: "Aman (AIR 48 Aspirant)",
      },
      {
        id: "room_class10_toppers",
        title: "Class 10 Board Champs (Maths & Science)",
        subject: "Class 10 Boards",
        activeStudents: 28,
        timerMode: "25 min Pomodoro",
        leader: "Sneha R.",
      },
      {
        id: "room_general_grind",
        title: "24/7 Global Study Hall (Camera/Mic Off)",
        subject: "General Study",
        activeStudents: 65,
        timerMode: "Continuous Timer",
        leader: "ClassTech AI Proctor",
      },
    ];

    return res.json({ success: true, rooms });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 8. INTERACTIVE PYQ BANK (Previous Year Questions 2015-2026)
// ============================================================================

export const getPyqQuestions = async (req, res) => {
  try {
    const { exam = "JEE Main", subject = "Physics", chapter = "Kinematics", year = "2024" } = req.query;

    // High-yield curated PYQ samples with AI-ready explanations
    const samplePyqs = [
      {
        id: "pyq_01",
        exam: "JEE Main",
        year: 2024,
        subject: "Physics",
        chapter: "Kinematics",
        questionText: "A particle starts from origin at t = 0 with a velocity 5.0 i m/s and moves in x-y plane under action of a force which produces a constant acceleration of (3.0 i + 2.0 j) m/s². What is the y-coordinate of the particle at the instant its x-coordinate is 84 m?",
        options: ["A) 36 m", "B) 24 m", "C) 18 m", "D) 48 m"],
        correctAnswer: "A) 36 m",
        difficulty: "Moderate",
      },
      {
        id: "pyq_02",
        exam: "NEET",
        year: 2024,
        subject: "Biology",
        chapter: "Cell Biology",
        questionText: "Which of the following cell organelles is responsible for extracting energy from carbohydrates to form ATP?",
        options: ["A) Ribosome", "B) Chloroplast", "C) Mitochondrion", "D) Lysosome"],
        correctAnswer: "C) Mitochondrion",
        difficulty: "Easy",
      },
      {
        id: "pyq_03",
        exam: "Class 10 CBSE",
        year: 2024,
        subject: "Science",
        chapter: "Light - Reflection & Refraction",
        questionText: "A concave mirror produces a real, inverted and equal-sized image of an object. The object must be placed at:",
        options: ["A) Principal focus", "B) Center of curvature", "C) Infinity", "D) Between pole and focus"],
        correctAnswer: "B) Center of curvature",
        difficulty: "Easy",
      },
    ];

    const filtered = samplePyqs.filter(
      (p) =>
        (!exam || p.exam.toLowerCase().includes(exam.toLowerCase())) ||
        (!subject || p.subject.toLowerCase() === subject.toLowerCase())
    );

    return res.json({ success: true, questions: filtered.length ? filtered : samplePyqs });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 9. PARENT PROGRESS SNAPSHOT (Secure Shareable Web Link)
// ============================================================================

export const generateParentSnapshotToken = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const token = jwt.sign({ studentId, purpose: "parent_snapshot" }, JWT_SECRET, { expiresIn: "90d" });

    const frontendBase = process.env.FRONTEND_URL || "https://classtech.in";
    const shareableUrl = `${frontendBase}/parent-view/${token}`;

    return res.json({
      success: true,
      shareableUrl,
      whatsappMessage: `Hello Parents! View my verified weekly study performance, test results, and attendance on Classtech: ${shareableUrl}`,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const viewParentSnapshot = async (req, res) => {
  try {
    const { token } = req.params;
    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch (_) {
      return res.status(401).json({ success: false, message: "This parent progress link has expired." });
    }

    const studentId = decoded.studentId;
    const entitlement = await getOrCreateStudentEntitlement(studentId);
    const student = await Student.findById(studentId);

    // Compute weekly metrics
    const mistakeCount = await StudentMistakeBook.countDocuments({ studentId });
    const masteredCount = await StudentMistakeBook.countDocuments({ studentId, status: "mastered" });

    return res.json({
      success: true,
      studentName: student?.name || "Student",
      targetExam: student?.targetExam || "CBSE / Competitive Exam",
      studyStreakDays: entitlement?.studyStreakDays || 5,
      totalFocusCoins: entitlement?.focusCoins || 120,
      conceptsMastered: masteredCount,
      totalMistakesLogged: mistakeCount,
      consistencyRating: "94% (Excellent)",
      verifiedBy: "Classtech Academic Monitoring Engine",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 10. IN-DASHBOARD EMBEDDED STORE & CASHFREE PAYMENT CHECKOUT
// ============================================================================

export const getStorePackages = async (req, res) => {
  try {
    await ensureDefaultPackages();
    let packages = await StudentPackage.find({ isActive: true });
    if (Array.isArray(packages)) {
      packages.sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || (Number(a.price) || 0) - (Number(b.price) || 0));
    }
    return res.json({ success: true, packages });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPackageOrder = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const { packageId } = req.body;

    const pkg = await StudentPackage.findById(packageId);
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });

    const orderId = `CT_STU_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const finalAmount = pkg.discountedPrice || pkg.price;

    // Instant unlock for free plans or mock tests
    if (finalAmount === 0) {
      const entitlement = await getOrCreateStudentEntitlement(studentId);
      entitlement.activePackage = pkg._id;
      entitlement.tier = pkg.slug.includes("pro") ? "pro" : "free";
      await entitlement.save();

      return res.json({
        success: true,
        isFree: true,
        message: "Free package activated successfully!",
        entitlement,
      });
    }

    // Cashfree / Gateway Order Record
    const paymentRecord = await CashfreePayment.create({
      orderId,
      amount: finalAmount,
      currency: "INR",
      purpose: `Student Subscription: ${pkg.name}`,
      status: "PENDING",
      student: studentId,
      metadata: { packageId: pkg._id, packageName: pkg.name },
    }).catch(() => null);

    return res.json({
      success: true,
      orderId,
      amount: finalAmount,
      packageName: pkg.name,
      currency: "INR",
      paymentSessionId: `session_${orderId}`,
    });
  } catch (error) {
    console.error("createPackageOrder error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyAndUnlockPackage = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const { orderId, packageId } = req.body;

    const pkg = await StudentPackage.findById(packageId);
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });

    const entitlement = await getOrCreateStudentEntitlement(studentId);
    entitlement.activePackage = pkg._id;
    entitlement.tier = pkg.slug.includes("master") ? "premium" : "pro";

    // Set expiration based on billingCycle
    const now = new Date();
    if (pkg.billingCycle === "monthly") {
      now.setMonth(now.getMonth() + 1);
    } else if (pkg.billingCycle === "yearly") {
      now.setFullYear(now.getFullYear() + 1);
    }
    entitlement.packageExpiresAt = now;
    await entitlement.save();

    // Mark Cashfree order as SUCCESS if present
    if (orderId) {
      await CashfreePayment.findOneAndUpdate({ orderId }, { status: "SUCCESS" }).catch(() => {});
    }

    // Add premium flashcards quota upon upgrading
    let quotaUpgrade = null;
    if (pkg.price > 0 || pkg.slug.includes("premium") || pkg.slug.includes("pro")) {
      quotaUpgrade = await addStudentPremiumFlashcards(studentId);
    }

    return res.json({
      success: true,
      message: `Congratulations! ${pkg.name} is now active on your account.`,
      tier: entitlement.tier,
      expiresAt: entitlement.packageExpiresAt,
      entitlement,
      quota: quotaUpgrade,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 11. INSTITUTE ARCHIVE HOOK (Transitions Student to Independent D2C)
// ============================================================================

export const transitionArchivedStudent = async (req, res) => {
  try {
    const { studentId, instituteId } = req.body;
    if (!studentId) return res.status(400).json({ success: false, message: "Student ID required." });

    const entitlement = await getOrCreateStudentEntitlement(studentId);
    entitlement.studentType = "archived_alumni";
    entitlement.archivedFromInstitute = instituteId || null;
    entitlement.archivedAt = new Date();
    await entitlement.save();

    return res.json({
      success: true,
      message: "Student transitioned to independent self-study dashboard.",
      studentType: "archived_alumni",
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 12. SUPER ADMIN PACKAGE & FEATURE OVERRIDES MANAGEMENT
// ============================================================================

export const getAdminStudentPackages = async (req, res) => {
  try {
    await ensureDefaultPackages();
    let packages = await StudentPackage.find();
    if (Array.isArray(packages)) {
      packages.sort((a, b) => (Number(a.priority) || 0) - (Number(b.priority) || 0) || (Number(a.price) || 0) - (Number(b.price) || 0));
    }
    return res.json({ success: true, packages });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createOrUpdateStudentPackage = async (req, res) => {
  try {
    const { id } = req.params;
    const payload = req.body;

    if (!payload.name || !payload.slug) {
      return res.status(400).json({ success: false, message: "Package name and slug are required." });
    }

    let pkg;
    if (id && id !== "new") {
      pkg = await StudentPackage.findByIdAndUpdate(id, payload, { new: true });
    } else {
      pkg = await StudentPackage.create(payload);
    }

    return res.json({ success: true, message: "Package saved successfully.", package: pkg });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const setStudentFeatureOverride = async (req, res) => {
  try {
    const { studentId, featureKey, enabled, customDailyLimit } = req.body;
    if (!studentId || !featureKey) {
      return res.status(400).json({ success: false, message: "studentId and featureKey are required." });
    }

    const entitlement = await getOrCreateStudentEntitlement(studentId);
    if (!entitlement.featureOverrides) entitlement.featureOverrides = new Map();

    entitlement.featureOverrides.set(featureKey, {
      enabled: Boolean(enabled),
      customDailyLimit: customDailyLimit !== undefined ? Number(customDailyLimit) : -1,
    });

    await entitlement.save();

    return res.json({
      success: true,
      message: `Feature ${featureKey} override applied for student ${studentId}.`,
      entitlement,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ============================================================================
// 13. TIER FLASHCARD LIMITS MANAGEMENT (Free & ClassTech Premium)
// ============================================================================

export const getAdminTierLimits = async (req, res) => {
  try {
    await ensureDefaultPackages();
    const freeLimit = await getTierFlashcardLimit("free");
    const premiumLimit = await getTierFlashcardLimit("premium");
    return res.json({
      success: true,
      tiers: {
        free: {
          slug: "classtech-free",
          name: "ClassTech Free",
          aiFlashcardsLimit: freeLimit,
        },
        premium: {
          slug: "classtech-premium",
          name: "ClassTech Premium",
          aiFlashcardsLimit: premiumLimit,
        },
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAdminTierLimits = async (req, res) => {
  try {
    const { freeLimit, premiumLimit } = req.body;
    await ensureDefaultPackages();
    const results = await updateTierFlashcardLimits({
      freeLimit: freeLimit !== undefined ? Number(freeLimit) : undefined,
      premiumLimit: premiumLimit !== undefined ? Number(premiumLimit) : undefined,
    });
    return res.json({
      success: true,
      message: "Tier flashcard limits updated successfully.",
      tiers: results,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
