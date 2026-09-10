/**
 * Clip Finder domain types. Shared by the pipeline, API routes and dashboard.
 * Times are REAL seconds; durations likewise. Nothing here depends on ffmpeg
 * or any AI vendor — adapters live in providers/.
 */

// ── Job lifecycle ──────────────────────────────────────────────────────────

export type ClipJobStatus =
  | "queued"
  | "processing"
  | "transcribing"
  | "analyzing"
  | "rendering"
  | "completed"
  | "failed"
  | "cancelled";

export type RenderStatus =
  "queued" | "processing" | "rendering" | "completed" | "failed" | "cancelled";

/** Stages shown to the user, with the exact progress percentages they map to. */
export const STAGES = {
  preparing: { progress: 0, label: "Preparing" },
  reading: { progress: 10, label: "Reading video" },
  extractingAudio: { progress: 20, label: "Extracting audio" },
  transcribing: { progress: 35, label: "Transcribing" },
  detectingScenes: { progress: 50, label: "Detecting scenes" },
  understandingScenes: { progress: 65, label: "Understanding scenes" },
  rankingClips: { progress: 75, label: "Ranking clips" },
  generatingSubtitles: { progress: 85, label: "Generating subtitles" },
  renderingPreviews: { progress: 95, label: "Rendering clips" },
  complete: { progress: 100, label: "Complete" },
} as const;

export type StageKey = keyof typeof STAGES;

// ── Input options ──────────────────────────────────────────────────────────

