import type { MediaTools, MediaProbe, SceneBoundary } from "@sara/clipfinder";
import fs from "node:fs";

/** Scriptable MediaTools fake for API tests (no ffmpeg dependency). */
export class FakeMediaTools implements MediaTools {
  probeResult: MediaProbe;
  sceneCuts: SceneBoundary[];

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
    return this.probeResult;
  }

  async extractAudio(_f: string, out: string): Promise<void> {
    fs.writeFileSync(out, Buffer.from("fake-wav"));
  }

  async detectScenes(): Promise<SceneBoundary[]> {
    return this.sceneCuts;
  }

  async extractThumbnail(_f: string, _at: number, out: string): Promise<void> {
    fs.writeFileSync(out, Buffer.from("fake-jpeg"));
  }

  async cutClip(_i: string, _s: number, _e: number, out: string): Promise<void> {
    fs.writeFileSync(out, Buffer.from("fake-cut"));
  }

  async convertAspect(
    _i: string,
    out: string,
    _aspect: unknown,
    _framing: unknown,
    _quality: 1080 | 720,
  ): Promise<void> {
    fs.writeFileSync(out, Buffer.from("fake-aspect"));
  }

  async burnSubtitles(_i: string, _s: string, _st: unknown, out: string): Promise<void> {
    fs.writeFileSync(out, Buffer.from("fake-burned"));
  }
}
