/**
 * JobManager — Clip Finder job lifecycle on top of @sara/db (node:sqlite):
 * creation from URL/upload (with SSRF + duplicate guards), progress-aware
 * views, cancel/retry/delete, clip queries, NL search, subtitle handling and
 * render requests. All external work happens in the worker, never in HTTP.
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@sara/logger";
import type { SqliteDatabase } from "@sara/db";
import { parseSearchQuery, describeCriteria } from "./nl-search.js";
import { generateSrt } from "./subtitles.js";
import { validateSourceUrl, looksLikeVideoMime } from "./ssrf.js";
import type { ClipFinderOptions, TranscriptSegment } from "./types.js";
import type { ClipFinderStorage } from "./storage.js";
import { clipFinderOptionsSchema, renderOptionsSchema, CLIP_CATEGORY_LABELS } from "./schema.js";
import { COPYRIGHT_NOTICE } from "./render.js";

const log = createLogger({ name: "sara-clipfinder" });

const ACTIVE_STATUSES = new Set(["queued", "processing", "transcribing", "analyzing", "rendering"]);

function now(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export interface JobManagerDeps {
  db: SqliteDatabase;
  storage: ClipFinderStorage;
  maxUploadBytes: number;
  maxUrlBytes: number;
  /** Whether AI providers are mocked — persisted so the UI can label results. */
  mock?: boolean;
  /** Fetch implementation (injectable for tests). */
  fetchImpl?: typeof fetch;
}

export class SourceRejectedError extends Error {
  constructor(
    message: string,
    readonly userFacing: boolean = true,
  ) {
    super(message);
    this.name = "SourceRejectedError";
  }
}

export class DuplicateJobError extends Error {
  constructor(
    message: string,
    readonly jobId: string,
  ) {
    super(message);
    this.name = "DuplicateJobError";
  }
}

export class JobManager {
  private readonly fetchImpl: typeof fetch;
  private readonly mock: boolean;

  constructor(private readonly deps: JobManagerDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.mock = deps.mock ?? false;
  }

  private get db(): SqliteDatabase {
    return this.deps.db;
  }

  // ── Creation ─────────────────────────────────────────────────────────────

  async createJobFromUrl(
    rawUrl: string,
    rawOptions: unknown,
  ): Promise<{ jobId: string; options: ClipFinderOptions }> {
    const options = clipFinderOptionsSchema.parse(rawOptions ?? {}) as ClipFinderOptions;
    const check = validateSourceUrl(rawUrl);
    if (!check.ok || check.url === undefined) {
      throw new SourceRejectedError(check.reason ?? "Invalid URL.");
    }

    // Duplicate guard: one active job per identical URL.
    const dup = this.db
      .prepare(
        `SELECT j.id FROM clip_finder_jobs j JOIN video_sources s ON s.id = j.source_id
         WHERE s.url = ? AND j.status IN ('queued','processing','transcribing','analyzing','rendering')`,
      )
      .get(check.url.toString()) as { id: string } | undefined;
    if (dup !== undefined) {
      throw new DuplicateJobError(
        "A job for this exact video URL is already queued or running.",
        dup.id,
      );
    }

    const sourceId = newId("src");
    const tempPath = this.deps.storage.sourcePath(sourceId, ".download");
    log.info({ url: check.url.toString() }, "downloading source video");

    let response: Response;
    try {
      response = await this.fetchWithRedirectGuards(check.url);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new SourceRejectedError(
        message.includes("timed out")
          ? "The video server took too long to respond — try again or use a smaller file."
          : `Could not reach the video URL: ${message}`,
      );
    }
    if (!response.ok) {
      throw new SourceRejectedError(
        response.status === 401 || response.status === 403
          ? "The video is not publicly accessible (authentication/permission required). Sara does not bypass access restrictions."
          : response.status === 404
            ? "The video URL returned 404 — the file does not exist (or is private)."
            : `The video server responded with HTTP ${response.status}.`,
      );
    }
    const mime = response.headers.get("content-type");
    if (mime !== null && !looksLikeVideoMime(mime)) {
      throw new SourceRejectedError(
        `The URL does not look like a video (content-type "${mime}"). Direct links to video files are required.`,
      );
    }
    const contentLength = Number.parseInt(response.headers.get("content-length") ?? "0", 10);
    if (contentLength > this.deps.maxUrlBytes) {
      throw new SourceRejectedError(
        `The file is too large (${Math.round(contentLength / 1e6)} MB). Limit is ${Math.round(this.deps.maxUrlBytes / 1e6)} MB.`,
      );
    }

    try {
      await this.downloadToFile(response, tempPath, this.deps.maxUrlBytes);
    } catch (err) {
      fs.rmSync(tempPath, { force: true });
      const message = err instanceof Error ? err.message : String(err);
      throw new SourceRejectedError(
        message.includes("too large") ? message : `Download failed: ${message}`,
      );
    }

    const size = fs.statSync(tempPath).size;
    const finalPath = `${tempPath.slice(0, -".download".length)}.bin`;
    fs.renameSync(tempPath, finalPath);
    this.db
      .prepare(
        "INSERT INTO video_sources (id, kind, url, file_path, size_bytes, status) VALUES (?, 'url', ?, ?, ?, 'ready')",
      )
      .run(sourceId, check.url.toString(), finalPath, size);
    return { jobId: this.insertJob(sourceId, options), options };
  }

