/**
 * Sara AI — the brain.
 *
 * Pipeline (see docs/sara-ai.md):
 *   event → normalize → moderation → context+memory retrieval →
 *   personality+prompt → LLM chain → output safety re-check → emotion →
 *   TTS chain → avatar frame
 *
 * The brain is transport-agnostic: the LiveDirector feeds it events and
 * consumes rendered responses; tests can drive it directly.
 */
import { createLogger } from "@sara/logger";
import { buildSystemPrompt } from "./personality.js";
import { detectLanguage, voiceFor } from "./languages.js";
import type {
  AvatarProvider,
  BrainReply,
  ChatTurn,
  LiveEvent,
  LLMProvider,
  MemoryRecord,
  MemoryStore,
  ModerationEngine,
  SaraEmotion,
  SaraLanguage,
  SaraPersonalityConfig,
  SpeechResult,
  TTSProvider,
  ViewerRecord,
} from "./index.js";

const log = createLogger({ name: "sara-brain" });

export interface BrainDeps {
  llm: LLMProvider;
  tts: TTSProvider;
  avatar: AvatarProvider;
  memory: MemoryStore;
  moderation: ModerationEngine;
  personality: SaraPersonalityConfig;
  aiDisclosure: string;
  memoryEnabled: boolean;
  onProviderUse?: (provider: string, kind: string, ok: boolean, latencyMs: number) => void;
}

export interface BrainResponse {
  reply: BrainReply;
  speech: SpeechResult;
  emotion: SaraEmotion;
  language: SaraLanguage;
  viewer: ViewerRecord | null;
  memories: MemoryRecord[];
  avatar: Awaited<ReturnType<AvatarProvider["render"]>>;
  latencyMs: number;
  moderated: "allowed" | "softened";
}

export class SaraBrain {
  constructor(private readonly deps: BrainDeps) {}

  /** Status accessors for the dashboard (provider names, degraded flags). */
  get llmName(): string {
    return this.deps.llm.name.split(" → ")[0]!;
  }
  get llmFallback(): string | null {
    return this.deps.llm.name.includes("→") ? "offline-persona" : null;
  }
  get ttsName(): string {
    return this.deps.tts.name.split(" → ")[0] ?? "captions-only";
  }
  get ttsDegraded(): boolean {
    return this.deps.tts.name.includes("mespeak") || this.deps.tts.name === "captions-only";
  }
  get personalityValue(): SaraPersonalityConfig {
    return this.deps.personality;
  }
  get avatarRef(): AvatarProvider {
    return this.deps.avatar;
  }
  get moderationRef(): ModerationEngine {
    return this.deps.moderation;
  }

  /** Decide whether this event deserves a spoken response (events vs comments). */
  shouldRespondToEvent(
    event: LiveEvent,
    settings: { autoGreetJoins: boolean; thankGifts: boolean; welcomeFollows: boolean },
  ): boolean {
    switch (event.kind) {
      case "follow":
        return settings.welcomeFollows;
      case "gift":
        return settings.thankGifts;
      case "join":
        return settings.autoGreetJoins;
      case "share":
        return true;
      case "battle_start":
      case "battle_update":
      case "battle_end":
        return true;
      default:
        return false;
    }
  }

  buildContextTurns(opts: {
    viewer: ViewerRecord | null;
    language: SaraLanguage;
    emotion: SaraEmotion;
    eventText: string;
    memories: MemoryRecord[];
    recentConversation: Array<{ role: "viewer" | "sara"; text: string }>;
    eventKind: LiveEvent["kind"];
  }): ChatTurn[] {
    const system = buildSystemPrompt({
      personality: this.deps.personality,
      emotion: opts.emotion,
      language: opts.language,
      aiDisclosure: this.deps.aiDisclosure,
      memoryContext: opts.memories.map((m) => `${m.kind}: ${m.content}`),
      viewerName: opts.viewer?.displayName ?? null,
      isLive: true,
    });
    const turns: ChatTurn[] = [{ role: "system", content: system }];
    // Compact recent conversation (last 6 turns) for continuity.
    for (const turn of opts.recentConversation.slice(-6)) {
      turns.push({ role: turn.role === "sara" ? "assistant" : "user", content: turn.text });
    }
    turns.push({ role: "user", content: opts.eventText });
    return turns;
  }

