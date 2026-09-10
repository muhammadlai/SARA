import { describe, expect, it } from "vitest";
import { parseSearchQuery, describeCriteria } from "../src/nl-search.js";

describe("natural language search parsing", () => {
  it('"Find the best emotional scenes." → Emotional', () => {
    const c = parseSearchQuery("Find the best emotional scenes.");
    expect(c.categories).toContain("emotional");
  });

  it('"Find scenes where the characters argue." → Argument', () => {
    const c = parseSearchQuery("Find scenes where the characters argue.");
    expect(c.categories).toContain("argument");
  });

  it('"Find the funniest moments." → Funny', () => {
    const c = parseSearchQuery("Find the funniest moments.");
    expect(c.categories).toContain("funny");
  });

  it('"Find romantic scenes." → Romantic', () => {
    expect(parseSearchQuery("Find romantic scenes.").categories).toContain("romantic");
  });

  it('"Find shocking moments." → Shocking', () => {
    expect(parseSearchQuery("Find shocking moments.").categories).toContain("shocking");
  });

  it('"Find scenes with powerful dialogue." → Best Dialogue', () => {
    expect(parseSearchQuery("Find scenes with powerful dialogue.").categories).toContain(
      "dialogue",
    );
  });

  it('"Find the top 10 scenes for YouTube Shorts." → count 10, aspect 9:16', () => {
    const c = parseSearchQuery("Find the top 10 scenes for YouTube Shorts.");
    expect(c.clipCount).toBe(10);
    expect(c.aspectRatio).toBe("9:16");
  });

  it('"Find scenes between 20 and 45 seconds." → min 20 max 45', () => {
    const c = parseSearchQuery("Find scenes between 20 and 45 seconds.");
    expect(c.minDurationSeconds).toBe(20);
    expect(c.maxDurationSeconds).toBe(45);
  });

  it('"top 5 moments under 30 seconds" → count 5, max 30', () => {
    const c = parseSearchQuery("top 5 moments under 30 seconds");
    expect(c.clipCount).toBe(5);
    expect(c.maxDurationSeconds).toBe(30);
  });

  it('"at least 25 seconds of drama" → min 25', () => {
    expect(parseSearchQuery("at least 25 seconds of drama").minDurationSeconds).toBe(25);
  });

  it("reports unmatched words for transparency", () => {
    const c = parseSearchQuery("Find the completely zyxwv unique scenes");
    expect(c.unmatched).toContain("zyxwv");
  });

  it("describeCriteria is human readable", () => {
    const text = describeCriteria(
      parseSearchQuery("top 10 funny scenes between 20 and 45 seconds"),
    );
    expect(text).toContain("Funny");
    expect(text).toContain("count: 10");
    expect(text).toContain("min: 20s");
    expect(text).toContain("max: 45s");
  });
});
