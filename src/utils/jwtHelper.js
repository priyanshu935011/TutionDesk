import jwt from "jsonwebtoken";

/**
 * Shared JWT signing and verification helper.
 * Fails closed when JWT_SECRET is missing instead of relying on weak defaults
 * or falling back to unsigned jwt.decode().
 */
export function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret || String(secret).trim().length < 8) {
    throw new Error("CRITICAL SECURITY CONFIG: JWT_SECRET environment variable must be configured.");
  }
  return secret;
}

export function signSessionToken(payload, expiresIn = "30d") {
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

export function verifyJwtToken(token) {
  if (!token || typeof token !== "string") {
    throw new Error("Missing token");
  }
  return jwt.verify(token, getJwtSecret());
}
