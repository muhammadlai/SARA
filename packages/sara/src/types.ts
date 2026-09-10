/**
 * Sara AI — virtual LIVE host domain types.
 *
 * The control plane treats every external system (LLM, TTS, STT, avatar,
 * TikTok, memory) as a replaceable adapter. Nothing here imports a specific
 * vendor SDK; providers implement these interfaces and are resolved from
 * validated configuration at boot.
 */

// ── Languages ────────────────────────────────────────────────────────────────
export type SaraLanguage = "en" | "ur" | "hi" | "roman-ur" | "mixed";

/** UI/translation codes used for TTS voice selection. */
export type TtsLanguage = "en" | "ur" | "hi";

// ── Emotions (simulated character states — never claimed as real feelings) ──
export type SaraEmotion =
  | "neutral"
  | "happy"
  | "excited"
  | "surprised"
  | "sad"
  | "confused"
  | "curious"
  | "playful"
  | "thankful"
  | "calm"
  | "thinking";

// ── Personality ──────────────────────────────────────────────────────────────
export interface SaraPersonalityConfig {
  name: string;
  tagline: string;
  warmth: number; // 0-1
  humor: number; // 0-1
  energy: number; // 0-1 (LIVE enthusiasm)
  formality: number; // 0-1
  responseLength: "short" | "medium" | "long";
  maxSentenceWords: number;
  emojiRate: number; // 0-1
  greetingStyle: "warm" | "energetic" | "calm";
  languages: SaraLanguage[];
  defaultLanguage: SaraLanguage;
  speaksAboutSelfAsAI: boolean; // must stay true in production
}

// ── Live events ──────────────────────────────────────────────────────────────
export type LiveEventKind =
  | "comment"
  | "follow"
  | "unfollow"
  | "gift"
  | "share"
  | "join"
  | "leave"
  | "like"
  | "battle_start"
  | "battle_update"
  | "battle_end"
  | "system";

export interface LiveEvent {
  id: string;
  kind: LiveEventKind;
  platform: string;
  username?: string;
  /** Platform-side unique user id (stable across renames). */
  userId?: string;
  text?: string;
  giftName?: string;
  giftCount?: number;
  battle?: BattleSnapshot;
  at: string;
}

export interface BattleSnapshot {
  state: "started" | "update" | "ended";
  opponent?: string;
  myScore?: number;
  opponentScore?: number;
}

export type ModerationAction = "allow" | "flag" | "reject" | "escalate";

export interface ModerationVerdict {
  action: ModerationAction;
  categories: string[];
  score: number;
  reason?: string;
  /** Which rules matched (rule ids) — audit without exposing slur lists. */
  matchedRules: string[];
}

// ── Memory ───────────────────────────────────────────────────────────────────
export type MemoryKind = "fact" | "preference" | "interaction" | "context";

export interface MemoryRecord {
  id: string;
  viewerId: string | null;
  kind: MemoryKind;
  content: string;
  salience: number;
  createdAt: string;
  updatedAt: string;
}

export interface ViewerRecord {
  id: string;
  platform: string;
  platformUserId: string;
  displayName: string;
  firstSeenAt: string;
  lastSeenAt: string;
  interactionCount: number;
  isFollower: boolean;
  isRegular: boolean;
  language: SaraLanguage | null;
}

// ── Comment queue ────────────────────────────────────────────────────────────
export type QueuePriority = 1 | 2 | 3 | 4 | 5; // 1 = highest

export interface QueuedComment {
  id: string;
  event: LiveEvent;
  priority: QueuePriority;
  queuedAt: string;
  reason: string;
}

export interface CommentQueueLimits {
  maxPerMinute: number;
  perViewerCooldownSeconds: number;
  duplicateWindowSeconds: number;
  minPriority: QueuePriority;
  queueMaxLength: number;
}

