/**
 * Scoring algorithm (documented — see docs/clip-finder.md §Scoring).
 *
 * 1. A `SceneUnderstandingProvider` scores each of the 14 dimensions 0–100.
 * 2. `overallScore` is the normalized weighted sum of all dimensions
 *    (weights below; they are normalized in code so they need not sum to 1).
 * 3. Each of the 12 categories has its own dimension profile; a scene's
 *    category score is the normalized weighted sum under that profile.
 * 4. Ranking applies small, documented adjustments:
 *      + duration fit bonus (clips inside the requested range rank higher),
 *      − overlap penalty is applied during dedupe, not here.
 * No single dimension can dominate the overall score.
 */
import { DIMENSIONS, type Dimension, type DimensionScores, type SceneAnalysis } from "./types.js";

export const DIMENSION_WEIGHTS: Record<Dimension, number> = {
  dialogue: 0.1,
  emotional: 0.12,
  storyImportance: 0.12,
  humor: 0.06,
  suspense: 0.08,
  conflict: 0.08,
  surprise: 0.06,
  romance: 0.05,
  sadness: 0.04,
  inspirational: 0.04,
  visualActivity: 0.08,
  dialogueCompleteness: 0.07,
  hook: 0.06,
  contextCompleteness: 0.04,
};

export function normalizedWeightedSum(
  scores: DimensionScores,
  weights: Partial<Record<Dimension, number>>,
): number {
  let sum = 0;
  let total = 0;
  for (const dimension of DIMENSIONS) {
    const w = weights[dimension];
    if (w === undefined) continue;
    sum += w * scores[dimension];
    total += w;
  }
  return total === 0 ? 0 : sum / total; // scores are already 0-100
}

/** Overall scene score across all 14 dimensions (0–100). */
export function overallScore(scores: DimensionScores): number {
  return Math.round(normalizedWeightedSum(scores, DIMENSION_WEIGHTS) * 10) / 10;
}

export function buildAnalysis(
  scores: DimensionScores,
  meta: { peakTime: number; summary: string; provider: string },
): SceneAnalysis {
  return { scores, overall: overallScore(scores), ...meta };
}

/** Clamp any provider-returned score into the legal 0–100 range. */
export function sanitizeScores(input: Partial<Record<Dimension, number>>): DimensionScores {
  const out = {} as DimensionScores;
  for (const dimension of DIMENSIONS) {
    const raw = input[dimension];
    const n = typeof raw === "number" && Number.isFinite(raw) ? raw : 50;
    out[dimension] = Math.max(0, Math.min(100, Math.round(n)));
  }
  return out;
}

/** Extra rank points (can be negative) for how well a clip fits the request. */
export function durationFitBonus(
  durationSeconds: number,
  minDuration: number,
  maxDuration: number,
): number {
  if (durationSeconds >= minDuration && durationSeconds <= maxDuration) return 2;
  const ideal = (minDuration + maxDuration) / 2;
  const drift = Math.abs(durationSeconds - ideal) / ideal;
  return Math.max(-4, -Math.round(drift * 6));
}
