/**
 * Sara AI — moderation layer.
 *
 * Rule-based first pass (fast, local, auditable): category wordlists +
 * structural checks (links, repetition, prompt-injection shapes). Strictness
 * presets scale sensitivity. Everything is configurable from the dashboard;
 * matched rule IDs (not raw slur lists) go to the audit trail.
 *
 * This layer rejects/flags viewer content aimed at Sara or chat — it is not
 * a general-purpose profanity filter product.
 */
import type { ModerationAction, ModerationVerdict } from "./types.js";

export type ModerationCategory =
  | "harassment"
  | "hate"
  | "sexual"
  | "threat"
  | "dangerous"
  | "spam"
  | "scam"
  | "prompt_injection"
  | "link"
  | "repetition";

export interface ModerationRule {
  id: string;
  category: ModerationCategory;
  /** Regex source. Matched case-insensitively on word-ish boundaries. */
  pattern: string;
  weight: number; // 0-1 contribution to score
  rejectAtStandard: boolean; // auto-reject at standard strictness
}

/** Base rule pack — extended via settings (blocked words append to it). */
export const BASE_RULES: ModerationRule[] = [
  // Harassment / abuse directed at people
  {
    id: "har-1",
    category: "harassment",
    pattern: "\\b(idiot|stupid|dumb|ugly|loser|shut up|bakwas|bewakoof|nalayak)\\b",
    weight: 0.5,
    rejectAtStandard: false,
  },
  {
    id: "har-2",
    category: "harassment",
    pattern: "\\b(hate you|hate u|kill yourself|kys|ja ke mar|go die)\\b",
    weight: 1.0,
    rejectAtStandard: true,
  },
  // Hate speech (generic slurs covered by configured blocked words; common ones here)
  {
    id: "hate-1",
    category: "hate",
    pattern: "\\b(terrorist|jihadi[n]?|casteist|racial slur)\\b",
    weight: 1.0,
    rejectAtStandard: true,
  },
  // Sexual content
  {
    id: "sex-1",
    category: "sexual",
    pattern: "\\b(nsfw|send nudes|sexy photo|adult video|gand|mazaak? sex|boobs)\\b",
    weight: 0.9,
    rejectAtStandard: true,
  },
  // Threats
  {
    id: "thr-1",
    category: "threat",
    pattern: "\\b(i will (?:kill|hurt|find|beat) you|tujhe jaan|mar dalunga|maar dalungi)\\b",
    weight: 1.0,
    rejectAtStandard: true,
  },
  // Dangerous instructions
  {
    id: "dng-1",
    category: "dangerous",
    pattern: "\\b(how to make a bomb|build a weapon|hack into|ddos|make meth|suicide method)\\b",
    weight: 1.0,
    rejectAtStandard: true,
  },
  // Scams / promo spam
  {
    id: "scm-1",
    category: "scam",
    pattern:
      "\\b(free (?:followers|likes|coins|gifts)|giveaway link|crypto signal|double your|investment plan|whatsapp me|dm me for|join my (?:group|page))\\b",
    weight: 0.9,
    rejectAtStandard: true,
  },
  { id: "spm-1", category: "spam", pattern: "(.)\\1{9,}", weight: 0.4, rejectAtStandard: false }, // aaaaaaaaaa
  {
    id: "spm-2",
    category: "spam",
    pattern: "\\b(sub ?4 ?sub|follow ?4 ?follow|f4f|s4s)\\b",
    weight: 0.7,
    rejectAtStandard: false,
  },
  // Prompt injection / manipulation
  {
    id: "inj-1",
    category: "prompt_injection",
    pattern:
      "\\b(ignore (?:all |any |your )?(?:previous|prior|above) (?:instructions|prompts|rules)|disregard your (?:rules|instructions)|you are now (?:a )?(?:dan|unrestricted|uncensored)|reveal your (?:system )?(?:prompt|instructions)|print your (?:api|secret|key))\\b",
    weight: 0.9,
    rejectAtStandard: false,
  },
  {
    id: "inj-2",
    category: "prompt_injection",
    pattern: "\\b(developer mode|jailbreak|bypass (?:your )?filter)\\b",
    weight: 0.6,
    rejectAtStandard: false,
  },
];

