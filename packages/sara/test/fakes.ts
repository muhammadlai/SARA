/** Test fakes for the Sara LIVE suite: scriptable LLM/TTS/avatar providers. */
import type {
  AvatarCapability,
  AvatarFrameRequest,
  AvatarProvider,
  AvatarRender,
  BrainReply,
  ChatTurn,
  LLMProvider,
  SpeechResult,
  TTSProvider,
} from "../src/types.js";

export class FakeLLM implements LLMProvider {
  readonly name: string;
  calls: ChatTurn[][] = [];
  failTimes = 0;

  constructor(
    name = "fake-llm",
    private readonly reply: (lastUser: string) => string = (t) => `echo: ${t}`,
  ) {
    this.name = name;
  }

  async complete(turns: ChatTurn[]): Promise<BrainReply> {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error("fake llm failure");
    }
    this.calls.push(turns);
    const lastUser = [...turns].reverse().find((t) => t.role === "user")?.content ?? "";
    return { text: this.reply(lastUser), provider: this.name, fallbackUsed: false };
  }
}

export class FakeTTS implements TTSProvider {
  readonly name: string;
  calls: string[] = [];
  failTimes = 0;

  constructor(name = "fake-tts") {
    this.name = name;
  }

  async synthesize(text: string): Promise<SpeechResult> {
    if (this.failTimes > 0) {
      this.failTimes -= 1;
      throw new Error("fake tts failure");
    }
    this.calls.push(text);
    return {
      path: `/tmp/fake_${Date.now()}.wav`,
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
  lastRequest: AvatarFrameRequest | null = null;

  capabilities(): AvatarCapability[] {
    return ["photo"];
  }

  async render(req: AvatarFrameRequest): Promise<AvatarRender> {
    this.lastRequest = req;
    return {
      mode: "photo",
      assetUrl: "/sara/sara-portrait.png",
      capabilities: this.capabilities(),
      provider: this.name,
    };
  }
}

/** In-memory SQLite with the Sara schema applied. */
export async function createTestDb(): Promise<Awaited<ReturnType<typeof setupDb>>> {
  return setupDb();
}

async function setupDb() {
  const { DatabaseSync } = await import("node:sqlite");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const os = await import("node:os");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sara-live-test-"));
  const db = new DatabaseSync(":memory:");
  const migrationPath = path.resolve(process.cwd(), "packages/db/migrations/0003_sara_live.sql");
  db.exec(fs.readFileSync(migrationPath, "utf8"));
  return { db, dir, cleanup: () => db.close() };
}