  /** Full respond cycle for one admitted comment or notable event. */
  async respond(opts: {
    event: LiveEvent;
    viewer: ViewerRecord | null;
    recentConversation: Array<{ role: "viewer" | "sara"; text: string }>;
    emotion: SaraEmotion;
  }): Promise<BrainResponse | null> {
    const started = Date.now();
    const event = opts.event;
    const rawText =
      event.text ??
      (event.kind === "gift" ? `[gift: ${event.giftName ?? "gift"}]` : `[${event.kind}]`);

    // 1. Moderation on incoming viewer text (comments only — events are trusted kinds).
    if (event.kind === "comment") {
      const verdict = this.deps.moderation.check({
        text: rawText,
        username: event.username ?? "viewer",
      });
      if (verdict.action === "reject" || verdict.action === "escalate") {
        log.info(
          { username: event.username, action: verdict.action, categories: verdict.categories },
          "comment rejected",
        );
        return null;
      }
    }

    // 2. Language + memory.
    const lang = detectLanguage(rawText);
    const language: SaraLanguage =
      lang.language === "en" && this.deps.personality.defaultLanguage !== "en"
        ? this.deps.personality.defaultLanguage
        : lang.language;
    const memories = this.deps.memoryEnabled
      ? this.deps.memory.retrieve({ viewerId: opts.viewer?.id ?? null, query: rawText, limit: 6 })
      : [];

    // 3. Prompt + LLM chain.
    const turns = this.buildContextTurns({
      viewer: opts.viewer,
      language,
      emotion: opts.emotion,
      eventText: rawText,
      memories,
      recentConversation: opts.recentConversation,
      eventKind: event.kind,
    });

    let reply: BrainReply;
    const t0 = Date.now();
    try {
      reply = await this.deps.llm.complete(turns);
      this.deps.onProviderUse?.(reply.provider, "llm", true, Date.now() - t0);
    } catch (err) {
      this.deps.onProviderUse?.("llm-chain", "llm", false, Date.now() - t0);
      log.error({ err: String(err).slice(0, 160) }, "all llm providers failed");
      // Last-resort safe line (never silent failure while LIVE).
      reply = {
        text: "Sorry chat, my brain hiccuped for a second — say that again? 😅",
        provider: "safe-default",
        fallbackUsed: true,
      };
    }

    // 4. Output safety re-check: soften anything the model produced that trips rules.
    let moderated: "allowed" | "softened" = "allowed";
    const outCheck = this.deps.moderation.checkOutput(reply.text);
    if (outCheck.action !== "allow") {
      reply = {
        ...reply,
        text: "Let's keep things friendly here! 😊 Ask me something fun instead.",
      };
      moderated = "softened";
    }

    // 5. Voice.
    const speech = await this.deps.tts.synthesize(reply.text, voiceFor(language));
    this.deps.onProviderUse?.(
      speech.provider,
      "tts",
      speech.format !== "none",
      Math.max(1, Date.now() - t0),
    );

    // 6. Avatar frame.
    let avatar: Awaited<ReturnType<AvatarProvider["render"]>>;
    try {
      avatar = await this.deps.avatar.render({
        text: reply.text,
        audioPath: speech.path || undefined,
        emotion: opts.emotion,
      });
    } catch (err) {
      log.warn({ err: String(err).slice(0, 120) }, "avatar render failed — degrading");
      avatar = {
        mode: "unavailable",
        assetUrl: null,
        capabilities: [],
        provider: "unavailable",
        note: String(err).slice(0, 120),
      };
    }

    return {
      reply,
      speech,
      emotion: opts.emotion,
      language,
      viewer: opts.viewer,
      memories,
      avatar,
      latencyMs: Date.now() - started,
      moderated,
    };
  }
}