  createJobFromUpload(
    upload: { tmpPath: string; originalName: string; sizeBytes: number },
    rawOptions: unknown,
  ): { jobId: string; options: ClipFinderOptions } {
    const options = clipFinderOptionsSchema.parse(rawOptions ?? {}) as ClipFinderOptions;
    if (upload.sizeBytes > this.deps.maxUploadBytes) {
      fs.rmSync(upload.tmpPath, { force: true });
      throw new SourceRejectedError(
        `The uploaded file is too large (${Math.round(upload.sizeBytes / 1e6)} MB). Limit is ${Math.round(this.deps.maxUploadBytes / 1e6)} MB.`,
      );
    }
    // Duplicate guard: identical active upload (name + size).
    const dup = this.db
      .prepare(
        `SELECT j.id FROM clip_finder_jobs j JOIN video_sources s ON s.id = j.source_id
         WHERE s.kind = 'upload' AND s.original_name = ? AND s.size_bytes = ?
           AND j.status IN ('queued','processing','transcribing','analyzing','rendering')`,
      )
      .get(upload.originalName, upload.sizeBytes) as { id: string } | undefined;
    if (dup !== undefined) {
      fs.rmSync(upload.tmpPath, { force: true });
      throw new DuplicateJobError("An identical upload is already queued or running.", dup.id);
    }

    const sourceId = newId("src");
    const ext = path.extname(upload.originalName).toLowerCase() || ".bin";
    const finalPath = this.deps.storage.sourcePath(sourceId, ext);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.renameSync(upload.tmpPath, finalPath);
    this.db
      .prepare(
        "INSERT INTO video_sources (id, kind, url, file_path, original_name, size_bytes, status) VALUES (?, 'upload', NULL, ?, ?, ?, 'ready')",
      )
      .run(sourceId, finalPath, upload.originalName, upload.sizeBytes);
    return { jobId: this.insertJob(sourceId, options), options };
  }

  private insertJob(sourceId: string, options: ClipFinderOptions): string {
    const jobId = newId("job");
    this.db
      .prepare(
        "INSERT INTO clip_finder_jobs (id, source_id, status, progress, stage, options_json, mock) VALUES (?, ?, 'queued', 0, 'Preparing', ?, ?)",
      )
      .run(jobId, sourceId, JSON.stringify(options), this.mock ? 1 : 0);
    log.info({ jobId, sourceId }, "clip finder job created");
    return jobId;
  }

