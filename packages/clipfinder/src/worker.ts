/**
 * In-process background worker with a concurrency limit. The DB is the queue:
 * the worker polls for `queued` analysis jobs and render requests, claims them
 * atomically, and runs the pipeline. On boot it recovers jobs interrupted by a
 * restart (marked failed, retryable) and applies retention sweeping.
 */
import fs from "node:fs";
import { createLogger } from "@sara/logger";
import type { SqliteDatabase } from "@sara/db";
import { runAnalysisPipeline, setProgress } from "./pipeline.js";
import { runRenderPipeline } from "./render.js";
import { type ClipFinderStorage } from "./storage.js";
import type {
  ClipFinderOptions,
  MediaTools,
  SceneUnderstandingProvider,
  SpeechToTextProvider,
} from "./types.js";

const log = createLogger({ name: "sara-clipfinder" });

export interface WorkerDeps {
  db: SqliteDatabase;
  storage: ClipFinderStorage;
  media: MediaTools;
  stt: SpeechToTextProvider;
  analyzer: SceneUnderstandingProvider;
  mock: boolean;
  concurrency: number;
  sceneThreshold: number;
  retentionHours: number;
}

const POLL_MS = 1200;
const SWEEP_MS = 6 * 3600 * 1000;

export class ClipFinderWorker {
  private timer: NodeJS.Timeout | null = null;
  private sweepTimer: NodeJS.Timeout | null = null;
  private running = 0;
  private stopped = false;

  constructor(private readonly deps: WorkerDeps) {}

