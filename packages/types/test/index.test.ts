import { describe, expect, it } from "vitest";
import { API_VERSION, apiFail, apiOk, CURRENT_PHASE, PHASES } from "../src/index.js";

describe("@sara/types", () => {
  it("exposes the current API version and phase", () => {
    expect(API_VERSION).toBe("v1");
    expect(CURRENT_PHASE).toBe(1);
  });

  it("lists all roadmap phases in order", () => {
    expect(PHASES).toHaveLength(13);
    expect(PHASES.map((p) => p.id)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it("builds success envelopes", () => {
    expect(apiOk({ hello: "world" })).toEqual({ ok: true, data: { hello: "world" } });
    expect(apiOk(42, "req-1")).toEqual({ ok: true, data: 42, requestId: "req-1" });
  });

  it("builds failure envelopes with optional details", () => {
    const base = apiFail("NOT_FOUND", "missing");
    expect(base).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "missing" } });

    const detailed = apiFail("INVALID_INPUT", "bad", { details: { field: "x" }, requestId: "r2" });
    expect(detailed.error.details).toEqual({ field: "x" });
    expect(detailed.requestId).toBe("r2");
  });
});
