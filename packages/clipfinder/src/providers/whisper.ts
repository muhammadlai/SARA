/**
 * Whisper-compatible SpeechToTextProvider using an OpenAI-compatible
 * transcription endpoint (official OpenAI API or any compatible self-hosted
 * server). Key/base-URL come from validated env config only.
 *
 * Response segments are normalized to { text, start, end, confidence? }.
 * Language support follows the selected model (whisper-1 covers Urdu, Hindi
 * and English among many others).
 */
import fs from "node:fs";
import { createLogger } from "@sara/logger";
import type { SpeechToTextProvider, Transcript, TranscriptSegment } from "../types.js";

const log = createLogger({ name: "sara-clipfinder" });

export interface WhisperProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

interface WhisperResponse {
  text?: string;
  language?: string;
  duration?: number;
  segments?: Array<{
    text?: string;
    start?: number;
    end?: number;
    no_speech_prob?: number;
    avg_logprob?: number;
  }>;
}

export class WhisperSTTProvider implements SpeechToTextProvider {
  readonly name: string;
  readonly mock = false;

  constructor(private readonly config: WhisperProviderConfig) {
    this.name = `whisper:${config.model ?? "whisper-1"}`;
  }

  async transcribe(audioPath: string, language: string): Promise<Transcript> {
    const base = (this.config.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
    const form = new FormData();
    const bytes = await fs.promises.readFile(audioPath);
    form.append("file", new Blob([new Uint8Array(bytes)], { type: "audio/wav" }), "audio.wav");
    form.append("model", this.config.model ?? "whisper-1");
    form.append("response_format", "verbose_json");
    if (language !== "auto") form.append("language", language);

    const res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: form,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      throw new Error(`Transcription failed (HTTP ${res.status}): ${detail}`);
    }
    const data = (await res.json()) as WhisperResponse;
    const segments: TranscriptSegment[] = (data.segments ?? [])
      .map((s) => ({
        text: (s.text ?? "").trim(),
        start: s.start ?? 0,
        end: s.end ?? 0,
        confidence:
          s.no_speech_prob !== undefined
            ? Math.max(0, Math.min(1, 1 - s.no_speech_prob))
            : undefined,
      }))
      .filter((s) => s.text.length > 0);

    return {
      language: data.language ?? language,
      text: (data.text ?? segments.map((s) => s.text).join(" ")).trim(),
      segments,
      provider: this.name,
    };
  }
}

/** True when the environment has everything the Whisper provider needs. */
export function isWhisperConfigured(apiKey: string | null | undefined): boolean {
  return typeof apiKey === "string" && apiKey.length > 10 && !apiKey.startsWith("changeme");
}

export { log as whisperLog };
