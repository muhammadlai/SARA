import { describe, expect, it } from "vitest";
import {
  bestCategory,
  categoryScore,
  resolveCategories,
  overallScore,
  sanitizeScores,
  durationFitBonus,
  DIMENSION_WEIGHTS,
} from "../src/index.js";
import { DIMENSIONS, type DimensionScores } from "../src/types.js";

const scores = (overrides: Partial<DimensionScores> = {}): DimensionScores =>
  sanitizeScores({
    dialogue: 60,
    emotional: 60,
    storyImportance: 60,
    humor: 60,
    suspense: 60,
    conflict: 60,
    surprise: 60,
    romance: 60,
    sadness: 60,
    inspirational: 60,
    visualActivity: 60,
    dialogueCompleteness: 60,
    hook: 60,
    contextCompleteness: 60,
    ...overrides,
  });

describe("scoring algorithm", () => {
  it("scores every dimension 0-100 after sanitizing", () => {
    const s = sanitizeScores({ humor: 900, sadness: -20, dialogue: 55 });
    expect(s.humor).toBe(100);
    expect(s.sadness).toBe(0);
    expect(s.dialogue).toBe(55);
    for (const d of DIMENSIONS) expect(typeof s[d]).toBe("number");
  });

  it("fills missing dimensions with a neutral 50", () => {
    const s = sanitizeScores({});
    expect(s.emotional).toBe(50);
    expect(s.hook).toBe(50);
  });

  it("computes the overall score as the normalized weighted sum", () => {
    // Every dimension at 60 → overall must be exactly 60 regardless of weights.
    expect(overallScore(scores())).toBe(60);
    // Weight check: raising the heaviest-weighted dimensions moves the score most.
    const highEmotional = overallScore(scores({ emotional: 100 }));
    const lowSadness = overallScore(scores({ sadness: 100 }));
    expect(highEmotional).toBeGreaterThan(lowSadness); // emotional weight 0.12 > sadness 0.04
  });

  it("never lets a single dimension dominate", () => {
    const only = scores({ hook: 100 });
    expect(overallScore(only)).toBeLessThan(70); // hook weight is 0.08 of the total
    const wSum = Object.values(DIMENSION_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(wSum).toBeCloseTo(1.0, 5);
  });

  it("caps the duration-fit bonus within documented bounds", () => {
    expect(durationFitBonus(30, 15, 60)).toBe(2);
    expect(durationFitBonus(600, 15, 60)).toBe(-4);
    expect(durationFitBonus(90, 15, 60)).toBeLessThanOrEqual(0);
  });
});

describe("category profiles", () => {
  it("funny profile prioritizes humor over romance", () => {
    const funny = categoryScore("funny", scores({ humor: 100 }));
    const romanticScene = categoryScore("funny", scores({ romance: 100 }));
    expect(funny).toBeGreaterThan(romanticScene);
  });

  it("argument profile reacts most to conflict", () => {
    const arg = categoryScore("argument", scores({ conflict: 100 }));
    const other = categoryScore("argument", scores({ humor: 100 }));
    expect(arg).toBeGreaterThan(other);
  });

  it("picks the best matching category", () => {
    expect(bestCategory(scores({ humor: 95 }))).toBe("funny");
    expect(bestCategory(scores({ romance: 95 }))).toBe("romantic");
    expect(bestCategory(scores({ conflict: 95, dialogue: 90 }))).toBe("argument");
  });

  it("resolves requested categories with the documented fallback", () => {
    expect(resolveCategories([])).toHaveLength(12);
    expect(resolveCategories(["general"])).toHaveLength(12);
    expect(resolveCategories(["funny", "bogus"])).toEqual(["funny"]);
    expect(resolveCategories(["sad", "emotional"])).toEqual(["sad", "emotional"]);
  });
});
