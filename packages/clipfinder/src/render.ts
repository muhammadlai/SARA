/**
 * Clip render pipeline: cut → aspect conversion (9:16 / 16:9 / 1:1) →
 * subtitle burn-in (+ optional clearly-labeled user commentary overlay) →
 * MP4 + SRT + JSON metadata on disk. The original source is NEVER modified —
 * every render writes new output files.
 */
import fs from "node:fs";
import { createLogger } from "@sara/logger";
import type { SqliteDatabase } from "@sara/db";
import { generateSrt, resolveSubtitleOptions } from "./subtitles.js";
import { CLIP_CATEGORY_LABELS } from "./schema.js";
import type { ParsedRenderOptions } from "./schema.js";
import type { MediaTools, TranscriptSegment } from "./types.js";

const log = createLogger({ name: "sara-clipfinder" });

export const COPYRIGHT_NOTICE =
  "Make sure you have the necessary rights or permission to use the source video. AI editing does not make copyrighted material copyright-free.";

function now(): string {
  return new Date().toISOString();
}

export interface RenderDeps {
  db: SqliteDatabase;
  renderId: string;
  storageRenderPath: (extension: string) => string;
  media: MediaTools;
  onStatus: (status: "processing" | "rendering", progress: number) => Promise<void>;
  shouldCancel: () => boolean;
}

export async function runRenderPipeline(deps: RenderDeps): Promise<void> {
  const { db, renderId } = deps;
  const setFailed = (message: string): void => {
    db.prepare(
      "UPDATE clip_renders SET status = 'failed', error = ?, finished_at = ? WHERE id = ?",
    ).run(message, now(), renderId);
  };

  try {
    const render = db.prepare("SELECT * FROM clip_renders WHERE id = ?").get(renderId) as
      Record<string, unknown> | undefined;
    if (render === undefined) throw new Error("Render request not found.");
    const clip = db
      .prepare("SELECT * FROM clip_candidates WHERE id = ?")
      .get(render.clip_id as string) as Record<string, unknown> | undefined;
    if (clip === undefined) throw new Error("The clip for this render no longer exists.");
    const job = db
      .prepare("SELECT * FROM clip_finder_jobs WHERE id = ?")
      .get(clip.job_id as string) as Record<string, unknown> | undefined;
    if (job === undefined) throw new Error("The job for this clip no longer exists.");
    const source = db
      .prepare("SELECT * FROM video_sources WHERE id = ?")
      .get(job.source_id as string) as Record<string, unknown> | undefined;
    if (source === undefined || typeof source.file_path !== "string") {
      throw new Error(
        "The original video file is no longer available (it may have been cleaned up).",
      );
    }

    const subtitleOverrides = JSON.parse(
      (render.subtitle_options_json as string | null) ?? "{}",
    ) as {
      fontSize?: number;
      position?: "bottom" | "center" | "top";
      background?: boolean;
      uppercase?: boolean;
      commentaryText?: string;
    };
    const options = {
      aspectRatio: render.aspect_ratio as ParsedRenderOptions["aspectRatio"],
      framing: render.framing as ParsedRenderOptions["framing"],
      quality: (render.height as number) === 1280 ? (720 as const) : (1080 as const),
      subtitleStyle: render.subtitle_style as ParsedRenderOptions["subtitleStyle"],
      subtitleOptions: subtitleOverrides,
      commentaryText: subtitleOverrides.commentaryText,
    };

    // Transcript segments for this job (for SRT regeneration at render time).
    const transcriptRow = db
      .prepare(
        "SELECT segments_json, language FROM transcripts WHERE job_id = ? ORDER BY created_at DESC LIMIT 1",
      )
      .get(job.id as string) as { segments_json: string; language: string } | undefined;
    const segments: TranscriptSegment[] =
      transcriptRow !== undefined
        ? (JSON.parse(transcriptRow.segments_json) as TranscriptSegment[])
        : [];

    const start = clip.start_time as number;
    const end = clip.end_time as number;

    await deps.onStatus("processing", 10);
    if (deps.shouldCancel()) return void setCancelled(db, renderId);

    // 1) Cut the clip (new file — never touch the original).
    const cutPath = deps.storageRenderPath("cut.mp4");
    await deps.media.cutClip(source.file_path, start, end, cutPath);
    await deps.onStatus("rendering", 45);
    if (deps.shouldCancel()) return void setCancelled(db, renderId);

    // 2) Aspect conversion with the chosen framing.
    const aspectPath = deps.storageRenderPath("aspect.mp4");
    await deps.media.convertAspect(
      cutPath,
      aspectPath,
      options.aspectRatio,
      options.framing,
      options.quality,
    );
    fs.rmSync(cutPath, { force: true });
    await deps.onStatus("rendering", 70);
    if (deps.shouldCancel()) return void setCancelled(db, renderId);

    // 3) Subtitles (regenerated at render time) + optional commentary overlay.
    const subtitleOptions = resolveSubtitleOptions(options.subtitleStyle, {
      ...(options.subtitleOptions as object),
    });
    const srtContent = generateSrt(segments, start, end, { uppercase: subtitleOptions.uppercase });
    const commentaryContent =
      options.commentaryText !== undefined && options.commentaryText.length > 0
        ? generateCommentarySrt(options.commentaryText, end - start)
        : null;

    let outputPath = aspectPath;
    if (srtContent.trim().length > 0 || commentaryContent !== null) {
      const srtPath = deps.storageRenderPath("srt");
      const burnSrt = commentaryContent !== null ? `${srtContent}${commentaryContent}` : srtContent;
      fs.writeFileSync(srtPath, burnSrt, "utf8");
      const burnedPath = deps.storageRenderPath("burned.mp4");
      await deps.media.burnSubtitles(aspectPath, srtPath, subtitleOptions, burnedPath);
      fs.rmSync(aspectPath, { force: true });
      outputPath = burnedPath;
      // The delivered SRT excludes commentary (it is a rendering overlay).
      const finalSrtPath = deps.storageRenderPath(".srt");
      fs.writeFileSync(finalSrtPath, srtContent, "utf8");
    } else {
      const finalSrtPath = deps.storageRenderPath(".srt");
      fs.writeFileSync(finalSrtPath, srtContent, "utf8");
    }

    // Rename the video to its final .mp4 name.
    const finalVideoPath = deps.storageRenderPath(".mp4");
    fs.renameSync(outputPath, finalVideoPath);

    // 4) Metadata JSON.
    const jsonPath = deps.storageRenderPath(".json");
    const metadata = {
      notice: COPYRIGHT_NOTICE,
      renderId,
      clip: {
        id: clip.id,
        jobId: clip.job_id,
        category:
          CLIP_CATEGORY_LABELS[clip.category as keyof typeof CLIP_CATEGORY_LABELS] ?? clip.category,
        rank: clip.rank,
        score: clip.score,
        reason: clip.reason,
        startTime: start,
        endTime: end,
        durationSeconds: end - start,
        transcript: clip.transcript_preview,
      },
      source: {
        kind: source.kind,
        url: source.url,
        originalName: source.original_name,
        durationSeconds: source.duration_seconds,
        width: source.width,
        height: source.height,
      },
      output: {
        aspectRatio: options.aspectRatio,
        framing: options.framing,
        width: options.quality === 1080 ? 1080 : 720,
        height: options.quality === 1080 ? 1920 : 1280,
        videoCodec: "h264 (libx264)",
        audioCodec: "aac",
        container: "mp4",
        subtitleStyle: subtitleOptions.style,
        hasCommentaryOverlay: commentaryContent !== null,
        commentaryNote:
          commentaryContent !== null
            ? "User-created text commentary is overlaid and labeled; it is distinct from the original source audio."
            : undefined,
      },
      mockJob: (job.mock as number) === 1,
      generatedAt: now(),
    };
    fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), "utf8");

    const size = fs.statSync(finalVideoPath).size;
    db.prepare(
      `UPDATE clip_renders SET status = 'completed', progress = 100, width = ?, height = ?, output_path = ?, srt_path = ?, json_path = ?, size_bytes = ?, finished_at = ? WHERE id = ?`,
    ).run(
      metadata.output.width,
      metadata.output.height,
      finalVideoPath,
      deps.storageRenderPath(".srt"),
      jsonPath,
      size,
      now(),
      renderId,
    );
    log.info({ renderId, size }, "render complete");
  } catch (err) {
    if (deps.shouldCancel()) return void setCancelled(db, renderId);
    const message = err instanceof Error ? err.message : String(err);
    log.error({ renderId, err: message }, "render failed");
    setFailed(message);
  }
}

