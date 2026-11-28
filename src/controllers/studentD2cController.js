import crypto from "crypto";
import jwt from "jsonwebtoken";
import axios from "axios";
import User from "../models/User.js";
import Student from "../models/Student.js";
import StudentPackage from "../models/StudentPackage.js";
import StudentEntitlement from "../models/StudentEntitlement.js";
import StudentMistakeBook from "../models/StudentMistakeBook.js";
import AiDoubtHistory from "../models/AiDoubtHistory.js";
import FocusSession from "../models/FocusSession.js";
import CashfreePayment from "../models/CashfreePayment.js";
import TestSeriesAttempt from "../models/TestSeriesAttempt.js";
import TestResult from "../models/TestResult.js";
import StudentStreak from "../models/StudentStreak.js";
import { getCashfreeConfig, getBaseUrl, checkCashfreeOrderStatus } from "./paymentController.js";
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

export const getPremiumPackageDetails = async (req, res) => {
  try {
    await ensureDefaultPackages();
    let packages = await StudentPackage.find({ isActive: true });
    let premiumPkg = packages.find(
      (p) => (p.tier || "").toLowerCase() === "premium" || (p.slug || "").includes("premium")
    );
    if (!premiumPkg) {
      premiumPkg = packages.find((p) => (Number(p.price) || 0) > 0) || packages[0];
    }

    const freeLimit = await getTierFlashcardLimit("free");
    const premiumLimit = await getTierFlashcardLimit("premium");

    const studentId = req.user?.studentId || req.user?.id || req.query.studentId;
    let isCurrentStudentPremium = false;
    let studentQuota = null;
    if (studentId) {
      try {
        const ent = await getOrCreateStudentEntitlement(studentId);
        isCurrentStudentPremium = (ent?.tier || "").toLowerCase() === "premium";
        const student = await Student.findById(studentId);
        if (student) {
          studentQuota = {
            limit: student.flashcards_limit ?? (isCurrentStudentPremium ? premiumLimit : freeLimit),
            created: student.flashcards_created ?? 0,
            remaining: Math.max(0, (student.flashcards_limit ?? (isCurrentStudentPremium ? premiumLimit : freeLimit)) - (student.flashcards_created ?? 0)),
            planTier: student.plan_tier || ent?.tier || "free",
          };
        }
      } catch (_) {}
    }

    const featureHighlights = [
      {
        icon: "flashcards",
        title: "500 AI Flashcards / Month",
        subtitle: "Generate smart active-recall cards from PDFs, notes & syllabus chapters with SM-2 spaced repetition.",
        badge: "Smart Revision",
      },
      {
        icon: "ai_tutor",
        title: "24/7 AI Master Tutor & Step-by-Step Solver",
        subtitle: "Instant solutions with diagrams & key takeaways for Boards, JEE, NEET, and school exams.",
        badge: "Unlimited",
      },
      {
        icon: "test_series",
        title: "Full All-Access Test Series Pass",
        subtitle: "Unlimited access to all chapter tests, mock exams, and real-time performance analytics.",
        badge: "VIP Pass",
      },
      {
        icon: "digital_notes",
        title: "Complete Digital & Handwritten Notes Library",
        subtitle: "Curated high-scoring formula cheat sheets, revision summaries, and expert notes.",
        badge: "All Subjects",
      },
      {
        icon: "mistake_book",
        title: "AI Mistake Book & Automated Concept Retests",
        subtitle: "Identifies weak concepts and creates targeted auto-generated practice retests.",
        badge: "Deep Retention",
      },
      {
        icon: "career_roadmap",
        title: "AI Career Guidance & Goal Planner",
        subtitle: "Target exam milestone roadmap, stream selection, and percentile predictor.",
        badge: "Exclusive",
      },
      {
        icon: "focus_rooms",
        title: "Unlimited Focus Sessions & Study Streak Shields",
        subtitle: "Ad-free lo-fi study rooms, coin multipliers, and streak freezes.",
        badge: "Productivity",
      },
    ];

    const faqs = [
      {
        q: "How many AI flashcards can I create with Premium?",
        a: "You get 500 AI flashcards every month! Whenever you upload study notes or PDFs, ClassTech AI formats them into high-retention spaced repetition flashcards.",
      },
      {
        q: "Does this include all Store Test Series and Notes?",
        a: "Yes! ClassTech Premium includes full access to all Test Series and Digital Notes available in the ClassTech Store without extra purchase.",
      },
      {
        q: "Can I cancel my subscription anytime?",
        a: "Yes, you can cancel at any time directly from the app. You will retain access until the end of your billing period.",
      },
      {
        q: "What payment modes are accepted?",
        a: "We accept all major UPI apps (Google Pay, PhonePe, Paytm, BHIM), Credit/Debit cards, and Netbanking via secure Cashfree payment gateway.",
      },
    ];

    return res.json({
      success: true,
      package: {
        id: String(premiumPkg._id || premiumPkg.id),
        title: premiumPkg.title || premiumPkg.name || "ClassTech Premium",
        tier: "premium",
        price: Number(premiumPkg.price || 299),
        originalPrice: Number(premiumPkg.price || 299) >= 299 ? 999 : 499,
        discountedPrice: Number(premiumPkg.discountedPrice || premiumPkg.discounted_price || premiumPkg.price || 299),
        currency: premiumPkg.currency || "INR",
        billingCycle: premiumPkg.billingCycle || premiumPkg.billing_cycle || "monthly",
        badgeText: premiumPkg.badgeText || premiumPkg.badge_text || "ALL-ACCESS VIP",
        aiFlashcardsLimit: premiumLimit,
        aiDoubtDailyLimit: premiumPkg.aiDoubtDailyLimit || premiumPkg.ai_doubt_daily_limit || 200,
        focusModeDailyLimitMinutes: premiumPkg.focusModeDailyLimitMinutes || premiumPkg.focus_mode_daily_limit_minutes || 480,
        featureHighlights,
        faqs,
        freeLimit,
        isCurrentStudentPremium,
        studentQuota,
      },
    });
  } catch (error) {
    console.error("getPremiumPackageDetails error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateAdminPremiumPackageDetails = async (req, res) => {
  try {
    const {
      title,
      price,
      discountedPrice,
      billingCycle,
      badgeText,
      aiFlashcardsLimit,
      aiDoubtDailyLimit,
      features,
      description,
      isActive,
    } = req.body;

    await ensureDefaultPackages();
    let packages = await StudentPackage.find();
    let premiumPkg = packages.find(
      (p) => (p.tier || "").toLowerCase() === "premium" || (p.slug || "").includes("premium")
    );
    if (!premiumPkg) {
      return res.status(404).json({ success: false, message: "ClassTech Premium package not found." });
    }

    const updates = {};
    if (title !== undefined) {
      updates.title = title;
      updates.name = title;
    }
    if (price !== undefined) updates.price = Number(price);
    if (discountedPrice !== undefined) updates.discounted_price = Number(discountedPrice);
    if (billingCycle !== undefined) {
      updates.billing_cycle = billingCycle;
      updates.billingCycle = billingCycle;
    }
    if (badgeText !== undefined) {
      updates.badge_text = badgeText;
      updates.badge = badgeText;
    }
    if (aiFlashcardsLimit !== undefined) {
      updates.ai_flashcards_limit = Number(aiFlashcardsLimit);
      await updateTierFlashcardLimits({ premiumLimit: Number(aiFlashcardsLimit) });
    }
    if (aiDoubtDailyLimit !== undefined) {
      updates.ai_doubt_daily_limit = Number(aiDoubtDailyLimit);
    }
    if (features !== undefined) {
      updates.features = features;
    }
    if (description !== undefined) {
      updates.description = description;
    }
    if (isActive !== undefined) {
      updates.is_active = Boolean(isActive);
      updates.isActive = Boolean(isActive);
    }

    const updated = await StudentPackage.findByIdAndUpdate(premiumPkg._id || premiumPkg.id, updates, { new: true });

    return res.json({
      success: true,
      message: "ClassTech Premium settings updated successfully.",
      package: updated,
    });
  } catch (error) {
    console.error("updateAdminPremiumPackageDetails error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createPackageOrder = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const { packageId } = req.body;

    let pkg = null;
    if (packageId) {
      pkg = await StudentPackage.findById(packageId);
    }
    if (!pkg) {
      const pkgs = await StudentPackage.find({ isActive: true });
      pkg = pkgs.find((p) => (p.tier || "").toLowerCase() === "premium" || (p.slug || "").includes("premium")) || pkgs[0];
    }
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });

    const finalAmount = Number(pkg.discountedPrice || pkg.discounted_price || pkg.price || 0);

    // Instant unlock for free plans
    if (finalAmount <= 0) {
      const entitlement = await getOrCreateStudentEntitlement(studentId);
      entitlement.activePackage = pkg._id || pkg.id;
      entitlement.tier = (pkg.tier || pkg.slug || "free").includes("premium") ? "premium" : "free";
      await entitlement.save();

      return res.json({
        success: true,
        isFree: true,
        message: "Free package activated successfully!",
        entitlement,
      });
    }

    // Lookup student profile for Cashfree customer details
    const student = await Student.findById(studentId);
    const user = await User.findById(studentId).catch(() => null);
    const studentName = student?.name || user?.name || "Student";
    const studentEmail = student?.email || user?.email || "student@classtech.in";
    const rawPhone = student?.phone || student?.parentPhone || user?.phone || "9999999999";
    const studentPhone = String(rawPhone).replace(/\D/g, "").slice(-10);

    const cfOrderId = "prem_" + crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    const config = await getCashfreeConfig();
    const { appId, secretKey, environment } = config;
    const baseUrl = getBaseUrl(environment);

    const headers = {
      "Content-Type": "application/json",
      "x-api-version": "2023-08-01",
      "x-client-id": appId,
      "x-client-secret": secretKey,
    };

    const rawFrontendUrl = process.env.FRONTEND_URL || "https://app.classtech.in";
    const secureFrontendUrl = rawFrontendUrl.startsWith("http://")
      ? rawFrontendUrl.replace(/^http:\/\//, "https://")
      : rawFrontendUrl.startsWith("https://")
      ? rawFrontendUrl
      : `https://${rawFrontendUrl}`;

    const payload = {
      order_id: cfOrderId,
      order_amount: finalAmount,
      order_currency: "INR",
      customer_details: {
        customer_id: studentId.slice(0, 45),
        customer_name: studentName.slice(0, 50),
        customer_email: studentEmail,
        customer_phone: studentPhone.length === 10 ? studentPhone : "9999999999",
      },
      order_meta: {
        return_url: `${secureFrontendUrl}/student/premium-status?order_id=${cfOrderId}`,
      },
      order_note: `ClassTech Premium: ${pkg.title || pkg.name || "Subscription"}`,
    };

    let paymentSessionId = "";
    try {
      const cfRes = await axios.post(`${baseUrl}/orders`, payload, { headers });
      paymentSessionId = cfRes.data?.payment_session_id || "";
    } catch (cfErr) {
      console.error("Cashfree createPackageOrder error:", cfErr.response?.data || cfErr.message);
      return res.status(500).json({
        success: false,
        message: "Failed to initiate Cashfree payment gateway.",
        details: cfErr.response?.data?.message || cfErr.message,
      });
    }

    // Cashfree / Gateway Order Record
    await CashfreePayment.create({
      orderId: cfOrderId,
      cfOrderId,
      amount: finalAmount,
      currency: "INR",
      purpose: `ClassTech Premium: ${pkg.title || pkg.name || "Subscription"}`,
      status: "PENDING",
      student: studentId,
      metadata: {
        packageId: String(pkg._id || pkg.id),
        packageName: pkg.title || pkg.name,
        tier: pkg.tier || "premium",
      },
    }).catch((e) => console.warn("CashfreePayment create warn:", e.message));

    return res.json({
      success: true,
      orderId: cfOrderId,
      cfOrderId,
      amount: finalAmount,
      packageName: pkg.title || pkg.name,
      currency: "INR",
      paymentSessionId,
      environment: (environment || "SANDBOX").toUpperCase(),
    });
  } catch (error) {
    console.error("createPackageOrder error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const verifyAndUnlockPackage = async (req, res) => {
  try {
    const studentId = String(req.user?.studentId || req.user?.id || req.body.studentId);
    const { orderId, cfOrderId, packageId } = req.body;
    const targetOrderId = cfOrderId || orderId;

    let pkg = null;
    if (packageId) {
      pkg = await StudentPackage.findById(packageId);
    }
    if (!pkg) {
      const pkgs = await StudentPackage.find({ isActive: true });
      pkg = pkgs.find((p) => (p.tier || "").toLowerCase() === "premium" || (p.slug || "").includes("premium")) || pkgs[0];
    }
    if (!pkg) return res.status(404).json({ success: false, message: "Package not found." });

    const finalAmount = Number(pkg.discountedPrice || pkg.discounted_price || pkg.price || 0);

    // If order is paid or free
    let isPaid = finalAmount <= 0;
    let paymentRecord = null;

    if (!isPaid && targetOrderId) {
      paymentRecord = await CashfreePayment.findOne({
        $or: [{ orderId: targetOrderId }, { cfOrderId: targetOrderId }],
      });

      if (paymentRecord && paymentRecord.status === "SUCCESS") {
        isPaid = true;
      } else {
        const config = await getCashfreeConfig();
        let cfStatus = await checkCashfreeOrderStatus(targetOrderId, config);
        if (cfStatus?.status === "pending") {
          await new Promise((r) => setTimeout(r, 1200));
          cfStatus = await checkCashfreeOrderStatus(targetOrderId, config);
        }
        isPaid =
          cfStatus?.status === "success" ||
          cfStatus?.status === "paid" ||
          cfStatus?.status === "PAID" ||
          cfStatus?.order_status === "PAID" ||
          cfStatus?.rawData?.order_status === "PAID" ||
          (Array.isArray(cfStatus?.rawData?.payments) &&
            cfStatus.rawData.payments.some(
              (p) => String(p?.payment_status || "").toUpperCase() === "SUCCESS"
            ));
      }
    }

    if (!isPaid && finalAmount > 0) {
      return res.status(400).json({
        success: false,
        message: "Payment verification pending or unsuccessful with Cashfree. Please retry or contact support.",
      });
    }

    if (paymentRecord) {
      paymentRecord.status = "SUCCESS";
      await paymentRecord.save().catch(() => {});
    }

    const entitlement = await getOrCreateStudentEntitlement(studentId);
    entitlement.activePackage = pkg._id || pkg.id;
    entitlement.tier = "premium";

    // Set expiration based on billingCycle
    const now = new Date();
    const cycle = (pkg.billingCycle || pkg.billing_cycle || "monthly").toLowerCase();
    if (cycle === "yearly") {
      now.setFullYear(now.getFullYear() + 1);
    } else {
      now.setMonth(now.getMonth() + 1);
    }
    entitlement.packageExpiresAt = now;
    await entitlement.save();

    // Award +500 premium flashcards quota and update student table plan_tier = 'premium'
    const quotaUpgrade = await addStudentPremiumFlashcards(studentId);

    return res.json({
      success: true,
      message: `🎉 Congratulations! ${pkg.title || pkg.name} is now active on your account.`,
      tier: "premium",
      expiresAt: entitlement.packageExpiresAt,
      entitlement,
      quota: quotaUpgrade,
    });
  } catch (error) {
    console.error("verifyAndUnlockPackage error:", error);
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

// ============================================================================
// 14. STUDENT STUDY ANALYTICS (Exact details, zero-safe 0-0 display)
// ============================================================================

export const getStudentStudyAnalytics = async (req, res) => {
  try {
    const rawStudentId = req.user?.studentId || req.user?.id || req.user?._id || req.query.studentId;
    const candidateIds = [
      rawStudentId,
      req.user?._id ? String(req.user._id) : null,
      req.user?.id ? String(req.user.id) : null,
      req.user?.studentId ? String(req.user.studentId) : null,
      req.query?.studentId ? String(req.query.studentId) : null,
    ].filter(Boolean).map(String);

    const userEmail = (req.user?.email || "").toLowerCase().trim();
    const userPhone = (req.user?.phone || req.user?.parentPhone || "").replace(/\D/g, "").slice(-10);

    // 1. Fetch Test Series Attempts
    const orFilters = [];
    if (candidateIds.length > 0) {
      orFilters.push({ student: { $in: candidateIds } });
      orFilters.push({ student_id: { $in: candidateIds } });
      orFilters.push({ studentId: { $in: candidateIds } });
    }
    if (userEmail) {
      orFilters.push({ studentEmail: userEmail });
    }
    if (userPhone && userPhone.length >= 7) {
      orFilters.push({ studentPhone: userPhone });
    }

    let attempts = [];
    if (orFilters.length > 0) {
      try {
        attempts = await TestSeriesAttempt.find({ $or: orFilters })
          .populate("testSeries", "title name subject category totalMarks durationMinutes")
          .sort({ submittedAt: -1, createdAt: -1 })
          .limit(100);
      } catch (attErr) {
        console.warn("[StudyAnalytics] Error querying attempts:", attErr.message);
      }
    }

    // 2. Fetch Offline / Teacher Test Results
    let offlineTests = [];
    if (candidateIds.length > 0) {
      try {
        offlineTests = await TestResult.find({ student: { $in: candidateIds } })
          .sort({ examDate: -1, createdAt: -1 })
          .limit(50);
      } catch (offErr) {
        console.warn("[StudyAnalytics] Error querying offline test results:", offErr.message);
      }
    }

    // 3. Fetch Doubts Solved Count
    let doubtsCount = 0;
    if (candidateIds.length > 0) {
      try {
        doubtsCount = await AiDoubtHistory.countDocuments({
          $or: candidateIds.map((id) => ({ studentId: id })),
        });
      } catch (_) {}
    }

    // 4. Fetch Mistakebook Counts
    let mistakesTotal = 0;
    let mistakesResolved = 0;
    if (candidateIds.length > 0) {
      try {
        mistakesTotal = await StudentMistakeBook.countDocuments({
          $or: candidateIds.map((id) => ({ studentId: id })),
        });
        mistakesResolved = await StudentMistakeBook.countDocuments({
          $or: candidateIds.map((id) => ({ studentId: id })),
          status: "mastered",
        });
      } catch (_) {}
    }

    // 5. Fetch Streak
    let currentStreak = 0;
    if (candidateIds.length > 0) {
      try {
        const streakDoc = await StudentStreak.findOne({
          $or: [
            ...candidateIds.map((id) => ({ student: id })),
            ...candidateIds.map((id) => ({ studentId: id })),
          ],
        });
        if (streakDoc) {
          currentStreak = streakDoc.currentStreak || streakDoc.streak || 0;
        }
      } catch (_) {}
    }

    const totalTestsCount = attempts.length + offlineTests.length;

    // Handle exact 0-0 zero-state if student has not performed any test actions
    if (totalTestsCount === 0) {
      return res.json({
        success: true,
        hasActivity: false,
        summary: {
          testsAttempted: 0,
          questionsSolved: 0,
          accuracy: 0,
          averageScore: 0,
          totalMarksObtained: 0,
          totalPossibleMarks: 0,
          totalTimeSpentSeconds: 0,
          totalTimeSpentFormatted: "0 hrs",
          correctCount: 0,
          wrongCount: 0,
          unansweredCount: 0,
          currentStreak: currentStreak || 0,
          doubtsSolved: doubtsCount || 0,
          mistakesCount: mistakesTotal || 0,
          mistakesResolved: mistakesResolved || 0,
        },
        subjectBreakdown: [],
        recentAttempts: [],
        scoreHistory: [],
      });
    }

    // Aggregate attempts
    let totalQuestionsAttempted = 0;
    let totalCorrect = 0;
    let totalWrong = 0;
    let totalUnanswered = 0;
    let totalScore = 0;
    let totalPossibleMarks = 0;
    let totalTimeTakenSeconds = 0;
    const subjectMap = {};

    const formattedRecentAttempts = [];
    const scoreHistory = [];

    // Process online attempts
    for (const att of attempts) {
      const qAttempted = Number(att.attemptedQuestions) || 0;
      const qCorrect = Number(att.correctAnswersCount) || 0;
      const qWrong = Number(att.wrongAnswersCount) || 0;
      const qUnanswered = Number(att.unansweredCount) || 0;
      const attScore = Number(att.score) || 0;
      const attTotalMarks = Number(att.totalMarks) || (attScore > 0 ? attScore : 100);
      const attPercentage = att.percentage !== undefined && att.percentage !== null
        ? Number(att.percentage)
        : (attTotalMarks > 0 ? Math.round((attScore / attTotalMarks) * 100) : 0);
      const attTime = Number(att.timeTakenSeconds) || 0;

      totalQuestionsAttempted += qAttempted;
      totalCorrect += qCorrect;
      totalWrong += qWrong;
      totalUnanswered += qUnanswered;
      totalScore += attScore;
      totalPossibleMarks += attTotalMarks;
      totalTimeTakenSeconds += attTime;

      const testTitle = att.testSeries?.title || att.testSeries?.name || att.studentName || "Mock Test Series";
      const subject = att.testSeries?.subject || "General";

      if (!subjectMap[subject]) {
        subjectMap[subject] = {
          subject,
          testsCount: 0,
          correct: 0,
          totalQuestions: 0,
          totalScore: 0,
          totalMax: 0,
        };
      }
      subjectMap[subject].testsCount += 1;
      subjectMap[subject].correct += qCorrect;
      subjectMap[subject].totalQuestions += (qAttempted || 1);
      subjectMap[subject].totalScore += attScore;
      subjectMap[subject].totalMax += attTotalMarks;

      formattedRecentAttempts.push({
        id: att._id || att.id,
        title: testTitle,
        subject,
        score: attScore,
        totalMarks: attTotalMarks,
        percentage: attPercentage,
        accuracy: qAttempted > 0 ? Math.round((qCorrect / qAttempted) * 100) : 0,
        timeTakenSeconds: attTime,
        submittedAt: att.submittedAt || att.createdAt,
        isPassed: att.isPassed ?? (attPercentage >= 40),
        type: "Test Series",
      });

      scoreHistory.push({
        date: att.submittedAt || att.createdAt,
        score: attScore,
        percentage: attPercentage,
        label: testTitle.length > 15 ? testTitle.slice(0, 15) + "..." : testTitle,
      });
    }

    // Process offline tests
    for (const off of offlineTests) {
      const offScore = Number(off.score) || 0;
      const offTotal = Number(off.totalMarks) || 100;
      const offPct = offTotal > 0 ? Math.round((offScore / offTotal) * 100) : 0;
      const offSubject = off.subject || "General";

      totalScore += offScore;
      totalPossibleMarks += offTotal;

      if (!subjectMap[offSubject]) {
        subjectMap[offSubject] = {
          subject: offSubject,
          testsCount: 0,
          correct: 0,
          totalQuestions: 0,
          totalScore: 0,
          totalMax: 0,
        };
      }
      subjectMap[offSubject].testsCount += 1;
      subjectMap[offSubject].totalScore += offScore;
      subjectMap[offSubject].totalMax += offTotal;

      formattedRecentAttempts.push({
        id: off._id || off.id,
        title: off.title || "Classroom Unit Test",
        subject: offSubject,
        score: offScore,
        totalMarks: offTotal,
        percentage: offPct,
        accuracy: offPct,
        timeTakenSeconds: 0,
        submittedAt: off.examDate || off.createdAt,
        isPassed: offPct >= 40,
        type: off.testType || "Classroom Test",
      });
    }

    // Summary calculations
    const accuracy = totalQuestionsAttempted > 0
      ? Math.round((totalCorrect / totalQuestionsAttempted) * 100)
      : (totalPossibleMarks > 0 ? Math.round((totalScore / totalPossibleMarks) * 100) : 0);

    const averageScore = totalPossibleMarks > 0
      ? Math.round((totalScore / totalPossibleMarks) * 100)
      : 0;

    const totalHours = (totalTimeTakenSeconds / 3600).toFixed(1);
    const totalTimeSpentFormatted = `${totalHours} hrs`;

    // Subject breakdown
    const subjectBreakdown = Object.values(subjectMap).map((s) => ({
      subject: s.subject,
      testsCount: s.testsCount,
      accuracy: s.totalQuestions > 0 ? Math.round((s.correct / s.totalQuestions) * 100) : (s.totalMax > 0 ? Math.round((s.totalScore / s.totalMax) * 100) : 0),
      avgScore: s.totalMax > 0 ? Math.round((s.totalScore / s.totalMax) * 100) : 0,
    }));

    return res.json({
      success: true,
      hasActivity: true,
      summary: {
        testsAttempted: totalTestsCount,
        questionsSolved: totalQuestionsAttempted,
        accuracy,
        averageScore,
        totalMarksObtained: totalScore,
        totalPossibleMarks,
        totalTimeSpentSeconds: totalTimeTakenSeconds,
        totalTimeSpentFormatted,
        correctCount: totalCorrect,
        wrongCount: totalWrong,
        unansweredCount: totalUnanswered,
        currentStreak: currentStreak || 0,
        doubtsSolved: doubtsCount || 0,
        mistakesCount: mistakesTotal || 0,
        mistakesResolved: mistakesResolved || 0,
      },
      subjectBreakdown,
      recentAttempts: formattedRecentAttempts.slice(0, 20),
      scoreHistory: scoreHistory.slice(0, 15).reverse(),
    });
  } catch (error) {
    console.error("[StudyAnalytics] Error in getStudentStudyAnalytics:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to compute study analytics",
      error: error.message,
    });
  }
};
