/** Sara LIVE integration tests: director lifecycle, takeover, emergency stop, fallbacks, simulator. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LiveDirector } from "../src/live.js";
import { SaraBrain } from "../src/brain.js";
import { MemoryStore } from "../src/memory.js";
import { ModerationEngine } from "../src/moderation.js";
import { EmotionEngine } from "../src/emotion.js";
import { DEFAULT_PERSONALITY, AI_DISCLOSURE_DEFAULT } from "../src/personality.js";
import { FallbackLLM, OfflinePersonaProvider } from "../src/providers/llm.js";
import { SimulatorSource } from "../src/providers/simulator.js";
import {
  OfficialTikTokSource,
  UnavailableTikTokSource,
  BattleManager,
  normalizeOfficialEvent,
} from "../src/providers/tiktok.js";
import { TTSChain } from "../src/providers/tts.js";
import { createTestDb, FakeAvatar, FakeLLM, FakeTTS } from "./fakes.js";
import type { BrainReply, LLMProvider, SaraControlSettings } from "../src/types.js";

const SETTINGS: SaraControlSettings = {
  responsesPerMinute: 30,
  perViewerCooldownSeconds: 0,
  duplicateWindowSeconds: 0,
  minPriority: 5,
  moderationStrictness: "standard",
  autoGreetJoins: false,
  thankGifts: true,
  welcomeFollows: true,
  memoryEnabled: true,
  aiDisclosure: AI_DISCLOSURE_DEFAULT,
};

class BrokenPrimary implements LLMProvider {
  readonly name = "broken-primary";
  async complete(): Promise<BrainReply> {
    throw new Error("down");
  }
}

interface Fixture {
  director: LiveDirector;
  llm: FakeLLM;
  tts: FakeTTS;
  avatar: FakeAvatar;
  simulator: SimulatorSource;
  cleanup: () => void;
}

async function buildDirector(
  overrides: { llm?: FakeLLM; settings?: Partial<SaraControlSettings> } = {},
): Promise<Fixture> {
  const { db, cleanup } = await createTestDb();
  const memory = new MemoryStore(db);
  const moderation = new ModerationEngine();
  const emotion = new EmotionEngine();
  const llm = overrides.llm ?? new FakeLLM("fake", (t) => `Reply to: ${t}`);
  const tts = new FakeTTS();
  const avatar = new FakeAvatar();
  const simulator = new SimulatorSource({ eventsPerMinute: 600 });
  const brain = new SaraBrain({
    llm,
    tts,
    avatar,
    memory,
    moderation,
    personality: DEFAULT_PERSONALITY,
    aiDisclosure: AI_DISCLOSURE_DEFAULT,
    memoryEnabled: true,
  });
  const director = new LiveDirector({
    db,
    brain,
    avatar,
    personality: DEFAULT_PERSONALITY,
    memory,
    moderation,
    sources: [new UnavailableTikTokSource(), simulator],
    settings: { ...SETTINGS, ...overrides.settings },
    aiDisclosure: AI_DISCLOSURE_DEFAULT,
  });
  void emotion;
  return { director, llm, tts, avatar, simulator, cleanup };
}

let fx: Fixture;

beforeEach(async () => {
  fx = await buildDirector();
});

afterEach(async () => {
  await fx.director.stop(); // stops simulator/drain timers before the DB closes
  fx.cleanup();
});

describe("LiveDirector lifecycle", () => {
  it("start → simulator comment → Sara response appears in feed", async () => {
    await fx.director.start();
    expect(fx.director.state).toBe("live");

    fx.simulator.injectComment("Ali", "Sara how are you?");
    // Drain loop runs every 700ms — wait for the response.
    for (let i = 0; i < 20 && fx.director.status().metrics.responses === 0; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const feed = fx.director.feedSince(null);
    const saraLine = feed.find((f) => f.kind === "sara");
    expect(saraLine).toBeDefined();
    expect(saraLine!.text).toContain("how are you");
    expect(fx.tts.calls.length).toBeGreaterThanOrEqual(1);
    expect(fx.director.status().metrics.comments).toBe(1);
  });

  it("offline persona brain works end-to-end without any external provider", async () => {
    const personaFx = await buildDirector({
      llm: new FakeLLM("forced", () => {
        throw new Error("external down");
      }),
    });
    // Swap in a real offline persona + fallback chain via a second director.
    const { db, cleanup } = await createTestDb();
    const memory = new MemoryStore(db);
    const persona = new OfflinePersonaProvider(() => ({
      personality: DEFAULT_PERSONALITY,
      emotion: "happy",
      language: "roman-ur",
      viewerName: "Ali",
      isRegular: false,
      isFollower: false,
      memoryContext: [],
      aiDisclosure: AI_DISCLOSURE_DEFAULT,
      eventKind: "comment",
    }));
    const chain: LLMProvider = new FallbackLLM([new BrokenPrimary(), persona]);
    const brain = new SaraBrain({
      llm: chain,
      tts: new FakeTTS(),
      avatar: new FakeAvatar(),
      memory,
      moderation: new ModerationEngine(),
      personality: DEFAULT_PERSONALITY,
      aiDisclosure: AI_DISCLOSURE_DEFAULT,
      memoryEnabled: true,
    });
    const director = new LiveDirector({
      db,
      brain,
      avatar: new FakeAvatar(),
      personality: DEFAULT_PERSONALITY,
      memory,
      moderation: new ModerationEngine(),
      sources: [new SimulatorSource()],
      settings: SETTINGS,
      aiDisclosure: AI_DISCLOSURE_DEFAULT,
    });
    await director.start();
    const sim = director["deps"].sources.find((s) => s.name === "simulator") as SimulatorSource;
    sim.injectComment("Ali", "Sara salaam! kia haal hai?");
    for (let i = 0; i < 20 && director.status().metrics.responses === 0; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const saraLine = director.feedSince(null).find((f) => f.kind === "sara");
    expect(saraLine).toBeDefined();
    expect(saraLine!.text.toLowerCase()).toMatch(/salam|welcome|kaise|theek/);
    void personaFx;
    cleanup();
  });

  it("pause stops responses; resume continues", async () => {
    await fx.director.start();
    fx.director.pause();
    fx.simulator.injectComment("Ali", "hello there friend");
    await new Promise((r) => setTimeout(r, 900));
    expect(fx.director.status().metrics.responses).toBe(0);
    fx.director.resume();
    for (let i = 0; i < 20 && fx.director.status().metrics.responses === 0; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    expect(fx.director.status().metrics.responses).toBeGreaterThanOrEqual(1);
  });

  it("human takeover drops the queue and operator messages flow", async () => {
    await fx.director.start();
    fx.simulator.injectComment("Ali", "question one");
    fx.simulator.injectComment("Bilal", "question two");
    fx.director.takeover();
    expect(fx.director.queueSnapshot().length).toBe(0);
    expect(fx.director.state).toBe("takeover");
    const item = fx.director.operatorMessage("Admin here, hello everyone!");
    expect(item.kind).toBe("operator");
    fx.director.resume();
    expect(fx.director.state).toBe("live");
  });

  it("emergency stop halts everything instantly", async () => {
    await fx.director.start();
    fx.simulator.injectComment("Ali", "hello before disaster");
    fx.simulator.injectComment("Ali", "hello again after");
    await fx.director.emergencyStop();
    expect(fx.director.state).toBe("stopped");
    expect(fx.director.queueSnapshot().length).toBe(0);
    const feed = fx.director.feedSince(null);
    expect(feed.some((f) => f.text.includes("EMERGENCY STOP"))).toBe(true);
  });

  it("moderation rejects abusive comments and counts them", async () => {
    await fx.director.start();
    fx.simulator.injectComment("Troll", "i will kill you");
    await new Promise((r) => setTimeout(r, 400));
    expect(fx.director.status().metrics.rejectedComments).toBe(1);
    expect(fx.director.status().metrics.responses).toBe(0);
    expect(fx.director.feedSince(null).some((f) => f.kind === "moderation")).toBe(true);
  });

  it("muted Sara reads chat but never speaks", async () => {
    await fx.director.start();
    fx.director.mute();
    fx.simulator.injectComment("Ali", "say hi please");
    await new Promise((r) => setTimeout(r, 900));
    expect(fx.director.status().metrics.responses).toBe(0);
    fx.director.unmute();
    expect(fx.director.state).toBe("live");
  });

  it("follow and gift events produce welcoming responses", async () => {
    await fx.director.start();
    // Inject via pipeline: director.handleEvent on synthetic events.
    fx.director.handleEvent({
      id: "f1",
      kind: "follow",
      platform: "simulator",
      username: "Ayesha",
      userId: "ayesha",
      at: new Date().toISOString(),
    });
    fx.director.handleEvent({
      id: "g1",
      kind: "gift",
      platform: "simulator",
      username: "Ayesha",
      userId: "ayesha",
      giftName: "Rose",
      giftCount: 5,
      at: new Date().toISOString(),
    });
    for (let i = 0; i < 20 && fx.director.status().metrics.responses < 2; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const feed = fx.director.feedSince(null).filter((f) => f.kind === "sara");
    expect(feed.length).toBeGreaterThanOrEqual(2); // follow + gift both answered
    expect(feed.some((f) => f.text.includes("Rose"))).toBe(true);
  });
});

describe("memory across sessions", () => {
  it("Sara greets a returning regular by name (memory → prompt → reply)", async () => {
    await fx.director.start();
    fx.simulator.injectComment("Ali", "mera naam Ali hai");
    for (let i = 0; i < 20 && fx.director.status().metrics.responses === 0; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    // Second round: the brain's system prompt should contain memory context.
    fx.simulator.injectComment("Ali", "Sara, do you remember me?");
    for (let i = 0; i < 20 && fx.llm.calls.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 150));
    }
    const secondSystem = fx.llm.calls[1]?.find((t) => t.role === "system");
    expect(secondSystem).toBeDefined();
    expect(secondSystem!.content).toContain("Ali");
  });
});

describe("TikTok official adapter", () => {
  it("unavailable source never pretends to be connected", () => {
    const s = new UnavailableTikTokSource();
    const st = s.status();
    expect(st.connected).toBe(false);
    expect(st.mode).toBe("unavailable");
    expect(st.detail).toMatch(/officially authorized/i);
  });

  it("normalizes official webhook payloads", () => {
    const evt = normalizeOfficialEvent({
      event: "comment",
      user: { unique_id: "ali_98" },
      text: "sara kaisi ho",
    });
    expect(evt).not.toBeNull();
    expect(evt!.kind).toBe("comment");
    expect(evt!.username).toBe("ali_98");
    expect(normalizeOfficialEvent({ event: "mystery" })).toBeNull();
  });

  it("official source with configured endpoint reports official mode and feeds events", async () => {
    const received: string[] = [];
    const src = new OfficialTikTokSource({ eventsUrl: "https://relay.example.com/events" });
    src.onEvent((e) => received.push(e.kind));
    await src.start();
    src.acceptWebhook({ event: "follow", user: { unique_id: "newbie" } });
    src.acceptWebhook({ event: "gift", user: { unique_id: "newbie" }, gift_name: "Rose" });
    expect(received).toEqual(["follow", "gift"]);
    expect(src.status().mode).toBe("official");
    await src.stop();
  });
});

describe("Battle manager", () => {
  it("reacts to officially exposed battle lifecycle", () => {
    const b = new BattleManager();
    const s = b.observe({
      id: "b1",
      kind: "battle_start",
      platform: "simulator",
      username: "Rival",
      battle: { state: "started", opponent: "Rival" },
      at: new Date().toISOString(),
    });
    expect(s.reaction).toContain("Rival");
    const u = b.observe({
      id: "b2",
      kind: "battle_update",
      platform: "simulator",
      battle: { state: "update", myScore: 300, opponentScore: 250 },
      at: new Date().toISOString(),
    });
    expect(u.reaction).toContain("300");
    const e = b.observe({
      id: "b3",
      kind: "battle_end",
      platform: "simulator",
      battle: { state: "ended", myScore: 400, opponentScore: 390 },
      at: new Date().toISOString(),
    });
    expect(e.reaction).toContain("WON");
    expect(b.current).toBeNull();
  });
});

describe("TTS chain degradation", () => {
  it("falls through failing providers to the offline voice, labeled degraded", async () => {
    const bad = new FakeTTS("bad-primary");
    bad.failTimes = 1;
    const offline = new FakeTTS("mespeak-offline");
    const chain = new TTSChain([bad, offline]);
    const res = await chain.synthesize("hello chat");
    expect(res.provider).toBe("mespeak-offline");
    expect(res.fallbackUsed).toBe(true);
    expect(res.degraded).toBe(true);
    expect(res.attempted).toEqual(["bad-primary"]);
  });

  it("captions-only when every provider fails (honest, no fake audio)", async () => {
    const bad1 = new FakeTTS("a");
    bad1.failTimes = 1;
    const bad2 = new FakeTTS("b");
    bad2.failTimes = 1;
    const chain = new TTSChain([bad1, bad2]);
    const res = await chain.synthesize("hello chat");
    expect(res.format).toBe("none");
    expect(res.provider).toBe("captions-only");
    expect(res.degraded).toBe(true);
  });
});

describe("LLM fallback chain", () => {
  it("falls back to the offline persona when the primary fails", async () => {
    const failing = new FakeLLM("failing");
    failing.failTimes = 1;
    const persona = new OfflinePersonaProvider(() => ({
      personality: DEFAULT_PERSONALITY,
      emotion: "neutral",
      language: "en",
      viewerName: null,
      isRegular: false,
      isFollower: false,
      memoryContext: [],
      aiDisclosure: AI_DISCLOSURE_DEFAULT,
      eventKind: "comment",
    }));
    const chain = new FallbackLLM([failing, persona]);
    const res = await chain.complete([{ role: "user", content: "Sara how are you?" }]);
    expect(res.provider).toBe("offline-persona");
    expect(res.fallbackUsed).toBe(true);
    expect(res.text).toMatch(/doing great|bilkul/i);
  });
});

describe("offline persona (scripted brain) bilingual coverage", () => {
  const persona = new OfflinePersonaProvider(() => ({
    personality: DEFAULT_PERSONALITY,
    emotion: "neutral",
    language: "roman-ur",
    viewerName: null,
    isRegular: false,
    isFollower: false,
    memoryContext: [],
    aiDisclosure: AI_DISCLOSURE_DEFAULT,
    eventKind: "comment",
  }));

  it("answers greetings in roman urdu", async () => {
    const r = await persona.complete([{ role: "user", content: "salam sara" }]);
    expect(r.text).toMatch(/alaikum|welcome/i);
  });

  it("introduces itself as an AI when asked", async () => {
    const r = await persona.complete([{ role: "user", content: "tum kaun ho? robot ho?" }]);
    expect(r.text).toContain("AI");
    expect(r.text).toContain("Sara");
  });

  it("never begs for gifts", async () => {
    for (const text of ["what can i do for you", "how are you", "salam"]) {
      const r = await persona.complete([{ role: "user", content: text }]);
      expect(r.text.toLowerCase()).not.toMatch(
        /send (gift|rose|money)|gift (kara|karo|please|dena)/,
      );
    }
  });
});
