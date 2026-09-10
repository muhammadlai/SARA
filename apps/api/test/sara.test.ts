/** Sara LIVE API tests: control, simulator flow, takeover/emergency stop, memory, auth. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  AuditLog,
  CommentQueue,
  EmotionEngine,
  LiveDirector,
  MemoryStore,
  ModerationEngine,
  ProviderUsage,
  SaraBrain,
  SimulatorSource,
  UnavailableTikTokSource,
  Watchdog,
  DEFAULT_PERSONALITY,
  type SaraSystem,
} from "@sara/live";
import { loadSaraConfig } from "@sara/config";
import { buildTestApp, TEST_PASSWORD, type TestApp } from "./helpers.js";
import { FakeAvatar, FakeLLM, FakeTTS } from "./sara-fakes.js";
import type { SaraContext } from "../src/services/sara-live.js";

async function buildSaraFixture(): Promise<{
  sara: SaraContext;
  simulator: SimulatorSource;
  cleanup: () => void;
}> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sara-api-test-"));
  const db = new DatabaseSync(path.join(dir, "sara.db"));
  db.exec(
    fs.readFileSync(
      path.resolve(process.cwd(), "packages/db/migrations/0003_sara_live.sql"),
      "utf8",
    ),
  );

  const llm = new FakeLLM("fake", (t: string) => `Reply to: ${t}`);
  const tts = new FakeTTS();
  const avatar = new FakeAvatar();
  const simulator = new SimulatorSource({ eventsPerMinute: 600 });
  const memory = new MemoryStore(db);
  const moderation = new ModerationEngine();
  const personality = DEFAULT_PERSONALITY;
  const brain = new SaraBrain({
    llm,
    tts,
    avatar,
    memory,
    moderation,
    personality,
    aiDisclosure: "🤖 Sara is an AI virtual character.",
    memoryEnabled: true,
  });
  const watchdog = new Watchdog();
  const director = new LiveDirector({
    db,
    brain,
    avatar,
    personality,
    memory,
    moderation,
    sources: [new UnavailableTikTokSource(), simulator],
    settings: {
      responsesPerMinute: 30,
      perViewerCooldownSeconds: 0,
      duplicateWindowSeconds: 0,
      minPriority: 5,
      moderationStrictness: "standard",
      autoGreetJoins: false,
      thankGifts: true,
      welcomeFollows: true,
      memoryEnabled: true,
      aiDisclosure: "🤖 Sara is an AI virtual character.",
    },
    aiDisclosure: "🤖 Sara is an AI virtual character.",
  });
  const system: SaraSystem = {
    db,
    config: loadSaraConfig({}),
    personality,
    memory,
    moderation,
    emotion: new EmotionEngine(),
    queue: new CommentQueue(),
    llm,
    tts,
    avatar,
    brain,
    director,
    sources: [simulator],
    watchdog,
    audit: new AuditLog(db),
    usage: new ProviderUsage(db),
    audioDir: dir,
  };
  return {
    sara: { config: system.config, system },
    simulator,
    cleanup: () => {
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

describe("sara live API (auth not configured)", () => {
  let app: TestApp;
  let fx: Awaited<ReturnType<typeof buildSaraFixture>>;

  beforeAll(async () => {
    fx = await buildSaraFixture();
    app = await buildTestApp({}, undefined, fx.sara);
    await app.ready();
  });

  afterAll(async () => {
    await fx.sara.system.director.stop();
    await app.close();
    fx.cleanup();
  });

  it("status shows simulator source, unavailable tiktok, and AI disclosure", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/sara/status" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.live.state).toBe("idle");
    expect(data.live.sources.some((s: { mode: string }) => s.mode === "simulator")).toBe(true);
    expect(data.live.sources.some((s: { mode: string }) => s.mode === "unavailable")).toBe(true);
    expect(data.aiDisclosure).toContain("AI virtual");
    expect(data.platformNotice).toContain("officially authorized");
  });

  it("start → simulate → Sara responds; feed and metrics update", async () => {
    const start = await app.inject({
      method: "POST",
      url: "/api/v1/sara/control",
      payload: { action: "start" },
    });
    expect(start.statusCode).toBe(200);
    expect(start.json().data.live.state).toBe("live");

    const sim = await app.inject({
      method: "POST",
      url: "/api/v1/sara/simulate",
      payload: { username: "Ali", text: "Sara how are you?" },
    });
    expect(sim.statusCode).toBe(200);

    // Wait for drain loop.
    let feed: Array<{ kind: string; text: string }> = [];
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      feed = app
        .inject({ method: "GET", url: "/api/v1/sara/feed" })
        .then((r) => r.json().data.items) as never;
      const f = await app.inject({ method: "GET", url: "/api/v1/sara/feed" });
      feed = f.json().data.items;
      if (feed.some((x) => x.kind === "sara")) break;
    }
    const saraLine = feed.find((x) => x.kind === "sara");
    expect(saraLine).toBeDefined();
    expect(saraLine!.text).toContain("how are you");

    const status = await app.inject({ method: "GET", url: "/api/v1/sara/status" });
    expect(status.json().data.live.metrics.responses).toBeGreaterThanOrEqual(1);
    expect(status.json().data.live.metrics.comments).toBe(1);
  }, 20_000);

  it("moderation blocks an abusive comment end-to-end", async () => {
    await app.inject({
      method: "POST",
      url: "/api/v1/sara/simulate",
      payload: { username: "Troll", text: "i will kill you" },
    });
    await new Promise((r) => setTimeout(r, 400));
    const status = await app.inject({ method: "GET", url: "/api/v1/sara/status" });
    expect(status.json().data.live.metrics.rejectedComments).toBeGreaterThanOrEqual(1);
    const mod = await app.inject({ method: "GET", url: "/api/v1/sara/moderation" });
    expect(mod.statusCode).toBe(200);
  });

  it("takeover → operator message → resume works over HTTP", async () => {
    const t = await app.inject({
      method: "POST",
      url: "/api/v1/sara/control",
      payload: { action: "takeover" },
    });
    expect(t.json().data.live.state).toBe("takeover");
    const op = await app.inject({
      method: "POST",
      url: "/api/v1/sara/operator",
      payload: { text: "I'm the human host now" },
    });
    expect(op.statusCode).toBe(200);
    const r = await app.inject({
      method: "POST",
      url: "/api/v1/sara/control",
      payload: { action: "resume" },
    });
    expect(r.json().data.live.state).toBe("live");
  });

  it("emergency stop over HTTP halts and wipes the queue", async () => {
    const e = await app.inject({
      method: "POST",
      url: "/api/v1/sara/control",
      payload: { action: "emergency-stop" },
    });
    expect(e.json().data.live.state).toBe("stopped");
    const feed = await app.inject({ method: "GET", url: "/api/v1/sara/feed" });
    expect(
      feed.json().data.items.some((f: { text: string }) => f.text.includes("EMERGENCY STOP")),
    ).toBe(true);
  });

  it("settings and moderation configuration round-trip", async () => {
    const s = await app.inject({
      method: "POST",
      url: "/api/v1/sara/settings",
      payload: { responsesPerMinute: 5, moderationStrictness: "strict" },
    });
    expect(s.json().data.responsesPerMinute).toBe(5);
    const m = await app.inject({
      method: "POST",
      url: "/api/v1/sara/moderation",
      payload: { extraBlockedWords: ["verybad"] },
    });
    expect(m.statusCode).toBe(200);
    const check = await app.inject({ method: "GET", url: "/api/v1/sara/moderation" });
    expect(check.json().data.blockedWords).toContain("verybad");
  });

  it("memory endpoints list and delete viewer data (privacy)", async () => {
    const mem = await app.inject({ method: "GET", url: "/api/v1/sara/memory" });
    const viewers = mem.json().data.viewers as Array<{ id: string; displayName: string }>;
    expect(viewers.some((v) => v.displayName === "Ali")).toBe(true);
    const del = await app.inject({
      method: "DELETE",
      url: `/api/v1/sara/memory/viewer/${viewers[0]!.id}`,
    });
    expect(del.statusCode).toBe(200);
  });

  it("converse runs the brain without touching the LIVE queue", async () => {
    const c = await app.inject({
      method: "POST",
      url: "/api/v1/sara/converse",
      payload: { text: "hello Sara", username: "Tester" },
    });
    expect(c.statusCode).toBe(200);
    expect(c.json().data.text).toContain("hello Sara");
    expect(c.json().data.tts.provider).toBe("fake-tts");
  });

  it("tiktok webhook without config returns honest 503", async () => {
    const w = await app.inject({
      method: "POST",
      url: "/api/v1/sara/tiktok/webhook",
      payload: { event: "comment", text: "hi" },
    });
    expect(w.statusCode).toBe(503);
    expect(w.json().error.message).toContain("officially authorized");
  });

  it("audit log records control actions", async () => {
    const a = await app.inject({ method: "GET", url: "/api/v1/sara/audit" });
    const actions = (a.json().data.entries as Array<{ action: string }>).map((e) => e.action);
    expect(actions.some((x) => x.startsWith("control."))).toBe(true);
  });

  it("analytics exposes real usage only", async () => {
    const an = await app.inject({ method: "GET", url: "/api/v1/sara/analytics" });
    expect(an.statusCode).toBe(200);
    expect(Array.isArray(an.json().data.providers)).toBe(true);
  });
});

describe("sara live API (auth configured)", () => {
  let app: TestApp;
  let fx: Awaited<ReturnType<typeof buildSaraFixture>>;
  let cookie: string;

  beforeAll(async () => {
    fx = await buildSaraFixture();
    app = await buildTestApp({ operatorPassword: TEST_PASSWORD }, undefined, fx.sara);
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "operator", password: TEST_PASSWORD },
    });
    cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  });

  afterAll(async () => {
    await fx.sara.system.director.stop();
    await app.close();
    fx.cleanup();
  });

  it("mutations require a session; status stays readable", async () => {
    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/sara/control",
      payload: { action: "start" },
    });
    expect(denied.statusCode).toBe(401);
    const sim = await app.inject({
      method: "POST",
      url: "/api/v1/sara/simulate",
      payload: { username: "x", text: "hi" },
    });
    expect(sim.statusCode).toBe(401);
    const ok = await app.inject({ method: "GET", url: "/api/v1/sara/status" });
    expect(ok.statusCode).toBe(200);

    const allowed = await app.inject({
      method: "POST",
      url: "/api/v1/sara/control",
      payload: { action: "start" },
      headers: { cookie },
    });
    expect(allowed.statusCode).toBe(200);
  });
});
