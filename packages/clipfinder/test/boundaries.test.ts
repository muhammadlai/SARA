import { describe, expect, it } from "vitest";
import { computeClipBoundary, transcriptForWindow } from "../src/boundaries.js";
import { buildSceneWindows } from "../src/pipeline.js";
import { iou, isDuplicate } from "../src/dedupe.js";
import type { TranscriptSegment } from "../src/types.js";

const segments: TranscriptSegment[] = [
  { text: "Where were you last night?", start: 10.0, end: 12.5 },
  { text: "I was at work. You know that.", start: 13.0, end: 16.0 },
  { text: "Don't lie to me!", start: 17.0, end: 19.2 },
  { text: "Because I saw you with him, that's why.", start: 20.0, end: 24.0 },
  { text: "Fine. You want the truth? Here it is.", start: 30.0, end: 34.0 },
];

describe("clip boundary intelligence", () => {
  const base = {
    sceneStart: 8,
    sceneEnd: 40,
    minDuration: 15,
    maxDuration: 30,
    segments,
    paddingBefore: 1.5,
    paddingAfter: 2.5,
    sourceDuration: 180,
  };

  it("never starts or ends mid-air when gaps exist nearby", () => {
    const r = computeClipBoundary({ ...base, peakTime: 18 });
    expect(r.startTime).toBeGreaterThanOrEqual(base.sceneStart);
    // end should sit at/near a sentence end (with padding), not mid-word
    const endingSegments = segments.filter((s) => Math.abs(s.end - r.endTime) < 2.6);
    expect(endingSegments.length).toBeGreaterThan(0);
  });

  it("clips respect the requested min/max duration", () => {
    const r = computeClipBoundary({ ...base, peakTime: 20 });
    expect(r.endTime - r.startTime).toBeLessThanOrEqual(base.maxDuration + 0.5);
    expect(r.endTime - r.startTime).toBeGreaterThanOrEqual(
      Math.min(base.minDuration, base.sceneEnd - base.sceneStart) - 0.5,
    );
  });

  it("prefers to end after the concluding sentence (paddingAfter honored)", () => {
    // Peak near the "Fine. You want the truth?" line → end should include its conclusion.
    const r = computeClipBoundary({ ...base, peakTime: 31, sceneStart: 28, sceneEnd: 44 });
    expect(r.endTime).toBeGreaterThanOrEqual(34.0); // sentence ends at 34.0
  });

  it("snaps the start back toward the preceding speech gap", () => {
    const r = computeClipBoundary({ ...base, peakTime: 20, sceneStart: 9 });
    const gapEnd = 16.0; // "I was at work..." ends at 16
    expect(r.startTime).toBeGreaterThanOrEqual(9);
    expect(r.startTime).toBeLessThanOrEqual(gapEnd + 3.5);
  });

  it("respects the source duration bound", () => {
    const r = computeClipBoundary({ ...base, peakTime: 35, sourceDuration: 36 });
    expect(r.endTime).toBeLessThanOrEqual(36);
  });

  it("transcriptForWindow extracts text inside the window only", () => {
    const { text } = transcriptForWindow(segments, 16.5, 24.5);
    expect(text).toContain("Don't lie to me!");
    expect(text).not.toContain("Where were you last night?");
  });
});

describe("scene window building", () => {
  it("creates windows between detected cuts", () => {
    const { windows, fallback } = buildSceneWindows(
      [
        { time: 30, score: 0.9 },
        { time: 75, score: 0.8 },
      ],
      120,
      60,
    );
    expect(fallback).toBe(false);
    expect(windows.length).toBe(3);
    expect(windows[0]?.start).toBe(0);
    expect(windows[1]?.start).toBe(30);
    expect(windows[2]?.end).toBe(120);
  });

  it("falls back to even segmentation when no cuts are detected", () => {
    const { windows, fallback } = buildSceneWindows([], 90, 60);
    expect(fallback).toBe(true);
    expect(windows.length).toBeGreaterThan(1);
  });

  it("splits very long scenes to stay near the max clip length", () => {
    const { windows } = buildSceneWindows([{ time: 0.1, score: 0.5 }], 300, 60);
    expect(windows.every((w) => w.duration <= 60 * 1.6)).toBe(true);
  });

  it("merges micro-scenes under 2s into their neighbor", () => {
    const { windows } = buildSceneWindows(
      [
        { time: 30, score: 0.9 },
        { time: 30.8, score: 0.4 },
        { time: 60, score: 0.9 },
      ],
      90,
      60,
    );
    expect(windows.some((w) => w.duration < 2)).toBe(false);
  });
});

describe("duplicate removal (IoU)", () => {
  it("detects heavy overlap", () => {
    expect(iou({ startTime: 10, endTime: 40 }, { startTime: 12, endTime: 42 })).toBeGreaterThan(
      0.3,
    );
    expect(isDuplicate({ startTime: 10, endTime: 40 }, [{ startTime: 12, endTime: 42 }])).toBe(
      true,
    );
  });

  it("keeps genuinely different windows", () => {
    expect(isDuplicate({ startTime: 0, endTime: 20 }, [{ startTime: 100, endTime: 130 }])).toBe(
      false,
    );
  });

  it("iou of identical windows is 1", () => {
    expect(iou({ startTime: 5, endTime: 10 }, { startTime: 5, endTime: 10 })).toBe(1);
  });
});
