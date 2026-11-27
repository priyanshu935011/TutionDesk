import { supabase } from "../utils/supabase.js";
import { getOrCreateStudentEntitlement } from "./studentEntitlementService.js";
import { callGeminiRaw } from "./aiService.js";
import { formatDisplayMath } from "../utils/mathFormatter.js";
import axios from "axios";

// Helper: Harvest logs for future model training
async function harvestAiLog({ userId, studentId, taskType, prompt, response, metadata = {} }) {
  try {
    const payload = {
      task_type: taskType || "AI_VOICE_TUTOR",
      prompt: String(prompt || "").slice(0, 5000),
      response: String(response || "").slice(0, 5000),
      user_name: "Student",
      user_role: "student",
      metadata: {
        userId: String(userId || ""),
        studentId: String(studentId || ""),
        ...metadata,
      },
    };
    await supabase.from("ai_harvest_logs").insert(payload);
  } catch (err) {
    console.warn("[AiTutor] harvest log error:", err.message);
  }
}

// Fallback in-memory / local storage for resilient operation
const localSessions = new Map();
const localUsage = new Map();

// 5 Core Tutor Personalities Configuration
export const TUTOR_PROFILES = [
  {
    id: "aarav",
    name: "Aarav Sir",
    description: "Friendly & patient tutor who explains complex topics step-by-step with simple real-life analogies.",
    personality: "friendly",
    gender: "male",
    supportedLanguages: ["English", "Hindi", "Hinglish"],
    subscriptionTier: "free",
    systemPrompt: `You are Aarav Sir, a warm, patient, and deeply encouraging Indian tutor on ClassTech. 
Your goal is to make students feel confident and genuinely interested in learning.
Speak in conversational language matching the student's selected language (English, Hindi, or conversational Hinglish).
Break complex concepts into bite-sized explanations.
Use intuitive real-world analogies (e.g., cricket, mobile batteries, cooking, day-to-day Indian examples).
After explaining a key point, briefly check: "Does this make sense to you?" or "Kya ye clear hai?"
Never sound robotic or give giant textbook dumps. Keep spoken turns concise (2-4 sentences max per turn).`,
  },
  {
    id: "anaya",
    name: "Anaya Ma'am",
    description: "Encouraging mentor specializing in biology, chemistry, and foundational sciences.",
    personality: "friendly",
    gender: "female",
    supportedLanguages: ["English", "Hindi", "Hinglish"],
    subscriptionTier: "free",
    systemPrompt: `You are Anaya Ma'am, a brilliant and supportive science teacher on ClassTech.
You excel at visualizing microscopic biology processes, chemical bonding, and intuitive science principles.
Be encouraging, structured, and clear.
Speak naturally in conversational language. Keep spoken turns short and interactive.`,
  },
  {
    id: "professor",
    name: "Prof. Ramanujan",
    description: "Rigorous concept master who dives deep into mathematics, physics, and logical derivations.",
    personality: "concept_master",
    gender: "male",
    supportedLanguages: ["English", "Hindi", "Hinglish"],
    subscriptionTier: "premium",
    systemPrompt: `You are Professor Ramanujan, a master of mathematical rigor, physics fundamentals, and deep logic.
Focus on *why* things work from first principles.
Break formulas down into their physical intuition before showing algebraic steps.
Speak with academic warmth and deep clarity.`,
  },
  {
    id: "coach",
    name: "Coach Vikram",
    description: "Energetic exam strategist focused on JEE, NEET high-yield questions & speed-accuracy drills.",
    personality: "exam_expert",
    gender: "male",
    supportedLanguages: ["English", "Hindi", "Hinglish"],
    subscriptionTier: "premium",
    systemPrompt: `You are Coach Vikram, an energetic and motivational competitive exam mentor on ClassTech.
Focus on JEE, NEET, and board examination patterns.
Highlight common traps, marking scheme tips, shortcuts, and time-management tactics.
Keep energy high, proactive, and focused on score optimization.`,
  },
  {
    id: "examiner",
    name: "Dr. Shastry",
    description: "Strict viva examiner who challenges your understanding with direct questions & cross-examination.",
    personality: "strict",
    gender: "male",
    supportedLanguages: ["English", "Hindi", "Hinglish"],
    subscriptionTier: "premium",
    systemPrompt: `You are Dr. Shastry, an experienced and exacting viva examiner.
Conduct an oral examination. Ask crisp, direct conceptual questions.
Listen to the student's answer, pinpoint any slight inaccuracy or misconception immediately, and challenge them to justify their reasoning.
Maintain academic discipline and high standards.`,
  },
];

