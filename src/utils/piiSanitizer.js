/**
 * DPDP Section 8(5) & Rule 6 PII Masking & Redaction Utilities
 * Ensures sensitive fields, credentials, and personal identifiers are scrubbed
 * from logs, crash telemetry, and external alerts.
 */

const SENSITIVE_KEY_PATTERN =
  /password|passcode|token|secret|otp|authorization|cookie|jwt|api[-_]?key|credit|cvv|pin/i;

export function maskEmail(email = "") {
  const str = String(email || "").trim();
  if (!str || str === "N/A" || !str.includes("@")) return str ? "***" : "N/A";
  const [local, domain] = str.split("@");
  if (!local) return `***@${domain}`;
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}***@${domain}`;
}

export function maskPhone(phone = "") {
  const raw = String(phone || "").replace(/\D/g, "");
  if (!raw) return "N/A";
  if (raw.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, raw.length - 4))}${raw.slice(-4)}`;
}

export function maskIp(ip = "") {
  const str = String(ip || "").trim();
  if (!str) return "";
  if (str.includes(".")) {
    const parts = str.split(".");
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.xxx.xxx`;
    }
  }
  if (str.includes(":")) {
    return `${str.split(":").slice(0, 3).join(":")}::xxxx`;
  }
  return "***";
}

export function sanitizeObjectForLog(value, depth = 0) {
  if (depth > 4) return "[Truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    // Mask inline email addresses or 10+ digit Indian phones inside free text
    return value
      .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => maskEmail(m))
      .replace(/\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g, (m) => maskPhone(m));
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeObjectForLog(item, depth + 1));
  }
  const clean = {};
  for (const [k, v] of Object.entries(value)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      clean[k] = "[REDACTED]";
    } else if (/email/i.test(k) && typeof v === "string") {
      clean[k] = maskEmail(v);
    } else if (/phone|mobile|whatsapp/i.test(k) && typeof v === "string") {
      clean[k] = maskPhone(v);
    } else if (/^ip$|ipaddress|ip_address/i.test(k) && typeof v === "string") {
      clean[k] = maskIp(v);
    } else {
      clean[k] = sanitizeObjectForLog(v, depth + 1);
    }
  }
  return clean;
}
