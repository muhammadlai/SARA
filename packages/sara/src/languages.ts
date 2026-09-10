/**
 * Sara AI — language utilities.
 *
 * Priorities: English, Urdu, Roman Urdu, Hindi. Detection is heuristic and
 * dependency-free: script ranges first, then Roman-Urdu/Hinglish lexicon
 * markers to separate roman-ur from en.
 */
import type { SaraLanguage, TtsLanguage } from "./types.js";

const URDU_RANGE = /[\u0600-\u06FF\u0750-\u077F]/;
const DEVANAGARI_RANGE = /[\u0900-\u097F]/;

/** Words that mark Roman Urdu / Hinglish latin-script writing. */
const ROMAN_URDU_MARKERS = new Set([
  "kia",
  "kya",
  "kyu",
  "kyun",
  "kyon",
  "haal",
  "hal",
  "hai",
  "hain",
  "ho",
  "hun",
  "hoon",
  "kahan",
  "kahaan",
  "kaise",
  "kaisay",
  "kaisi",
  "acha",
  "achha",
  "theek",
  "thik",
  "mera",
  "meri",
  "tera",
  "tumhara",
  "aapka",
  "apka",
  "naam",
  "nam",
  "tum",
  "aap",
  "ap",
  "mai",
  "main",
  "mein",
  "kar",
  "karo",
  "karahi",
  "karrahi",
  "karrahe",
  "rahi",
  "raha",
  "rahe",
  "ajj",
  "aj",
  "aaj",
  "kal",
  "abhi",
  "batao",
  "bata",
  "suno",
  "dekho",
  "acha",
  "shukriya",
  "salam",
  "assalam",
  "alaikum",
  "asalam",
  "walikum",
  "khuda",
  "hafiz",
  "yaar",
  "bhai",
  "behen",
  "ammi",
  "abbu",
  "khana",
  "pani",
  "ghar",
  "dost",
  "pyar",
  "pyaar",
  "dil",
  "bilkul",
  "zara",
  "thora",
  "bohat",
  "bohot",
  "bahut",
  "kamal",
  "zabardast",
  "maza",
  "pata",
  "nahi",
  "nahin",
  "haan",
  "ji",
  "bhi",
  "aur",
  "par",
  "lekin",
  "toh",
  "se",
  "koi",
  "kuch",
  "sab",
  "log",
  "waqt",
  "time",
  "nahi",
  "kaise",
]);

const HINDI_ROMAN_MARKERS = new Set([
  "kaisa",
  "kaisi",
  "kya",
  "hai",
  "hain",
  "kahan",
  "mera",
  "meri",
  "naam",
  "tum",
  "aap",
  "kar",
  "raha",
  "rahi",
  "aaj",
  "kal",
  "achha",
  "thik",
  "dhanyawad",
  "namaste",
  "bhai",
  "didi",
  "khana",
  "paani",
  "ghar",
  "dost",
  "pyaar",
  "dil",
  "bahut",
  "maza",
  "nahin",
]);

export interface LanguageDetection {
  language: SaraLanguage;
  confidence: number;
  /** TTS voice language to use (urdu script → ur, else closest latin voice). */
  voice: TtsLanguage;
}

export function detectLanguage(text: string): LanguageDetection {
  const trimmed = text.trim();
  if (!trimmed) return { language: "en", confidence: 0.3, voice: "en" };

  if (DEVANAGARI_RANGE.test(trimmed)) {
    // Devanagari with stray latin or Urdu-script words → mixed.
    return URDU_RANGE.test(trimmed)
      ? { language: "mixed", confidence: 0.9, voice: "hi" }
      : { language: "hi", confidence: 0.95, voice: "hi" };
  }

  const hasUrdu = URDU_RANGE.test(trimmed);
  const hasLatin = /[a-zA-Z]/.test(trimmed);
  if (hasUrdu && hasLatin) return { language: "mixed", confidence: 0.9, voice: "ur" };
  if (hasUrdu) return { language: "ur", confidence: 0.95, voice: "ur" };

  const words = trimmed
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return { language: "en", confidence: 0.4, voice: "en" };

  let ur = 0;
  let hi = 0;
  for (const w of words) {
    if (ROMAN_URDU_MARKERS.has(w)) ur += 1;
    if (HINDI_ROMAN_MARKERS.has(w)) hi += 1;
  }
  const markerHits = Math.max(ur, hi);
  const ratio = markerHits / words.length;
  if (markerHits === 0) return { language: "en", confidence: 0.85, voice: "en" };
  if (ratio >= 0.2 || markerHits >= 2) {
    const language: SaraLanguage = hi > ur && ur === 0 ? "hi" : "roman-ur";
    return { language, confidence: Math.min(0.9, 0.5 + ratio), voice: "hi" };
  }
  // One weak marker → probably English sentence with a loan word.
  return { language: "en", confidence: 0.6, voice: "en" };
}

