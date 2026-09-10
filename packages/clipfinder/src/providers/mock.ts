/**
 * Mock providers for development/demo mode (MOCK_CLIP_FINDER=true or when no
 * AI credentials are configured). They are deterministic, produce plausible,
 * clearly-labeled DEMO/MOCK data, and never represent real analysis of the
 * actual audio/video content. The UI shows a MOCK badge for mock results.
 */
import { buildAnalysis, sanitizeScores } from "../scoring.js";
import type {
  ClipTitles,
  SceneAnalysis,
  SceneUnderstandingProvider,
  SpeechToTextProvider,
  TitleGenerator,
  Transcript,
  TranscriptSegment,
} from "../types.js";

export const MOCK_PROVIDER_TAG = "MOCK";

/**
 * Synthetic bilingual drama dialogue (English + Urdu/Hindi lines) spread over
 * the audio duration. Different stretches lean into different categories so
 * the heuristic analyzer produces varied, believable rankings.
 */
const MOCK_LINES: Array<{ en?: string; ur?: string; kind: string }> = [
  { en: "I can't believe you kept this secret from me for ten years.", kind: "conflict" },
  { ur: "مجھے کچھ اور بات کرنی ہے… یہ سب نہیں کہہ سکتی۔", kind: "emotional" },
  { en: "Why would you do that? After everything we've been through!", kind: "argument" },
  { ur: "یہ آپ کی غلطی ہے، میری نہیں۔ میں نے سب بتا دیا تھا۔", kind: "argument" },
  { en: "Look, I know I messed up. But I never stopped thinking about you.", kind: "romantic" },
  { ur: "تمہاری آنکھوں میں وہی پرانی کہانی ابھی بھی ہے۔", kind: "romantic" },
  { en: "The doctor said we should prepare for the worst.", kind: "sad" },
  { ur: "اللہ پر بھروسہ رکھو، سب ٹھیک ہو جائے گا۔", kind: "inspirational" },
  { en: "And then the lights went out… and someone was standing at the door.", kind: "suspense" },
  { en: "You should see your face right now! That was priceless!", kind: "funny" },
  { ur: "ہنسنا بند کرو! یہ سنجیدہ معاملہ ہے!", kind: "funny" },
  { en: "Everything changes tonight. This is the moment it all turns around.", kind: "hook" },
  { en: "I forgive you. Not because you deserve it — because I deserve peace.", kind: "emotional" },
  { ur: "وقت بدل گیا ہے۔ اب ہم ایک دوسرے کے ساتھ کھڑے ہیں۔", kind: "story" },
  { en: "If you walk out that door, don't ever come back.", kind: "conflict" },
  { ur: "یہ خبر سن کر پورا گھر دیوَالوں سے لگ گیا۔", kind: "shocking" },
];

export class MockSTTProvider implements SpeechToTextProvider {
  readonly name = "mock-transcriber";
  readonly mock = true;

  async transcribe(audioPath: string, language: string): Promise<Transcript> {
    void audioPath;
    // Duration unknown without probing — the pipeline passes the file; we
    // derive length from the media probe upstream, so here we simply spread
    // lines over 4-minute default and let clipping handle the rest. The
    // pipeline overrides `durationTotal` when it re-times segments.
    const segments: TranscriptSegment[] = MOCK_LINES.map((line, i) => ({
      text: [line.en, line.ur].filter(Boolean).join(" "),
      start: i * 14 + 2,
      end: i * 14 + 12,
      confidence: 0.82 + ((i * 7) % 10) / 50,
    }));
    return {
      language: language === "auto" ? "en+ur" : language,
      text: segments.map((s) => s.text).join(" "),
      segments,
      provider: `${this.name} [DEMO/MOCK DATA]`,
    };
  }
}

