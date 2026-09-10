/**
 * Natural-language search → structured criteria. Deterministic rule-based
 * parsing (no LLM required), so it is fast, offline and fully testable.
 * Handles phrasings like:
 *   "Find the funniest scenes"            → categories: [funny]
 *   "top 10 emotional moments"            → clipCount: 10, categories: [emotional]
 *   "scenes between 20 and 45 seconds"    → min 20, max 45
 *   "best scenes for YouTube Shorts"      → aspectRatio: 9:16
 * Unrecognized words are returned in `unmatched` for transparency.
 */
import type { AspectRatio, SearchCriteria } from "./types.js";
import { ASPECT_RATIOS } from "./types.js";
import { CLIP_CATEGORY_LABELS, type ClipCategory } from "./schema.js";

const CATEGORY_KEYWORDS: Array<[ClipCategory, RegExp]> = [
  ["funny", /\b(funny|funniest|humor|humour|comedy|comedic|hilarious|joke|laugh)\b/i],
  ["emotional", /\b(emotional|emotion|feelings|heartfelt|touching|dramatic)\b/i],
  ["romantic", /\b(romantic|romance|love)\b/i],
  ["sad", /\b(sad|saddest|cry|crying|tears|tragic|tragedy)\b/i],
  ["shocking", /\b(shocking|shocked|shock|jaw.?drop|unbelievable|twist)\b/i],
  ["suspense", /\b(suspense|suspenseful|thrilling|thriller|tense|intense)\b/i],
  ["argument", /\b(argu\w*|fight|fighting|confront\w*|yelling|shouting|anger|angry|conflict)\b/i],
  ["inspirational", /\b(inspir\w*|motivat\w*|uplifting|powerful|hope)\b/i],
  ["story", /\b(story|plot|pivotal|important (moment|scene|part)|turning point)\b/i],
  ["dialogue", /\b(dialogue|dialog|quote|quotes|line|lines|conversation|speech)\b/i],
  ["hook", /\b(hook|hooks|opener|intro|opening)\b/i],
  ["general", /\b(best|top|highlight|highlights|moments|scenes|clips|moments?)\b/i],
];

export function parseSearchQuery(query: string): SearchCriteria {
  const text = query.toLowerCase();
  const criteria: SearchCriteria = { categories: [], unmatched: [] };

  // Clip count: "top 10", "10 scenes", "find 5".
  const countMatch =
    /(?:top|best)?\s*(\d{1,2})\s*(?:best\s+)?(?:emotional\s+|funny\s+|romantic\s+|sad\s+|shocking\s+|suspense\w*\s+|argu\w*\s+|inspir\w*\s+)?(?:scenes?|moments?|clips?|highlights?)/.exec(
      text,
    ) ?? /\b(?:find|get|show)\s+(\d{1,2})\b/.exec(text);
  if (countMatch) {
    const n = Number.parseInt(countMatch[1] ?? "", 10);
    if (Number.isFinite(n) && n >= 1 && n <= 50) criteria.clipCount = n;
  }

  // Duration windows: "between 20 and 45 seconds", "20 to 45s",
  // "under 30 seconds", "at least 20 seconds".
  const between =
    /\b(?:between|from)\s+(\d{1,3})\s*(?:and|to|-|–)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/.exec(
      text,
    );
  const to = /\b(\d{1,3})\s*(?:to|-|–)\s*(\d{1,3})\s*(?:seconds?|secs?|s)\b/.exec(text);
  const under =
    /\b(?:under|less than|max(?:imum)?(?: of)?|shorter than)\s+(\d{1,3})\s*(?:seconds?|secs?|s)?\b/.exec(
      text,
    );
  const atLeast =
    /\b(?:at least|over|more than|min(?:imum)?(?: of)?|longer than)\s+(\d{1,3})\s*(?:seconds?|secs?|s)?\b/.exec(
      text,
    );
  if (between ?? to) {
    const m = (between ?? to) as RegExpExecArray;
    criteria.minDurationSeconds = Number.parseInt(m[1] ?? "0", 10);
    criteria.maxDurationSeconds = Number.parseInt(m[2] ?? "0", 10);
  } else {
    if (under) criteria.maxDurationSeconds = Number.parseInt(under[1] ?? "0", 10);
    if (atLeast) criteria.minDurationSeconds = Number.parseInt(atLeast[1] ?? "0", 10);
  }

  // Aspect ratio: Shorts / vertical / reel / tiktok → 9:16, etc.
  if (/\b(shorts?|vertical|reel[s]?|tiktok|9:16|9 by 16)\b/i.test(text)) {
    criteria.aspectRatio = "9:16";
  } else if (/\b(landscape|16:9|youtube video|widescreen)\b/i.test(text)) {
    criteria.aspectRatio = "16:9";
  } else if (/\b(square|1:1|instagram post)\b/i.test(text)) {
    criteria.aspectRatio = "1:1";
  }

  // Categories — every matched keyword adds its category once.
  const matched = new Set<ClipCategory>();
  for (const [category, pattern] of CATEGORY_KEYWORDS) {
    if (category === "general") continue; // added below as the fallback
    if (pattern.test(text)) matched.add(category);
  }
  if (matched.size === 0 && /\b(best|top|highlight|moments?|scenes?|clips?)\b/i.test(text)) {
    matched.add("general");
  }
  criteria.categories = [...matched];

  // Collect words we could not map (letters only, >2 chars, not stopwords).
  const known = new RegExp(
    [
      ...CATEGORY_KEYWORDS.map(([, p]) => p.source),
      "\\b(?:find|the|a|an|of|from|this|video|where|with|for|and|in|me|sara|between|and|to|under|over|at least|less|more|than|seconds?|secs?|top|best|good|great|most|youtube|shorts?|please)\\b",
      "\\b\\d+\\b",
      "[:\\-–]",
    ].join("|"),
    "gi",
  );
  const leftover = text.replace(known, " ").match(/[a-z']{3,}/g) ?? [];
  criteria.unmatched = [...new Set(leftover)].slice(0, 8);

  return criteria;
}

/** Human-readable summary of parsed criteria (for UI + agent messages). */
export function describeCriteria(criteria: SearchCriteria): string {
  const parts: string[] = [];
  if (criteria.categories.length > 0) {
    parts.push(
      `categories: ${criteria.categories.map((c) => CLIP_CATEGORY_LABELS[c as ClipCategory] ?? c).join(", ")}`,
    );
  }
  if (criteria.clipCount !== undefined) parts.push(`count: ${criteria.clipCount}`);
  if (criteria.minDurationSeconds !== undefined) parts.push(`min: ${criteria.minDurationSeconds}s`);
  if (criteria.maxDurationSeconds !== undefined) parts.push(`max: ${criteria.maxDurationSeconds}s`);
  if (criteria.aspectRatio) parts.push(`aspect: ${criteria.aspectRatio}`);
  if (criteria.unmatched.length > 0) parts.push(`unrecognized: ${criteria.unmatched.join(", ")}`);
  return parts.length > 0 ? parts.join(" · ") : "no specific criteria — using overall ranking";
}

/** True when the string is one of the known aspect ratios. */
export function isAspectRatio(value: string): value is AspectRatio {
  return (ASPECT_RATIOS as readonly string[]).includes(value);
}
