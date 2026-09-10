/** Local Sara fakes for API tests (kept separate from the package's own suite). */
import type {
  AvatarCapability,
  AvatarFrameRequest,
  AvatarRender,
  BrainReply,
  ChatTurn,
  LLMProvider,
  SpeechResult,
  TTSProvider,
} from "@sara/live";
import type { AvatarProvider } from "@sara/live";

export class FakeLLM implements LLMProvider {
  readonly name: string;
  calls: ChatTurn[][] = [];

  constructor(
    name = "fake-llm",
    private readonly reply: (lastUser: string) => string = (t) => `Reply to: ${t}`,
  ) {
    this.name = name;
  }

  async complete(turns: ChatTurn[]): Promise<BrainReply> {
    this.calls.push(turns);
    const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
    return { text: this.reply(lastUser), provider: this.name, fallbackUsed: false };
  }
}

export class FakeTTS implements TTSProvider {
  readonly name = "fake-tts";
  calls: string[] = [];

  async synthesize(text: string): Promise<SpeechResult> {
    this.calls.push(text);
    return {
      path: "/tmp/fake.wav",
      provider: this.name,
      format: "wav",
      fallbackUsed: false,
      voiceCloned: false,
      degraded: false,
      durationEstimateSeconds: 1,
    };
  }
}

export class FakeAvatar implements AvatarProvider {
  readonly name = "fake-avatar";

  capabilities(): AvatarCapability[] {
    return ["photo"];
  }

  async render(req: AvatarFrameRequest): Promise<AvatarRender> {
    void req;
    return {
      mode: "photo",
      assetUrl: "/sara/sara-portrait.png",
      capabilities: this.capabilities(),
      provider: this.name,
    };
  }
}
