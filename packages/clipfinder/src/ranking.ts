/**
 * Candidate generation & ranking: analyzed scenes → deduped, ranked clips.
 *
 * Primary ranking score:
 *  - no specific categories requested → the scene's overall score,
 *  - categories requested → the scene's best score under the requested
 *    category profiles ("find the funniest" really prioritizes humor).
 * The chosen category label is the profile that produced that score.
 */
import { categoryScore, resolveCategories } from "./categories.js";
import type { ClipCategory } from "./schema.js";
import type { DimensionScores } from "./types.js";
import { computeClipBoundary, transcriptForWindow } from "./boundaries.js";
import { isDuplicate } from "./dedupe.js";
import { durationFitBonus } from "./scoring.js";
import type { ClipFinderOptions, Scene, TranscriptSegment } from "./types.js";

export interface ClipDraft {
  sceneId: string;
  category: ClipCategory;
  startTime: number;
  endTime: number;
  duration: number;
  score: number;
  reason: string;
  transcriptPreview: string;
  snappedStart: boolean;
  snappedEnd: boolean;
}

export interface RankInput {
  scenes: Scene[];
  segments: TranscriptSegment[];
  options: ClipFinderOptions;
  clipCount: number;
  sourceDuration: number;
}

export function rankScenes(input: RankInput): ClipDraft[] {
  const { scenes, segments, options, clipCount, sourceDuration } = input;
  const requested = resolveCategories(options.categories);
  const onlyGeneral =
    options.categories.length === 0 || options.categories.every((c) => c === "general");

  const drafts: ClipDraft[] = [];
  for (const scene of scenes) {
    if (scene.analysis === null) continue;
    const { scores, peakTime, summary } = scene.analysis;

    let primaryScore: number;
    let category: ClipCategory;
    if (onlyGeneral) {
      primaryScore = scene.analysis.overall;
      category = bestOf(requested, scores);
    } else {
      category = bestOf(requested, scores);
      primaryScore = categoryScore(category, scores);
    }

    const boundary = computeClipBoundary({
      sceneStart: scene.startTime,
      sceneEnd: scene.endTime,
      peakTime,
      minDuration: options.minDurationSeconds,
      maxDuration: options.maxDurationSeconds,
      segments,
      paddingBefore: options.paddingBeforeSeconds,
      paddingAfter: options.paddingAfterSeconds,
      sourceDuration,
    });
    const duration = boundary.endTime - boundary.startTime;
    const { text, preview } = transcriptForWindow(segments, boundary.startTime, boundary.endTime);

    const boundaryNote = boundary.snappedEnd ? "" : " Cut sits at a scene edge.";
    drafts.push({
      sceneId: scene.id,
      category,
      startTime: boundary.startTime,
      endTime: boundary.endTime,
      duration,
      score:
        Math.round(
          (primaryScore +
            durationFitBonus(duration, options.minDurationSeconds, options.maxDurationSeconds)) *
            10,
        ) / 10,
      reason: `${summary}${boundaryNote}`.trim(),
      transcriptPreview: preview.length > 0 ? preview : "(no dialogue in this window)",
      snappedStart: boundary.snappedStart,
      snappedEnd: boundary.snappedEnd,
    });
    void text;
  }

  // Highest score first; drop overlaps; keep at most clipCount.
  drafts.sort((a, b) => b.score - a.score);
  const accepted: ClipDraft[] = [];
  for (const draft of drafts) {
    if (accepted.length >= clipCount) break;
    if (isDuplicate(draft, accepted)) continue;
    accepted.push(draft);
  }
  return accepted;
}

function bestOf(categories: ClipCategory[], scores: DimensionScores): ClipCategory {
  let best: ClipCategory = categories[0] ?? "general";
  let bestScore = -1;
  for (const category of categories) {
    const s = categoryScore(category, scores);
    if (s > bestScore) {
      bestScore = s;
      best = category;
    }
  }
  return best;
}
