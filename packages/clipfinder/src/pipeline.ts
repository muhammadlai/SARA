/**
 * The analysis pipeline — the real work behind a Clip Finder job:
 *   probe → audio → transcript → scene detection → understanding →
 *   ranking → subtitles → previews → stored results.
 *
 * Progress is persisted at every stage boundary (the numbers mirror the
 * documented stage table) and cancellation is cooperative: the DB status is
 * checked between stages and inside per-scene loops. Nothing is simulated —
 * if a stage cannot run, the job fails with the underlying reason.
 */
import fs from "node:fs";
import path from "node:path";
import { createLogger } from "@sara/logger";
import type { SqliteDatabase } from "@sara/db";
import type { SceneAnalysis, SpeechToTextProvider } from "./types.js";
import { retimedMockTranscript } from "./providers/mock.js";
import { rankScenes } from "./ranking.js";
import { generateSrt } from "./subtitles.js";
import { transcriptForWindow } from "./boundaries.js";
import {
  STAGES,
  type ClipFinderOptions,
  type MediaTools,
  type SceneUnderstandingProvider,
  type StageKey,
  type TranscriptSegment,
} from "./types.js";

const log = createLogger({ name: "sara-clipfinder" });

export interface PipelineDeps {
  db: SqliteDatabase;
  jobId: string;
  sourcePath: string;
  options: ClipFinderOptions;
  mock: boolean;
  sceneThreshold: number;
  media: MediaTools;
  stt: SpeechToTextProvider;
  analyzer: SceneUnderstandingProvider;
  storageAudioPath: () => string;
  storageThumbPath: (sceneIndex: number) => string;
  storageClipThumbPath: (clipId: string) => string;
  onProgress: (stage: StageKey) => Promise<void>;
  shouldCancel: () => boolean;
  cancelled: () => void;
  failed: (message: string) => void;
}

function now(): string {
  return new Date().toISOString();
}

export function setProgress(db: SqliteDatabase, jobId: string, stage: StageKey): void {
  const { progress, label } = STAGES[stage];
  const status =
    stage === "transcribing"
      ? "transcribing"
      : stage === "detectingScenes" || stage === "understandingScenes" || stage === "rankingClips"
        ? "analyzing"
        : stage === "generatingSubtitles" || stage === "renderingPreviews"
          ? "rendering"
          : stage === "complete"
            ? "completed"
            : "processing";
  db.prepare(
    "UPDATE clip_finder_jobs SET status = ?, progress = ?, stage = ?, updated_at = ? WHERE id = ?",
  ).run(status, progress, label, now(), jobId);
}

function newId(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
}

