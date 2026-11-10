/**
 * DPDP Data Minimization & Pseudonymization Helper for External LLM Calls
 * Replaces student names, phone numbers, and emails with deterministic tokens
 * before prompts leave backend to external AI APIs, then restores display names
 * only in the local response returned to the authenticated institute user.
 */

export function createStudentPiiTokenizer(students = []) {
  const tokenToName = new Map();
  const replacementPairs = [];

  students.forEach((s, index) => {
    const code = `STUDENT_${String(index + 1).padStart(3, "0")}`;
    const rawName = String(s?.name || "").trim();
    if (rawName) {
      tokenToName.set(code, rawName);
      replacementPairs.push({ value: rawName, token: code });
    }
    const rawPhone = String(s?.phone || "").trim();
    if (rawPhone) {
      replacementPairs.push({ value: rawPhone, token: `[PHONE_REDACTED]` });
    }
    const rawParentPhone = String(s?.parentPhone || "").trim();
    if (rawParentPhone) {
      replacementPairs.push({ value: rawParentPhone, token: `[PARENT_PHONE_REDACTED]` });
    }
    const rawEmail = String(s?.email || "").trim();
    if (rawEmail) {
      replacementPairs.push({ value: rawEmail, token: `[EMAIL_REDACTED]` });
    }
  });

  // Sort longer strings first so partial names don't prematurely break full names
  replacementPairs.sort((a, b) => b.value.length - a.value.length);

  const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const sanitizeForLlm = (text = "") => {
    let output = String(text || "");
    for (const pair of replacementPairs) {
      if (!pair.value || pair.value.length < 2) continue;
      const re = new RegExp(`(?<!\\w)${escapeRegex(pair.value)}(?!\\w)`, "gi");
      output = output.replace(re, pair.token);
    }
    // Safety net: scrub any standalone email or 10-digit Indian phone numbers in user query text
    output = output
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[EMAIL_REDACTED]")
      .replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, "[PHONE_REDACTED]");
    return output;
  };

  const restoreInResponse = (text = "") => {
    let output = String(text || "");
    for (const [token, name] of tokenToName.entries()) {
      output = output.replace(new RegExp(escapeRegex(token), "g"), name);
    }
    return output;
  };

  return {
    sanitizeForLlm,
    restoreInResponse,
    tokenMapSize: tokenToName.size,
  };
}