function setCancelled(db: SqliteDatabase, renderId: string): void {
  db.prepare("UPDATE clip_renders SET status = 'cancelled', finished_at = ? WHERE id = ?").run(
    now(),
    renderId,
  );
}

/**
 * Commentary text → SRT overlay: split into readable cues (~4s each),
 * each prefixed to make the user-created nature explicit on screen.
 */
export function generateCommentarySrt(commentary: string, clipDuration: number): string {
  const clean = commentary.trim();
  if (clean.length === 0) return "";
  const words = clean.split(/\s+/);
  const cues: string[] = [];
  const chunkWords = 12;
  for (let i = 0; i < words.length; i += chunkWords) {
    cues.push(`[Commentary] ${words.slice(i, i + chunkWords).join(" ")}`);
  }
  const per = Math.min(4.5, Math.max(2, clipDuration / Math.max(1, cues.length)));
  return (
    cues
      .map((text, i) => {
        const s = i * per;
        const e = Math.min(clipDuration, s + per - 0.2);
        return `${i + 1}\r\n${ts(s)} --> ${ts(e)}\r\n${text}`;
      })
      .join("\r\n\r\n") + "\r\n\r\n"
  );
}

function ts(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  const ms = String(Math.round((s - Math.floor(s)) * 1000)).padStart(3, "0");
  return `${h}:${m}:${sec},${ms}`;
}
