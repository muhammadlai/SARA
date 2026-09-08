import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TestApp } from "./helpers.js";
import { buildTestApp } from "./helpers.js";

let app: TestApp;

beforeAll(async () => {
  app = await buildTestApp({ corsOrigins: ["http://localhost:3000"] });
});

afterAll(async () => {
  await app.close();
});

describe("CORS", () => {
  it("allows configured origins", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "http://localhost:3000" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("denies unknown origins (no CORS headers)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(200); // request still served; browsers enforce CORS
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("answers preflight requests for allowed origins", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/login",
      headers: {
        origin: "http://localhost:3000",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("lets requests without an Origin header through (same-origin / curl)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
  });
});
