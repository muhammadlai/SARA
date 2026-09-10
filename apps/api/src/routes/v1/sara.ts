/**
 * Sara AI — LIVE host API.
 *
 * Dashboard endpoints: status, feed, simulator, control, settings, memory,
 * moderation, personality, audit, analytics, audio, avatar, and the official
 * TikTok webhook relay. All responses use the standard envelope. Mutations
 * require a session when operator auth is configured.
 */
import type { FastifyInstance } from "fastify";
import fs from "node:fs";
import path from "node:path";
import { requireSessionIfConfigured } from "../../lib/auth-guard.js";
import type { SaraContext } from "../../services/sara-live.js";

interface SaraApiOptions {
  sara: SaraContext;
}

const AUDIO_EXT: Record<string, string> = {
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

export function saraRoutes(app: FastifyInstance, opts: SaraApiOptions): void {
  const { system } = opts.sara;
  const { director, memory, moderation, watchdog, audit, usage, avatar, personality, brain } =
    system;

  const mutate = requireSessionIfConfigured().preHandler;

  // ── Status & feed ───────────────────────────────────────────────────────────
  app.get("/status", async () => {
    return {
      ok: true,
      data: {
        live: director.status(),
        emotion: director.emotionNow(),
        battle: director.battleNow(),
        system: watchdog.snapshot(),
        providers: usage.summary(),
        personality,
        avatar: {
          provider: avatar.name,
          capabilities: avatar.capabilities(),
          portraitUrl: "/sara/sara-portrait.png",
        },
        aiDisclosure: director.settingsValue().aiDisclosure,
        platformNotice:
          "Sara connects to TikTok only through officially authorized APIs/endpoints. Simulator mode is used for development and testing.",
      },
    };
  });

  app.get<{ Querystring: { after?: string; limit?: string } }>("/feed", async (req) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 80)));
    return { ok: true, data: { items: director.feedSince(req.query.after ?? null, limit) } };
  });

  app.get<{ Querystring: { limit?: string } }>("/queue", async (req) => {
    void req;
    return {
      ok: true,
      data: { queue: director.queueSnapshot(), settings: director.settingsValue() },
    };
  });

  // ── Simulator ───────────────────────────────────────────────────────────────
  app.post<{ Body: { username?: string; text?: string } }>(
    "/simulate",
    { preHandler: mutate },
    async (req, reply) => {
      const username = (req.body.username ?? "").trim() || "Guest";
      const text = (req.body.text ?? "").trim();
      if (!text) {
        return reply
          .status(400)
          .send({ ok: false, error: { code: "INVALID_INPUT", message: "text is required" } });
      }
      if (text.length > 300) {
        return reply.status(400).send({
          ok: false,
          error: { code: "INVALID_INPUT", message: "text too long (max 300)" },
        });
      }
      const result = director.simulatorComment(username.slice(0, 32), text);
      return {
        ok: true,
        data: { eventId: result.event.id, accepted: result.accepted, reason: result.reason },
      };
    },
  );

  // ── Control ─────────────────────────────────────────────────────────────────
  app.post<{ Body: { action?: string } }>(
    "/control",
    { preHandler: mutate },
    async (req, reply) => {
      const action = (req.body.action ?? "").trim();
      let detail = "";
      switch (action) {
        case "start":
          await director.start();
          detail = "session started";
          break;
        case "stop":
          await director.stop();
          detail = "session stopped";
          break;
        case "pause":
          director.pause();
          detail = "paused";
          break;
        case "resume":
          director.resume();
          detail = "resumed";
          break;
        case "takeover":
          director.takeover();
          detail = "human takeover";
          break;
        case "mute":
          director.mute();
          detail = "muted";
          break;
        case "unmute":
          director.unmute();
          detail = "unmuted";
          break;
        case "emergency-stop":
          await director.emergencyStop();
          detail = "EMERGENCY STOP executed";
          break;
        default:
          return reply.status(400).send({
            ok: false,
            error: {
              code: "INVALID_INPUT",
              message: "action must be start|stop|pause|resume|takeover|mute|unmute|emergency-stop",
            },
          });
      }
      audit.append({
        actor: "operator",
        action: `control.${action}`,
        target: director.status().session?.id ?? null,
      });
      return { ok: true, data: { detail, live: director.status() } };
    },
  );

  app.post<{ Body: { text?: string } }>("/operator", { preHandler: mutate }, async (req, reply) => {
    const text = (req.body.text ?? "").trim();
    if (!text)
      return reply
        .status(400)
        .send({ ok: false, error: { code: "INVALID_INPUT", message: "text is required" } });
    const item = director.operatorMessage(text.slice(0, 300));
    audit.append({
      actor: "operator",
      action: "operator.message",
      details: { length: text.length },
    });
    return { ok: true, data: { item } };
  });

  // ── Settings / personality / moderation ─────────────────────────────────────
  app.get("/settings", async () => ({ ok: true, data: director.settingsValue() }));

  app.post<{ Body: Record<string, unknown> }>("/settings", { preHandler: mutate }, async (req) => {
    const allowed = [
      "responsesPerMinute",
      "perViewerCooldownSeconds",
      "duplicateWindowSeconds",
      "minPriority",
      "moderationStrictness",
      "autoGreetJoins",
      "thankGifts",
      "welcomeFollows",
      "memoryEnabled",
      "aiDisclosure",
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in req.body) patch[key] = req.body[key];
    }
    const settings = director.configureSettings(patch);
    if (typeof patch.moderationStrictness === "string") {
      moderation.configure({ strictness: settings.moderationStrictness });
    }
    audit.append({ actor: "operator", action: "settings.update", details: patch });
    return { ok: true, data: settings };
  });

  app.get("/personality", async () => ({ ok: true, data: personality }));

  app.post<{ Body: Record<string, unknown> }>(
    "/personality",
    { preHandler: mutate },
    async (req) => {
      const allowed = [
        "name",
        "tagline",
        "warmth",
        "humor",
        "energy",
        "formality",
        "responseLength",
        "emojiRate",
        "greetingStyle",
        "defaultLanguage",
      ] as const;
      const patch: Record<string, unknown> = {};
      for (const key of allowed) {
        if (key in req.body) patch[key] = req.body[key];
      }
      Object.assign(personality, patch);
      audit.append({ actor: "operator", action: "personality.update", details: patch });
      return { ok: true, data: personality };
    },
  );

  app.get("/moderation", async () => {
    const recent = system.db
      .prepare(
        "SELECT category, action, COUNT(*) AS n FROM sara_moderation GROUP BY category, action ORDER BY n DESC LIMIT 20",
      )
      .all();
    return {
      ok: true,
      data: {
        settings: moderation.settingsValue(),
        blockedWords: moderation.settingsValue().extraBlockedWords,
        summary: recent,
      },
    };
  });

  app.post<{ Body: { strictness?: string; extraBlockedWords?: string[]; allowLinks?: boolean } }>(
    "/moderation",
    { preHandler: mutate },
    async (req) => {
      const patch: {
        strictness?: "relaxed" | "standard" | "strict";
        extraBlockedWords?: string[];
        allowLinks?: boolean;
      } = {};
      if (req.body.strictness && ["relaxed", "standard", "strict"].includes(req.body.strictness)) {
        patch.strictness = req.body.strictness as "relaxed" | "standard" | "strict";
      }
      if (Array.isArray(req.body.extraBlockedWords))
        patch.extraBlockedWords = req.body.extraBlockedWords
          .map((w) => String(w).trim().toLowerCase())
          .filter(Boolean)
          .slice(0, 200);
      if (typeof req.body.allowLinks === "boolean") patch.allowLinks = req.body.allowLinks;
      moderation.configure(patch);
      audit.append({
        actor: "operator",
        action: "moderation.configure",
        details: { strictness: patch.strictness, blockedCount: patch.extraBlockedWords?.length },
      });
      return { ok: true, data: moderation.settingsValue() };
    },
  );

  // ── Memory (privacy controls included) ──────────────────────────────────────
  app.get("/memory", async () => {
    const viewers = memory.recentViewers(20);
    const globalMemories = memory.retrieve({ limit: 20 });
    return {
      ok: true,
      data: { viewers, memories: globalMemories, enabled: director.settingsValue().memoryEnabled },
    };
  });

  app.delete<{ Params: { id: string } }>("/memory/:id", { preHandler: mutate }, async (req) => {
    const ok = memory.forget(req.params.id);
    audit.append({ actor: "operator", action: "memory.delete", target: req.params.id });
    return { ok: true, data: { deleted: ok } };
  });

  app.delete<{ Params: { id: string } }>(
    "/memory/viewer/:id",
    { preHandler: mutate },
    async (req) => {
      const n = memory.forgetViewer(req.params.id);
      audit.append({
        actor: "operator",
        action: "memory.forget-viewer",
        target: req.params.id,
        details: { deleted: n },
      });
      return { ok: true, data: { deleted: n } };
    },
  );

  // ── TikTok official webhook relay ───────────────────────────────────────────
  app.post("/tiktok/webhook", async (req, reply) => {
    const token = opts.sara.config.tiktokToken;
    if (token) {
      const auth = req.headers.authorization ?? "";
      if (auth !== `Bearer ${token}`) {
        return reply
          .status(401)
          .send({ ok: false, error: { code: "UNAUTHORIZED", message: "invalid webhook secret" } });
      }
    }
    const official = system.sources.find((s) => s.name === "tiktok-official") as
      { acceptWebhook(raw: unknown): unknown } | undefined;
    if (!official) {
      return reply.status(503).send({
        ok: false,
        error: {
          code: "NOT_CONFIGURED",
          message:
            "TikTok official events relay is not configured. Set SARA_TIKTOK_EVENTS_URL to an officially authorized endpoint. Unofficial scraping/cookie access is not supported.",
        },
      });
    }
    const evt = official.acceptWebhook(req.body) as { id?: string } | null;
    if (!evt) {
      return reply.status(422).send({
        ok: false,
        error: { code: "UNSUPPORTED_EVENT", message: "event type not recognized" },
      });
    }
    return { ok: true, data: { accepted: true, eventId: evt.id ?? null } };
  });

  // ── Audio (TTS output) ──────────────────────────────────────────────────────
  app.get<{ Params: { file: string } }>("/audio/:file", async (req, reply) => {
    const file = path.basename(req.params.file); // no traversal
    const full = path.join(system.audioDir, file);
    if (!fs.existsSync(full)) {
      return reply
        .status(404)
        .send({ ok: false, error: { code: "NOT_FOUND", message: "audio not found" } });
    }
    const ext = path.extname(full).toLowerCase();
    const stream = fs.createReadStream(full);
    return reply.type(AUDIO_EXT[ext] ?? "application/octet-stream").send(stream);
  });

  // ── Audit & analytics & health ──────────────────────────────────────────────
  app.get("/audit", async () => ({ ok: true, data: { entries: audit.recent(50) } }));

  app.get("/analytics", async () => {
    const sessions = system.db
      .prepare(
        "SELECT id, platform, state, started_at, stopped_at, comment_count, response_count, event_count, error_count FROM sara_live_sessions ORDER BY created_at DESC LIMIT 20",
      )
      .all();
    const live = director.status();
    return {
      ok: true,
      data: {
        current: live.metrics,
        sessions,
        providers: usage.summary(),
        responsesPerMinute: live.queue.responsesPerMinute,
      },
    };
  });

  app.get("/health", async () => ({ ok: true, data: watchdog.snapshot() }));

  // Self-check used by the dashboard (and the demo) — exercises the brain
  // without touching the LIVE queue.
  app.post<{ Body: { text?: string; username?: string } }>(
    "/converse",
    { preHandler: mutate },
    async (req, reply) => {
      const text = (req.body.text ?? "").trim();
      if (!text)
        return reply
          .status(400)
          .send({ ok: false, error: { code: "INVALID_INPUT", message: "text is required" } });
      const emotion = director.emotionNow();
      const response = await brain.respond({
        event: {
          id: `ui_${Date.now()}`,
          kind: "comment",
          platform: "simulator",
          username: (req.body.username ?? "Operator").slice(0, 32),
          userId: "operator-console",
          text,
          at: new Date().toISOString(),
        },
        viewer: memory.findViewer("simulator", "operator-console"),
        recentConversation: [],
        emotion: emotion.emotion as ReturnType<typeof director.emotionNow>["emotion"] as never,
      });
      if (!response)
        return reply
          .status(422)
          .send({ ok: false, error: { code: "REJECTED", message: "blocked by moderation" } });
      return {
        ok: true,
        data: {
          text: response.reply.text,
          provider: response.reply.provider,
          fallback: response.reply.fallbackUsed,
          tts: {
            provider: response.speech.provider,
            degraded: response.speech.degraded,
            url: response.speech.path
              ? `/api/v1/sara/audio/${encodeURIComponent(response.speech.path.split("/").pop()!)}`
              : null,
          },
          emotion: response.emotion,
          language: response.language,
          avatar: response.avatar,
        },
      };
    },
  );

  void brain; // referenced above via closure; keep tree-shaking honest
}