/** Re-time mock segments to the actual probed duration. */
export function retimedMockTranscript(durationSeconds: number, language: string): Transcript {
  const span = Math.max(60, durationSeconds);
  const step = span / MOCK_LINES.length;
  const segments: TranscriptSegment[] = MOCK_LINES.map((line, i) => ({
    text: [line.en, line.ur].filter(Boolean).join(" "),
    start: Math.round(i * step * 10) / 10,
    end: Math.round((i * step + step * 0.8) * 10) / 10,
    confidence: 0.85,
  }));
  return {
    language: language === "auto" ? "en+ur" : language,
    text: segments.map((s) => s.text).join(" "),
    segments,
    provider: `${MockSTTProvider.prototype.name} [DEMO/MOCK DATA]`,
  };
}

const KIND_SCORES: Record<string, Partial<Record<string, number>>> = {
  conflict: {
    conflict: 88,
    dialogue: 74,
    emotional: 62,
    surprise: 55,
    suspense: 48,
    storyImportance: 60,
    hook: 66,
    dialogueCompleteness: 80,
    contextCompleteness: 70,
    humor: 5,
    romance: 8,
    sadness: 20,
    inspirational: 10,
    visualActivity: 45,
  },
  argument: {
    conflict: 92,
    dialogue: 82,
    emotional: 70,
    hook: 70,
    suspense: 55,
    dialogueCompleteness: 85,
    contextCompleteness: 72,
    storyImportance: 58,
    surprise: 40,
    humor: 10,
    romance: 5,
    sadness: 25,
    inspirational: 8,
    visualActivity: 50,
  },
  emotional: {
    emotional: 90,
    storyImportance: 78,
    dialogue: 80,
    sadness: 55,
    hook: 74,
    dialogueCompleteness: 84,
    contextCompleteness: 76,
    suspense: 40,
    conflict: 45,
    surprise: 42,
    humor: 5,
    romance: 30,
    inspirational: 35,
    visualActivity: 40,
  },
  romantic: {
    romance: 92,
    emotional: 78,
    dialogue: 76,
    hook: 62,
    dialogueCompleteness: 82,
    contextCompleteness: 74,
    storyImportance: 55,
    sadness: 18,
    conflict: 12,
    surprise: 30,
    humor: 12,
    inspirational: 22,
    suspense: 20,
    visualActivity: 38,
  },
  sad: {
    sadness: 92,
    emotional: 84,
    storyImportance: 70,
    dialogue: 72,
    dialogueCompleteness: 80,
    contextCompleteness: 70,
    hook: 58,
    conflict: 25,
    romance: 20,
    surprise: 25,
    humor: 3,
    inspirational: 18,
    suspense: 30,
    visualActivity: 35,
  },
  suspense: {
    suspense: 90,
    hook: 82,
    surprise: 62,
    storyImportance: 66,
    visualActivity: 58,
    dialogue: 60,
    dialogueCompleteness: 70,
    contextCompleteness: 62,
    conflict: 40,
    emotional: 45,
    humor: 5,
    romance: 8,
    sadness: 20,
    inspirational: 10,
  },
  funny: {
    humor: 93,
    surprise: 60,
    dialogue: 72,
    hook: 68,
    dialogueCompleteness: 78,
    contextCompleteness: 66,
    emotional: 40,
    conflict: 30,
    romance: 10,
    sadness: 5,
    inspirational: 12,
    suspense: 20,
    storyImportance: 30,
    visualActivity: 55,
  },
  shocking: {
    surprise: 90,
    conflict: 70,
    suspense: 65,
    hook: 80,
    visualActivity: 62,
    dialogue: 66,
    dialogueCompleteness: 72,
    contextCompleteness: 60,
    emotional: 55,
    storyImportance: 62,
    humor: 8,
    romance: 8,
    sadness: 30,
    inspirational: 10,
  },
  inspirational: {
    inspirational: 91,
    emotional: 70,
    storyImportance: 66,
    dialogue: 74,
    hook: 60,
    dialogueCompleteness: 80,
    contextCompleteness: 72,
    conflict: 20,
    romance: 12,
    sadness: 15,
    surprise: 25,
    humor: 8,
    suspense: 22,
    visualActivity: 40,
  },
  story: {
    storyImportance: 92,
    contextCompleteness: 84,
    dialogue: 78,
    dialogueCompleteness: 82,
    emotional: 55,
    hook: 58,
    conflict: 40,
    surprise: 40,
    suspense: 42,
    humor: 6,
    romance: 15,
    sadness: 25,
    inspirational: 25,
    visualActivity: 38,
  },
  hook: {
    hook: 94,
    surprise: 65,
    visualActivity: 60,
    dialogue: 66,
    suspense: 60,
    dialogueCompleteness: 66,
    contextCompleteness: 55,
    storyImportance: 52,
    conflict: 38,
    emotional: 45,
    humor: 10,
    romance: 8,
    sadness: 15,
    inspirational: 20,
  },
};

