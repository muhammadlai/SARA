/**
 * Sara AI — LiveDirector.
 *
 * Owns the LIVE session state machine and wires everything together:
 * event sources (TikTok official / simulator) → moderation → comment queue →
 * brain → responses + feed. Handles pause / human takeover / mute /
 * emergency stop / source failure recovery. Persists sessions, events and
 * messages through the shared SQLite database.
 */
import { createLogger } from "@sara/logger";
import type { SqliteDatabase } from "@sara/db";
import { detectLanguage } from "./languages.js";
import { EmotionEngine } from "./emotion.js";
import { BattleManager } from "./providers/tiktok.js";
import { CommentQueue } from "./comments.js";
import type { SaraEmotion, SaraLanguage } from "./types.js";
import type {
  AvatarProvider,
  FeedItem,
  LiveEvent,
  LiveEventSource,
  LiveMetrics,
  LiveSessionState,
  LiveStatus,
  MemoryStore,
  ModerationEngine,
  SaraBrain,
  SaraControlSettings,
  SaraPersonalityConfig,
  ViewerRecord,
} from "./index.js";

const log = createLogger({ name: "sara-live" });

export interface LiveDirectorDeps {
  db: SqliteDatabase;
  brain: SaraBrain;
  avatar: AvatarProvider;
  personality: SaraPersonalityConfig;
  memory: MemoryStore;
  moderation: ModerationEngine;
  sources: LiveEventSource[];
  settings: SaraControlSettings;
  aiDisclosure: string;
}

function now(): string {
  return new Date().toISOString();
}

