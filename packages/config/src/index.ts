/**
 * @sara/config — the single place where Sara reads environment variables.
 *
 * Convention (docs/CODING_CONVENTIONS.md): no other module may touch
 * `process.env` directly. Configuration is validated with zod, fails fast on
 * startup with precise error messages, and exposes safe defaults.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

// ── Env file loading ───────────────────────────────────────────────────────

/**
 * Parse a `.env`-style file body into key/value pairs.
 * Supports `KEY=VALUE`, comments (#), blank lines, and single/double quotes.
 */
export function parseEnvFile(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue; // not KEY=VALUE — ignore silently (be liberal in what we accept)
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) out[key] = value;
  }
  return out;
}

/**
 * Walk up from `startDir` until a `.env` file is found (monorepo root), load it
 * into `process.env` without overriding values that are already set.
 *
 * Returns the path of the loaded file, or `null` when none exists.
 */
export function loadEnvFileIntoProcess(
  startDir: string = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  let dir = path.resolve(startDir);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(dir, ".env");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const parsed = parseEnvFile(fs.readFileSync(candidate, "utf8"));
      for (const [key, value] of Object.entries(parsed)) {
        if (!(key in env)) env[key] = value;
      }
      return candidate;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

// ── Schemas ────────────────────────────────────────────────────────────────

const NODE_ENV_VALUES = ["development", "test", "production"] as const;
const LOG_LEVELS = ["debug", "info", "warn", "error", "silent"] as const;

const booleanText = z
  .union([z.literal("true"), z.literal("false"), z.literal("")])
  .transform((v) => (v === "" ? undefined : v === "true"))
  .optional();

const csvOrigins = z
  .string()
  .default("")
  .transform((s) =>
    s
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  )
  .refine((list) => list.every((origin) => /^https?:\/\/[^\s]+$/.test(origin)), {
    message: "CORS_ORIGINS entries must be http(s) origins",
  });

export const apiConfigSchema = z.object({
  NODE_ENV: z.enum(NODE_ENV_VALUES).default("development"),
  LOG_LEVEL: z.enum(LOG_LEVELS).default("info"),
  LOG_PRETTY: booleanText,
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().min(1).default("0.0.0.0"),
  CORS_ORIGINS: csvOrigins,
  DATABASE_URL: z.string().min(1).optional(),
  SESSION_SECRET: z.string().min(16).optional(),
  OPERATOR_USERNAME: z.string().min(1).default("operator"),
  OPERATOR_PASSWORD: z.string().min(8).optional(),
});

export const webConfigSchema = z.object({
  API_INTERNAL_URL: z
    .string()
    .default("http://127.0.0.1:4000")
    .refine((v) => /^https?:\/\/[^\s]+$/.test(v), {
      message: "API_INTERNAL_URL must be an http(s) URL",
    }),
  APP_URL: z
    .string()
    .optional()
    .refine((v) => v === undefined || /^https?:\/\/[^\s]+$/.test(v), {
      message: "APP_URL must be an http(s) URL",
    }),
});

// ── Resolved config objects ────────────────────────────────────────────────

export interface ApiConfig {
  env: (typeof NODE_ENV_VALUES)[number];
  isProduction: boolean;
  logLevel: (typeof LOG_LEVELS)[number];
  logPretty: boolean;
  apiPort: number;
  host: string;
  corsOrigins: string[];
  databaseUrl: string | null;
  sessionSecret: string | null;
  operatorUsername: string;
  operatorPassword: string | null;
}

export interface WebConfig {
  apiInternalUrl: string;
  appUrl: string | null;
}

/** Thrown when required configuration is missing or invalid. */
export class ConfigError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/**
 * Load and validate API configuration from `env` (defaults to `process.env`).
 * Never throws for *missing optional* values — those become `null` plus an
 * entry in `warnings` so services can degrade gracefully and say why.
 */
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): {
  config: ApiConfig;
  warnings: string[];
} {
  const parsed = apiConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error));

  const data = parsed.data;
  const warnings: string[] = [];

  const sessionSecret = data.SESSION_SECRET ?? null;
  if (sessionSecret === null) {
    warnings.push(
      "SESSION_SECRET is not set — using an ephemeral per-process secret (sessions reset on restart). Set it before exposing Sara beyond localhost.",
    );
  } else if (/^changeme/i.test(sessionSecret)) {
    warnings.push(
      "SESSION_SECRET still has its placeholder value — generate a real secret (openssl rand -hex 32).",
    );
  }

  const operatorPassword = data.OPERATOR_PASSWORD ?? null;
  if (operatorPassword === null) {
    warnings.push(
      "OPERATOR_PASSWORD is not set — the auth login endpoint is disabled until you configure it.",
    );
  }

  const config: ApiConfig = {
    env: data.NODE_ENV,
    isProduction: data.NODE_ENV === "production",
    logLevel: data.LOG_LEVEL,
    logPretty: data.LOG_PRETTY ?? data.NODE_ENV === "development",
    apiPort: data.API_PORT,
    host: data.HOST,
    corsOrigins: data.CORS_ORIGINS,
    databaseUrl: data.DATABASE_URL ?? null,
    sessionSecret,
    operatorUsername: data.OPERATOR_USERNAME,
    operatorPassword,
  };
  return { config, warnings };
}

