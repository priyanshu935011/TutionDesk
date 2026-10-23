import AiHarvestLog from "../models/AiHarvestLog.js";

/**
 * Harvest and log AI interaction in database
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

    await AiHarvestLog.create({
      institute: cleanInstId,
      instituteId: cleanInstId,
      user: rawUserId,
      userName: user?.name || user?.email || "User",
      userRole: user?.role || "user",
      taskType: String(taskType || "QUERY").toUpperCase(),
      prompt: String(prompt || "").trim(),
      response: textResponse,
      generatedContent: generatedContent || null,
      metadata: metadata || {},
      creditsDeducted: Number(creditsDeducted || 0),
    });
  } catch (err) {
    console.warn("⚠️ Failed to harvest AI interaction log:", err.message);
  }
}
