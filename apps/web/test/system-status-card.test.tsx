import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemStatusCard } from "../components/system-status-card";
import { formatUptime, isHealthEnvelope } from "../lib/health";
import type { HealthPayload } from "@sara/types";

const HEALTH: HealthPayload = {
  status: "ok",
  service: "sara-api",
  version: "0.2.0-test",
  apiVersion: "v1",
  uptimeSeconds: 42,
  timestamp: "2026-09-08T12:00:00.000Z",
  checks: { database: { status: "unconfigured" } },
};

function fetchOk(payload: { ok: boolean; data: HealthPayload }) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SystemStatusCard", () => {
  it("shows the online state with API metadata", async () => {
    vi.stubGlobal("fetch", fetchOk({ ok: true, data: HEALTH }));
    render(<SystemStatusCard />);

    expect(await screen.findByText("Online")).toBeInTheDocument();
    expect(screen.getByText("0.2.0-test")).toBeInTheDocument();
    expect(screen.getByText("42s")).toBeInTheDocument();
    expect(screen.getByText("Not configured · Phase 2")).toBeInTheDocument();
    expect(screen.getByText(/Response time/)).toBeInTheDocument();
  });

  it("shows the degraded state when the database is down", async () => {
    vi.stubGlobal(
      "fetch",
      fetchOk({
        ok: true,
        data: { ...HEALTH, status: "degraded", checks: { database: { status: "down" } } },
      }),
    );
    render(<SystemStatusCard />);

    expect(await screen.findByText("Degraded")).toBeInTheDocument();
    expect(screen.getByText("Unreachable")).toBeInTheDocument();
  });

  it("shows an error state with a working retry button when the API is unreachable", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("connection refused"));
    vi.stubGlobal("fetch", failing);
    const user = userEvent.setup();
    render(<SystemStatusCard />);

    expect(await screen.findByText("API unreachable")).toBeInTheDocument();
    expect(screen.getByText(/connection refused/)).toBeInTheDocument();

    // API comes back; retry should recover the card.
    vi.stubGlobal("fetch", fetchOk({ ok: true, data: HEALTH }));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.getByText("Online")).toBeInTheDocument());
  });
});

describe("isHealthEnvelope", () => {
  it("accepts a valid success envelope and rejects everything else", () => {
    expect(isHealthEnvelope({ ok: true, data: HEALTH })).toBe(true);
    expect(isHealthEnvelope({ ok: false, error: { code: "INTERNAL", message: "x" } })).toBe(false);
    expect(isHealthEnvelope({ ok: true, data: {} })).toBe(false);
    expect(isHealthEnvelope(null)).toBe(false);
    expect(isHealthEnvelope("hello")).toBe(false);
  });
});

describe("formatUptime", () => {
  it("formats seconds, minutes, hours and days", () => {
    expect(formatUptime(42)).toBe("42s");
    expect(formatUptime(125)).toBe("2m 05s");
    expect(formatUptime(4000)).toBe("1h 06m");
    expect(formatUptime(90000)).toBe("1d 01h");
  });
});