export const ASPECT_RATIOS = ["9:16", "16:9", "1:1"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

export interface ClipFinderOptions {
  clipCount: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  aspectRatio: AspectRatio;
  /** BCP-47 hint for transcription, or "auto". */
  language: string;
  /** Category ids the user cares about; empty = all. */
  categories: string[];
  /** Optional natural-language request, also parsed into criteria. */
  query?: string;
  paddingBeforeSeconds: number;
  paddingAfterSeconds: number;
}

export interface SearchCriteria {
  clipCount?: number;
  minDurationSeconds?: number;
  maxDurationSeconds?: number;
  categories: string[];
  aspectRatio?: AspectRatio;
  unmatched: string[];
}

// ── Transcript ─────────────────────────────────────────────────────────────

export interface TranscriptSegment {
  text: string;
  start: number;
  end: number;
  /** 0..1 where the provider supplies it. */
  confidence?: number;
}

export interface Transcript {
  language: string;
  text: string;
  segments: TranscriptSegment[];
  provider: string;
}

// ── Scenes & analysis dimensions ───────────────────────────────────────────

/** The 14 analysis dimensions, scored 0–100. */
export const DIMENSIONS = [
  "dialogue",
  "emotional",
  "storyImportance",
  "humor",
  "suspense",
  "conflict",
  "surprise",
  "romance",
  "sadness",
  "inspirational",
  "visualActivity",
  "dialogueCompleteness",
  "hook",
  "contextCompleteness",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];
export type DimensionScores = Record<Dimension, number>;

export interface SceneAnalysis {
  scores: DimensionScores;
  overall: number;
  /** Timestamp (seconds) of the emotional/dramatic peak inside the scene. */
  peakTime: number;
  /** One-line human explanation used for clip "Reason". */
  summary: string;
  provider: string;
}

export interface Scene {
  id: string;
  jobId: string;
  sceneIndex: number;
  startTime: number;
  endTime: number;
  duration: number;
  transcriptText: string;
  thumbnailPath: string | null;
  visual: VisualMetadata;
  analysis: SceneAnalysis | null;
}

export interface VisualMetadata {
  /** Scene-change score(s) observed at the boundary, when available. */
  boundaryScore?: number;
  width?: number;
  height?: number;
  avgSceneLevel?: number;
  [key: string]: unknown;
}

// ── Clip candidates ────────────────────────────────────────────────────────

export interface ClipCandidate {
  id: string;
  jobId: string;
  sceneId: string | null;
  rank: number;
  category: string;
  startTime: number;
  endTime: number;
  duration: number;
  score: number;
  reason: string;
  transcriptPreview: string;
  thumbnailPath: string | null;
  selected: boolean;
}

// ── Renders & subtitles ────────────────────────────────────────────────────

export const SUBTITLE_STYLES = ["classic", "modern", "minimal", "large", "shorts"] as const;
export type SubtitleStyle = (typeof SUBTITLE_STYLES)[number];

export const FRAMING_MODES = ["blur-pad", "center-crop"] as const;
export type FramingMode = (typeof FRAMING_MODES)[number];

export interface SubtitleOptions {
  style: SubtitleStyle;
  fontSize: number;
  position: "bottom" | "center" | "top";
  background: boolean;
  uppercase: boolean;
}

export interface RenderOptions {
  aspectRatio: AspectRatio;
  subtitleStyle: SubtitleStyle;
  subtitleOptions: Partial<SubtitleOptions>;
  framing: FramingMode;
  /** Output height for 9:16 (1080 or 720). */
  quality: 1080 | 720;
}

export interface RenderResultPaths {
  outputPath: string;
  srtPath: string;
  jsonPath: string;
  sizeBytes: number;
}

// ── Provider contracts ─────────────────────────────────────────────────────

export interface MediaProbe {
  durationSeconds: number;
  width: number;
  height: number;
  fps: number;
  container: string;
  videoCodec: string | null;
  audioCodec: string | null;
  sizeBytes: number;
}

export interface SceneBoundary {
  time: number;
  score: number;
}

/** All local media operations, abstracted for testability. */
export interface MediaTools {
  probe(filePath: string): Promise<MediaProbe>;
  extractAudio(filePath: string, outputPath: string): Promise<void>;
  detectScenes(filePath: string, threshold: number): Promise<SceneBoundary[]>;
  extractThumbnail(filePath: string, atSeconds: number, outputPath: string): Promise<void>;
  cutClip(input: string, start: number, end: number, output: string): Promise<void>;
  convertAspect(
    input: string,
    output: string,
    aspect: AspectRatio,
    framing: FramingMode,
    quality: 1080 | 720,
  ): Promise<void>;
  burnSubtitles(
    input: string,
    srtPath: string,
    style: SubtitleOptions,
    output: string,
  ): Promise<void>;
}

export interface SpeechToTextProvider {
  readonly name: string;
  readonly mock: boolean;
  transcribe(audioPath: string, language: string): Promise<Transcript>;
}

export interface SceneUnderstandingProvider {
  readonly name: string;
  readonly mock: boolean;
  analyze(scene: {
    transcriptText: string;
    startTime: number;
    endTime: number;
    duration: number;
    visual: VisualMetadata;
  }): Promise<SceneAnalysis>;
}

export interface ClipTitles {
  mock: boolean;
  titles: string[];
  descriptions: string[];
  hashtags: string[];
}

export interface TitleGenerator {
  readonly name: string;
  readonly mock: boolean;
  generate(input: {
    transcript: string;
    reason: string;
    category: string;
    duration: number;
  }): Promise<ClipTitles>;
}

// ── Agent tool ─────────────────────────────────────────────────────────────

export const CLIP_FINDER_SCOPES = {
  READ_VIDEO: "video.read",
  ANALYZE_VIDEO: "video.analyze",
  CREATE_DERIVATIVE: "video.derivative.create",
} as const;

export interface AgentContext {
  /** Granted permission scopes for the caller (operator session or agent run). */
  hasScope(scope: string): boolean;
}

export interface AgentToolResult {
  accepted: boolean;
  jobId?: string;
  status?: ClipJobStatus;
  message: string;
  statusUrl?: string;
}

export interface AgentToolDefinition {
  name: "video_clip_finder";
  description: string;
  requiredScopes: string[];
  renderScopes: string[];
  inputSchema: Record<string, unknown>;
}
