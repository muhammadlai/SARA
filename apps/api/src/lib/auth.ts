/**
 * Authentication foundation (Phase 1):
 *  - scrypt password hashing/verification (timing-safe)
 *  - HMAC-signed session tokens (compact JWT-style, zero dependencies)
 *
 * Deliberately minimal: the operator's credentials live in validated env
 * config until Phase 2 replaces this with database-backed users and sessions.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE_NAME = "sara_session";
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8 hours

const SCRYPT_KEYLEN = 64;

export interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

/** Hash a password as `scrypt:<salt hex>:<hash hex>`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN).toString("hex");
  return `scrypt:${salt}:${hash}`;
}

/** Timing-safe password verification against a {@link hashPassword} string. */
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || salt === undefined || hash === undefined) return false;
  const expected = Buffer.from(hash, "hex");
  const candidate = scryptSync(password, salt, SCRYPT_KEYLEN);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function signSession(
  claims: { sub: string },
  secret: string,
  now: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const full: SessionClaims = {
    sub: claims.sub,
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + ttlSeconds,
  };
  const payload = Buffer.from(JSON.stringify(full), "utf8").toString("base64url");
  return `${payload}.${hmac(payload, secret)}`;
}

/** Verify signature and expiry; returns claims or null. Never throws. */
export function verifySession(
  token: string,
  secret: string,
  now: number = Date.now(),
): SessionClaims | null {
  const parts = token.split(".");
  const payload = parts[0];
  const signature = parts[1];
  if (parts.length !== 2 || payload === undefined || signature === undefined) return null;

  const expected = hmac(payload, secret);
  const given = Buffer.from(signature);
  const wanted = Buffer.from(expected);
  if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    if (typeof claims.sub !== "string" || typeof claims.exp !== "number") return null;
    if (claims.exp * 1000 <= now) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Ephemeral fallback secret for when SESSION_SECRET is not configured. */
export function createEphemeralSecret(): string {
  return randomBytes(32).toString("hex");
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
