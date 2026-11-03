/**
 * Helper utilities for multi-device FCM token management.
 * Stores tokens as a JSON array string in Supabase's text column `fcm_token`
 * and as an array `fcmTokens` in MongoDB / metadata files.
 */

export const parseFcmTokens = (raw) => {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return Array.from(
      new Set(raw.map((t) => (t ? String(t).trim() : "")).filter((t) => t.length > 10))
    );
  }
  const str = String(raw).trim();
  if (!str) return [];

  // If stored as JSON string (e.g. '["token1","token2"]')
  if (str.startsWith("[") && str.endsWith("]")) {
    try {
      const parsed = JSON.parse(str);
      if (Array.isArray(parsed)) {
        return Array.from(
          new Set(parsed.map((t) => (t ? String(t).trim() : "")).filter((t) => t.length > 10))
        );
      }
    } catch (_) {}
  }

  // Fallback to single string token
  return str.length > 10 ? [str] : [];
};

/**
 * Add a token to existing tokens list (max 10 active devices per user/student)
 */
export const addFcmToken = (existingRaw, newToken) => {
  const clean = String(newToken || "").trim();
  if (!clean || clean.length < 10) return parseFcmTokens(existingRaw);

  const tokens = parseFcmTokens(existingRaw);
  // Remove if already present so it moves to front (most recently active device)
  const filtered = tokens.filter((t) => t !== clean);
  filtered.unshift(clean);

  // Keep up to 10 most recent devices
  return filtered.slice(0, 10);
};

/**
 * Remove a token (e.g. on device logout)
 */
export const removeFcmToken = (existingRaw, tokenToRemove) => {
  const clean = String(tokenToRemove || "").trim();
  if (!clean) return parseFcmTokens(existingRaw);

  const tokens = parseFcmTokens(existingRaw);
  return tokens.filter((t) => t !== clean);
};

/**
 * Serialize token array to string for Supabase `fcm_token` text column
 */
export const serializeTokensForDb = (tokensArray) => {
  if (!Array.isArray(tokensArray) || tokensArray.length === 0) {
    return null;
  }
  return JSON.stringify(tokensArray);
};
