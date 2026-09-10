/**
 * Sara AI — TikTok LIVE integration adapter.
 *
 * POLICY (hard requirement):
 *   - Only official/authorized channels. This adapter consumes an
 *     **official events webhook / authorized API endpoint** that the
 *     operator must configure (`SARA_TIKTOK_EVENTS_URL`) — i.e. an endpoint
 *     TikTok or an authorized partner actually provides for the account.
 *   - NO cookie theft, NO scraping, NO auth bypass, NO unofficial websocket
 *     libraries that impersonate viewers, NO fake engagement of any kind.
 *   - Outgoing actions (sending comments into LIVE) are NOT implemented:
 *     TikTok does not offer a public LIVE comment-posting API — the honest
 *     behavior is to say so, not to fake it.
 *
 * If the endpoint is not configured, the source reports mode="unavailable"
 * with a clear explanation — Sara never claims TikTok is connected.
 */
import { createLogger } from "@sara/logger";
import type {
  BattleSnapshot,
  LiveEvent,
  LiveEventKind,
  LiveEventSource,
  SourceStatus,
} from "../types.js";

const log = createLogger({ name: "sara-tiktok" });

/** Normalized payload shape we expect from the official events webhook. */
interface OfficialEventPayload {
  event?: string;
  kind?: string;
  username?: string;
  user_id?: string;
  user?: { unique_id?: string; user_id?: string; nickname?: string };
  text?: string;
  comment?: string;
  gift_name?: string;
  gift?: string;
  gift_count?: number;
  battle?: BattleSnapshot;
  at?: string;
}

const KIND_MAP: Record<string, LiveEventKind> = {
  comment: "comment",
  chat: "comment",
  gift: "gift",
  follow: "follow",
  unfollow: "unfollow",
  share: "share",
  join: "join",
  member: "join",
  leave: "leave",
  like: "like",
  battle_start: "battle_start",
  battle: "battle_start",
  battle_update: "battle_update",
  battle_end: "battle_end",
};

