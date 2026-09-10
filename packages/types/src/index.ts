/**
 * @sara/types — shared types and constants for every Sara service.
 *
 * Runtime exports are limited to small, dependency-free constants/helpers so
 * this package is safe to import from the API, the web app and future workers.
 */

/** URL-namespaced API version. Future breaking changes introduce `/api/v2`. */
export const API_VERSION = "v1" as const;

/** Human-facing application name. */
export const APP_NAME = "Sara" as const;

/** The phase currently being developed (mirrors DEVELOPMENT_PLAN.md). */
export const CURRENT_PHASE = 1 as const;

/** All roadmap phases, for UI badges and status displays. */
export const PHASES = [
  { id: 0, title: "Project foundation" },
  { id: 1, title: "Application scaffold" },
  { id: 2, title: "Database, settings & auth" },
  { id: 3, title: "Chat & orchestrator v1" },
  { id: 4, title: "Memory system" },
  { id: 5, title: "Personality & emotions" },
  { id: 6, title: "Tasks & scheduling" },
  { id: 7, title: "Voice" },
  { id: 8, title: "Virtual avatar" },
  { id: 9, title: "Tools & approvals" },
  { id: 10, title: "Content studio" },
  { id: 11, title: "Social media" },
  { id: 12, title: "Analytics & deployment" },
] as const;

export type PhaseId = (typeof PHASES)[number]["id"];

// ── API response envelope ──────────────────────────────────────────────────

/** Machine-readable error codes shared across API and dashboard. */
export type ErrorCode =
  | "INTERNAL"
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "AUTH_NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "CONFLICT"
  | "SERVICE_UNAVAILABLE";

export interface ApiSuccess<TData> {
  ok: true;
  data: TData;
  requestId?: string;
}

export interface ApiFailure {
  ok: false;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

/** Every API endpoint responds with this envelope. */
export type ApiResponse<TData> = ApiSuccess<TData> | ApiFailure;

/** Runtime helper for constructing success envelopes. */
export function apiOk<TData>(data: TData, requestId?: string): ApiSuccess<TData> {
  return requestId === undefined ? { ok: true, data } : { ok: true, data, requestId };
}

/** Runtime helper for constructing failure envelopes. */
export function apiFail(
  code: ErrorCode,
  message: string,
  options: { details?: unknown; requestId?: string } = {},
): ApiFailure {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(options.details !== undefined ? { details: options.details } : {}),
    },
    ...(options.requestId !== undefined ? { requestId: options.requestId } : {}),
  };
}

// ── Health ─────────────────────────────────────────────────────────────────

/** Lifecycle state of one infrastructure component. */
export type HealthState = "up" | "down" | "unconfigured";

export interface ComponentHealth {
  status: HealthState;
  latencyMs?: number;
  detail?: string;
}

export interface HealthPayload {
  status: "ok" | "degraded";
  service: string;
  version: string;
  apiVersion: typeof API_VERSION;
  uptimeSeconds: number;
  timestamp: string;
  checks: {
    database: ComponentHealth;
  };
}

// ── Auth (Phase 1 foundation; full sessions land in Phase 2) ───────────────

export interface SessionUser {
  username: string;
  displayName?: string;
}

export interface SessionInfo {
  authenticated: boolean;
  user?: SessionUser;
}
