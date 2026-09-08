/**
 * Client-side health fetching. The dashboard always calls the API same-origin
 * (relative /api/* URL) — the Next server proxies to the API service, so this
 * works on localhost and behind preview proxies without CORS.
 */
import type { ApiResponse, HealthPayload } from "@sara/types";

export interface HealthView {
  status: "online" | "degraded" | "offline";
  health?: HealthPayload;
  latencyMs?: number;
  error?: string;
}

/** Type guard for a successful health envelope coming over the wire. */
export function isHealthEnvelope(
  value: unknown,
): value is Extract<ApiResponse<HealthPayload>, { ok: true }> {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.ok !== true || typeof record.data !== "object" || record.data === null) return false;
  const data = record.data as Record<string, unknown>;
  return (
    typeof data.service === "string" && typeof data.checks === "object" && data.checks !== null
  );
}

/** Fetch API health with latency measurement; never throws. */
export async function fetchHealth(): Promise<HealthView> {
  const started = performance.now();
  try {
    const res = await fetch("/api/v1/health", { cache: "no-store" });
    if (!res.ok) throw new Error(`API responded with HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isHealthEnvelope(body)) throw new Error("Unexpected response from API");
    return {
      status: body.data.status === "degraded" ? "degraded" : "online",
      health: body.data,
      latencyMs: Math.max(1, Math.round(performance.now() - started)),
    };
  } catch (err) {
    return { status: "offline", error: err instanceof Error ? err.message : "Request failed" };
  }
}

/** Compact human uptime formatter: 42s, 2m 05s, 1h 06m, 3d 04h. */
export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${String(minutes % 60).padStart(2, "0")}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${String(hours % 24).padStart(2, "0")}h`;
}
