/**
 * Sara AI — TTS provider chain.
 *
 * Order (first available wins; failures fall through):
 *   1. avatar-engine  — Chatterbox voice cloning via the vendored AvatarAI
 *                       engine (GPU; used when SARA_AVATAR_ENGINE_URL is set)
 *   2. openai         — OpenAI-compatible /audio/speech (tts-1, needs key)
 *   3. edge-tts       — Microsoft neural voices via the `edge-tts` CLI (free)
 *   4. piper          — local Piper neural voice (if a voice file is configured)
 *   5. mespeak        — bundled OFFLINE fallback (eSpeak-class quality; always
 *                       works, labeled degraded)
 *   6. captions-only  — no audio produced; honest degradation
 *
 * Every result reports which engine actually produced the audio so the UI can
 * label degraded output — Sara never pretends a natural voice was used.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createLogger } from "@sara/logger";
import type { SpeechResult, TTSProvider, TtsLanguage } from "../types.js";

const log = createLogger({ name: "sara-tts" });

function estimateSeconds(text: string): number {
  return Math.max(1, Math.round((text.split(/\s+/).length / 150) * 60) / 10);
}

export interface EngineTTSOptions {
  baseUrl: string;
  voiceId?: string | null;
  fetchImpl?: typeof fetch;
}

/** Calls the vendored AvatarAI engine's TTS endpoint (Chatterbox chain). */
export class EngineTTSProvider implements TTSProvider {
  readonly name = "avatar-engine";
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly opts: EngineTTSOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async synthesize(text: string, language: TtsLanguage): Promise<SpeechResult> {
    const res = await this.fetchImpl(`${this.opts.baseUrl.replace(/\/+$/, "")}/api/v1/tts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, language, voice_id: this.opts.voiceId ?? undefined }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`engine tts http ${res.status}`);
    const data = (await res.json()) as { audio_path?: string; url?: string };
    if (!data.audio_path && !data.url) throw new Error("engine tts: no audio in response");
    return {
      path: data.audio_path ?? data.url!,
      provider: this.name,
      format: "wav",
      fallbackUsed: false,
      voiceCloned: Boolean(this.opts.voiceId),
      degraded: false,
      durationEstimateSeconds: estimateSeconds(text),
    };
  }
}

export interface OpenAIHttpTTSOptions {
  apiKey?: string | null;
  baseUrl?: string | null;
  model?: string;
  voice?: string;
  fetchImpl?: typeof fetch;
}

export class OpenAITTSProvider implements TTSProvider {
  readonly name = "openai-tts";
  private readonly fetchImpl: typeof fetch;

  constructor(
    private readonly opts: OpenAIHttpTTSOptions,
    private readonly outDir: string,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async synthesize(text: string): Promise<SpeechResult> {
    if (!this.opts.apiKey) throw new Error("no api key");
    const base = (this.opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    const res = await this.fetchImpl(`${base}/audio/speech`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.opts.apiKey}` },
      body: JSON.stringify({
        model: this.opts.model ?? "tts-1",
        voice: this.opts.voice ?? "shimmer",
        input: text.slice(0, 3000),
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`openai tts http ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(
      this.outDir,
      `tts_${Date.now()}_${globalThis.crypto.randomUUID().slice(0, 8)}.mp3`,
    );
    fs.writeFileSync(file, buf);
    return {
      path: file,
      provider: this.name,
      format: "mp3",
      fallbackUsed: false,
      voiceCloned: false,
      degraded: false,
      durationEstimateSeconds: estimateSeconds(text),
    };
  }
}

const EDGE_VOICES: Record<TtsLanguage, string> = {
  en: "en-PK-UzmaNeural",
  ur: "ur-PK-UzmaNeural",
  hi: "hi-IN-SwaraNeural",
};

/** Uses the `edge-tts` python CLI (pip install edge-tts). */
export class EdgeTTSProvider implements TTSProvider {
  readonly name = "edge-tts";
  constructor(
    private readonly outDir: string,
    private readonly pythonBin = "python3",
  ) {}

  available(): boolean {
    try {
      const require2 = createRequire(import.meta.url);
      // The CLI may be on PATH even if the module is not importable here.
      return fs.existsSync(this.pythonBin) || require2.resolve("edge-tts") !== "";
    } catch {
      return false;
    }
  }

  synthesize(text: string, language: TtsLanguage): Promise<SpeechResult> {
    const out = path.join(
      this.outDir,
      `tts_${Date.now()}_${globalThis.crypto.randomUUID().slice(0, 8)}.mp3`,
    );
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.pythonBin,
        [
          "-m",
          "edge_tts",
          "--voice",
          EDGE_VOICES[language],
          "--text",
          text.slice(0, 2000),
          "--write-media",
          out,
        ],
        {
          stdio: "ignore",
        },
      );
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("edge-tts timeout"));
      }, 45_000);
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 512) {
          resolve({
            path: out,
            provider: this.name,
            format: "mp3",
            fallbackUsed: false,
            voiceCloned: false,
            degraded: false,
            durationEstimateSeconds: estimateSeconds(text),
          });
        } else reject(new Error(`edge-tts exit ${code}`));
      });
    });
  }
}

export interface PiperOptions {
  voicePath: string; // .onnx
  binary?: string; // piper executable; default `piper`
}

/** Local Piper neural voice (https://github.com/rhasspy/piper). */
export class PiperTTSProvider implements TTSProvider {
  readonly name = "piper";

  constructor(
    private readonly opts: PiperOptions,
    private readonly outDir: string,
  ) {}

  available(): boolean {
    return fs.existsSync(this.opts.voicePath);
  }

  synthesize(text: string): Promise<SpeechResult> {
    const out = path.join(
      this.outDir,
      `tts_${Date.now()}_${globalThis.crypto.randomUUID().slice(0, 8)}.wav`,
    );
    return new Promise((resolve, reject) => {
      const proc = spawn(
        this.opts.binary ?? "piper",
        ["--model", this.opts.voicePath, "--output_file", out],
        { stdio: ["pipe", "ignore", "pipe"] },
      );
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        reject(new Error("piper timeout"));
      }, 60_000);
      let stderr = "";
      proc.stderr?.on("data", (d) => (stderr += String(d)));
      proc.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      proc.on("exit", (code) => {
        clearTimeout(timer);
        if (code === 0 && fs.existsSync(out) && fs.statSync(out).size > 512) {
          resolve({
            path: out,
            provider: this.name,
            format: "wav",
            fallbackUsed: false,
            voiceCloned: false,
            degraded: false,
            durationEstimateSeconds: estimateSeconds(text),
          });
        } else reject(new Error(`piper exit ${code}: ${stderr.slice(0, 100)}`));
      });
      proc.stdin?.end(text.slice(0, 3000));
    });
  }
}

/**
 * Bundled offline fallback (meSpeak/eSpeak NG compiled for Node). Quality is
 * robotic — flagged degraded=true so the dashboard always labels it.
 */
interface MespeakModule {
  loadConfig(config: unknown): void;
  loadVoice(voice: unknown): void;
  speak(text: string, opts: Record<string, unknown>): Uint8Array | null;
}

export class MeSpeakTTSProvider implements TTSProvider {
  readonly name = "mespeak-offline";
  private loaded = false;
  private engine: MespeakModule | null = null;

  constructor(private readonly outDir: string) {}

  available(): boolean {
    try {
      const require2 = createRequire(import.meta.url);
      require2.resolve("mespeak");
      return true;
    } catch {
      return false;
    }
  }

  private ensureLoaded(): boolean {
    if (this.loaded && this.engine) return true;
    try {
      const require2 = createRequire(import.meta.url);
      const meSpeak = require2("mespeak") as MespeakModule;
      const fsOk = fs.readFileSync;
      meSpeak.loadConfig(
        JSON.parse(fsOk(require2.resolve("mespeak/src/mespeak_config.json"), "utf8")),
      );
      // Female-ish variant per language via espeak voice variants.
      meSpeak.loadVoice(JSON.parse(fsOk(require2.resolve("mespeak/voices/en/en-us.json"), "utf8")));
      this.engine = meSpeak;
      this.loaded = true;
      return true;
    } catch (err) {
      log.warn({ err: String(err).slice(0, 120) }, "mespeak unavailable");
      return false;
    }
  }

  synthesize(text: string, language: TtsLanguage): Promise<SpeechResult> {
    if (!this.ensureLoaded() || !this.engine)
      return Promise.reject(new Error("mespeak unavailable"));
    const spoken = language === "ur" ? text : text; // latin fallback: Urdu script is romanized poorly by espeak; captions carry meaning
    const wav = this.engine.speak(spoken.slice(0, 800), {
      rawdata: "buffer",
      variant: "f2",
      speed: 172,
      pitch: 55,
    } as Record<string, unknown>);
    if (!wav || wav.byteLength < 512) return Promise.reject(new Error("mespeak produced no audio"));
    const file = path.join(
      this.outDir,
      `tts_${Date.now()}_${globalThis.crypto.randomUUID().slice(0, 8)}.wav`,
    );
    fs.writeFileSync(file, Buffer.from(wav));
    return Promise.resolve({
      path: file,
      provider: this.name,
      format: "wav",
      fallbackUsed: true,
      voiceCloned: false,
      degraded: true,
      durationEstimateSeconds: estimateSeconds(text),
    });
  }
}

export interface TTSChainResult extends SpeechResult {
  /** null when every provider failed → captions-only mode. */
  attempted: string[];
}

export class TTSChain implements TTSProvider {
  readonly name: string;

  constructor(private readonly chain: TTSProvider[]) {
    this.name = chain.map((p) => p.name).join(" → ") || "captions-only";
  }

  async synthesize(text: string, language: TtsLanguage = "en"): Promise<TTSChainResult> {
    const attempted: string[] = [];
    for (const provider of this.chain) {
      try {
        const res = await provider.synthesize(text, language);
        if (attempted.length > 0)
          log.warn({ attempted, used: provider.name }, "tts fallback engaged");
        const degradedByName =
          provider.name.includes("mespeak") || provider.name === "captions-only";
        return {
          ...res,
          fallbackUsed: res.fallbackUsed || attempted.length > 0,
          degraded: res.degraded || degradedByName,
          attempted,
        };
      } catch (err) {
        attempted.push(provider.name);
        log.warn(
          { provider: provider.name, err: String(err).slice(0, 100) },
          "tts provider failed",
        );
      }
    }
    // Captions-only: honest degradation.
    return {
      path: "",
      provider: "captions-only",
      format: "none",
      fallbackUsed: true,
      voiceCloned: false,
      degraded: true,
      durationEstimateSeconds: 0,
      attempted,
    };
  }
}

export function resolveTTSChain(opts: {
  engineBaseUrl?: string | null;
  engineVoiceId?: string | null;
  openaiApiKey?: string | null;
  openaiBaseUrl?: string | null;
  edgePython?: string | null;
  piperVoicePath?: string | null;
  piperBinary?: string | null;
  outDir: string;
  includeOfflineFallback?: boolean;
}): { chain: TTSProvider; primary: string | null; degradedDefault: boolean } {
  const providers: TTSProvider[] = [];
  if (opts.engineBaseUrl) {
    providers.push(
      new EngineTTSProvider({ baseUrl: opts.engineBaseUrl, voiceId: opts.engineVoiceId ?? null }),
    );
  }
  if (opts.openaiApiKey) {
    providers.push(
      new OpenAITTSProvider(
        { apiKey: opts.openaiApiKey, baseUrl: opts.openaiBaseUrl ?? null },
        opts.outDir,
      ),
    );
  }
  if (opts.edgePython) {
    providers.push(new EdgeTTSProvider(opts.outDir, opts.edgePython));
  }
  if (opts.piperVoicePath) {
    providers.push(
      new PiperTTSProvider(
        { voicePath: opts.piperVoicePath, binary: opts.piperBinary ?? undefined },
        opts.outDir,
      ),
    );
  }
  if (opts.includeOfflineFallback !== false) {
    providers.push(new MeSpeakTTSProvider(opts.outDir));
  }
  return {
    chain: new TTSChain(providers),
    primary: providers[0]?.name ?? null,
    degradedDefault: providers.length === 1 && providers[0] instanceof MeSpeakTTSProvider,
  };
}
