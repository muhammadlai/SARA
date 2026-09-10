/**
 * Sara AI — system factory.
 *
 * Assembles the full LIVE-host stack from validated config:
 *   config → providers (LLM chain, TTS chain, avatar) → memory → moderation →
 *   brain → sources (TikTok official / simulator) → LiveDirector → watchdog
 *
 * Tests inject fakes via the `overrides` bag; the API uses this directly.
 */
import fs from "node:fs";
import path from "node:path";
import type { SqliteDatabase } from "@sara/db";
import type { SaraConfig } from "@sara/config";
import { createLogger } from "@sara/logger";
import { AuditLog, ProviderUsage } from "./audit.js";
import { CommentQueue } from "./comments.js";
import { EmotionEngine } from "./emotion.js";
import { ModerationEngine } from "./moderation.js";
import { MemoryStore } from "./memory.js";
import { Watchdog } from "./health.js";
import { SaraBrain } from "./brain.js";
import { LiveDirector } from "./live.js";
import { DEFAULT_PERSONALITY } from "./personality.js";
import { resolveLLMChain, type OfflineBrainContext } from "./providers/llm.js";
import { resolveTTSChain } from "./providers/tts.js";
import { resolveAvatarProvider } from "./providers/avatar.js";
import { OfficialTikTokSource, UnavailableTikTokSource } from "./providers/tiktok.js";
import { SimulatorSource } from "./providers/simulator.js";
import type {
  AvatarProvider,
  LLMProvider,
  LiveEventSource,
  SaraControlSettings,
  SaraPersonalityConfig,
  TTSProvider,
} from "./types.js";

const log = createLogger({ name: "sara" });

export interface SaraSystemOverrides {
  llm?: LLMProvider;
  tts?: TTSProvider;
  avatar?: AvatarProvider;
  sources?: LiveEventSource[];
  personality?: Partial<SaraPersonalityConfig>;
  settings?: Partial<SaraControlSettings>;
  dataDir?: string;
}

export interface SaraSystem {
  db: SqliteDatabase;
  config: SaraConfig;
  personality: SaraPersonalityConfig;
  memory: MemoryStore;
  moderation: ModerationEngine;
  emotion: EmotionEngine;
  queue: CommentQueue;
  llm: LLMProvider;
  tts: TTSProvider;
  avatar: AvatarProvider;
  brain: SaraBrain;
  director: LiveDirector;
  sources: LiveEventSource[];
  watchdog: Watchdog;
  audit: AuditLog;
  usage: ProviderUsage;
  audioDir: string;
}

const DEFAULT_CONTROL_SETTINGS: SaraControlSettings = {
  responsesPerMinute: 8,
  perViewerCooldownSeconds: 20,
  duplicateWindowSeconds: 60,
  minPriority: 3,
  moderationStrictness: "standard",
  autoGreetJoins: false, // joins are noisy; comments/follows/gifts matter
  thankGifts: true,
  welcomeFollows: true,
  memoryEnabled: true,
  aiDisclosure: "🤖 Sara is an AI virtual character.",
};

