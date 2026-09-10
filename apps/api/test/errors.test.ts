import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers.js";
import { buildTestApp } from "./helpers.js";

let app: TestApp;

beforeAll(async () => {
  app = await buildTestApp();
});

afterAll(async () => {
  await app.close();
});

describe("centralized error handling", () => {
  it("wraps unknown routes in the standard error envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/does-not-exist" });
    expect(res.statusCode).toBe(404);

    const body = res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.error.message).toContain("GET /api/v1/does-not-exist");
    expect(body.requestId).toBeTruthy();
  });

  it("maps malformed JSON bodies to a 400 envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: { "content-type": "application/json" },
      payload: "{definitely-not-json",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("INVALID_INPUT");
  });

  it("maps schema violations to a 400 envelope with details", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { wrong: "shape" },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error.code).toBe("INVALID_INPUT");
    expect(body.error.details).toBeTruthy();
  });
});
