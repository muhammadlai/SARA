/**
 * OpenAI-compatible chat LLM providers for scene understanding and title
 * generation. Used only when API credentials exist; otherwise the mock
 * providers are selected (see resolve.ts). The model is instructed to return
 * strict JSON with all 14 dimension scores; responses are sanitized so a
 * misbehaving model can never break the pipeline.
 */
import { createLogger } from "@sara/logger";
import { buildAnalysis, sanitizeScores } from "../scoring.js";
import { bestCategory } from "../categories.js";
import { CLIP_CATEGORY_LABELS } from "../schema.js";
import type {
  ClipTitles,
  SceneAnalysis,
  SceneUnderstandingProvider,
  TitleGenerator,
} from "../types.js";

const log = createLogger({ name: "sara-clipfinder" });

export interface LlmProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

async function chatJson(config: LlmProviderConfig, system: string, user: string): Promise<unknown> {
  const base = (config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: config.model ?? "gpt-4o-mini",
      temperature: 0.2,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`LLM request failed (HTTP ${res.status}): ${detail}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content ?? "{}";
  return JSON.parse(content) as unknown;
}

const ANALYZER_SYSTEM = `You are a drama-scene analyst for a clip-finding tool.
Given a scene's transcript (and timing), score it on 14 dimensions from 0 to 100:
dialogue, emotional, storyImportance, humor, suspense, conflict, surprise, romance,
sadness, inspirational, visualActivity, dialogueCompleteness, hook, contextCompleteness.
Also give peakTime (seconds into the scene where the emotional peak occurs) and a one-sentence
summary explaining why the scene would (or would not) make a compelling clip.
Respond with strict JSON: {"scores":{...14 keys...},"peakTime":number,"summary":"..."}.`;

export class LlmSceneAnalyzer implements SceneUnderstandingProvider {
  readonly name: string;
  readonly mock = false;

  constructor(private readonly config: LlmProviderConfig) {
    this.name = `llm:${config.model ?? "gpt-4o-mini"}`;
  }

  async analyze(scene: {
    transcriptText: string;
    startTime: number;
    endTime: number;
    duration: number;
  }): Promise<SceneAnalysis> {
    const user = [
      `Scene from ${scene.startTime.toFixed(1)}s to ${scene.endTime.toFixed(1)}s (${scene.duration.toFixed(1)}s).`,
      `Transcript (may be empty if the scene has no dialogue):`,
      scene.transcriptText.slice(0, 4000) || "(no speech detected)",
    ].join("\n");
    const raw = (await chatJson(this.config, ANALYZER_SYSTEM, user)) as {
      scores?: Record<string, number>;
      peakTime?: number;
      summary?: string;
    };
    const scores = sanitizeScores(raw.scores ?? {});
    const peak = Number.isFinite(raw.peakTime)
      ? Math.max(0, Math.min(scene.duration, raw.peakTime as number))
      : scene.duration / 2;
    return buildAnalysis(scores, {
      peakTime: scene.startTime + peak,
      summary: (raw.summary ?? "").slice(0, 300) || "No summary returned.",
      provider: this.name,
    });
  }
}

const TITLES_SYSTEM = `You write metadata for short vertical drama clips.
Based ONLY on the provided clip transcript and reason (no invented plot points, no misleading
clickbait), respond with strict JSON:
{"titles":["...","...","..."],"descriptions":["...","...","..."],"hashtags":["#..."]}.
Titles ≤ 60 chars, descriptions ≤ 200 chars, 6-10 hashtags relevant to the content.`;

export class LlmTitleGenerator implements TitleGenerator {
  readonly name: string;
  readonly mock = false;

  constructor(private readonly config: LlmProviderConfig) {
    this.name = `llm:${config.model ?? "gpt-4o-mini"}`;
  }

  async generate(input: {
    transcript: string;
    reason: string;
    category: string;
    duration: number;
  }): Promise<ClipTitles> {
    const label =
      CLIP_CATEGORY_LABELS[input.category as keyof typeof CLIP_CATEGORY_LABELS] ?? input.category;
    const user = `Category: ${label}\nDuration: ${input.duration.toFixed(0)}s\nReason it was selected: ${input.reason}\nTranscript:\n${input.transcript.slice(0, 3000)}`;
    const raw = (await chatJson(this.config, TITLES_SYSTEM, user)) as {
      titles?: string[];
      descriptions?: string[];
      hashtags?: string[];
    };
    const clean = (list: string[] | undefined, max: number, cap: number): string[] =>
      (list ?? [])
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, max)
        .map((s) => s.slice(0, cap));
    return {
      mock: false,
      titles: clean(raw.titles, 3, 100),
      descriptions: clean(raw.descriptions, 3, 300),
      hashtags: clean(raw.hashtags, 12, 40),
    };
  }
}

export { log as llmLog, bestCategory };