/** Load and validate web (dashboard) configuration. */
export function loadWebConfig(env: NodeJS.ProcessEnv = process.env): WebConfig {
  const parsed = webConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error));
  return {
    apiInternalUrl: parsed.data.API_INTERNAL_URL,
    appUrl: parsed.data.APP_URL ?? null,
  };
}

// ── Clip Finder configuration ──────────────────────────────────────────────

export const clipFinderConfigSchema = z.object({
  MOCK_CLIP_FINDER: booleanText,
  CLIP_FINDER_CONCURRENCY: z.coerce.number().int().min(1).max(4).default(1),
  CLIP_FINDER_MAX_UPLOAD_MB: z.coerce.number().min(1).max(4096).default(512),
  CLIP_FINDER_MAX_URL_SIZE_MB: z.coerce.number().min(1).max(4096).default(1024),
  CLIP_FINDER_MAX_DURATION_MIN: z.coerce.number().min(1).max(600).default(120),
  CLIP_FINDER_SCENE_THRESHOLD: z.coerce.number().min(0.05).max(0.95).default(0.3),
  CLIP_FINDER_RETENTION_HOURS: z.coerce.number().min(1).max(8760).default(24),
  CLIP_FINDER_DATA_DIR: z.string().min(1).optional(),
  CLIP_FINDER_FFMPEG_PATH: z.string().min(1).optional(),
  CLIP_FINDER_FFPROBE_PATH: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z
    .string()
    .optional()
    .refine((v) => v === undefined || /^https?:\/\/[^\s]+$/.test(v), {
      message: "OPENAI_BASE_URL must be an http(s) URL",
    }),
  WHISPER_MODEL: z.string().min(1).optional(),
  LLM_MODEL: z.string().min(1).optional(),
});

export interface ClipFinderConfig {
  mock: boolean;
  concurrency: number;
  maxUploadBytes: number;
  maxUrlBytes: number;
  maxDurationMinutes: number;
  sceneThreshold: number;
  retentionHours: number;
  dataDir: string;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  openaiApiKey: string | null;
  openaiBaseUrl: string | null;
  whisperModel: string | null;
  llmModel: string | null;
}

export function loadClipFinderConfig(
  env: NodeJS.ProcessEnv = process.env,
  defaults: { dataDir?: string } = {},
): ClipFinderConfig {
  const parsed = clipFinderConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error));
  const data = parsed.data;
  const hasAiKey = data.OPENAI_API_KEY !== undefined && !data.OPENAI_API_KEY.startsWith("changeme");
  const mock = data.MOCK_CLIP_FINDER ?? !hasAiKey;
  return {
    mock,
    concurrency: data.CLIP_FINDER_CONCURRENCY,
    maxUploadBytes: data.CLIP_FINDER_MAX_UPLOAD_MB * 1024 * 1024,
    maxUrlBytes: data.CLIP_FINDER_MAX_URL_SIZE_MB * 1024 * 1024,
    maxDurationMinutes: data.CLIP_FINDER_MAX_DURATION_MIN,
    sceneThreshold: data.CLIP_FINDER_SCENE_THRESHOLD,
    retentionHours: data.CLIP_FINDER_RETENTION_HOURS,
    dataDir:
      data.CLIP_FINDER_DATA_DIR ??
      defaults.dataDir ??
      path.resolve(process.cwd(), "data/clip-finder"),
    ffmpegPath: data.CLIP_FINDER_FFMPEG_PATH ?? null,
    ffprobePath: data.CLIP_FINDER_FFPROBE_PATH ?? null,
    openaiApiKey: hasAiKey ? (data.OPENAI_API_KEY ?? null) : null,
    openaiBaseUrl: data.OPENAI_BASE_URL ?? null,
    whisperModel: data.WHISPER_MODEL ?? null,
    llmModel: data.LLM_MODEL ?? null,
  };
}

