/**
 * Sara AI — LLM provider abstraction.
 *
 * Chain (first configured wins, failures fall through):
 *   1. OpenAI-compatible (OpenAI / Ollama / vLLM / any compatible base URL)
 *   2. Anthropic (messages API)
 *   3. Offline persona brain (deterministic, bilingual, always available)
 *
 * The offline brain is NOT a fake claim of AI sophistication — it is a real
 * scripted persona engine used when no external LLM is configured, and it is
 * always labeled as `mock` in status payloads.
 */
import { createLogger } from "@sara/logger";
import { buildSystemPrompt, pick, VARIATION } from "../personality.js";
import { detectIntent, detectLanguage, titleCase } from "../languages.js";
import type {
  BrainReply,
  ChatTurn,
  LLMProvider,
  SaraEmotion,
  SaraLanguage,
  SaraPersonalityConfig,
} from "../types.js";

const log = createLogger({ name: "sara-llm" });

export interface OpenAICompatOptions {
  apiKey?: string | null;
  baseUrl?: string | null;
  model: string;
  fetchImpl?: typeof fetch;
  /** Label reported in status (openai / ollama / vllm …). */
  label?: string;
}

export class OpenAICompatProvider implements LLMProvider {
  readonly name: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: OpenAICompatOptions) {
    this.name = opts.label ?? "openai-compatible";
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(turns: ChatTurn[]): Promise<BrainReply> {
    if (!this.opts.apiKey && !this.opts.baseUrl) throw new Error("no api key configured");
    const base = (this.opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.opts.apiKey ? { authorization: `Bearer ${this.opts.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: this.opts.model,
        messages: turns,
        max_tokens: 220,
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`llm http ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("empty completion");
    return { text, provider: this.name, fallbackUsed: false };
  }
}

export interface AnthropicOptions {
  apiKey?: string | null;
  model: string;
  baseUrl?: string | null;
  fetchImpl?: typeof fetch;
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: AnthropicOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async complete(turns: ChatTurn[]): Promise<BrainReply> {
    if (!this.opts.apiKey) throw new Error("no api key configured");
    const base = (this.opts.baseUrl ?? "https://api.anthropic.com/v1").replace(/\/+$/, "");
    const system = turns
      .filter((t) => t.role === "system")
      .map((t) => t.content)
      .join("\n\n");
    const messages = turns.filter((t) => t.role !== "system");
    const res = await this.fetchImpl(`${base}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.opts.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.opts.model,
        system,
        messages,
        max_tokens: 220,
        temperature: 0.8,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`llm http ${res.status}`);
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = data.content
      ?.map((c) => c.text ?? "")
      .join("")
      .trim();
    if (!text) throw new Error("empty completion");
    return { text, provider: this.name, fallbackUsed: false };
  }
}

export interface OfflineBrainContext {
  personality: SaraPersonalityConfig;
  emotion: SaraEmotion;
  language: SaraLanguage;
  viewerName: string | null;
  isRegular: boolean;
  isFollower: boolean;
  memoryContext: string[];
  aiDisclosure: string;
  eventKind: string;
  giftName?: string;
}

/**
 * Deterministic persona engine — real bilingual responses for the common
 * LIVE situations, so Sara works with zero external services. Labeled
 * "offline-persona (scripted)" everywhere it appears.
 */
export class OfflinePersonaProvider implements LLMProvider {
  readonly name = "offline-persona";

  constructor(private readonly ctx: () => OfflineBrainContext) {}

  async complete(turns: ChatTurn[]): Promise<BrainReply> {
    const ctx = this.ctx();
    const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
    // Per-message context: language + name come from what the viewer actually
    // wrote (the static closure only carries personality defaults).
    const detected = detectLanguage(lastUser);
    const effective: OfflineBrainContext = {
      ...ctx,
      language: ctx.language === "en" ? detected.language : ctx.language,
      viewerName: ctx.viewerName ?? detectIntent(lastUser).name ?? null,
    };
    const text = this.compose(lastUser, effective);
    return { text, provider: this.name, fallbackUsed: true };
  }

  private compose(viewerText: string, ctx: OfflineBrainContext): string {
    const name = ctx.viewerName;
    const intent = detectIntent(viewerText);
    const seed = Math.floor(Math.random() * 997);

    // Event-driven replies.
    if (ctx.eventKind === "gift")
      return pick(VARIATION.gift, seed)
        .replace("{gift}", ctx.giftName ?? "gift")
        .replace("{name}", name ?? "friend");
    if (ctx.eventKind === "follow")
      return pick(VARIATION.follow, seed).replace("{name}", name ?? "friend");

    switch (intent.intent) {
      case "greeting": {
        if (ctx.isRegular && name) {
          return seed % 2 === 0
            ? `Welcome back, ${name}! So good to see you again ❤️ How have you been?`
            : `${name}! Arey welcome back yaar 😄 Stream isn't the same without you.`;
        }
        if (ctx.language === "ur") return "وعلیکم سلام! خوش آمدید 🌸 آپ کیسے ہیں؟";
        if (ctx.language === "roman-ur")
          return "Wa-alaikum assalam! Welcome to the stream 😊 Aap kaise hain? Batao kya chal raha hai aaj kal?";
        if (ctx.language === "hi") return "नमस्ते! स्ट्रीम पर आपका स्वागत है 😊 कैसे हैं आप?";
        return pick(VARIATION.greeting, seed);
      }
      case "how_are_you": {
        if (ctx.emotion === "excited")
          return "I'm SO hyped tonight! 😄 Chat is on fire — how are YOU doing?";
        if (ctx.language === "ur") return "میں بالکل ٹھیک ہوں، شکریہ! 🌸 آپ سنائیں، آج کیسے ہیں؟";
        if (ctx.language === "roman-ur")
          return "Main bilkul theek hoon, shukriya! 😊 Aap sunao, aaj ka din kaisa tha?";
        if (ctx.language === "hi") return "मैं बिल्कुल ठीक हूँ! 😄 आप बताओ, आज कैसे हैं?";
        return "I'm doing great, thank you for asking! 😄 How are you doing today?";
      }
      case "remember": {
        if (ctx.isRegular && name) {
          return seed % 2 === 0
            ? `Of course I remember you, ${name}! ❤️ You're one of our regulars now — how have you been?`
            : `${name}! Hamesha se yaad rakha hai 😄 Welcome back — tell me everything!`;
        }
        if (name) return `Yes ${name}! 😄 We've chatted before — good to see you again!`;
        return "I remember everyone who hangs out here! 😄 Tell me your name if we haven't met yet.";
      }
      case "introduces_name": {
        const n = intent.name ? titleCase(intent.name) : "friend";
        return seed % 2 === 0
          ? `Nice to meet you, ${n}! ❤️ Welcome to the Sara family.`
          : `${n}! Lovely name 😄 Welcome in — say hi anytime!`;
      }
      case "who_are_you": {
        if (ctx.language === "roman-ur")
          return `Main ${ctx.personality.name} hoon — ek AI virtual host! 🤖 Live pe aap se baatein karna mujhe pasand hai. Aap batao?`;
        if (ctx.language === "ur")
          return `میں ${ctx.personality.name} ہوں — ایک اے آئی ورچوئل میزبان! 🤖`;
        return `I'm ${ctx.personality.name} — an AI virtual host! 🤖 ${ctx.aiDisclosure} I chat, laugh and hang out with you here on LIVE.`;
      }
      case "thanks": {
        return ctx.language === "roman-ur"
          ? "Aray koi baat nahi! 😊 Khushi hui sun kar."
          : "Aww, anytime! 😊 That's what I'm here for.";
      }
      case "goodbye": {
        return pick(VARIATION.goodbye, seed).replace("{name}", name ?? "friend");
      }
      case "affection": {
        return "Aww that's so sweet! ❤️ You're a wonderful human — thank you for the kindness!";
      }
      default: {
        // Generic but personality-flavored continuation.
        const generic = [
          name
            ? `That's interesting, ${name}! Tell me more 😄`
            : "Interesting! Tell me more about that 😄",
          "Ooh good one! 😄 Anyone else thinking the same? Drop it in chat!",
          "Haha I love where this is going 😄 What do you all think?",
        ];
        if (ctx.language === "roman-ur") {
          generic.push("Wah, acha point hai! 😄 Aur batao, phir kya hua?");
          generic.push("Sahi kaha! 😄 Chalo aage barho, aur sunao.");
        }
        return pick(generic, seed);
      }
    }
  }
}