export function buildSaraSystem(opts: {
  db: SqliteDatabase;
  config: SaraConfig;
  overrides?: SaraSystemOverrides;
}): SaraSystem {
  const cfg = opts.config;
  const overrides = opts.overrides ?? {};
  const db = opts.db;

  const dataDir = overrides.dataDir ?? path.resolve(process.cwd(), "data/sara");
  const audioDir = path.join(dataDir, "audio");
  fs.mkdirSync(audioDir, { recursive: true });

  const personality: SaraPersonalityConfig = { ...DEFAULT_PERSONALITY, ...overrides.personality };
  const settings: SaraControlSettings = {
    ...DEFAULT_CONTROL_SETTINGS,
    responsesPerMinute: cfg.responsesPerMinute,
    memoryEnabled: cfg.memoryEnabled,
    aiDisclosure: cfg.aiDisclosure,
    ...overrides.settings,
  };

  const memory = new MemoryStore(db);
  const moderation = new ModerationEngine();
  moderation.configure({ strictness: settings.moderationStrictness });
  const emotion = new EmotionEngine();
  const queue = new CommentQueue();
  const audit = new AuditLog(db);
  const usage = new ProviderUsage(db);
  const watchdog = new Watchdog();

  const onProviderUse = (provider: string, kind: string, ok: boolean, latencyMs: number): void => {
    usage.record(provider, kind, ok, latencyMs);
    if (kind === "llm") {
      watchdog.report("llm", {
        healthy: ok || provider === "offline-persona",
        degraded: provider === "offline-persona" || provider === "safe-default",
        detail: ok ? `primary: ${provider}` : `provider failing (using fallback: ${provider})`,
      });
    }
    if (kind === "tts") {
      watchdog.report("tts", {
        healthy: ok,
        degraded: provider === "mespeak-offline" || provider === "captions-only",
        detail: ok ? `engine: ${provider}` : `voice unavailable — captions only (${provider})`,
      });
    }
  };

  // Offline brain context closure (personality-flavored scripted replies).
  const offlineCtx = (): OfflineBrainContext => ({
    personality,
    emotion: emotion.emotion,
    language: personality.defaultLanguage,
    viewerName: null,
    isRegular: false,
    isFollower: false,
    memoryContext: [],
    aiDisclosure: cfg.aiDisclosure,
    eventKind: "comment",
  });

  const llmChain = resolveLLMChain({
    openaiApiKey: cfg.openaiApiKey,
    openaiBaseUrl: cfg.llmBaseUrl,
    openaiModel: cfg.llmModel,
    anthropicApiKey: cfg.anthropicApiKey,
    anthropicModel: cfg.llmModel,
    offlineCtx,
  });
  const llmFinal: LLMProvider =
    overrides.llm ??
    new llmModule.FallbackLLM(llmChain.chain, (failed, used) => {
      watchdog.report("llm", {
        healthy: true,
        degraded: true,
        detail: `${failed.join(", ")} failed → ${used}`,
      });
    });

  const ttsResolved = resolveTTSChain({
    engineBaseUrl: cfg.ttsEngineUrl,
    engineVoiceId: cfg.voiceId,
    openaiApiKey: cfg.openaiApiKey,
    openaiBaseUrl: cfg.llmBaseUrl,
    edgePython: cfg.ttsEdgePython,
    piperVoicePath: cfg.piperVoicePath,
    piperBinary: cfg.piperBinary,
    outDir: audioDir,
  });
  const tts = overrides.tts ?? ttsResolved.chain;

  const avatar =
    overrides.avatar ??
    resolveAvatarProvider({ engineBaseUrl: cfg.avatarEngineUrl, engineAvatarId: cfg.avatarId });

  const brain = new SaraBrain({
    llm: llmFinal,
    tts,
    avatar,
    memory,
    moderation,
    personality,
    aiDisclosure: cfg.aiDisclosure,
    memoryEnabled: settings.memoryEnabled,
    onProviderUse,
  });

  // Sources: official TikTok when configured, simulator when enabled.
  const sources: LiveEventSource[] = [];
  if (cfg.tiktokEventsUrl) {
    sources.push(
      new OfficialTikTokSource({
        eventsUrl: cfg.tiktokEventsUrl,
        bearerToken: cfg.tiktokToken,
      }),
    );
  } else {
    sources.push(new UnavailableTikTokSource());
  }
  if (cfg.simulatorEnabled || overrides.sources) {
    sources.push(overrides.sources?.find((s) => s.name === "simulator") ?? new SimulatorSource());
  }
  const finalSources = overrides.sources ?? sources;

  const director = new LiveDirector({
    db,
    brain,
    avatar,
    personality,
    memory,
    moderation,
    sources: finalSources,
    settings,
    aiDisclosure: cfg.aiDisclosure,
  });

  watchdog.register("memory", "ready");
  watchdog.register("llm", `primary: ${llmChain.primary}`);
  watchdog.register("tts", `engine: ${ttsResolved.primary ?? "captions-only"}`);
  watchdog.register("avatar", `mode: ${avatar.name}`);
  watchdog.register("sources", finalSources.map((s) => s.name).join(", "));
  watchdog.start();

  log.info(
    {
      llm: llmFinal.name,
      tts: tts.name,
      avatar: avatar.name,
      sources: finalSources.map((s) => s.name),
    },
    "sara system built",
  );

  return {
    db,
    config: cfg,
    personality,
    memory,
    moderation,
    emotion,
    queue,
    llm: llmFinal,
    tts,
    avatar,
    brain,
    director,
    sources: finalSources,
    watchdog,
    audit,
    usage,
    audioDir,
  };
}

// Local import alias to keep the factory above tidy.
import * as llmModule from "./providers/llm.js";