/** Pick the TTS language for a chosen Sara language. */
export function voiceFor(language: SaraLanguage): TtsLanguage {
  switch (language) {
    case "ur":
      return "ur";
    case "hi":
    case "roman-ur":
      return "hi";
    case "mixed":
    default:
      return "en";
  }
}

const GREET_RE =
  /\b(salam|assalam(o|u)?\s*alaikum|alaikum\s*(ass)?salam|hi|hello|hey|namaste|salaam)\b/i;
const NAME_RE =
  /\b(?:mera naam|my name is|main hoon|i am|mujhe (?:log )?kehte|h?ai[n]?)\s+([a-zA-Z\u0600-\u06FF]{2,20})\b/i;
const HOW_ARE_YOU_RE =
  /\b(kia|kya|kaise|kaisay|kaisi|how|kesa|kaisa)\b[^.?!]*\b(haal|hain|ho|are you|hai|rahi ho|rahe ho)\b/i;
const THANKS_RE = /\b(shukriya|thanks|thank you|dhanyawad|mehrabani)\b/i;
const WHO_ARE_YOU_RE =
  /\b(kaun ho|kon ho|who are you|who made you|who created you|tum kya ho|what are you|ap kaun|aap kaun|introduce|robot|insaan)\b|(?:کیا تم|کون ہو|روبوٹ)/i;
const REMEMBER_RE = /\b(remember|yaad|pata hai|do you know me|pehchan)\b|یاد/i;
const URDU_HOW_ARE_YOU_RE = /(کیسے ہیں|کیسے ہو|کیا حال)/;
const URDU_GREET_RE = /(سلام|السلام|علیکم)/;
const GOODBYE_RE = /\b(bye|good ?bye|khuda hafiz|allah hafiz|see ya|alvida)\b/i;
const LOVE_RE = /\b(love you|pyar|pyaar|i like you|shaadi|marry)\b/i;

export interface IntentGuess {
  intent:
    | "greeting"
    | "how_are_you"
    | "remember"
    | "remember"
    | "introduces_name"
    | "thanks"
    | "who_are_you"
    | "goodbye"
    | "affection"
    | "question"
    | "chat";
  /** Captured name for introduces_name, normalized. */
  name?: string;
  isQuestion: boolean;
}

/** Cheap deterministic intent detection used by the offline brain + queue priority. */
export function detectIntent(text: string): IntentGuess {
  const t = text.trim();
  const isQuestion =
    /\?/.test(t) ||
    /^(kya|kia|kaise|kaisa|kaun|kon|kab|kahan|kyun|kyu|what|who|where|when|why|how|can|do|does|is|are|tum|aap)\b/i.test(
      t,
    );
  const name = t.match(NAME_RE)?.[1];
  if (name && !/^(sara)$/i.test(name))
    return { intent: "introduces_name", name: titleCase(name), isQuestion };
  if (REMEMBER_RE.test(t)) return { intent: "remember", isQuestion };
  if (HOW_ARE_YOU_RE.test(t) || URDU_HOW_ARE_YOU_RE.test(t))
    return { intent: "how_are_you", isQuestion };
  if (WHO_ARE_YOU_RE.test(t)) return { intent: "who_are_you", isQuestion };
  if (GREET_RE.test(t) || URDU_GREET_RE.test(t)) return { intent: "greeting", isQuestion };
  if (THANKS_RE.test(t)) return { intent: "thanks", isQuestion };
  if (GOODBYE_RE.test(t)) return { intent: "goodbye", isQuestion };
  if (LOVE_RE.test(t)) return { intent: "affection", isQuestion };
  if (isQuestion) return { intent: "question", isQuestion };
  return { intent: "chat", isQuestion };
}

export function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) => (w.length > 0 ? (w[0] as string).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}