  start(): void {
    try {
      this.recover();
      this.deps.storage.ensureLayout();
      const swept = this.deps.storage.sweepRetention(this.deps.retentionHours);
      if (swept.temp + swept.renders > 0) {
        log.info({ ...swept }, "retention sweep on boot");
      }
    } catch (err) {
      log.warn(
        { err: err instanceof Error ? err.message : String(err) },
        "clip finder worker disabled (database unavailable)",
      );
      return; // no polling loop when the DB layer is unavailable
    }
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref();
    this.sweepTimer = setInterval(() => {
      const result = this.deps.storage.sweepRetention(this.deps.retentionHours);
      if (result.temp + result.renders > 0) log.info({ ...result }, "retention sweep");
    }, SWEEP_MS);
    this.sweepTimer.unref();
    log.info({ concurrency: this.deps.concurrency }, "clip finder worker started");
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.sweepTimer !== null) clearInterval(this.sweepTimer);
    log.info("clip finder worker stopped");
  }

  /** Jobs stuck mid-flight from a previous process become retryable failures. */
  private recover(): void {
    const interrupted = this.deps.db
      .prepare(
        "SELECT id FROM clip_finder_jobs WHERE status IN ('processing','transcribing','analyzing','rendering')",
      )
      .all() as Array<{ id: string }>;
    for (const row of interrupted) {
      this.deps.db
        .prepare(
          "UPDATE clip_finder_jobs SET status = 'failed', error = 'Processing was interrupted by a service restart. Retry to continue.', finished_at = ? WHERE id = ?",
        )
        .run(new Date().toISOString(), row.id);
      log.warn({ jobId: row.id }, "recovered interrupted job → failed (retryable)");
    }
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running >= this.deps.concurrency) return;
    try {
      await this.tickInner();
    } catch (err) {
      log.warn({ err: err instanceof Error ? err.message : String(err) }, "worker tick failed");
    }
  }

  private async tickInner(): Promise<void> {
    if (this.stopped || this.running >= this.deps.concurrency) return;
    const render = this.claimRender();
    if (render !== null) {
      this.running += 1;
      void this.runRender(render.id).finally(() => {
        this.running -= 1;
      });
      return;
    }
    const job = this.claimAnalysisJob();
    if (job !== null) {
      this.running += 1;
      void this.runAnalysis(job.id).finally(() => {
        this.running -= 1;
      });
    }
  }

  private claimAnalysisJob(): { id: string } | null {
    const next = this.deps.db
      .prepare(
        "SELECT id FROM clip_finder_jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1",
      )
      .get() as { id: string } | undefined;
    if (next === undefined) return null;
    const result = this.deps.db
      .prepare(
        "UPDATE clip_finder_jobs SET status = 'processing', stage = 'Preparing', updated_at = ? WHERE id = ? AND status = 'queued'",
      )
      .run(new Date().toISOString(), next.id);
    return result.changes > 0 ? next : null;
  }

  private claimRender(): { id: string } | null {
    const next = this.deps.db
      .prepare("SELECT id FROM clip_renders WHERE status = 'queued' ORDER BY created_at LIMIT 1")
      .get() as { id: string } | undefined;
    if (next === undefined) return null;
    const result = this.deps.db
      .prepare(
        "UPDATE clip_renders SET status = 'processing', progress = 5 WHERE id = ? AND status = 'queued'",
      )
      .run(next.id);
    return result.changes > 0 ? next : null;
  }

  private isCancelled(): boolean {
    // Overridden per-run below; kept for interface symmetry.
    return false;
  }

  private async runAnalysis(jobId: string): Promise<void> {
    const db = this.deps.db;
    const job = db.prepare("SELECT * FROM clip_finder_jobs WHERE id = ?").get(jobId) as
      Record<string, unknown> | undefined;
    if (job === undefined) return;
    const source = db
      .prepare("SELECT file_path FROM video_sources WHERE id = ?")
      .get(job.source_id as string) as { file_path: string | null } | undefined;
    if (
      source === undefined ||
      source.file_path === null ||
      !fs.existsSync(source.file_path ?? "")
    ) {
      db.prepare(
        "UPDATE clip_finder_jobs SET status = 'failed', error = 'The source video file is missing from storage.', finished_at = ? WHERE id = ?",
      ).run(new Date().toISOString(), jobId);
      return;
    }
    // The DB status is the cancellation channel: the API flips it to
    // 'cancelled' and the pipeline checks between stages.
    let cancelled = false;
    const checkCancelled = (): boolean => {
      const row = db.prepare("SELECT status FROM clip_finder_jobs WHERE id = ?").get(jobId) as
        { status: string } | undefined;
      return row?.status === "cancelled";
    };
    void this.isCancelled;

    await runAnalysisPipeline({
      db,
      jobId,
      sourcePath: source.file_path,
      options: JSON.parse((job.options_json as string) ?? "{}") as ClipFinderOptions,
      mock: (job.mock as number) === 1,
      sceneThreshold: this.deps.sceneThreshold,
      media: this.deps.media,
      stt: this.deps.stt,
      analyzer: this.deps.analyzer,
      storageAudioPath: () => this.deps.storage.jobArtifactPath(jobId, "audio.wav"),
      storageThumbPath: (i) =>
        this.deps.storage.jobArtifactPath(jobId, `scene-${String(i).padStart(3, "0")}.jpg`),
      storageClipThumbPath: (clipId) =>
        this.deps.storage.jobArtifactPath(jobId, `clip-${clipId}.jpg`),
      onProgress: async (stage) => {
        setProgress(db, jobId, stage);
      },
      shouldCancel: () => {
        if (checkCancelled()) {
          cancelled = true;
          return true;
        }
        return false;
      },
      cancelled: () => {
        cancelled = true;
      },
      failed: () => {
        // status/error already persisted by the pipeline
      },
    });
    void cancelled;
  }

  private async runRender(renderId: string): Promise<void> {
    const db = this.deps.db;
    await runRenderPipeline({
      db,
      renderId,
      storageRenderPath: (extension) => this.deps.storage.renderPath(renderId, extension),
      media: this.deps.media,
      onStatus: async (status, progress) => {
        db.prepare("UPDATE clip_renders SET status = ?, progress = ? WHERE id = ?").run(
          status,
          progress,
          renderId,
        );
      },
      shouldCancel: () => {
        const row = db.prepare("SELECT status FROM clip_renders WHERE id = ?").get(renderId) as
          { status: string } | undefined;
        return row?.status === "cancelled";
      },
    });
  }
}
