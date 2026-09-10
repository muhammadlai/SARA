/**
 * FFmpeg-backed MediaTools implementation. Binary resolution order:
 *   explicit paths (constructor / validated config) → npm-bundled
 *   @ffmpeg-installer/@ffprobe-installer binaries.
 *
 * Framing modes: "blur-pad" keeps the whole frame visible over a blurred
 * background (nobody gets cut off); "center-crop" fills the target frame.
 * All operations are time-bounded; stderr tails become user-facing errors.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import type {
  AspectRatio,
  FramingMode,
  MediaProbe,
  MediaTools,
  SceneBoundary,
  SubtitleOptions,
} from "../types.js";
import { subtitleStyleToAss } from "../subtitles.js";

const nodeRequire = createRequire(import.meta.url);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  binary: string,
  args: string[],
  options: { timeoutMs?: number; onStdout?: (chunk: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer =
      options.timeoutMs !== undefined
        ? setTimeout(() => {
            child.kill("SIGKILL");
            reject(new Error(`${path.basename(binary)} timed out after ${options.timeoutMs}ms`));
          }, options.timeoutMs)
        : null;

    child.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      options.onStdout?.(text);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (timer !== null) clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer !== null) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function requireInstaller(moduleName: string): string | null {
  try {
    // Optional dependency — may genuinely be absent.
    const mod = nodeRequire(moduleName) as { path?: unknown };
    return typeof mod.path === "string" ? mod.path : null;
  } catch {
    return null;
  }
}

function resolveBinary(
  explicitPath: string | undefined,
  installer: string | null,
  name: string,
): string {
  if (explicitPath !== undefined && explicitPath.length > 0) {
    if (fs.existsSync(explicitPath)) return explicitPath;
    throw new Error(`${name} not found at the configured path: ${explicitPath}`);
  }
  if (installer !== null) return installer;
  throw new Error(
    `${name} binary not found. Install @ffmpeg-installer/ffmpeg or configure CLIP_FINDER_FFMPEG_PATH / CLIP_FINDER_FFPROBE_PATH.`,
  );
}

export class FfmpegMediaTools implements MediaTools {
  readonly ffmpeg: string;
  readonly ffprobe: string;

  constructor(paths: { ffmpegPath?: string; ffprobePath?: string } = {}) {
    this.ffmpeg = resolveBinary(
      paths.ffmpegPath,
      requireInstaller("@ffmpeg-installer/ffmpeg"),
      "ffmpeg",
    );
    this.ffprobe = resolveBinary(
      paths.ffprobePath,
      requireInstaller("@ffprobe-installer/ffprobe"),
      "ffprobe",
    );
  }

  async probe(filePath: string): Promise<MediaProbe> {
    const { code, stdout, stderr } = await run(
      this.ffprobe,
      ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
      { timeoutMs: 30_000 },
    );
    if (code !== 0) {
      const tail = stderr.split("\n").slice(-1)[0] ?? "";
      throw new Error(
        `Could not read the video file — it may be corrupted or in an unsupported format. ${tail}`.trim(),
      );
    }
    const data = JSON.parse(stdout) as {
      format?: { duration?: string; size?: string; format_name?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
      }>;
    };
    const video = (data.streams ?? []).find((s) => s.codec_type === "video");
    const audio = (data.streams ?? []).find((s) => s.codec_type === "audio");
    if (video === undefined) {
      throw new Error(
        "The source contains no video stream — an audio file cannot be processed here.",
      );
    }
    const duration = Number.parseFloat(data.format?.duration ?? "0");
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Could not determine the video duration — the file may be incomplete.");
    }
    const [rawNum, rawDen] = (video.avg_frame_rate ?? "25/1").split("/");
    const num = Number.parseFloat(rawNum ?? "25");
    const den = Number.parseFloat(rawDen ?? "1");
    const fps = den !== 0 && Number.isFinite(num) && Number.isFinite(den) ? num / den : 25;
    return {
      durationSeconds: duration,
      width: video.width ?? 0,
      height: video.height ?? 0,
      fps: Math.round(fps * 100) / 100,
      container: data.format?.format_name ?? "unknown",
      videoCodec: video.codec_name ?? null,
      audioCodec: audio?.codec_name ?? null,
      sizeBytes: Number.parseInt(data.format?.size ?? "0", 10),
    };
  }

  async extractAudio(filePath: string, outputPath: string): Promise<void> {
    const { code, stderr } = await run(
      this.ffmpeg,
      ["-y", "-i", filePath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath],
      { timeoutMs: 15 * 60_000 },
    );
    if (code !== 0) {
      const tail = stderr.split("\n").slice(-1)[0] ?? "";
      throw new Error(
        `Audio extraction failed — the source may have no audio track or an unsupported codec. ${tail}`.trim(),
      );
    }
  }

  async detectScenes(filePath: string, threshold: number): Promise<SceneBoundary[]> {
    const boundaries = new Map<number, number>();
    let lastTime: number | null = null;
    const { code } = await run(
      this.ffmpeg,
      [
        "-i",
        filePath,
        "-vf",
        `select='gt(scene,${threshold})',metadata=print:file=-`,
        "-an",
        "-f",
        "null",
        "-",
      ],
      {
        timeoutMs: 30 * 60_000,
        onStdout: (chunk) => {
          for (const match of chunk.matchAll(/pts_time:([\d.]+)/g)) {
            const t = Number.parseFloat(match[1] ?? "0");
            if (!Number.isFinite(t)) continue;
            boundaries.set(t, 1);
            lastTime = t;
          }
          for (const match of chunk.matchAll(/lavfi\.scene_score=([\d.]+)/g)) {
            const score = Number.parseFloat(match[1] ?? "1");
            if (lastTime !== null) boundaries.set(lastTime, score);
          }
        },
      },
    );
    if (code !== 0) throw new Error("Scene detection failed while reading the video.");
    return [...boundaries.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([time, score]) => ({ time, score }));
  }

  async extractThumbnail(filePath: string, atSeconds: number, outputPath: string): Promise<void> {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    const { code } = await run(
      this.ffmpeg,
      [
        "-y",
        "-ss",
        String(Math.max(0, atSeconds)),
        "-i",
        filePath,
        "-frames:v",
        "1",
        "-vf",
        "scale=480:-2",
        outputPath,
      ],
      { timeoutMs: 60_000 },
    );
    if (code !== 0) throw new Error(`Thumbnail extraction failed at ${atSeconds}s.`);
  }

  async cutClip(input: string, start: number, end: number, output: string): Promise<void> {
    const duration = Math.max(0.1, end - start);
    const { code, stderr } = await run(
      this.ffmpeg,
      [
        "-y",
        "-ss",
        String(start),
        "-i",
        input,
        "-t",
        String(duration),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeoutMs: 30 * 60_000 },
    );
    if (code !== 0) {
      const tail = stderr.split("\n").slice(-1)[0] ?? "";
      throw new Error(`Clip cutting failed. ${tail}`.trim());
    }
  }

  async convertAspect(
    input: string,
    output: string,
    aspect: AspectRatio,
    framing: FramingMode,
    quality: 1080 | 720,
  ): Promise<void> {
    const shortSide = quality === 1080 ? 1080 : 720;
    const target =
      aspect === "9:16"
        ? `${shortSide}:${quality === 1080 ? 1920 : 1280}`
        : aspect === "16:9"
          ? `${quality === 1080 ? 1920 : 1280}:${shortSide}`
          : `${shortSide}:${shortSide}`;

    let filter: string;
    if (framing === "center-crop") {
      filter = `scale=${target}:force_original_aspect_ratio=increase,crop=${target}`;
    } else {
      filter =
        `[0:v]split=2[bg][fg];` +
        `[bg]scale=${target}:force_original_aspect_ratio=increase,crop=${target},boxblur=24:2[bgb];` +
        `[fg]scale=${target}:force_original_aspect_ratio=decrease[fgs];` +
        `[bgb][fgs]overlay=(W-w)/2:(H-h)/2`;
    }

    const { code, stderr } = await run(
      this.ffmpeg,
      [
        "-y",
        "-i",
        input,
        "-filter_complex",
        filter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeoutMs: 30 * 60_000 },
    );
    if (code !== 0) {
      const tail = stderr.split("\n").slice(-1)[0] ?? "";
      throw new Error(`Aspect conversion failed. ${tail}`.trim());
    }
  }

  async burnSubtitles(
    input: string,
    srtPath: string,
    style: SubtitleOptions,
    output: string,
  ): Promise<void> {
    const force = subtitleStyleToAss(style).replace(/,/g, "\\,");
    const escaped = srtPath.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const { code, stderr } = await run(
      this.ffmpeg,
      [
        "-y",
        "-i",
        input,
        "-vf",
        `subtitles=filename='${escaped}':force_style='${force}'`,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "23",
        "-c:a",
        "copy",
        "-movflags",
        "+faststart",
        output,
      ],
      { timeoutMs: 30 * 60_000 },
    );
    if (code !== 0) {
      const tail = stderr.split("\n").slice(-1)[0] ?? "";
      throw new Error(`Subtitle rendering failed. ${tail}`.trim());
    }
  }
}
