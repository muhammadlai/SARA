/**
 * @sara/clipfinder — public API of the AI Drama Clip Finder module.
 */
export * from "./types.js";
export {
  clipFinderOptionsSchema,
  renderOptionsSchema,
  patchClipSchema,
  searchSchema,
  resolvedOptionsSchema,
  CLIP_CATEGORIES,
  CLIP_CATEGORY_LABELS,
} from "./schema.js";
export type { ParsedRenderOptions } from "./schema.js";
export {
  DIMENSION_WEIGHTS,
  overallScore,
  buildAnalysis,
  sanitizeScores,
  durationFitBonus,
} from "./scoring.js";
export { categoryScore, bestCategory, resolveCategories, CATEGORY_PROFILES } from "./categories.js";
export { parseSearchQuery, describeCriteria } from "./nl-search.js";
export { computeClipBoundary, transcriptForWindow } from "./boundaries.js";
export { iou, isDuplicate } from "./dedupe.js";
export { rankScenes } from "./ranking.js";
export {
  generateSrt,
  cuesToSrt,
  buildCues,
  subtitleStyleToAss,
  resolveSubtitleOptions,
  DEFAULT_SUBTITLE_OPTIONS,
} from "./subtitles.js";
export { validateSourceUrl, hasVideoExtension, looksLikeVideoMime } from "./ssrf.js";
export { ClipFinderStorage } from "./storage.js";
export { FfmpegMediaTools } from "./providers/ffmpeg.js";
export { isWhisperConfigured, WhisperSTTProvider } from "./providers/whisper.js";
export { LlmSceneAnalyzer, LlmTitleGenerator } from "./providers/llm.js";
export { resolveProviders, type ProviderEnv, type ResolvedProviders } from "./providers/resolve.js";
export {
  MockSTTProvider,
  MockSceneAnalyzer,
  MockTitleGenerator,
  retimedMockTranscript,
  MOCK_PROVIDER_TAG,
} from "./providers/mock.js";
export { runAnalysisPipeline, buildSceneWindows, setProgress } from "./pipeline.js";
export { runRenderPipeline, generateCommentarySrt, COPYRIGHT_NOTICE } from "./render.js";
export { JobManager, SourceRejectedError, DuplicateJobError } from "./jobs.js";
export { ClipFinderWorker, type WorkerDeps } from "./worker.js";
export {
  VIDEO_CLIP_FINDER_TOOL,
  invokeClipFinderTool,
  parseClipFinderUtterance,
} from "./agent-tool.js";
