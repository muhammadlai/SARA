/**
 * Clip Finder service context for the API process: validated config →
 * storage + providers + job manager + worker. Tests inject their own
 * database/providers via buildServer options.
 */
import { loadClipFinderConfig, type ClipFinderConfig } from "@sara/config";
import { getDatabase, isDatabaseConfigured, type SqliteDatabase } from "@sara/db";
import type { DatabaseSync } from "node:sqlite";
import {
  ClipFinderStorage,
  ClipFinderWorker,
  FfmpegMediaTools,
  JobManager,
  resolveProviders,
  VIDEO_CLIP_FINDER_TOOL,
} from "@sara/clipfinder";

export interface ClipFinderContext {
  config: ClipFinderConfig;
  storage: ClipFinderStorage;
  db: SqliteDatabase;
  manager: JobManager;
  worker: ClipFinderWorker;
  providers: ReturnType<typeof resolveProviders>;
  tool: typeof VIDEO_CLIP_FINDER_TOOL;
}

/**
 * A database proxy that only opens the real connection on first use, so the
 * API stays runnable (Clip Finder simply disabled) when DATABASE_URL is not
 * configured — matching the project's graceful-degradation philosophy.
 */
function lazyDatabase(): SqliteDatabase {
  let real: DatabaseSync | null = null;
  return new Proxy({} as DatabaseSync, {
    get(_target, prop) {
      if (real === null) real = getDatabase();
      const value = Reflect.get(real as object, prop);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

export function createClipFinderContext(
  overrides: Partial<
    Pick<ClipFinderConfig, "mock" | "dataDir" | "ffmpegPath" | "ffprobePath">
  > = {},
  deps: { db?: SqliteDatabase; fetchImpl?: typeof fetch } = {},
): ClipFinderContext {
  const config = loadClipFinderConfig(process.env, {
    dataDir: overrides.dataDir,
  });
  if (overrides.mock !== undefined) {
    config.mock = overrides.mock;
  }
  const storage = new ClipFinderStorage(config.dataDir);
  storage.ensureLayout();
  const db = deps.db ?? (isDatabaseConfigured() ? getDatabase() : lazyDatabase());
  const providers = resolveProviders({
    mockClipFinder: config.mock,
    sttProvider: process.env.STT_PROVIDER ?? null,
    openaiApiKey: config.openaiApiKey,
    openaiBaseUrl: config.openaiBaseUrl,
    whisperModel: config.whisperModel,
    llmModel: config.llmModel,
  });
  // Respect explicit ffmpeg paths from validated config.
  const media =
    config.ffmpegPath !== null || config.ffprobePath !== null
      ? new FfmpegMediaTools({
          ffmpegPath: config.ffmpegPath ?? undefined,
          ffprobePath: config.ffprobePath ?? undefined,
        })
      : providers.media;
  const manager = new JobManager({
    db,
    storage,
    maxUploadBytes: config.maxUploadBytes,
    maxUrlBytes: config.maxUrlBytes,
    mock: providers.mock,
    fetchImpl: deps.fetchImpl,
  });
  const worker = new ClipFinderWorker({
    db,
    storage,
    media,
    stt: providers.stt,
    analyzer: providers.analyzer,
    mock: providers.mock,
    concurrency: config.concurrency,
    sceneThreshold: config.sceneThreshold,
    retentionHours: config.retentionHours,
  });
  return {
    config,
    storage,
    db,
    manager,
    worker,
    providers: { ...providers, media },
    tool: VIDEO_CLIP_FINDER_TOOL,
  };
}
