import AiHarvestLog from "../models/AiHarvestLog.js";
import { sanitizeObjectForLog } from "./piiSanitizer.js";

/**
 * Harvest and log AI interaction in database (with PII stripped per DPDP data minimization).
 */
export async function logAiHarvest({
  instituteId = null,
  user = null,
  taskType = "QUERY",
  prompt = "",
  response = "",
  generatedContent = null,
  metadata = {},
  creditsDeducted = 0,
}) {
  try {
    const rawInstId = instituteId || user?.institute?._id || user?.institute || null;
    const cleanInstId = rawInstId ? String(rawInstId) : null;
    const rawUserId = user?._id || user?.id || null;

    let textResponse = "";
    if (typeof response === "string") {
      textResponse = response;
    } else if (response && typeof response === "object") {
      textResponse = response.reply || response.content || response.message || JSON.stringify(response);
    }

    const safePrompt = sanitizeObjectForLog(String(prompt || "").trim());
    const safeResponse = sanitizeObjectForLog(String(textResponse || "").substring(0, 4000));
    const safeRole = user?.role || "user";

    await AiHarvestLog.create({
      institute: cleanInstId,
      instituteId: cleanInstId,
      user: rawUserId,
      userName: safeRole === "student" ? "Student" : user?.role || "User",
      userRole: safeRole,
      taskType: String(taskType || "QUERY").toUpperCase(),
      prompt: safePrompt,
      response: safeResponse,
      generatedContent: generatedContent ? sanitizeObjectForLog(generatedContent) : null,
      metadata: sanitizeObjectForLog(metadata || {}),
      creditsDeducted: Number(creditsDeducted || 0),
    });
  } catch (err) {
    console.warn("⚠️ Failed to harvest AI interaction log:", err.message);
  }
}