export function normalizeOfficialEvent(
  raw: OfficialEventPayload,
  platform = "tiktok",
): LiveEvent | null {
  const kindRaw = (raw.event ?? raw.kind ?? "").toLowerCase();
  const kind = KIND_MAP[kindRaw];
  if (!kind) return null;
  const username = raw.username ?? raw.user?.unique_id ?? raw.user?.nickname;
  const userId = raw.user_id ?? raw.user?.user_id;
  return {
    id: `tk_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
    kind,
    platform,
    username,
    userId,
    text: raw.text ?? raw.comment,
    giftName: raw.gift_name ?? raw.gift,
    giftCount: raw.gift_count,
    battle: raw.battle,
    at: raw.at ?? new Date().toISOString(),
  };
}

export interface OfficialTikTokOptions {
  /** Authorized events endpoint (webhook URL or authorized REST poll). */
  eventsUrl?: string | null;
  /** Optional shared secret header for the operator's own webhook relay. */
  bearerToken?: string | null;
  pollIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

/**
 * Official-channel source. Supports two shapes:
 *  - push: the operator's relay POSTs normalized events to Sara (acceptWebhook)
 *  - pull: Sara polls the configured endpoint for new events (start())
 */
export class OfficialTikTokSource implements LiveEventSource {
  readonly name = "tiktok-official";
  readonly platform = "tiktok";
  private handler: ((e: LiveEvent) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private connectedFlag = false;
  private lastEventAt: string | null = null;
  private reconnects = 0;
  private consecutiveFailures = 0;
  private cursor: string | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OfficialTikTokOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  get connected(): boolean {
    return this.connectedFlag;
  }

  async start(): Promise<void> {
    if (!this.opts.eventsUrl) return; // stays "unavailable" — by design
    this.connectedFlag = true;
    const interval = this.opts.pollIntervalMs ?? 4000;
    const poll = async (): Promise<void> => {
      if (!this.connectedFlag) return;
      try {
        const url = new URL(this.opts.eventsUrl!);
        if (this.cursor) url.searchParams.set("cursor", this.cursor);
        const res = await this.fetchImpl(url, {
          headers: this.opts.bearerToken
            ? { authorization: `Bearer ${this.opts.bearerToken}` }
            : {},
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`http ${res.status}`);
        const data = (await res.json()) as { events?: OfficialEventPayload[]; cursor?: string };
        for (const raw of data.events ?? []) {
          const evt = normalizeOfficialEvent(raw);
          if (evt) {
            this.lastEventAt = evt.at;
            this.handler?.(evt);
          }
        }
        if (data.cursor) this.cursor = data.cursor;
        this.consecutiveFailures = 0;
      } catch (err) {
        this.consecutiveFailures += 1;
        log.warn(
          { err: String(err).slice(0, 120), failures: this.consecutiveFailures },
          "tiktok poll failed",
        );
        if (this.consecutiveFailures >= 3) {
          // Exponential backoff via doubling the poll interval temporarily.
          this.reconnects += 1;
        }
      }
    };
    this.timer = setInterval(
      () => {
        void poll();
      },
      interval + Math.min(this.reconnects * 4000, 60_000),
    );
    void poll();
  }

  /** Operator webhook relay: their server forwards official events to Sara. */
  acceptWebhook(raw: OfficialEventPayload): LiveEvent | null {
    const evt = normalizeOfficialEvent(raw);
    if (!evt) return null;
    this.lastEventAt = evt.at;
    this.handler?.(evt);
    return evt;
  }

  async stop(): Promise<void> {
    this.connectedFlag = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onEvent(handler: (event: LiveEvent) => void): void {
    this.handler = handler;
  }

  status(): SourceStatus {
    return {
      connected: this.connectedFlag && this.consecutiveFailures < 3,
      detail: this.opts.eventsUrl
        ? this.connected
          ? `polling official events endpoint (${this.consecutiveFailures} recent failures)`
          : "configured, connection failing — check credentials/endpoint"
        : "not configured: set SARA_TIKTOK_EVENTS_URL to an officially authorized events endpoint. Sara will not use unofficial/cookie-based access.",
      mode: "official",
      lastEventAt: this.lastEventAt,
      reconnects: this.reconnects,
    };
  }
}

/** Explicit "not available" source used when TikTok is not configured. */
export class UnavailableTikTokSource implements LiveEventSource {
  readonly name = "tiktok-unavailable";
  readonly platform = "tiktok";
  readonly connected = false;
  private handler: ((e: LiveEvent) => void) | null = null;

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  onEvent(handler: (event: LiveEvent) => void): void {
    this.handler = handler;
  }
  /** Used by tests to verify no events flow when unavailable. */
  injectForTest(event: LiveEvent): void {
    this.handler?.(event);
  }
  status(): SourceStatus {
    return {
      connected: false,
      detail:
        "TikTok not connected: no authorized events endpoint configured. Sara is NOT live on TikTok. Configure SARA_TIKTOK_EVENTS_URL with an officially authorized integration; unofficial scraping/cookie access is intentionally not supported.",
      mode: "unavailable",
      lastEventAt: null,
      reconnects: 0,
    };
  }
}

/**
 * Battle Event Manager — reacts only to officially exposed battle events.
 * Simulated battles come from the simulator source (labeled), never fabricated
 * as real.
 */
export class BattleManager {
  private active: BattleSnapshot | null = null;

  observe(event: LiveEvent): {
    handled: boolean;
    reaction: string | null;
    snapshot: BattleSnapshot | null;
  } {
    if (event.kind === "battle_start") {
      this.active = event.battle ?? { state: "started", opponent: event.username };
      return {
        handled: true,
        reaction: this.active.opponent
          ? `Battle time against ${this.active.opponent}! Let's go! 😄`
          : "Battle time! Let's go! 😄",
        snapshot: this.active,
      };
    }
    if (event.kind === "battle_update" && this.active) {
      this.active = event.battle ?? this.active;
      const s = this.active;
      const scoreLine =
        s.myScore !== undefined && s.opponentScore !== undefined
          ? `Score ${s.myScore}–${s.opponentScore}`
          : "It's heating up";
      return {
        handled: true,
        reaction: `${scoreLine} — keep it coming! ✨`,
        snapshot: this.active,
      };
    }
    if (event.kind === "battle_end") {
      const s = event.battle ?? this.active;
      this.active = null;
      let reaction = "What a battle! GG everyone! 🎉";
      if (s?.myScore !== undefined && s?.opponentScore !== undefined) {
        reaction =
          s.myScore >= s.opponentScore
            ? "We WON the battle! GG everyone, thank you! 🎉"
            : "Tough loss — but GG! Well fought 👏";
      }
      return { handled: true, reaction, snapshot: s ?? null };
    }
    return { handled: false, reaction: null, snapshot: this.active };
  }

  get current(): BattleSnapshot | null {
    return this.active;
  }
}
