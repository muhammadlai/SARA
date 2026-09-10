import { describe, expect, it } from "vitest";
import {
  createEphemeralSecret,
  hashPassword,
  signSession,
  verifyPassword,
  verifySession,
} from "../src/lib/auth.js";

describe("password hashing", () => {
  it("round-trips a password", () => {
    const stored = hashPassword("hunter2-secret");
    expect(stored.startsWith("scrypt:")).toBe(true);
    expect(verifyPassword("hunter2-secret", stored)).toBe(true);
  });

  it("rejects wrong passwords", () => {
    const stored = hashPassword("hunter2-secret");
    expect(verifyPassword("hunter3-secret", stored)).toBe(false);
  });

  it("produces a unique salt per hash", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("refuses malformed stored hashes", () => {
    expect(verifyPassword("x", "not-a-hash")).toBe(false);
    expect(verifyPassword("x", "md5:abcd:efgh")).toBe(false);
  });
});

describe("session tokens", () => {
  const secret = "unit-test-secret-0123456789abcdef";

  it("signs and verifies a session token", () => {
    const token = signSession({ sub: "operator" }, secret);
    const claims = verifySession(token, secret);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe("operator");
    expect(claims?.exp).toBeGreaterThan(claims?.iat ?? 0);
  });

  it("rejects tampered payloads", () => {
    const token = signSession({ sub: "operator" }, secret);
    const [payload] = token.split(".");
    const evil = Buffer.from(JSON.stringify({ sub: "attacker", iat: 1, exp: 9999999999 })).toString(
      "base64url",
    );
    expect(verifySession(`${evil}.${token.split(".")[1]}`, secret)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it("rejects tokens signed with a different secret", () => {
    const token = signSession({ sub: "operator" }, secret);
    expect(verifySession(token, "another-secret-0123456789abcdef")).toBeNull();
  });

  it("rejects expired tokens", () => {
    const past = Date.now() - 1000 * 60 * 60; // signed 1h ago
    const token = signSession({ sub: "operator" }, secret, past, 60); // 60s TTL
    expect(verifySession(token, secret)).toBeNull();
    // ...but still valid when checked just after issuance
    expect(verifySession(token, secret, past + 1000)).not.toBeNull();
  });

  it("rejects malformed tokens", () => {
    expect(verifySession("garbage", secret)).toBeNull();
    expect(verifySession("a.b.c", secret)).toBeNull();
  });

  it("creates a random ephemeral secret", () => {
    expect(createEphemeralSecret()).not.toBe(createEphemeralSecret());
    expect(createEphemeralSecret()).toHaveLength(64);
  });
});