  private async fetchWithRedirectGuards(url: URL, depth = 0): Promise<Response> {
    if (depth > 3) throw new SourceRejectedError("Too many redirects while fetching the video.");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await this.fetchImpl(url, {
        signal: controller.signal,
        redirect: "manual",
        // Never attach credentials of any kind.
        headers: { "user-agent": "SaraClipFinder/0.3 (+self-hosted)" },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (location === null) throw new SourceRejectedError("Redirect without a destination.");
        const next = new URL(location, url);
        const guard = validateSourceUrl(next.toString());
        if (!guard.ok) throw new SourceRejectedError(guard.reason ?? "Redirect blocked.");
        return this.fetchWithRedirectGuards(guard.url as URL, depth + 1);
      }
      return res;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async downloadToFile(
    response: Response,
    target: string,
    maxBytes: number,
  ): Promise<void> {
    if (response.body === null) throw new SourceRejectedError("Empty response body.");
    let written = 0;
    const reader = response.body.getReader();
    const out = fs.createWriteStream(target);
    out.on("error", () => {
      // Late flush errors (e.g. cleanup raced the stream) must not crash the process.
    });
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      written += value.byteLength;
      if (written > maxBytes) {
        reader.cancel().catch(() => {});
        out.destroy();
        throw new SourceRejectedError(
          `The file is too large (over ${Math.round(maxBytes / 1e6)} MB while downloading).`,
        );
      }
      if (!out.write(Buffer.from(value))) {
        await new Promise<void>((resolve) => out.once("drain", resolve));
      }
    }
    await new Promise<void>((resolve, reject) =>
      out.end((err?: Error | null) => (err ? reject(err) : resolve())),
    );
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  getJob(jobId: string): Record<string, unknown> | null {
    const job = this.db.prepare("SELECT * FROM clip_finder_jobs WHERE id = ?").get(jobId) as
      Record<string, unknown> | undefined;
    if (job === undefined) return null;
    return this.jobView(job);
  }

  listJobs(limit = 50): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare("SELECT * FROM clip_finder_jobs ORDER BY created_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((row) => this.jobView(row));
  }

  private jobView(job: Record<string, unknown>): Record<string, unknown> {
    const source = this.db
      .prepare("SELECT * FROM video_sources WHERE id = ?")
      .get(job.source_id as string) as Record<string, unknown> | undefined;
    const counts = this.db
      .prepare("SELECT COUNT(*) AS n FROM clip_candidates WHERE job_id = ?")
      .get(job.id as string) as { n: number };
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      stage: job.stage,
      error: job.error,
      mock: (job.mock as number) === 1,
      options: JSON.parse((job.options_json as string) ?? "{}"),
      counts: { clips: counts.n },
      source: source
        ? {
            id: source.id,
            kind: source.kind,
            url: source.url,
            originalName: source.original_name,
            sizeBytes: source.size_bytes,
            durationSeconds: source.duration_seconds,
            width: source.width,
            height: source.height,
            fps: source.fps,
            container: source.container,
            videoCodec: source.video_codec,
            audioCodec: source.audio_codec,
          }
        : null,
      createdAt: job.created_at,
      updatedAt: job.updated_at,
      finishedAt: job.finished_at,
    };
  }

  getClips(
    jobId: string,
    filter: { category?: string; sort?: "score" | "duration" | "category" | "rank" } = {},
  ): Array<Record<string, unknown>> {
    const rows = this.db
      .prepare("SELECT * FROM clip_candidates WHERE job_id = ?")
      .all(jobId) as Array<Record<string, unknown>>;
    let clips = rows.map((row) => this.clipView(row));
    if (filter.category !== undefined) {
      clips = clips.filter((c) => c.category === filter.category);
    }
    const sort = filter.sort ?? "rank";
    clips.sort((a, b) => {
      if (sort === "score") return (b.score as number) - (a.score as number);
      if (sort === "duration") return (b.duration as number) - (a.duration as number);
      if (sort === "category")
        return (
          String(a.category).localeCompare(String(b.category)) ||
          (a.rank as number) - (b.rank as number)
        );
      return (a.rank as number) - (b.rank as number);
    });
    return clips;
  }

  getClip(clipId: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT * FROM clip_candidates WHERE id = ?").get(clipId) as
      Record<string, unknown> | undefined;
    return row === undefined ? null : this.clipView(row);
  }

  private clipView(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: row.id,
      jobId: row.job_id,
      rank: row.rank,
      category: row.category,
      categoryLabel:
        CLIP_CATEGORY_LABELS[row.category as keyof typeof CLIP_CATEGORY_LABELS] ?? row.category,
      startTime: row.start_time,
      endTime: row.end_time,
      duration: row.duration,
      score: row.score,
      reason: row.reason,
      transcriptPreview: row.transcript_preview,
      selected: (row.selected as number) === 1,
      hasThumbnail: row.thumbnail_path !== null,
      createdAt: row.created_at,
    };
  }

