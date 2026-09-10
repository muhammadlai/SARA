/**
 * The 12 clip categories. Each category has a dimension profile used to
 * compute a per-category score for every scene ("Find the funniest scenes"
 * → rank by the `funny` profile). `general` uses the overall weights.
 */
import { DIMENSION_WEIGHTS, normalizedWeightedSum } from "./scoring.js";
import type { Dimension, DimensionScores } from "./types.js";
import { CLIP_CATEGORIES, CLIP_CATEGORY_LABELS, type ClipCategory } from "./schema.js";

export const CATEGORY_PROFILES: Record<ClipCategory, Partial<Record<Dimension, number>>> = {
  emotional: { emotional: 0.5, sadness: 0.15, dialogue: 0.2, storyImportance: 0.15 },
  funny: { humor: 0.7, surprise: 0.15, dialogue: 0.15 },
  romantic: { romance: 0.6, emotional: 0.25, dialogue: 0.15 },
  sad: { sadness: 0.6, emotional: 0.3, storyImportance: 0.1 },
  shocking: { surprise: 0.4, conflict: 0.3, suspense: 0.2, visualActivity: 0.1 },
  suspense: { suspense: 0.6, storyImportance: 0.2, hook: 0.2 },
  argument: { conflict: 0.6, dialogue: 0.3, emotional: 0.1 },
  inspirational: { inspirational: 0.6, emotional: 0.25, storyImportance: 0.15 },
  story: { storyImportance: 0.6, contextCompleteness: 0.2, dialogue: 0.2 },
  dialogue: { dialogue: 0.6, dialogueCompleteness: 0.25, hook: 0.15 },
  hook: { hook: 0.7, surprise: 0.15, visualActivity: 0.15 },
  general: DIMENSION_WEIGHTS,
};

export { CLIP_CATEGORIES, CLIP_CATEGORY_LABELS };

export function categoryScore(category: ClipCategory, scores: DimensionScores): number {
  return Math.round(normalizedWeightedSum(scores, CATEGORY_PROFILES[category]) * 10) / 10;
}

/** Best-matching category for a scene — used when the user did not pick one. */
export function bestCategory(scores: DimensionScores): ClipCategory {
  let best: ClipCategory = "general";
  let bestScore = -1;
  for (const category of CLIP_CATEGORIES) {
    const score = categoryScore(category, scores);
    if (score > bestScore) {
      bestScore = score;
      best = category;
    }
  }
  return best;
}

/** Filter a requested category list down to valid ids (empty → all/general). */
export function resolveCategories(requested: string[]): ClipCategory[] {
  const valid = requested.filter((c): c is ClipCategory =>
    (CLIP_CATEGORIES as readonly string[]).includes(c),
  );
  if (valid.length === 0 || (valid.length === 1 && valid[0] === "general")) {
    return [...CLIP_CATEGORIES];
  }
  return valid;
}
