/**
 * Clip boundary intelligence. Never cut arbitrary fixed chunks:
 *  - the window is centered on the scene's emotional peak,
 *  - the start snaps back to a transcript gap (so the first sentence starts
 *    cleanly, with configurable lead padding),
 *  - the end snaps forward to the end of the sentence that concludes the
 *    thought (never mid-sentence when avoidable),
 *  - the result is clamped to [min,max] duration and to the source bounds.
 */
import type { TranscriptSegment } from "./types.js";

export interface BoundaryInput {
  sceneStart: number;
  sceneEnd: number;
  peakTime: number;
  minDuration: number;
  maxDuration: number;
  segments: TranscriptSegment[];
  paddingBefore: number;
  paddingAfter: number;
  sourceDuration: number;
}

export interface BoundaryResult {
  startTime: number;
  endTime: number;
  snappedStart: boolean;
  snappedEnd: boolean;
}

const SENTENCE_END = /[.!?。！？।]["')\]]?$/;

function lastGapBefore(segments: TranscriptSegment[], time: number): number | null {
  let gap: number | null = null;
  for (let i = 0; i < segments.length; i += 1) {
    const current = segments[i];
    if (current === undefined) continue;
    if (current.start >= time) break;
    const next = segments[i + 1];
    if (next === undefined || next.start - current.end > 0.25) {
      // A pause after this segment — candidate cut point.
      if (current.end <= time) gap = current.end;
    }
  }
  return gap;
}

function sentenceEndAfter(
  segments: TranscriptSegment[],
  time: number,
  horizon: number,
): number | null {
  for (const segment of segments) {
    if (segment.end >= time && segment.end <= horizon && SENTENCE_END.test(segment.text.trim())) {
      return segment.end;
    }
  }
  return null;
}

export function computeClipBoundary(input: BoundaryInput): BoundaryResult {
  const {
    sceneStart,
    sceneEnd,
    peakTime,
    minDuration,
    maxDuration,
    segments,
    paddingBefore,
    paddingAfter,
    sourceDuration,
  } = input;

  const sceneDuration = sceneEnd - sceneStart;
  // Ideal window length: whole scene if it fits, otherwise the max duration
  // centered on the emotional peak.
  let targetDuration = Math.min(Math.max(sceneDuration, minDuration), maxDuration);
  if (sceneDuration > maxDuration) {
    targetDuration = maxDuration;
  }

  let start = peakTime - targetDuration * 0.4; // slightly front-weighted (hook first)
  let end = start + targetDuration;

  // Snap the start to a speech gap at/just before the desired start.
  let snappedStart = false;
  const searchFrom = Math.max(sceneStart, start - Math.max(6, paddingBefore * 4));
  const gap = lastGapBefore(segments, start + 0.5);
  if (gap !== null && gap >= searchFrom && gap >= start - paddingBefore - 4) {
    start = Math.max(sceneStart, gap - Math.min(paddingBefore, 1.0));
    snappedStart = true;
  }

  // Snap the end to the conclusion of the sentence in progress near the end.
  let snappedEnd = false;
  const conclusion = sentenceEndAfter(segments, end - 2.5, end + paddingAfter + 4);
  if (conclusion !== null) {
    end = conclusion + Math.min(paddingAfter, 1.2);
    snappedEnd = true;
  }

  // Clamp to the requested duration window and the scene/source bounds.
  const lo = Math.max(sceneStart, 0);
  const hi = Math.min(sceneEnd, sourceDuration > 0 ? sourceDuration : sceneEnd);
  if (end > hi) end = hi;
  if (end - start > maxDuration) end = start + maxDuration;
  if (end - start < Math.min(minDuration, hi - lo)) {
    end = Math.min(hi, start + minDuration);
  }
  if (start < lo) start = lo;
  if (end - start < 1) end = Math.min(hi, start + Math.min(maxDuration, hi - start));

  const round = (n: number) => Math.round(n * 100) / 100;
  return {
    startTime: round(start),
    endTime: round(end),
    snappedStart,
    snappedEnd,
  };
}

/** Transcript text inside [start,end], plus a short preview. */
export function transcriptForWindow(
  segments: TranscriptSegment[],
  start: number,
  end: number,
): { text: string; preview: string } {
  const inside = segments
    .filter((s) => s.end > start && s.start < end)
    .map((s) => s.text.trim())
    .filter(Boolean);
  const text = inside.join(" ");
  const preview = text.length > 220 ? `${text.slice(0, 217)}…` : text;
  return { text, preview };
}
