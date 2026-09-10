/**
 * Typed client for the Sara LIVE host API (dashboard use only).
 */
export interface SaraLiveStatus {
  state: "idle" | "starting" | "live" | "paused" | "takeover" | "muted" | "stopped" | "error";
  platform: string;
  session: { id: string; startedAt: string | null } | null;
  sources: Array<{
    connected: boolean;
    detail: string;
    mode: "official" | "simulator" | "unavailable";
    lastEventAt: string | null;
    reconnects: number;
  }>;
  brain: { provider: string; fallback: string | null };
  tts: { provider: string; degraded: boolean };
  avatar: { provider: string; capabilities: string[] };
  queue: { depth: number; responsesPerMinute: number };
  metrics: {
    uptimeSeconds: number;
    comments: number;
    responses: number;
    rejectedComments: number;
    events: number;
    errors: number;
    reconnects: number;
    avgResponseLatencyMs: number;
    tokensUsed: number | null;
  };
  aiDisclosure: string;
}

export interface SaraStatusResponse {
  live: SaraLiveStatus;
  emotion: { emotion: string; intensity: number };
  battle: { state: string; opponent?: string; myScore?: number; opponentScore?: number } | null;
  system: {
    overall: "healthy" | "degraded" | "failing";
    components: Array<{ component: string; healthy: boolean; degraded: boolean; detail: string }>;
    process: {
      uptimeSeconds: number;
      memoryMb: number;
      cpuPercent: number | null;
      nodeVersion: string;
    };
  };
  providers: Array<{
    provider: string;
    kind: string;
    calls: number;
    failures: number;
    avgLatencyMs: number;
  }>;
  personality: SaraPersonality;
  avatar: { provider: string; capabilities: string[]; portraitUrl: string };
  aiDisclosure: string;
  platformNotice: string;
}

export interface SaraPersonality {
  name: string;
  tagline: string;
  warmth: number;
  humor: number;
  energy: number;
  formality: number;
  responseLength: "short" | "medium" | "long";
  emojiRate: number;
  greetingStyle: "warm" | "energetic" | "calm";
  defaultLanguage: string;
}

export interface SaraFeedItem {
  id: string;
  at: string;
  kind: "viewer" | "sara" | "operator" | "system" | "event" | "moderation" | "error" | "status";
  text: string;
  username?: string;
  emotion?: string;
  audioUrl?: string;
  avatar?: { mode: string; assetUrl: string | null; note?: string } | null;
  meta?: Record<string, unknown>;
}

export interface SaraMemoryData {
  viewers: Array<{
    id: string;
    displayName: string;
    platform: string;
    interactionCount: number;
    isFollower: boolean;
    isRegular: boolean;
    lastSeenAt: string;
  }>;
  memories: Array<{
    id: string;
    viewerId: string | null;
    kind: string;
    content: string;
    salience: number;
  }>;
  enabled: boolean;
}

export interface SaraSettings {
  responsesPerMinute: number;
  perViewerCooldownSeconds: number;
  duplicateWindowSeconds: number;
  minPriority: number;
  moderationStrictness: "relaxed" | "standard" | "strict";
  autoGreetJoins: boolean;
  thankGifts: boolean;
  welcomeFollows: boolean;
  memoryEnabled: boolean;
  aiDisclosure: string;
}

export interface SaraModerationData {
  settings: { strictness: string; extraBlockedWords: string[]; allowLinks: boolean };
  blockedWords: string[];
  summary: Array<{ category: string; action: string; n: number }>;
}

async function envelope<T>(res: Response): Promise<T> {
  const body = (await res.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!body.ok) throw new Error(body.error?.message ?? `request failed (${res.status})`);
  return body.data as T;
}

export function createSaraClient(getJson: typeof fetch = (...a) => fetch(...a)) {
  const req = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const res = await getJson(url, {
      ...init,
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
    return envelope<T>(res);
  };

  return {
    status: () => req<SaraStatusResponse>("/api/v1/sara/status"),
    feed: (after: string | null) =>
      req<{ items: SaraFeedItem[] }>(
        `/api/v1/sara/feed${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      ),
    simulate: (username: string, text: string) =>
      req<{ eventId: string; accepted: boolean; reason: string }>("/api/v1/sara/simulate", {
        method: "POST",
        body: JSON.stringify({ username, text }),
      }),
    control: (action: string) =>
      req<{ detail: string }>("/api/v1/sara/control", {
        method: "POST",
        body: JSON.stringify({ action }),
      }),
    operator: (text: string) =>
      req<{ item: SaraFeedItem }>("/api/v1/sara/operator", {
        method: "POST",
        body: JSON.stringify({ text }),
      }),
    settings: () => req<SaraSettings>("/api/v1/sara/settings"),
    updateSettings: (patch: Partial<SaraSettings>) =>
      req<SaraSettings>("/api/v1/sara/settings", { method: "POST", body: JSON.stringify(patch) }),
    personality: () => req<SaraPersonality>("/api/v1/sara/personality"),
    updatePersonality: (patch: Partial<SaraPersonality>) =>
      req<SaraPersonality>("/api/v1/sara/personality", {
        method: "POST",
        body: JSON.stringify(patch),
      }),
    moderation: () => req<SaraModerationData>("/api/v1/sara/moderation"),
    updateModeration: (patch: {
      strictness?: string;
      extraBlockedWords?: string[];
      allowLinks?: boolean;
    }) =>
      req<SaraModerationData>("/api/v1/sara/moderation", {
        method: "POST",
        body: JSON.stringify(patch),
      }),
    memory: () => req<SaraMemoryData>("/api/v1/sara/memory"),
    forgetMemory: (id: string) =>
      req<{ deleted: boolean }>(`/api/v1/sara/memory/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    forgetViewer: (id: string) =>
      req<{ deleted: number }>(`/api/v1/sara/memory/viewer/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
    audit: () =>
      req<{
        entries: Array<{
          id: number;
          at: string;
          actor: string;
          action: string;
          target: string | null;
        }>;
      }>("/api/v1/sara/audit"),
    analytics: () =>
      req<{
        current: SaraLiveStatus["metrics"];
        sessions: unknown[];
        providers: SaraStatusResponse["providers"];
      }>("/api/v1/sara/analytics"),
    converse: (text: string, username = "Operator") =>
      req<{
        text: string;
        provider: string;
        fallback: boolean;
        tts: { provider: string; degraded: boolean; url: string | null };
        emotion: string;
        language: string;
      }>("/api/v1/sara/converse", { method: "POST", body: JSON.stringify({ text, username }) }),
  };
}

export type SaraClient = ReturnType<typeof createSaraClient>;

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
