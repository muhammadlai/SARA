/**
 * Provider resolution: pick real providers when credentials/config exist,
 * mock providers otherwise (explicit MOCK_CLIP_FINDER=true forces mocks).
 * Mock results are ALWAYS labeled so demo data can never pass as production.
 */
import type {
  MediaTools,
  SceneUnderstandingProvider,
  SpeechToTextProvider,
  TitleGenerator,
} from "../types.js";
import { FfmpegMediaTools } from "./ffmpeg.js";
import { isWhisperConfigured, WhisperSTTProvider } from "./whisper.js";
import { LlmSceneAnalyzer, LlmTitleGenerator, type LlmProviderConfig } from "./llm.js";
import { MockSceneAnalyzer, MockSTTProvider, MockTitleGenerator } from "./mock.js";

export interface ProviderEnv {
  mockClipFinder: boolean;
  sttProvider: string | null;
  openaiApiKey: string | null;
  openaiBaseUrl: string | null;
  whisperModel: string | null;
  llmModel: string | null;
}

export interface ResolvedProviders {
  mock: boolean;
  mockReason: string;
  media: MediaTools;
  stt: SpeechToTextProvider;
  analyzer: SceneUnderstandingProvider;
  titles: TitleGenerator;
}

export function resolveProviders(env: ProviderEnv): ResolvedProviders {
  const media = new FfmpegMediaTools();

  const whisperReady = isWhisperConfigured(env.openaiApiKey);
  const llmReady = isWhisperConfigured(env.openaiApiKey);
  const forcedMock = env.mockClipFinder === true;

  if (forcedMock || !whisperReady || !llmReady) {
    const reasons: string[] = [];
    if (forcedMock) reasons.push("MOCK_CLIP_FINDER=true");
    if (!whisperReady) reasons.push("no STT credentials (OPENAI_API_KEY unset)");
    if (!llmReady) reasons.push("no LLM credentials (OPENAI_API_KEY unset)");
    return {
      mock: true,
      mockReason: reasons.join("; "),
      media,
      stt: new MockSTTProvider(),
      analyzer: new MockSceneAnalyzer(),
      titles: new MockTitleGenerator(),
    };
  }

  const config: LlmProviderConfig = {
    apiKey: env.openaiApiKey as string,
    baseUrl: env.openaiBaseUrl ?? undefined,
    model: env.llmModel ?? undefined,
  };
  const stt = new WhisperSTTProvider({
    apiKey: env.openaiApiKey as string,
    baseUrl: env.openaiBaseUrl ?? undefined,
    model: env.whisperModel ?? undefined,
  });
  return {
    mock: false,
    mockReason: "",
    media,
    stt,
    analyzer: new LlmSceneAnalyzer(config),
    titles: new LlmTitleGenerator(config),
  };
}