const KIND_SUMMARIES: Record<string, string> = {
  conflict: "Strong confrontational dialogue with a clear dramatic reaction.",
  argument: "Heated argument with sharp, quotable lines and rising tension.",
  emotional: "Emotionally charged exchange that peaks with a heartfelt confession.",
  romantic: "Tender romantic moment with an emotionally warm payoff.",
  sad: "Melancholic scene carrying genuine emotional weight.",
  suspense: "Tense buildup with a cliffhanger-style beat that holds attention.",
  funny: "Comedic timing lands well; lighthearted and shareable.",
  shocking: "Surprising reveal that lands hard and invites a rewatch.",
  inspirational: "Uplifting message with a motivating, memorable line.",
  story: "Pivotal story beat that advances the plot meaningfully.",
  hook: "Attention-grabbing moment that works as a strong short-form opener.",
};

export class MockSceneAnalyzer implements SceneUnderstandingProvider {
  readonly name = "mock-analyzer [DEMO/MOCK DATA]";
  readonly mock = true;

  async analyze(scene: {
    transcriptText: string;
    startTime: number;
    endTime: number;
    duration: number;
    visual: { avgSceneLevel?: number };
  }): Promise<SceneAnalysis> {
    const lower = scene.transcriptText.toLowerCase();
    let kind = "story";
    for (const key of Object.keys(KIND_SCORES)) {
      const m = MOCK_LINES.find((l) => l.kind === key);
      if (m === undefined) continue;
      const snippet = (m.en ?? m.ur ?? "").toLowerCase().slice(0, 18);
      if (snippet.length > 0 && lower.includes(snippet.slice(0, 12))) {
        kind = key;
        break;
      }
    }
    const scores = sanitizeScores(KIND_SCORES[kind] ?? {});
    const variation = ((Math.floor(scene.startTime) * 31) % 11) - 5;
    for (const key of Object.keys(scores) as Array<keyof typeof scores>) {
      scores[key] = Math.max(0, Math.min(100, scores[key] + variation));
    }
    const peak = Math.min(scene.duration, Math.max(0, scene.duration * 0.6));
    return buildAnalysis(scores, {
      peakTime: scene.startTime + peak,
      summary: KIND_SUMMARIES[kind] ?? "Engaging moment suitable for short-form clips.",
      provider: this.name,
    });
  }
}

export class MockTitleGenerator implements TitleGenerator {
  readonly name = "mock-titles [DEMO/MOCK DATA]";
  readonly mock = true;

  async generate(input: {
    transcript: string;
    reason: string;
    category: string;
    duration: number;
  }): Promise<ClipTitles> {
    const words = input.transcript
      .split(/\s+/)
      .filter((w) => w.length > 3)
      .slice(0, 6)
      .join(" ");
    const topic = words.length > 0 ? `"${words}…"` : "this scene";
    return {
      mock: true,
      titles: [
        `${topic} — the moment everything changed`,
        `You won't believe what happens next…`,
        `The scene everyone is talking about`,
      ].map((t) => t.slice(0, 80)),
      descriptions: [
        `${input.reason} Clip length ${Math.round(input.duration)}s.`,
        `A ${input.category} moment from the source video. Transcript snippet: ${topic}`,
        "Watch till the end — [DEMO/MOCK DATA] metadata generated without an AI provider.",
      ],
      hashtags: [
        "#drama",
        "#shorts",
        "#viral",
        "#dramascene",
        "#mustwatch",
        "#emotional",
        "#foryou",
      ],
    };
  }
}

export { MOCK_LINES };