// ── Sara LIVE host configuration ─────────────────────────────────────────────
export const saraConfigSchema = z.object({
  SARA_LLM_PROVIDER: z.enum(["auto", "openai", "anthropic", "ollama", "offline"]).default("auto"),
  SARA_LLM_MODEL: z.string().min(1).optional(),
  SARA_LLM_BASE_URL: z
    .string()
    .optional()
    .refine((v) => v === undefined || /^https?:\/\/[^\s]+$/.test(v), {
      message: "SARA_LLM_BASE_URL must be http(s)",
    }),
  SARA_TTS_ENGINE_URL: z.string().optional(), // AvatarAI engine base URL (Chatterbox)
  SARA_TTS_EDGE_PYTHON: z.string().optional(), // python bin for edge-tts (e.g. /usr/bin/python3)
  SARA_TTS_PIPER_VOICE: z.string().optional(), // path to piper .onnx voice
  SARA_TTS_PIPER_BIN: z.string().optional(),
  SARA_VOICE_ID: z.string().optional(), // cloned-voice id inside the engine
  SARA_AVATAR_ENGINE_URL: z.string().optional(),
  SARA_AVATAR_ID: z.string().optional(),
  SARA_TIKTOK_EVENTS_URL: z
    .string()
    .optional()
    .refine((v) => v === undefined || /^https?:\/\/[^\s]+$/.test(v), {
      message: "SARA_TIKTOK_EVENTS_URL must be http(s)",
    }),
  SARA_TIKTOK_TOKEN: z.string().optional(),
  SARA_SIMULATOR: booleanText.default("true"), // simulator source enabled (dev/verify)
  SARA_MEMORY_ENABLED: booleanText.default("true"),
  SARA_RESPONSES_PER_MINUTE: z.coerce.number().int().min(1).max(60).default(8),
  SARA_AI_DISCLOSURE: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.string().optional(),
});

export interface SaraConfig {
  llmProvider: "auto" | "openai" | "anthropic" | "ollama" | "offline";
  llmModel: string;
  llmBaseUrl: string | null;
  openaiApiKey: string | null;
  anthropicApiKey: string | null;
  ttsEngineUrl: string | null;
  ttsEdgePython: string | null;
  piperVoicePath: string | null;
  piperBinary: string | null;
  voiceId: string | null;
  avatarEngineUrl: string | null;
  avatarId: string | null;
  tiktokEventsUrl: string | null;
  tiktokToken: string | null;
  simulatorEnabled: boolean;
  memoryEnabled: boolean;
  responsesPerMinute: number;
  aiDisclosure: string;
}

function secret(value: string | undefined): string | null {
  return value && !value.startsWith("changeme") ? value : null;
}

export function loadSaraConfig(env: NodeJS.ProcessEnv = process.env): SaraConfig {
  const parsed = saraConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(formatIssues(parsed.error));
  const d = parsed.data;
  const openaiKey = secret(d.OPENAI_API_KEY);
  let provider = d.SARA_LLM_PROVIDER;
  if (provider === "auto") {
    provider = openaiKey
      ? "openai"
      : d.ANTHROPIC_API_KEY
        ? "anthropic"
        : d.SARA_LLM_BASE_URL
          ? "ollama"
          : "offline";
  }
  return {
    llmProvider: provider,
    llmModel:
      d.SARA_LLM_MODEL ??
      (provider === "anthropic"
        ? "claude-sonnet-4-6"
        : provider === "ollama"
          ? "llama3.1"
          : "gpt-4o-mini"),
    llmBaseUrl: d.SARA_LLM_BASE_URL ?? (provider === "ollama" ? "http://localhost:11434/v1" : null),
    openaiApiKey: openaiKey,
    anthropicApiKey: secret(d.ANTHROPIC_API_KEY),
    ttsEngineUrl: d.SARA_TTS_ENGINE_URL ?? d.SARA_AVATAR_ENGINE_URL ?? null,
    ttsEdgePython: d.SARA_TTS_EDGE_PYTHON ?? null,
    piperVoicePath: d.SARA_TTS_PIPER_VOICE ?? null,
    piperBinary: d.SARA_TTS_PIPER_BIN ?? null,
    voiceId: d.SARA_VOICE_ID ?? null,
    avatarEngineUrl: d.SARA_AVATAR_ENGINE_URL ?? null,
    avatarId: d.SARA_AVATAR_ID ?? null,
    tiktokEventsUrl: d.SARA_TIKTOK_EVENTS_URL ?? null,
    tiktokToken: secret(d.SARA_TIKTOK_TOKEN),
    simulatorEnabled: d.SARA_SIMULATOR,
    memoryEnabled: d.SARA_MEMORY_ENABLED,
    responsesPerMinute: d.SARA_RESPONSES_PER_MINUTE,
    aiDisclosure: d.SARA_AI_DISCLOSURE ?? "🤖 Sara is an AI virtual character.",
  };
}
