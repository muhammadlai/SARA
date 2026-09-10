/**
 * Duplicate/overlap removal. Greedy highest-score-first with an
 * Intersection-over-Union threshold (default 0.30): clips that largely
 * re-cover the same footage are dropped in favor of the better-ranked one.
 */
export interface OverlapWindow {
  startTime: number;
  endTime: number;
}

export function iou(a: OverlapWindow, b: OverlapWindow): number {
  const inter = Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime);
  if (inter <= 0) return 0;
  const union = Math.max(a.endTime, b.endTime) - Math.min(a.startTime, b.startTime);
  return inter / union;
}

export function isDuplicate(
  candidate: OverlapWindow,
  accepted: OverlapWindow[],
  threshold = 0.3,
): boolean {
  return accepted.some((existing) => iou(candidate, existing) > threshold);
}
