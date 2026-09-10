import type {
  MediaTools,
  MediaProbe,
  SceneBoundary,
  AspectRatio,
  FramingMode,
} from "../src/types.js";
import fs from "node:fs";

/** Scriptable MediaTools fake — no ffmpeg, deterministic, writes real files. */
export class FakeMediaTools implements MediaTools {
  probeResult: MediaProbe;
  sceneCuts: SceneBoundary[];
  failOn: string | null = null;
  writtenFiles = new Set<string>();

  constructor(
    probe: Partial<MediaProbe> = {},
    sceneCuts: SceneBoundary[] = [
      { time: 30, score: 0.9 },
      { time: 75, score: 0.8 },
      { time: 120, score: 0.95 },
    ],
  ) {
    this.probeResult = {
      durationSeconds: 180,
      width: 1280,
      height: 720,
      fps: 25,
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "aac",
      sizeBytes: 10_000_000,
      ...probe,
    };
    this.sceneCuts = sceneCuts;
  }

  async probe(): Promise<MediaProbe> {
    if (this.failOn === "probe") throw new Error("unsupported codec in test fixture");
    return this.probeResult;
  }

  async extractAudio(_filePath: string, outputPath: string): Promise<void> {
    if (this.failOn === "audio") throw new Error("audio extraction failed in test fixture");
    fs.writeFileSync(outputPath, Buffer.from("fake-wav"));
    this.writtenFiles.add(outputPath);
  }

  async detectScenes(): Promise<SceneBoundary[]> {
    if (this.failOn === "scenes") throw new Error("scene detection failed in test fixture");
    return this.sceneCuts;
  }

  async extractThumbnail(_f: string, _at: number, outputPath: string): Promise<void> {
    fs.writeFileSync(outputPath, Buffer.from("fake-jpeg"));
    this.writtenFiles.add(outputPath);
  }

  async cutClip(_input: string, _s: number, _e: number, output: string): Promise<void> {
    if (this.failOn === "cut") throw new Error("cut failed in test fixture");
    fs.writeFileSync(output, Buffer.from("fake-mp4-cut"));
  }

  async convertAspect(
    _input: string,
    output: string,
    _aspect: AspectRatio,
    _framing: FramingMode,
    _quality: 1080 | 720,
  ): Promise<void> {
    if (this.failOn === "aspect") throw new Error("aspect conversion failed in test fixture");
    fs.writeFileSync(output, Buffer.from("fake-mp4-aspect"));
  }

  async burnSubtitles(_i: string, _s: string, _st: unknown, output: string): Promise<void> {
    if (this.failOn === "burn") throw new Error("subtitle burn failed in test fixture");
    fs.writeFileSync(output, Buffer.from("fake-mp4-burned"));
  }
}
