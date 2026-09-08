import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers.js";
import { buildTestApp, TEST_PASSWORD } from "./helpers.js";

function sessionCookie(res: { headers: Record<string, unknown> }): string {
  const raw = res.headers["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === "string" ? value : "";
}

describe("auth foundation (configured operator)", () => {
  let app: TestApp;
  let cookie: string;

  beforeAll(async () => {
    app = await buildTestApp({ operatorPassword: TEST_PASSWORD });
  });

  afterAll(async () => {
    await app.close();
  });

  it("rejects wrong credentials with a 401 envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "operator", password: "wrong-password" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects an unknown username with a 401 envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "intruder", password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(401);
  });

  it("issues an HttpOnly session cookie on successful login", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "operator", password: TEST_PASSWORD },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.user.username).toBe("operator");

    cookie = sessionCookie(res);
    expect(cookie).toContain("sara_session=");
    expect(cookie.toLowerCase()).toContain("httponly");
  });

  it("reports the authenticated session via /auth/me", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.data.authenticated).toBe(true);
    expect(body.data.user.username).toBe("operator");
  });

  it("reports unauthenticated (200) without a cookie", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/auth/me" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.authenticated).toBe(false);
  });

  it("clears the session on logout", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/logout",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.loggedOut).toBe(true);
    expect(sessionCookie(res)).toMatch(/(max-age=0|expires=thu, 01 jan 1970)/i);
  });
});

describe("auth foundation (not configured)", () => {
  it("returns 503 AUTH_NOT_CONFIGURED when no operator password is set", async () => {
    const app = await buildTestApp({ operatorPassword: null });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { username: "operator", password: "whatever-password" },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().error.code).toBe("AUTH_NOT_CONFIGURED");
    } finally {
      await app.close();
    }
  });
});

describe("auth rate limiting", () => {
  it("returns 429 after repeated login attempts", async () => {
    const app = await buildTestApp({ operatorPassword: TEST_PASSWORD });
    try {
      let lastRes;
      for (let i = 0; i < 6; i += 1) {
        lastRes = await app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { username: "operator", password: `attempt-${i}-wrong` },
        });
      }
      expect(lastRes?.statusCode).toBe(429);
      expect(lastRes?.json().error.code).toBe("RATE_LIMITED");
    } finally {
      await app.close();
    }
  });
});