export async function runAnalysisPipeline(deps: PipelineDeps): Promise<void> {
  const { db, jobId, sourcePath, options, media, analyzer } = deps;

  try {
    // ── 10% Read video ────────────────────────────────────────────────
    await deps.onProgress("reading");
    const probe = await media.probe(sourcePath);
    db.prepare(
      `UPDATE video_sources SET duration_seconds = ?, width = ?, height = ?, fps = ?, container = ?, video_codec = ?, audio_codec = ?, size_bytes = ? WHERE id = (SELECT source_id FROM clip_finder_jobs WHERE id = ?)`,
    ).run(
      probe.durationSeconds,
      probe.width,
      probe.height,
      probe.fps,
      probe.container,
      probe.videoCodec,
      probe.audioCodec,
      probe.sizeBytes,
      jobId,
    );
    log.info({ jobId, duration: probe.durationSeconds }, "video probed");
    if (await checkCancel(deps)) return;

    // ── 20% Extract audio ─────────────────────────────────────────────
    await deps.onProgress("extractingAudio");
    const audioPath = deps.storageAudioPath();
    fs.mkdirSync(path.dirname(audioPath), { recursive: true });
    await media.extractAudio(sourcePath, audioPath);
    if (await checkCancel(deps)) return;

    // ── 35% Transcribe ────────────────────────────────────────────────
    await deps.onProgress("transcribing");
    let transcript;
    if (deps.mock) {
      transcript = retimedMockTranscript(probe.durationSeconds, options.language);
    } else {
      transcript = await deps.stt.transcribe(audioPath, options.language);
    }
    db.prepare(
      "INSERT INTO transcripts (id, job_id, language, provider, text, segments_json) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(
      newId("tr"),
      jobId,
      transcript.language,
      transcript.provider,
      transcript.text,
      JSON.stringify(transcript.segments),
    );
    log.info({ jobId, segments: transcript.segments.length }, "transcript stored");
    if (await checkCancel(deps)) return;

    // ── 50% Detect scenes ─────────────────────────────────────────────
    await deps.onProgress("detectingScenes");
    const boundaries = await media.detectScenes(sourcePath, deps.sceneThreshold);
    const segments: TranscriptSegment[] = transcript.segments;
    const sceneWindows = buildSceneWindows(
      boundaries,
      probe.durationSeconds,
      options.maxDurationSeconds,
    );
    if (sceneWindows.fallback) {
      log.warn({ jobId }, "no scene changes above threshold — using even segmentation");
    }
    if (await checkCancel(deps)) return;

    // ── 65% Understand scenes ─────────────────────────────────────────
    await deps.onProgress("understandingScenes");
    const sceneIds: string[] = [];
    for (let i = 0; i < sceneWindows.windows.length; i += 1) {
      if (await checkCancel(deps)) return;
      const w = sceneWindows.windows[i];
      if (w === undefined) continue;
      const { text } = transcriptForWindow(segments, w.start, w.end);
      const thumbPath = deps.storageThumbPath(i);
      try {
        await media.extractThumbnail(sourcePath, w.start + w.duration / 2, thumbPath);
      } catch {
        // Thumbnail is best-effort; analysis continues without it.
      }
      const analysis = await analyzer.analyze({
        transcriptText: text,
        startTime: w.start,
        endTime: w.end,
        duration: w.duration,
        visual: { boundaryScore: w.boundaryScore },
      });
      const sceneId = newId("sc");
      sceneIds.push(sceneId);
      db.prepare(
        `INSERT INTO scenes (id, job_id, scene_index, start_time, end_time, duration, transcript_text, thumbnail_path, visual_json, analysis_json, overall_score, categories_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        sceneId,
        jobId,
        i,
        w.start,
        w.end,
        w.duration,
        text,
        thumbPath,
        JSON.stringify(w),
        JSON.stringify(analysis),
        analysis.overall,
        "[]",
      );
    }
    log.info({ jobId, scenes: sceneIds.length }, "scenes analyzed");
    if (await checkCancel(deps)) return;

    // ── 75% Rank clips ────────────────────────────────────────────────
    await deps.onProgress("rankingClips");
    const sceneRows = db
      .prepare("SELECT * FROM scenes WHERE job_id = ? ORDER BY scene_index")
      .all(jobId) as Array<Record<string, unknown>>;
    const scenes = sceneRows.map((row) => ({
      id: row.id as string,
      jobId,
      sceneIndex: row.scene_index as number,
      startTime: row.start_time as number,
      endTime: row.end_time as number,
      duration: row.duration as number,
      transcriptText: row.transcript_text as string,
      thumbnailPath: row.thumbnail_path as string | null,
      visual: JSON.parse((row.visual_json as string) ?? "{}") as Record<string, unknown>,
      analysis:
        row.analysis_json !== null
          ? (JSON.parse(row.analysis_json as string) as SceneAnalysis)
          : null,
    }));
    const drafts = rankScenes({
      scenes,
      segments,
      options,
      clipCount: options.clipCount,
      sourceDuration: probe.durationSeconds,
    });
    const clipIds: string[] = [];
    for (let rank = 0; rank < drafts.length; rank += 1) {
      const draft = drafts[rank];
      if (draft === undefined) continue;
      const clipId = newId("clip");
      clipIds.push(clipId);
      db.prepare(
        `INSERT INTO clip_candidates (id, job_id, scene_id, rank, category, start_time, end_time, duration, score, reason, transcript_preview, thumbnail_path, selected)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      ).run(
        clipId,
        jobId,
        draft.sceneId,
        rank + 1,
        draft.category,
        draft.startTime,
        draft.endTime,
        draft.duration,
        draft.score,
        draft.reason,
        draft.transcriptPreview,
        sceneRows.find((s) => s.id === draft.sceneId)?.thumbnail_path as string | null,
      );
    }
    if (await checkCancel(deps)) return;

    // ── 85% Generate subtitles ────────────────────────────────────────
    await deps.onProgress("generatingSubtitles");
    for (const clipId of clipIds) {
      if (await checkCancel(deps)) return;
      const clip = db
        .prepare("SELECT start_time, end_time FROM clip_candidates WHERE id = ?")
        .get(clipId) as { start_time: number; end_time: number } | undefined;
      if (clip === undefined) continue;
      const srt = generateSrt(segments, clip.start_time, clip.end_time);
      db.prepare(
        "INSERT INTO subtitle_tracks (id, clip_id, language, format, style, content) VALUES (?, ?, ?, 'srt', 'modern', ?)",
      ).run(newId("sub"), clipId, transcript.language, srt);
    }

    // ── 95% Render previews (per-clip thumbnails) ─────────────────────
    await deps.onProgress("renderingPreviews");
    for (const clipId of clipIds) {
      const clip = db
        .prepare("SELECT start_time, end_time FROM clip_candidates WHERE id = ?")
        .get(clipId) as { start_time: number; end_time: number } | undefined;
      if (clip === undefined) continue;
      const clipThumb = deps.storageClipThumbPath(clipId);
      try {
        await media.extractThumbnail(
          sourcePath,
          clip.start_time + (clip.end_time - clip.start_time) / 3,
          clipThumb,
        );
        db.prepare("UPDATE clip_candidates SET thumbnail_path = ? WHERE id = ?").run(
          clipThumb,
          clipId,
        );
      } catch {
        // keep scene thumbnail fallback
      }
    }

    // ── 100% Complete ─────────────────────────────────────────────────
    setProgress(db, jobId, "complete");
    db.prepare("UPDATE clip_finder_jobs SET finished_at = ? WHERE id = ?").run(now(), jobId);
    log.info({ jobId, clips: clipIds.length }, "analysis complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ jobId, err: message }, "analysis failed");
    db.prepare(
      "UPDATE clip_finder_jobs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
    ).run(message, now(), jobId);
    deps.failed(message);
  }
}

async function checkCancel(deps: PipelineDeps): Promise<boolean> {
  if (!deps.shouldCancel()) return false;
  deps.db
    .prepare(
      "UPDATE clip_finder_jobs SET status = 'cancelled', stage = 'Cancelled', finished_at = ? WHERE id = ?",
    )
    .run(now(), deps.jobId);
  deps.cancelled();
  return true;
}

export interface SceneWindow {
  start: number;
  end: number;
  duration: number;
  boundaryScore?: number;
}

/** Even segmentation used when no scene changes are detectable. */
function evenWindows(
  duration: number,
  maxDuration: number,
): { windows: SceneWindow[]; fallback: boolean } {
  const step = Math.max(8, Math.min(maxDuration * 0.75, 45));
  const windows: SceneWindow[] = [];
  for (let t = 0; t < duration - 2; t += step) {
    const end = Math.min(duration, t + step);
    windows.push({
      start: Math.round(t * 100) / 100,
      end: Math.round(end * 100) / 100,
      duration: Math.round((end - t) * 100) / 100,
    });
  }
  return { windows, fallback: true };
}

/** Merge scene-change times into usable scene windows. */
export function buildSceneWindows(
  boundaries: Array<{ time: number; score: number }>,
  duration: number,
  maxDuration: number,
): { windows: SceneWindow[]; fallback: boolean } {
  const realCuts = boundaries
    .filter((b) => b.time > 0.5 && b.time < duration - 0.5)
    .map((b) => b.time);
  if (realCuts.length === 0) {
    return evenWindows(duration, maxDuration);
  }
  const cuts = [0, ...realCuts].sort((a, b) => a - b);
  const raw: SceneWindow[] = [];
  for (let i = 0; i < cuts.length; i += 1) {
    const start = cuts[i] as number;
    const end = i + 1 < cuts.length ? (cuts[i + 1] as number) : duration;
    const dur = end - start;
    if (dur < 1) continue;
    raw.push({
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      duration: Math.round(dur * 100) / 100,
      boundaryScore:
        i === 0 ? undefined : boundaries.find((b) => Math.abs(b.time - start) < 0.2)?.score,
    });
  }
  if (raw.length === 0) {
    return evenWindows(duration, maxDuration);
  }
  // Merge micro-scenes (<2s) into neighbors and split very long ones.
  const merged: SceneWindow[] = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (w.duration < 2 && last !== undefined) {
      last.end = w.end;
      last.duration = Math.round((last.end - last.start) * 100) / 100;
    } else {
      merged.push({ ...w });
    }
  }
  const final: SceneWindow[] = [];
  for (const w of merged) {
    if (w.duration <= maxDuration * 1.6) {
      final.push(w);
      continue;
    }
    const parts = Math.ceil(w.duration / (maxDuration * 0.9));
    const step = w.duration / parts;
    for (let p = 0; p < parts; p += 1) {
      const s = w.start + p * step;
      final.push({
        start: Math.round(s * 100) / 100,
        end: Math.round((s + step) * 100) / 100,
        duration: Math.round(step * 100) / 100,
        boundaryScore: w.boundaryScore,
      });
    }
  }
  return { windows: final, fallback: false };
}
