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

describe("GET /api/v1/health", () => {
  it("returns the ok envelope with service metadata", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.service).toBe("sara-api");
    expect(body.data.apiVersion).toBe("v1");
    expect(typeof body.data.version).toBe("string");
    expect(body.data.version.length).toBeGreaterThan(0);
    expect(typeof body.data.uptimeSeconds).toBe("number");
    expect(typeof body.data.timestamp).toBe("string");
    expect(body.requestId).toBeTruthy();
  });

  it("reports the database as unconfigured when DATABASE_URL is absent", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.json().data.checks.database.status).toBe("unconfigured");
    expect(res.json().data.status).toBe("ok"); // foundation mode: unconfigured is healthy
  });

  it("answers the version index endpoint", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.data.apiVersion).toBe("v1");
    expect(Array.isArray(body.data.endpoints)).toBe(true);
  });
});
