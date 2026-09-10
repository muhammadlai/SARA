/**
 * Sara AI — emotion engine.
 *
 * Simulated character states (NOT claims of real consciousness): a small
 * lexicon-driven state machine with baseline decay toward "neutral"/"happy".
 * Emotion colors response wording, TTS style and the avatar expression.
 */
import type { LiveEvent, SaraEmotion } from "./types.js";

interface EmotionRule {
  test: RegExp;
  emotion: SaraEmotion;
  intensity: number;
}

const COMMENT_RULES: EmotionRule[] = [
  {
    test: /\b(congrats|congratulations|mubarak|shabash|well done|winner)\b/i,
    emotion: "excited",
    intensity: 0.8,
  },
  {
    test: /\b(love you|pyaar|pyar|you are (?:the )?best|adorable|cute|beautiful)\b/i,
    emotion: "happy",
    intensity: 0.7,
  },
  { test: /\b(thank you|thanks|shukriya|mehrabani|gift)\b/i, emotion: "thankful", intensity: 0.7 },
  {
    test: /\b(why|kya matlab|samajh|confused|what do you mean|matlab)\b/i,
    emotion: "curious",
    intensity: 0.5,
  },
  { test: /\b(sad|dukh|rona|crying|miss you|alone|akela)\b/i, emotion: "sad", intensity: 0.6 },
  { test: /\b(hahaha|lol|lmao|mazaak|joke|funny|haso)\b/i, emotion: "playful", intensity: 0.7 },
  {
    test: /\b(omg|what?!|kya?!|seriously|really\?|unbelievable)\b/i,
    emotion: "surprised",
    intensity: 0.6,
  },
  {
    test: /\b(tell me more|acha?|interesting|suno|kya socha)\b/i,
    emotion: "curious",
    intensity: 0.4,
  },
];

const EVENT_RULES: Partial<Record<LiveEvent["kind"], { emotion: SaraEmotion; intensity: number }>> =
  {
    follow: { emotion: "happy", intensity: 0.75 },
    gift: { emotion: "thankful", intensity: 0.9 },
    share: { emotion: "excited", intensity: 0.7 },
    battle_start: { emotion: "excited", intensity: 0.8 },
    join: { emotion: "happy", intensity: 0.4 },
  };

export class EmotionEngine {
  private current: SaraEmotion = "neutral";
  private intensity = 0.3;
  private updatedAt = Date.now();

  get emotion(): SaraEmotion {
    return this.decay().current;
  }

  get currentIntensity(): number {
    this.decay();
    return Number(this.intensity.toFixed(2));
  }

  /** Feed a viewer comment; returns the new state. */
  observeComment(text: string): { emotion: SaraEmotion; intensity: number } {
    this.decay();
    let best: EmotionRule | null = null;
    for (const rule of COMMENT_RULES) {
      if (rule.test.test(text) && (!best || rule.intensity > best.intensity)) best = rule;
    }
    if (best) this.apply(best.emotion, best.intensity);
    return { emotion: this.current, intensity: this.currentIntensity };
  }

  observeEvent(event: LiveEvent): { emotion: SaraEmotion; intensity: number } {
    this.decay();
    const rule = EVENT_RULES[event.kind];
    if (rule) this.apply(rule.emotion, rule.intensity);
    return { emotion: this.current, intensity: this.currentIntensity };
  }

  /** Direct override (operator / brain). */
  set(emotion: SaraEmotion, intensity = 0.6): void {
    this.apply(emotion, intensity);
  }

  reset(): void {
    this.current = "neutral";
    this.intensity = 0.3;
    this.updatedAt = Date.now();
  }

  private apply(emotion: SaraEmotion, intensity: number): void {
    this.current = emotion;
    this.intensity = Math.min(1, Math.max(this.intensity * 0.4, intensity));
    this.updatedAt = Date.now();
  }

  /** Decay toward a calm baseline: ~1 intensity point per 90s. */
  private decay(): this {
    const elapsed = (Date.now() - this.updatedAt) / 1000;
    if (elapsed > 15 && this.current !== "neutral") {
      const drop = elapsed / 90;
      this.intensity = Math.max(0.15, this.intensity - drop);
      if (this.intensity <= 0.16) {
        this.current = this.intensity <= 0.16 ? "calm" : this.current;
        if (elapsed > 240) this.current = "neutral";
      }
    }
    return this;
  }
}

/** Map emotion → avatar expression parameters (photo mode + engine prompts). */
export function emotionToExpression(emotion: SaraEmotion): {
  smile: number;
  eyebrowRaise: number;
  energyLevel: number;
} {
  switch (emotion) {
    case "excited":
      return { smile: 0.9, eyebrowRaise: 0.7, energyLevel: 1 };
    case "happy":
      return { smile: 0.8, eyebrowRaise: 0.3, energyLevel: 0.8 };
    case "playful":
      return { smile: 0.75, eyebrowRaise: 0.5, energyLevel: 0.75 };
    case "thankful":
      return { smile: 0.7, eyebrowRaise: 0.2, energyLevel: 0.6 };
    case "surprised":
      return { smile: 0.3, eyebrowRaise: 0.9, energyLevel: 0.85 };
    case "curious":
      return { smile: 0.4, eyebrowRaise: 0.6, energyLevel: 0.6 };
    case "confused":
    case "thinking":
      return { smile: 0.2, eyebrowRaise: 0.5, energyLevel: 0.4 };
    case "sad":
      return { smile: 0.05, eyebrowRaise: 0.1, energyLevel: 0.25 };
    case "calm":
      return { smile: 0.45, eyebrowRaise: 0.1, energyLevel: 0.35 };
    default:
      return { smile: 0.5, eyebrowRaise: 0.2, energyLevel: 0.5 };
  }
}