// Helper: Call Gemini API using centralized system credentials + fallback resilience
async function callGemini(prompt, systemInstruction = "", harvestMeta = null) {
  try {
    const text = await callGeminiRaw({
      prompt,
      systemInstruction,
      temperature: 0.35,
      timeout: 15000,
    });
    if (text && text.trim().length > 0) {
      const cleanText = text.trim();
      if (harvestMeta) {
        harvestAiLog({
          userId: harvestMeta.userId,
          studentId: harvestMeta.studentId,
          taskType: harvestMeta.taskType || "AI_VOICE_TUTOR",
          prompt,
          response: cleanText,
          metadata: harvestMeta.metadata,
        });
      }
      const formattedText = formatDisplayMath(cleanText);
      return formattedText;
    }
  } catch (err) {
    console.warn("[AiTutorService] callGemini error:", err.message);
  }

  return "Let's break that down step-by-step. What specific part would you like me to clarify?";
}

// 1. Get Tutor Configuration & Profiles
export async function getTutorConfig(userId, studentId) {
  let isPremium = false;
  if (studentId || userId) {
    try {
      const ent = await getOrCreateStudentEntitlement(studentId || userId);
      isPremium = ent && ent.tier === "premium";
    } catch (_) {}
  }

  const usageKey = `${userId || "guest"}_${new Date().toISOString().slice(0, 10)}`;
  const usage = localUsage.get(usageKey) || { seconds: 0, sessionCount: 0 };

  const dailyMinutesLimit = isPremium ? 45 : 5;
  const dailySessionsLimit = isPremium ? 10 : 2;
  const remainingSeconds = Math.max(0, dailyMinutesLimit * 60 - usage.seconds);

  const availableTutors = TUTOR_PROFILES.map((t) => ({
    ...t,
    isLocked: t.subscriptionTier === "premium" && !isPremium,
  }));

  return {
    isPremium,
    dailyMinutesLimit,
    dailySessionsLimit,
    secondsUsedToday: usage.seconds,
    remainingSecondsToday: remainingSeconds,
    remainingMinutesToday: Math.round(remainingSeconds / 60),
    sessionsUsedToday: usage.sessionCount,
    tutors: availableTutors,
    teachingModes: [
      { id: "ask_anything", title: "Ask Anything", desc: "Interactive conversational doubt solving" },
      { id: "learn_chapter", title: "Learn a Chapter", desc: "Structured pedagogical chapter walkthrough" },
      { id: "practice_test", title: "Practice & Viva", desc: "Mock oral exam & viva evaluation" },
    ],
    languages: ["Hinglish", "English", "Hindi"],
  };
}

// 2. Start a Voice Tutor Session
export async function startTutorSession({ userId, studentId, tutorId = "aarav", subject = "Physics", chapter = "", teachingMode = "ask_anything", language = "Hinglish" }) {
  let isPremium = false;
  try {
    const ent = await getOrCreateStudentEntitlement(studentId || userId);
    isPremium = ent && ent.tier === "premium";
  } catch (_) {}

  const tutor = TUTOR_PROFILES.find((t) => t.id === tutorId) || TUTOR_PROFILES[0];
  if (tutor.subscriptionTier === "premium" && !isPremium) {
    const err = new Error("This AI Tutor personality is exclusively available for ClassTech Premium students.");
    err.status = 403;
    throw err;
  }

  const usageKey = `${userId || "guest"}_${new Date().toISOString().slice(0, 10)}`;
  const currentUsage = localUsage.get(usageKey) || { seconds: 0, sessionCount: 0 };
  const dailyLimitSeconds = (isPremium ? 45 : 5) * 60;

  if (currentUsage.seconds >= dailyLimitSeconds) {
    const err = new Error(
      isPremium
        ? "You have reached your daily 45-minute AI Voice Tutor limit. Your quota will reset tomorrow."
        : "You have used your 5-minute daily free AI Voice Tutor allowance. Upgrade to ClassTech Premium for 45 minutes daily."
    );
    err.status = 403;
    err.quotaExhausted = true;
    throw err;
  }

  const sessionId = "session_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7);
  const session = {
    id: sessionId,
    userId,
    studentId,
    tutorId: tutor.id,
    tutorName: tutor.name,
    personality: tutor.personality,
    subject,
    chapter,
    teachingMode,
    language,
    startedAt: new Date(),
    status: "active",
    messages: [],
    durationSeconds: 0,
  };

  localSessions.set(sessionId, session);

  const greetingPrompt = `You are starting an oral teaching session with a student on ClassTech.
Subject: ${subject}
Chapter: ${chapter || "General Revision"}
Mode: ${teachingMode}
Language: ${language}
Provide a warm, energetic, and engaging opening spoken remark (1-2 short sentences) introducing yourself and inviting the student's first question.`;

  const initialGreeting = await callGemini(greetingPrompt, tutor.systemPrompt, {
    userId,
    studentId,
    taskType: "AI_VOICE_TUTOR_GREETING",
    metadata: { sessionId, tutorId, subject, chapter, language },
  });

  session.messages.push({
    role: "assistant",
    content: initialGreeting,
    timestamp: new Date(),
  });

  return {
    sessionId,
    tutorName: tutor.name,
    personality: tutor.personality,
    subject,
    chapter,
    teachingMode,
    language,
    initialGreeting,
    remainingSeconds: dailyLimitSeconds - currentUsage.seconds,
  };
}