  searchClips(jobId: string, query: string): Record<string, unknown> | null {
    const job = this.getJob(jobId);
    if (job === null) return null;
    const criteria = parseSearchQuery(query);
    const all = this.getClips(jobId, { sort: "score" });
    let clips = all;
    if (criteria.categories.length > 0) {
      const wanted = new Set(criteria.categories);
      const matching = clips.filter((c) => wanted.has(c.category as string));
      if (matching.length > 0) clips = matching;
    }
    if (criteria.minDurationSeconds !== undefined) {
      const filtered = clips.filter((c) => (c.duration as number) >= criteria.minDurationSeconds!);
      if (filtered.length > 0) clips = filtered;
    }
    if (criteria.maxDurationSeconds !== undefined) {
      const filtered = clips.filter((c) => (c.duration as number) <= criteria.maxDurationSeconds!);
      if (filtered.length > 0) clips = filtered;
    }
    if (criteria.clipCount !== undefined) clips = clips.slice(0, criteria.clipCount);
    return {
      jobId,
      query,
      criteria,
      criteriaDescription: describeCriteria(criteria),
      mock: job.mock,
      results: clips.map((clip, index) => ({ ...clip, rank: index + 1 })),
    };
  }

  // ── Mutations ────────────────────────────────────────────────────────────

