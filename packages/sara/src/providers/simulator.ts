/**
 * Sara AI — LIVE simulator.
 *
 * Generates realistic synthetic traffic (comments incl. Roman Urdu/Urdu/
 * Hindi, follows, gifts, joins/leaves, battle start/update/end) so the whole
 * pipeline runs with zero TikTok access. Everything it produces is labeled
 * simulator — it never masquerades as a real platform connection.
 */
import type { LiveEvent, LiveEventSource, SourceStatus } from "../types.js";

export interface SimulatorOptions {
  /** Events per minute (comments + ambient events). */
  eventsPerMinute?: number;
  /** Deterministic script mode (tests) vs random mode (dashboard). */
  scripted?: boolean;
}

interface ScriptEntry {
  username: string;
  userId: string;
  kind:
    | "comment"
    | "follow"
    | "gift"
    | "join"
    | "leave"
    | "like"
    | "battle_start"
    | "battle_update"
    | "battle_end"
    | "share";
  text?: string;
  giftName?: string;
}

/** A believable mixed audience — the requested multilingual mix. */
const AUDIENCE: Array<{ username: string; userId: string }> = [
  { username: "Ali", userId: "sim-ali" },
  { username: "fatima_k", userId: "sim-fatima" },
  { username: "Rahul_98", userId: "sim-rahul" },
  { username: "ayesha.noor", userId: "sim-ayesha" },
  { username: "techguy_umar", userId: "sim-umar" },
  { username: "PriyaSharma", userId: "sim-priya" },
  { username: "bhai_jaan_77", userId: "sim-bhai" },
];

const COMMENT_SCRIPT: string[] = [
  "Sara how are you?",
  "Sara kaisi ho?",
  "kia haal hai sara",
  "salaam sara",
  "hello Sara!",
  "tum kahan se ho",
  "mera naam Ali hai",
  "aj kya kar rahi ho",
  "Sara you are the best",
  "hahaha good one",
  "aaj ka mood kaisa hai?",
  "Priya this stream is so chill",
  "Sara mera naam Ahmed hai",
  "kya tum robot ho",
  "namaste Sara ji",
  "thank you sara ❤️",
  "shukriya sara, dil se",
  "hahaha",
  "lol 😄",
  "who made you sara?",
];

const GIFTS = ["Rose", "TikTok", "Heart Me", "Perfume", "Doughnut", "Hand Waves"];

export class SimulatorSource implements LiveEventSource {
  readonly name = "simulator";
  readonly platform = "simulator";
  readonly connected = true;
  private handler: ((e: LiveEvent) => void) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private scriptIndex = 0;
  private lastEventAt: string | null = null;
  private readonly options: SimulatorOptions;

  constructor(options: SimulatorOptions = {}) {
    this.options = options;
  }

  async start(): Promise<void> {
    if (this.timer) return;
    const perMinute = this.options.eventsPerMinute ?? 8;
    const intervalMs = Math.max(1500, Math.floor(60_000 / perMinute));
    this.timer = setInterval(() => {
      const evt = this.generateNext();
      this.lastEventAt = evt.at;
      this.handler?.(evt);
    }, intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  onEvent(handler: (event: LiveEvent) => void): void {
    this.handler = handler;
  }

  status(): SourceStatus {
    return {
      connected: true,
      detail: "LIVE SIMULATOR — synthetic audience for development/testing. Not a real platform.",
      mode: "simulator",
      lastEventAt: this.lastEventAt,
      reconnects: 0,
    };
  }

  /** One synthetic event, advancing through a deterministic script first. */
  generateNext(now = new Date()): LiveEvent {
    const mk = (kind: LiveEvent["kind"], extra: Partial<LiveEvent> = {}): LiveEvent => ({
      id: `sim_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
      kind,
      platform: "simulator",
      at: now.toISOString(),
      ...extra,
    });

    if (this.options.scripted) {
      const i = this.scriptIndex++;
      if (i < COMMENT_SCRIPT.length) {
        const who = AUDIENCE[i % AUDIENCE.length]!;
        return mk("comment", {
          username: who.username,
          userId: who.userId,
          text: COMMENT_SCRIPT[i],
        });
      }
      const extras: ScriptEntry[] = [
        { username: "Ali", userId: "sim-ali", kind: "follow" },
        { username: "fatima_k", userId: "sim-fatima", kind: "gift", giftName: "Rose" },
        {
          username: "Rahul_98",
          userId: "sim-rahul",
          kind: "comment",
          text: "Sara aaj kaun sa drama dekh rahi ho?",
        },
        { username: "ayesha.noor", userId: "sim-ayesha", kind: "share" },
        { username: "techguy_umar", userId: "sim-umar", kind: "battle_start" },
        { username: "techguy_umar", userId: "sim-umar", kind: "battle_update" },
        { username: "techguy_umar", userId: "sim-umar", kind: "battle_end" },
      ];
      const e = extras[(i - COMMENT_SCRIPT.length) % extras.length]!;
      return mk(e.kind, {
        username: e.username,
        userId: e.userId,
        text: e.text,
        giftName: e.giftName,
      });
    }

    // Random mode.
    const roll = Math.random();
    const who = AUDIENCE[Math.floor(Math.random() * AUDIENCE.length)]!;
    if (roll < 0.68) {
      const text = COMMENT_SCRIPT[Math.floor(Math.random() * COMMENT_SCRIPT.length)]!;
      return mk("comment", { username: who.username, userId: who.userId, text });
    }
    if (roll < 0.78) return mk("follow", { username: who.username, userId: who.userId });
    if (roll < 0.86) {
      return mk("gift", {
        username: who.username,
        userId: who.userId,
        giftName: GIFTS[Math.floor(Math.random() * GIFTS.length)],
        giftCount: 1 + Math.floor(Math.random() * 3),
      });
    }
    if (roll < 0.9) return mk("join", { username: who.username, userId: who.userId });
    if (roll < 0.94) return mk("like", { username: who.username, userId: who.userId });
    if (roll < 0.97)
      return mk("battle_start", {
        username: who.username,
        userId: who.userId,
        battle: { state: "started", opponent: "RivalHost_99" },
      });
    return mk("battle_update", {
      username: who.username,
      userId: who.userId,
      battle: {
        state: "update",
        opponent: "RivalHost_99",
        myScore: Math.floor(Math.random() * 500),
        opponentScore: Math.floor(Math.random() * 500),
      },
    });
  }

  /** Manually inject a comment typed in the dashboard simulator box. */
  injectComment(
    username: string,
    text: string,
    userId = `sim-${username.toLowerCase().replace(/\W+/g, "-")}`,
  ): LiveEvent {
    const evt: LiveEvent = {
      id: `sim_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
      kind: "comment",
      platform: "simulator",
      username,
      userId,
      text,
      at: new Date().toISOString(),
    };
    this.lastEventAt = evt.at;
    this.handler?.(evt);
    return evt;
  }
}