function rid(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export class LiveDirector {
  state: LiveSessionState = "idle";
  private sessionId: string | null = null;
  private startedAt: string | null = null;
  private readonly queue = new CommentQueue();
  private readonly emotion = new EmotionEngine();
  private readonly battle = new BattleManager();
  private readonly feed: FeedItem[] = [];
  private readonly recentConversation: Array<{ role: "viewer" | "sara"; text: string }> = [];
  private processing = false;
  private drainTimer: NodeJS.Timeout | null = null;
  private lastLatencies: number[] = [];
  private counters: LiveMetrics = {
    uptimeSeconds: 0,
    comments: 0,
    responses: 0,
    rejectedComments: 0,
    events: 0,
    errors: 0,
    reconnects: 0,
    avgResponseLatencyMs: 0,
    tokensUsed: null,
  };
  private settings: SaraControlSettings;

  constructor(private readonly deps: LiveDirectorDeps) {
    this.settings = { ...deps.settings };
    this.queue.configureLimits({
      maxPerMinute: this.settings.responsesPerMinute,
      perViewerCooldownSeconds: this.settings.perViewerCooldownSeconds,
      duplicateWindowSeconds: this.settings.duplicateWindowSeconds,
      minPriority: this.settings.minPriority,
    });
    // Wire source handlers exactly once, at construction, so both real-time
    // events and simulator injections flow through the same single path.
    for (const source of deps.sources) {
      source.onEvent((evt) => this.handleEvent(evt));
    }
  }

  // ── Session control ────────────────────────────────────────────────────────
  async start(): Promise<LiveStatus> {
    if (this.state === "live" || this.state === "starting") return this.status();
    this.state = "starting";
    this.sessionId = rid("sess");
    this.startedAt = now();
    this.db
      .prepare(
        "INSERT INTO sara_live_sessions (id, platform, state, created_at, config_json) VALUES (?, ?, 'starting', ?, ?)",
      )
      .run(
        this.sessionId,
        this.primaryPlatform(),
        now(),
        JSON.stringify({ simulatorOnly: this.isSimulated() }),
      );
    this.pushFeed({
      kind: "status",
      text: this.isSimulated()
        ? "Sara session started (SIMULATOR mode — not connected to TikTok)"
        : "Sara session starting…",
    });

    for (const source of this.deps.sources) {
      try {
        await source.start();
      } catch (err) {
        this.counters.errors += 1;
        log.warn({ source: source.name, err: String(err).slice(0, 140) }, "source failed to start");
      }
    }
    this.state = "live";
    this.db
      .prepare("UPDATE sara_live_sessions SET state = 'live', started_at = ? WHERE id = ?")
      .run(now(), this.sessionId);
    this.startDrainLoop();
    this.pushFeed({ kind: "system", text: "Sara is LIVE ✨ Say hi in the simulator!" });
    return this.status();
  }

  async stop(): Promise<LiveStatus> {
    for (const source of this.deps.sources) await source.stop().catch(() => undefined);
    if (this.drainTimer) clearInterval(this.drainTimer);
    this.drainTimer = null;
    this.queue.clear();
    if (this.sessionId) {
      this.db
        .prepare("UPDATE sara_live_sessions SET state = 'stopped', stopped_at = ? WHERE id = ?")
        .run(now(), this.sessionId);
    }
    this.state = "stopped";
    this.pushFeed({ kind: "status", text: "Sara stopped. Session archived." });
    return this.status();
  }

  pause(): LiveStatus {
    if (this.state === "live") {
      this.state = "paused";
      this.pushFeed({ kind: "status", text: "Sara paused — she'll hold this thought." });
    }
    return this.status();
  }

  resume(): LiveStatus {
    if (this.state === "paused" || this.state === "takeover") {
      this.state = "live";
      this.pushFeed({ kind: "status", text: "Sara resumed — back to the show!" });
    }
    return this.status();
  }

  /** Human takeover: Sara goes quiet, operator sends messages themselves. */
  takeover(): LiveStatus {
    this.state = "takeover";
    const dropped = this.queue.clear();
    this.pushFeed({
      kind: "status",
      text: `Human takeover — Sara muted herself (${dropped} queued comment${dropped === 1 ? "" : "s"} dropped).`,
    });
    return this.status();
  }

  mute(): LiveStatus {
    if (this.state === "live") {
      this.state = "muted";
      this.pushFeed({ kind: "status", text: "Sara muted (she still reads chat, says nothing)." });
    }
    return this.status();
  }

  unmute(): LiveStatus {
    if (this.state === "muted") {
      this.state = "live";
      this.pushFeed({ kind: "status", text: "Sara unmuted." });
    }
    return this.status();
  }

  /** EMERGENCY STOP: immediate halt of all automated output, queue wiped. */
  async emergencyStop(): Promise<LiveStatus> {
    const dropped = this.queue.clear();
    this.state = "stopped";
    for (const source of this.deps.sources) await source.stop().catch(() => undefined);
    if (this.drainTimer) clearInterval(this.drainTimer);
    this.drainTimer = null;
    if (this.sessionId) {
      this.db
        .prepare(
          "UPDATE sara_live_sessions SET state = 'stopped', stopped_at = ?, error_count = error_count + 1 WHERE id = ?",
        )
        .run(now(), this.sessionId);
    }
    this.pushFeed({
      kind: "moderation",
      text: `🛑 EMERGENCY STOP — automated output halted instantly (${dropped} queued items wiped).`,
    });
    log.warn("emergency stop engaged");
    return this.status();
  }

  /** Operator manual message (used during takeover). */
  operatorMessage(text: string): FeedItem {
    return this.pushFeed({ kind: "operator", text });
  }

  // ── Event intake ───────────────────────────────────────────────────────────
  handleEvent(event: LiveEvent): void {
    this.counters.events += 1;
    const viewer = this.trackViewer(event);
    this.persistEvent(event, viewer);

    const emo = this.emotion.observeEvent(event);

    if (event.kind === "comment") {
      this.counters.comments += 1;
      const verdict = this.deps.moderation.check({
        text: event.text ?? "",
        username: event.username ?? "viewer",
      });
      this.persistModeration(event, verdict);
      if (viewer && event.text) {
        this.deps.memory.remember({
          viewerId: viewer.id,
          kind: "interaction",
          content: event.text.slice(0, 200),
          salience: 0.35,
          ttlSeconds: 6 * 3600,
        });
      }

      if (verdict.action === "reject" || verdict.action === "escalate") {
        this.counters.rejectedComments += 1;
        this.pushFeed({
          kind: "moderation",
          text: `blocked ${verdict.action} comment from ${event.username ?? "viewer"} [${verdict.categories.join(", ") || "policy"}]`,
          username: event.username,
          meta: { categories: verdict.categories, score: verdict.score },
        });
        return;
      }
      if (verdict.action === "flag") {
        this.pushFeed({
          kind: "moderation",
          text: `flagged comment from ${event.username ?? "viewer"} (${verdict.categories.join(", ")})`,
          username: event.username,
        });
      }

      const decision = this.queue.admit(event, verdict);
      if (decision.admitted && decision.priority) {
        this.queue.enqueue(event, decision.priority, decision.reason);
        this.pushFeed({
          kind: "viewer",
          text: event.text ?? "",
          username: event.username,
          meta: { queued: true, priority: decision.priority, reason: decision.reason },
        });
      } else {
        // Drops are visible in the feed (UI grays them) for transparency.
        this.pushFeed({
          kind: "viewer",
          text: event.text ?? "",
          username: event.username,
          meta: { queued: false, reason: decision.reason },
        });
      }
      return;
    }

    // Non-comment events.
    if (event.kind === "join") {
      this.pushFeed({
        kind: "event",
        text: `${event.username ?? "someone"} joined`,
        username: event.username,
      });
      if (!this.settings.autoGreetJoins) return;
    }
    if (event.kind === "follow" && !this.settings.welcomeFollows) return;
    if (event.kind === "gift" && !this.settings.thankGifts) return;

    if (["battle_start", "battle_update", "battle_end"].includes(event.kind)) {
      const res = this.battle.observe(event);
      if (res.reaction)
        this.pushFeed({ kind: "event", text: res.reaction, meta: { battle: res.snapshot } });
    }

    void this.respondNow(event, viewer, emo.emotion);
  }

  private trackViewer(event: LiveEvent): ViewerRecord | null {
    if (!event.username) return null;
    return this.deps.memory.upsertViewer({
      platform: event.platform,
      platformUserId: event.userId ?? event.username.toLowerCase(),
      displayName: event.username,
      language: event.text ? detectLanguage(event.text).language : undefined,
    });
  }

  private async respondNow(
    event: LiveEvent,
    viewer: ViewerRecord | null,
    emotion: SaraEmotion,
  ): Promise<void> {
    if (this.state !== "live") return;
    await this.runOne(event, viewer, emotion);
  }

  // ── Queue drain ────────────────────────────────────────────────────────────
  private startDrainLoop(): void {
    if (this.drainTimer) return;
    this.drainTimer = setInterval(() => {
      void this.drain();
    }, 700);
  }

  private async drain(): Promise<void> {
    if (this.processing || this.state !== "live") return;
    const next = this.queue.next();
    if (!next) return;
    this.processing = true;
    try {
      await this.runOne(next.event, this.viewerFor(next.event), this.emotion.emotion);
    } finally {
      this.processing = false;
    }
  }

  private async runOne(
    event: LiveEvent,
    viewer: ViewerRecord | null,
    emotion: SaraEmotion,
  ): Promise<void> {
    if (this.state !== "live") return;
    try {
      const response = await this.deps.brain.respond({
        event,
        viewer,
        recentConversation: this.recentConversation.slice(-6),
        emotion,
      });
      if (!response) return; // moderation rejected inside the brain

      this.recentConversation.push(
        { role: "viewer", text: event.text ?? `[${event.kind}]` },
        { role: "sara", text: response.reply.text },
      );
      if (this.recentConversation.length > 40)
        this.recentConversation.splice(0, this.recentConversation.length - 40);

      this.counters.responses += 1;
      this.lastLatencies.push(response.latencyMs);
      if (this.lastLatencies.length > 50) this.lastLatencies.shift();
      this.counters.avgResponseLatencyMs = Math.round(
        this.lastLatencies.reduce((a, b) => a + b, 0) / this.lastLatencies.length,
      );

      this.persistMessage(event, response);

      const audioFile = response.speech.path ? response.speech.path.split("/").pop()! : undefined;
      this.pushFeed({
        kind: "sara",
        text: response.reply.text,
        username: this.deps.personality.name,
        emotion: response.emotion,
        audioUrl: audioFile ? `/api/v1/sara/audio/${encodeURIComponent(audioFile)}` : undefined,
        avatar: response.avatar,
        meta: {
          provider: response.reply.provider,
          fallback: response.reply.fallbackUsed,
          tts: response.speech.provider,
          degraded: response.speech.degraded,
          language: response.language,
          latencyMs: response.latencyMs,
          replyTo: event.kind === "comment" ? (event.username ?? undefined) : undefined,
          replyText: event.kind === "comment" ? (event.text ?? undefined) : undefined,
          eventKind: event.kind,
          giftName: event.giftName,
        },
      });

      if (this.settings.memoryEnabled && viewer && event.text) {
        this.deps.memory.remember({
          viewerId: viewer.id,
          kind: "context",
          content: `Sara responded to "${event.text.slice(0, 80)}"`,
          salience: 0.25,
          ttlSeconds: 3600,
        });
      }
    } catch (err) {
      this.counters.errors += 1;
      log.error({ err: String(err).slice(0, 160) }, "response cycle failed");
      this.pushFeed({ kind: "error", text: `response error: ${String(err).slice(0, 120)}` });
    }
  }

  private viewerFor(event: LiveEvent): ViewerRecord | null {
    if (!event.username) return null;
    return this.deps.memory.findViewer(
      event.platform,
      event.userId ?? event.username.toLowerCase(),
    );
  }

  // ── Simulator chat (dashboard box → same pipeline as real events) ─────────
  simulatorComment(
    username: string,
    text: string,
  ): { event: LiveEvent; accepted: boolean; reason: string } {
    const source = this.deps.sources.find((s) => s.name === "simulator");
    if (!source)
      return {
        event: this.syntheticEvent(username, text),
        accepted: false,
        reason: "simulator-not-enabled",
      };
    // injectComment triggers the constructor-wired handler → handleEvent exactly once.
    const evt = (
      source as unknown as { injectComment(u: string, t: string): LiveEvent }
    ).injectComment(username, text);
    return { event: evt, accepted: true, reason: "ok" };
  }

  private syntheticEvent(username: string, text: string): LiveEvent {
    return {
      id: rid("sim"),
      kind: "comment",
      platform: "simulator",
      username,
      userId: username.toLowerCase(),
      text,
      at: now(),
    };
  }

  // ── Status / feed ──────────────────────────────────────────────────────────
  status(): LiveStatus {
    return {
      state: this.state,
      platform: this.primaryPlatform(),
      session: this.sessionId ? { id: this.sessionId, startedAt: this.startedAt } : null,
      sources: this.deps.sources.map((s) => s.status()),
      brain: { provider: this.deps.brain.llmName, fallback: this.deps.brain.llmFallback },
      tts: { provider: this.deps.brain.ttsName, degraded: this.deps.brain.ttsDegraded },
      avatar: { provider: this.deps.avatar.name, capabilities: this.deps.avatar.capabilities() },
      queue: { depth: this.queue.depth, responsesPerMinute: this.queue.responsesPerMinute() },
      metrics: {
        ...this.counters,
        uptimeSeconds: this.startedAt
          ? Math.round((Date.now() - Date.parse(this.startedAt)) / 1000)
          : 0,
      },
      aiDisclosure: this.settings.aiDisclosure,
    };
  }

  feedSince(afterId: string | null, limit = 80): FeedItem[] {
    if (!afterId) return this.feed.slice(-limit);
    const idx = this.feed.findIndex((f) => f.id === afterId);
    if (idx === -1) return this.feed.slice(-limit);
    return this.feed.slice(idx + 1, idx + 1 + limit);
  }

  queueSnapshot() {
    return this.queue.snapshot();
  }

  configureSettings(patch: Partial<SaraControlSettings>): SaraControlSettings {
    this.settings = { ...this.settings, ...patch };
    this.queue.configureLimits({
      maxPerMinute: this.settings.responsesPerMinute,
      perViewerCooldownSeconds: this.settings.perViewerCooldownSeconds,
      duplicateWindowSeconds: this.settings.duplicateWindowSeconds,
      minPriority: this.settings.minPriority,
    });
    this.persistSettings();
    return this.settings;
  }

  settingsValue(): SaraControlSettings {
    return { ...this.settings };
  }

  emotionNow(): { emotion: string; intensity: number } {
    return { emotion: this.emotion.emotion, intensity: this.emotion.currentIntensity };
  }

  battleNow() {
    return this.battle.current;
  }

  // ── Persistence ────────────────────────────────────────────────────────────
  private get db(): SqliteDatabase {
    return this.deps.db;
  }

  private primaryPlatform(): string {
    return this.deps.sources.some((s) => s.status().mode === "official") ? "tiktok" : "simulator";
  }

  private isSimulated(): boolean {
    return !this.deps.sources.some((s) => s.status().mode === "official" && s.status().connected);
  }

  private pushFeed(item: Omit<FeedItem, "id" | "at">): FeedItem {
    const full: FeedItem = { id: rid("feed"), at: now(), ...item };
    this.feed.push(full);
    if (this.feed.length > 500) this.feed.splice(0, this.feed.length - 500);
    return full;
  }

  private persistEvent(event: LiveEvent, viewer: ViewerRecord | null): void {
    this.db
      .prepare(
        "INSERT INTO sara_events (id, session_id, kind, platform, username, viewer_id, payload_json, priority, moderation_action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 5, 'allow', ?)",
      )
      .run(
        event.id,
        this.sessionId,
        event.kind,
        event.platform,
        event.username ?? null,
        viewer?.id ?? null,
        JSON.stringify({
          text: event.text,
          gift: event.giftName,
          count: event.giftCount,
          battle: event.battle,
        }),
        event.at,
      );
  }

  private persistModeration(
    event: LiveEvent,
    verdict: { action: string; categories: string[]; score: number; matchedRules: string[] },
  ): void {
    for (const category of verdict.categories.length > 0 ? verdict.categories : ["none"]) {
      this.db
        .prepare(
          "INSERT INTO sara_moderation (id, event_id, category, action, matched_rules_json, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          rid("mod"),
          event.id,
          category,
          verdict.action,
          JSON.stringify(verdict.matchedRules),
          verdict.score,
          now(),
        );
    }
  }

  private persistMessage(
    event: LiveEvent,
    response: {
      reply: { text: string; provider: string };
      speech: { provider: string };
      emotion: SaraEmotion;
      language: SaraLanguage;
    },
  ): void {
    this.db
      .prepare(
        "INSERT INTO sara_messages (id, session_id, role, viewer_id, username, text, language, emotion, engine_json, created_at) VALUES (?, ?, 'sara', ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        rid("msg"),
        this.sessionId,
        this.viewerFor(event)?.id ?? null,
        event.username ?? null,
        response.reply.text,
        response.language,
        response.emotion,
        JSON.stringify({ provider: response.reply.provider, tts: response.speech.provider }),
        now(),
      );
  }

  private persistSettings(): void {
    this.db
      .prepare(
        "INSERT INTO sara_settings (key, value_json, updated_at) VALUES ('control', ?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
      )
      .run(JSON.stringify(this.settings), now());
  }
}