// ── Providers ────────────────────────────────────────────────────────────────
export interface ChatTurn {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface BrainReply {
  text: string;
  provider: string;
  fallbackUsed: boolean;
}

export interface LLMProvider {
  readonly name: string;
  complete(
    turns: ChatTurn[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<BrainReply>;
}

export interface SpeechResult {
  path: string;
  provider: string;
  format: string;
  fallbackUsed: boolean;
  voiceCloned: boolean;
  /** True when the output is the offline robotic fallback, not a natural voice. */
  degraded: boolean;
  durationEstimateSeconds: number;
}

export interface TTSProvider {
  readonly name: string;
  synthesize(text: string, language: TtsLanguage, opts?: { speed?: number }): Promise<SpeechResult>;
}

export type AvatarCapability = "photo" | "lipsync" | "expressions";

export interface AvatarFrameRequest {
  text: string;
  audioPath?: string;
  emotion: SaraEmotion;
}

export interface AvatarRender {
  mode: "engine-lipsync" | "photo" | "unavailable";
  /** URL the dashboard can load (engine video, portrait image, etc). */
  assetUrl: string | null;
  capabilities: AvatarCapability[];
  provider: string;
  note?: string;
}

export interface AvatarProvider {
  readonly name: string;
  capabilities(): AvatarCapability[];
  render(req: AvatarFrameRequest): Promise<AvatarRender>;
}

export type STTProviderName = string;

export interface STTProvider {
  readonly name: STTProviderName;
  transcribe(
    audioPath: string,
    language?: TtsLanguage,
  ): Promise<{ text: string; language: TtsLanguage }>;
}

// ── TikTok integration (official-only) ───────────────────────────────────────
export interface LiveEventSource {
  readonly name: string;
  /** true when actually connected to a real platform right now. */
  readonly connected: boolean;
  readonly platform: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Poll-free push consumer for normalized events. */
  onEvent(handler: (event: LiveEvent) => void): void;
  status(): SourceStatus;
}

export interface SourceStatus {
  connected: boolean;
  detail: string;
  /** "official" = real authorized connection; "simulator" = synthetic; "unavailable" = configured but not connected. */
  mode: "official" | "simulator" | "unavailable";
  lastEventAt: string | null;
  reconnects: number;
}

// ── Session / control plane ──────────────────────────────────────────────────
export type LiveSessionState =
  "idle" | "starting" | "live" | "paused" | "takeover" | "muted" | "stopped" | "error";

export interface LiveStatus {
  state: LiveSessionState;
  platform: string;
  session: { id: string; startedAt: string | null } | null;
  sources: SourceStatus[];
  brain: { provider: string; fallback: string | null };
  tts: { provider: string; degraded: boolean };
  avatar: { provider: string; capabilities: AvatarCapability[] };
  queue: { depth: number; responsesPerMinute: number };
  metrics: LiveMetrics;
  aiDisclosure: string;
}

export interface LiveMetrics {
  uptimeSeconds: number;
  comments: number;
  responses: number;
  rejectedComments: number;
  events: number;
  errors: number;
  reconnects: number;
  avgResponseLatencyMs: number;
  tokensUsed: number | null;
}

export interface SaraControlSettings {
  responsesPerMinute: number;
  perViewerCooldownSeconds: number;
  duplicateWindowSeconds: number;
  minPriority: QueuePriority;
  moderationStrictness: "relaxed" | "standard" | "strict";
  autoGreetJoins: boolean;
  thankGifts: boolean;
  welcomeFollows: boolean;
  memoryEnabled: boolean;
  aiDisclosure: string;
}

// ── Health ───────────────────────────────────────────────────────────────────
export interface ComponentHealth {
  component: string;
  healthy: boolean;
  degraded: boolean;
  detail: string;
  since: string;
  lastCheckedAt: string;
}

export interface SystemSnapshot {
  overall: "healthy" | "degraded" | "failing";
  components: ComponentHealth[];
  process: {
    uptimeSeconds: number;
    memoryMb: number;
    cpuPercent: number | null;
    nodeVersion: string;
  };
}

// ── Feed (dashboard) ─────────────────────────────────────────────────────────
export interface FeedItem {
  id: string;
  at: string;
  kind: "viewer" | "sara" | "operator" | "system" | "event" | "moderation" | "error" | "status";
  text: string;
  username?: string;
  emotion?: SaraEmotion;
  audioUrl?: string;
  avatar?: AvatarRender | null;
  meta?: Record<string, unknown>;
}