  patchClip(
    clipId: string,
    patch: { startTime: number; endTime: number },
  ): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT * FROM clip_candidates WHERE id = ?").get(clipId) as
      Record<string, unknown> | undefined;
    if (row === undefined) return null;
    const duration = patch.endTime - patch.startTime;
    this.db
      .prepare("UPDATE clip_candidates SET start_time = ?, end_time = ?, duration = ? WHERE id = ?")
      .run(patch.startTime, patch.endTime, duration, clipId);
    return this.getClip(clipId);
  }

  setClipSelected(clipId: string, selected: boolean): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT id FROM clip_candidates WHERE id = ?").get(clipId);
    if (row === undefined) return null;
    this.db
      .prepare("UPDATE clip_candidates SET selected = ? WHERE id = ?")
      .run(selected ? 1 : 0, clipId);
    return this.getClip(clipId);
  }

  regenerateSubtitles(clipId: string, style: string, uppercase: boolean): string | null {
    const clip = this.db.prepare("SELECT * FROM clip_candidates WHERE id = ?").get(clipId) as
      Record<string, unknown> | undefined;
    if (clip === undefined) return null;
    const transcript = this.db
      .prepare(
        "SELECT segments_json, language FROM transcripts WHERE job_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(clip.job_id as string) as { segments_json: string; language: string } | undefined;
    const segments =
      transcript !== undefined ? (JSON.parse(transcript.segments_json) as TranscriptSegment[]) : [];
    const srt = generateSrt(segments, clip.start_time as number, clip.end_time as number, {
      uppercase,
    });
    const existing = this.db
      .prepare("SELECT id FROM subtitle_tracks WHERE clip_id = ? AND style = ?")
      .get(clipId, style) as { id: string } | undefined;
    if (existing !== undefined) {
      this.db.prepare("UPDATE subtitle_tracks SET content = ? WHERE id = ?").run(srt, existing.id);
    } else {
      this.db
        .prepare(
          "INSERT INTO subtitle_tracks (id, clip_id, language, format, style, content) VALUES (?, ?, ?, 'srt', ?, ?)",
        )
        .run(newId("sub"), clipId, transcript?.language ?? "auto", style, srt);
    }
    return srt;
  }

  getSubtitles(clipId: string, style = "modern"): string | null {
    const row = this.db
      .prepare("SELECT content FROM subtitle_tracks WHERE clip_id = ? AND style = ?")
      .get(clipId, style) as { content: string } | undefined;
    if (row !== undefined) return row.content;
    const any = this.db
      .prepare(
        "SELECT content FROM subtitle_tracks WHERE clip_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(clipId) as { content: string } | undefined;
    return any?.content ?? null;
  }

  requestRender(clipId: string, rawOptions: unknown): Record<string, unknown> | null {
    const clip = this.db
      .prepare("SELECT id, job_id FROM clip_candidates WHERE id = ?")
      .get(clipId) as { id: string; job_id: string } | undefined;
    if (clip === undefined) return null;
    const parsed = renderOptionsSchema.parse(rawOptions ?? {});
    const dims =
      parsed.aspectRatio === "9:16"
        ? { w: parsed.quality, h: parsed.quality === 1080 ? 1920 : 1280 }
        : parsed.aspectRatio === "16:9"
          ? { w: parsed.quality === 1080 ? 1920 : 1280, h: parsed.quality }
          : { w: parsed.quality, h: parsed.quality };
    const renderId = newId("rnd");
    this.db
      .prepare(
        `INSERT INTO clip_renders (id, clip_id, status, progress, aspect_ratio, width, height, subtitle_style, subtitle_options_json, framing)
         VALUES (?, ?, 'queued', 0, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        renderId,
        clipId,
        parsed.aspectRatio,
        dims.w,
        dims.h,
        parsed.subtitleStyle,
        JSON.stringify({ ...parsed.subtitleOptions, commentaryText: parsed.commentaryText }),
        parsed.framing,
      );
    return this.getRender(renderId);
  }

  getRender(renderId: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT * FROM clip_renders WHERE id = ?").get(renderId) as
      Record<string, unknown> | undefined;
    if (row === undefined) return null;
    return {
      id: row.id,
      clipId: row.clip_id,
      status: row.status,
      progress: row.progress,
      aspectRatio: row.aspect_ratio,
      width: row.width,
      height: row.height,
      subtitleStyle: row.subtitle_style,
      framing: row.framing,
      error: row.error,
      sizeBytes: row.size_bytes,
      hasOutput: row.output_path !== null,
      createdAt: row.created_at,
      finishedAt: row.finished_at,
    };
  }

  getRenderFiles(
    renderId: string,
  ): { videoPath: string; srtPath: string; jsonPath: string; metadata: string } | null {
    const row = this.db.prepare("SELECT * FROM clip_renders WHERE id = ?").get(renderId) as
      Record<string, unknown> | undefined;
    if (row === undefined || row.output_path === null) return null;
    const jsonPath = row.json_path as string;
    const metadata = fs.existsSync(jsonPath) ? fs.readFileSync(jsonPath, "utf8") : "{}";
    return {
      videoPath: row.output_path as string,
      srtPath: row.srt_path as string,
      jsonPath,
      metadata,
    };
  }

  cancelRender(renderId: string): Record<string, unknown> | null {
    const row = this.db.prepare("SELECT status FROM clip_renders WHERE id = ?").get(renderId) as
      { status: string } | undefined;
    if (row === undefined) return null;
    if (ACTIVE_STATUSES.has(row.status)) {
      this.db
        .prepare("UPDATE clip_renders SET status = 'cancelled', finished_at = ? WHERE id = ?")
        .run(now(), renderId);
    }
    return this.getRender(renderId);
  }

  cancelJob(jobId: string): Record<string, unknown> | null {
    const job = this.db.prepare("SELECT status FROM clip_finder_jobs WHERE id = ?").get(jobId) as
      { status: string } | undefined;
    if (job === undefined) return null;
    if (ACTIVE_STATUSES.has(job.status)) {
      this.db
        .prepare(
          "UPDATE clip_finder_jobs SET status = 'cancelled', stage = 'Cancelled', finished_at = ? WHERE id = ?",
        )
        .run(now(), jobId);
      log.info({ jobId }, "job cancellation requested");
    }
    return this.getJob(jobId);
  }

  retryJob(jobId: string): Record<string, unknown> | null {
    const job = this.db.prepare("SELECT status FROM clip_finder_jobs WHERE id = ?").get(jobId) as
      { status: string } | undefined;
    if (job === undefined) return null;
    if (job.status !== "failed" && job.status !== "cancelled") {
      throw new Error("Only failed or cancelled jobs can be retried.");
    }
    this.db
      .prepare(
        "UPDATE clip_finder_jobs SET status = 'queued', progress = 0, stage = 'Preparing', error = NULL, finished_at = NULL WHERE id = ?",
      )
      .run(jobId);
    return this.getJob(jobId);
  }

  deleteJob(jobId: string): boolean {
    const job = this.db.prepare("SELECT * FROM clip_finder_jobs WHERE id = ?").get(jobId) as
      Record<string, unknown> | undefined;
    if (job === undefined) return false;
    const source = this.db
      .prepare("SELECT file_path FROM video_sources WHERE id = ?")
      .get(job.source_id as string) as { file_path: string | null } | undefined;
    // Renders: delete files + rows.
    const renders = this.db
      .prepare(
        "SELECT r.id, r.output_path FROM clip_renders r JOIN clip_candidates c ON c.id = r.clip_id WHERE c.job_id = ?",
      )
      .all(jobId) as Array<{ id: string; output_path: string | null }>;
    for (const render of renders) {
      this.deps.storage.removeRenderFile(render.output_path);
      this.db.prepare("DELETE FROM clip_renders WHERE id = ?").run(render.id);
    }
    // Temp workspace + original source file (explicit deletion only).
    this.deps.storage.removeJobWorkspace(jobId, source?.file_path ?? null);
    for (const table of ["subtitle_tracks"]) {
      this.db
        .prepare(
          `DELETE FROM ${table} WHERE clip_id IN (SELECT id FROM clip_candidates WHERE job_id = ?)`,
        )
        .run(jobId);
    }
    this.db.prepare("DELETE FROM clip_candidates WHERE job_id = ?").run(jobId);
    this.db.prepare("DELETE FROM scenes WHERE job_id = ?").run(jobId);
    this.db.prepare("DELETE FROM transcripts WHERE job_id = ?").run(jobId);
    this.db.prepare("DELETE FROM clip_finder_jobs WHERE id = ?").run(jobId);
    if (source !== undefined)
      this.db.prepare("DELETE FROM video_sources WHERE id = ?").run(job.source_id as string);
    log.info({ jobId }, "job deleted");
    return true;
  }

  deleteClip(clipId: string): boolean {
    const clip = this.db.prepare("SELECT * FROM clip_candidates WHERE id = ?").get(clipId) as
      Record<string, unknown> | undefined;
    if (clip === undefined) return false;
    const renders = this.db
      .prepare("SELECT id, output_path FROM clip_renders WHERE clip_id = ?")
      .all(clipId) as Array<{ id: string; output_path: string | null }>;
    for (const render of renders) {
      this.deps.storage.removeRenderFile(render.output_path);
      this.db.prepare("DELETE FROM clip_renders WHERE id = ?").run(render.id);
    }
    this.db.prepare("DELETE FROM subtitle_tracks WHERE clip_id = ?").run(clipId);
    this.db.prepare("DELETE FROM clip_candidates WHERE id = ?").run(clipId);
    return true;
  }

  getClipThumbnailPath(clipId: string): string | null {
    const row = this.db
      .prepare("SELECT thumbnail_path FROM clip_candidates WHERE id = ?")
      .get(clipId) as { thumbnail_path: string | null } | undefined;
    if (row === undefined || row.thumbnail_path === null) return null;
    return fs.existsSync(row.thumbnail_path) ? row.thumbnail_path : null;
  }
}

export { COPYRIGHT_NOTICE };