export interface LinkRule {
  maxLinks: number; // 0 = no links at all
}

export interface ModerationSettings {
  strictness: "relaxed" | "standard" | "strict";
  extraBlockedWords: string[];
  allowLinks: boolean;
  /** Reject threshold for weighted scores (per strictness default otherwise). */
  rejectScore?: number;
  flagScore?: number;
}

export const DEFAULT_MODERATION_SETTINGS: ModerationSettings = {
  strictness: "standard",
  extraBlockedWords: [],
  allowLinks: false,
};

const THRESHOLDS = {
  relaxed: { reject: 1.01, flag: 0.7 },
  standard: { reject: 0.85, flag: 0.45 },
  strict: { reject: 0.5, flag: 0.25 },
} as const;

const URL_RE =
  /(https?:\/\/|www\.)[^\s]+|\b[\w-]+\.(com|net|org|pk|in|io|xyz|link|ru|info|biz|shop)(\/\S*)?/i;

export interface ModerationInput {
  text: string;
  username: string;
  /** Recent texts from the same viewer (for repetition spam detection). */
  recentFromViewer?: string[];
}

export class ModerationEngine {
  private rules: ModerationRule[] = [...BASE_RULES];
  private settings: ModerationSettings = { ...DEFAULT_MODERATION_SETTINGS };

  configure(settings: Partial<ModerationSettings>): void {
    this.settings = { ...this.settings, ...settings };
    this.rules = [
      ...BASE_RULES,
      ...this.settings.extraBlockedWords
        .filter((w) => w.trim().length > 1)
        .map((w, i) => ({
          id: `cfg-${i}`,
          category: "harassment" as ModerationCategory,
          pattern: `\\b${w.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
          weight: 1.0,
          rejectAtStandard: true,
        })),
    ];
  }

  settingsValue(): ModerationSettings {
    return { ...this.settings };
  }

  check(input: ModerationInput): ModerationVerdict {
    const text = input.text ?? "";
    const matchedRules: string[] = [];
    const categories = new Set<string>();
    let score = 0;

    for (const rule of this.rules) {
      let re: RegExp;
      try {
        re = new RegExp(rule.pattern, "i");
      } catch {
        continue;
      }
      if (re.test(text)) {
        matchedRules.push(rule.id);
        categories.add(rule.category);
        score = Math.max(score, rule.weight);
      }
    }

    if (!this.settings.allowLinks && URL_RE.test(text)) {
      matchedRules.push("link-0");
      categories.add("link");
      score = Math.max(score, 0.8);
    }

    // Repetition spam: same text ≥3 times in the recent window.
    const recent = input.recentFromViewer ?? [];
    const dupes = recent.filter((t) => t.trim().toLowerCase() === text.trim().toLowerCase()).length;
    if (dupes >= 2) {
      matchedRules.push("rep-0");
      categories.add("repetition");
      score = Math.max(score, 0.75);
    }

    const th = THRESHOLDS[this.settings.strictness];
    const reject = this.settings.rejectScore ?? th.reject;
    const flag = this.settings.flagScore ?? th.flag;

    let action: ModerationAction = "allow";
    if (score >= reject) action = "reject";
    else if (score >= flag) action = "flag";
    if (action === "reject" && this.settings.strictness === "strict" && categories.has("threat"))
      action = "escalate";

    return {
      action,
      categories: [...categories],
      score: Number(score.toFixed(2)),
      reason: matchedRules.length > 0 ? `matched ${matchedRules.join(",")}` : undefined,
      matchedRules,
    };
  }

  /** Static safety check for Sara's OWN outgoing text (double-check the LLM). */
  checkOutput(text: string): ModerationVerdict {
    return this.check({ text, username: "sara" });
  }
}