/** Provider chain with automatic fallback + usage logging. */
export class FallbackLLM implements LLMProvider {
  readonly name: string;
  constructor(
    private readonly chain: LLMProvider[],
    private readonly onFallback?: (failed: string[], used: string) => void,
  ) {
    this.name = chain.map((c) => c.name).join(" → ");
  }

  async complete(turns: ChatTurn[]): Promise<BrainReply> {
    const failures: string[] = [];
    for (const provider of this.chain) {
      try {
        const reply = await provider.complete(turns);
        if (failures.length > 0) {
          log.warn({ failed: failures, used: provider.name }, "llm fallback engaged");
          this.onFallback?.(failures, provider.name);
        }
        return { ...reply, fallbackUsed: failures.length > 0 || reply.fallbackUsed };
      } catch (err) {
        failures.push(provider.name);
        log.warn(
          { provider: provider.name, err: String(err).slice(0, 120) },
          "llm provider failed",
        );
      }
    }
    throw new Error(`all llm providers failed: ${failures.join(", ")}`);
  }
}

/** Convenience: resolve the brain chain from config values. */
export function resolveLLMChain(opts: {
  openaiApiKey?: string | null;
  openaiBaseUrl?: string | null;
  openaiModel?: string;
  anthropicApiKey?: string | null;
  anthropicModel?: string;
  offlineCtx: () => OfflineBrainContext;
}): { chain: LLMProvider[]; primary: string; fallback: string | null } {
  const chain: LLMProvider[] = [];
  if (opts.openaiApiKey || (opts.openaiBaseUrl && opts.openaiModel)) {
    chain.push(
      new OpenAICompatProvider({
        apiKey: opts.openaiApiKey ?? null,
        baseUrl: opts.openaiBaseUrl ?? null,
        model: opts.openaiModel ?? "gpt-4o-mini",
        label: opts.openaiBaseUrl ? "openai-compatible" : "openai",
      }),
    );
  }
  if (opts.anthropicApiKey) {
    chain.push(
      new AnthropicProvider({
        apiKey: opts.anthropicApiKey,
        model: opts.anthropicModel ?? "claude-sonnet-4-6",
      }),
    );
  }
  chain.push(new OfflinePersonaProvider(opts.offlineCtx));
  return {
    chain,
    primary: chain[0]!.name,
    fallback: chain.length > 1 ? "offline-persona" : null,
  };
}

export { buildSystemPrompt };