// 3. Process Conversational Spoken Turn (Supports Interruption)
export async function interactWithTutor({ sessionId, userSpeech, isInterruption = false }) {
  const session = localSessions.get(sessionId);
  if (!session) {
    const err = new Error("Tutor session not found or expired.");
    err.status = 404;
    throw err;
  }

  const tutor = TUTOR_PROFILES.find((t) => t.id === session.tutorId) || TUTOR_PROFILES[0];

  if (isInterruption && session.messages.length > 0) {
    const lastMsg = session.messages[session.messages.length - 1];
    if (lastMsg.role === "assistant") {
      lastMsg.interrupted = true;
    }
  }

  session.messages.push({
    role: "user",
    content: userSpeech,
    timestamp: new Date(),
    isInterruption,
  });

  const recentTurns = session.messages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n");

  const prompt = `Student says: "${userSpeech}"
${isInterruption ? "(Note: The student just interrupted your explanation with this question or doubt. Acknowledge and address it immediately.)" : ""}
Recent context:
${recentTurns}

Respond naturally as ${tutor.name} in ${session.language}.
Keep your reply concise, clear, and interactive for speech delivery (2-3 sentences max).
Avoid markdown formatting or bullet points that sound unnatural when spoken aloud.`;

  const reply = await callGemini(prompt, tutor.systemPrompt, {
    userId: session.userId,
    studentId: session.studentId,
    taskType: "AI_VOICE_TUTOR_INTERACT",
    metadata: { sessionId, isInterruption, tutorId: tutor.id, subject: session.subject },
  });

  session.messages.push({
    role: "assistant",
    content: reply,
    timestamp: new Date(),
  });

  return {
    sessionId,
    reply,
    isInterruption,
    tutorName: tutor.name,
  };
}

// 4. End Session & Generate Post-Session Learning Report
export async function endTutorSession({ sessionId, durationSeconds = 60 }) {
  const session = localSessions.get(sessionId);
  if (!session) {
    return {
      success: true,
      durationSeconds,
      summary: "Completed AI Voice revision session.",
      conceptsUnderstood: ["Active recall", "Conceptual foundations"],
      conceptsToRevise: ["Practice numerical problem sets"],
      recommendedFlashcards: [],
    };
  }

  session.status = "completed";
  session.endedAt = new Date();
  session.durationSeconds = durationSeconds;

  const usageKey = `${session.userId || "guest"}_${new Date().toISOString().slice(0, 10)}`;
  const current = localUsage.get(usageKey) || { seconds: 0, sessionCount: 0 };
  current.seconds += durationSeconds;
  current.sessionCount += 1;
  localUsage.set(usageKey, current);

  const conversationText = session.messages
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${m.content}`)
    .join("\n");

  const reportPrompt = `Based on this tutoring conversation:
${conversationText}

Generate a structured JSON learning report with:
{
  "summary": "1-2 sentence overall summary of the student's mastery in this session",
  "conceptsUnderstood": ["concept 1", "concept 2"],
  "conceptsToRevise": ["concept requiring more practice"],
  "recommendedFlashcards": [
    {"question": "High-yield question based on discussion", "answer": "Clear concise answer"}
  ]
}
Return ONLY valid JSON.`;

  let report = {
    summary: `Productive ${Math.round(durationSeconds / 60) || 1}-minute active revision on ${session.subject}.`,
    conceptsUnderstood: [`${session.subject} core principles`, "Problem solving logic"],
    conceptsToRevise: ["Deeper formula derivation practice"],
    recommendedFlashcards: [
      {
        question: `What is the key takeaway from ${session.subject} discussed in this session?`,
        answer: "Mastering fundamental definitions and applying active recall to problem solving.",
      },
    ],
  };

  try {
    const rawReport = await callGemini(reportPrompt);
    const jsonMatch = rawReport.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      report = JSON.parse(jsonMatch[0]);
    }
  } catch (_) {}

  return {
    sessionId,
    subject: session.subject,
    chapter: session.chapter,
    durationSeconds,
    report,
  };
}

export default {
  getTutorConfig,
  startTutorSession,
  interactWithTutor,
  endTutorSession,
  TUTOR_PROFILES,
};
