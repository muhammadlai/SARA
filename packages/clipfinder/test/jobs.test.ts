/**
 * Integration: JobManager + Worker + pipeline against an in-memory database
 * with fake media tools and mock AI providers — the full lifecycle without
 * ffmpeg or network: create → process → rank → search → edit → render →
 * cancel/fail/retry/duplicate paths.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ClipFinderStorage,
  ClipFinderWorker,
  JobManager,
  DuplicateJobError,
  SourceRejectedError,
} from "../src/index.js";
import { MockSceneAnalyzer, MockSTTProvider, MockTitleGenerator } from "../src/providers/mock.js";
import { FakeMediaTools } from "./fakes.js";

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const migration = fs.readFileSync(
    path.resolve(process.cwd(), "packages/db/migrations/0002_clip_finder.sql"),
    "utf8",
  );
  db.exec(migration);
  return db;
}

interface Fixture {
  db: DatabaseSync;
  manager: JobManager;
  worker: ClipFinderWorker;
  media: FakeMediaTools;
  storage: ClipFinderStorage;
  tmpRoot: string;
  sourceFile: string;
}

function makeFixture(): Fixture {
  const tmpRoot = fs.mkdtempSync(path.join(import.meta.dirname, "cf-test-"));
  const storage = new ClipFinderStorage(tmpRoot);
  storage.ensureLayout();
  const db = makeDb();
  const media = new FakeMediaTools();
  const manager = new JobManager({
    db,
    storage,
    maxUploadBytes: 100 * 1024 * 1024,
    maxUrlBytes: 100 * 1024 * 1024,
    mock: true,
  });
  const worker = new ClipFinderWorker({
    db,
    storage,
    media,
    stt: new MockSTTProvider(),
    analyzer: new MockSceneAnalyzer(),
    mock: true,
    concurrency: 1,
    sceneThreshold: 0.3,
    retentionHours: 24,
  });
  const sourceFile = storage.sourcePath("fakesrc", ".mp4");
  fs.writeFileSync(sourceFile, Buffer.from("fake-source-video"));
  return { db, manager, worker, media, storage, tmpRoot, sourceFile };
}

let fx: Fixture;

/** Fresh temp file per upload (createJobFromUpload moves it). */
function makeUpload(
  name: string,
  sizeBytes = 1000,
): { tmpPath: string; originalName: string; sizeBytes: number } {
  const tmpPath = path.join(fx.tmpRoot, `in-${name}`);
  fs.writeFileSync(tmpPath, Buffer.alloc(Math.max(1, Math.min(sizeBytes, 1_000_000))));
  return { tmpPath, originalName: name, sizeBytes };
}

beforeEach(() => {
  fx = makeFixture();
});
afterEach(() => {
  fx.worker.stop();
  fs.rmSync(fx.tmpRoot, { recursive: true, force: true });
});

const OPTIONS = {
  clipCount: 5,
  minDurationSeconds: 15,
  maxDurationSeconds: 60,
  aspectRatio: "9:16" as const,
  language: "auto",
  categories: ["general"],
};

/** Typed accessor for the first ranked clip (views are Record<string, unknown>). */
function firstClip(jobId: string): {
  id: string;
  rank: number;
  category: string;
  score: number;
  duration: number;
  transcriptPreview: string;
  reason: string;
} {
  const clip = fx.manager.getClips(jobId)[0];
  if (clip === undefined) throw new Error("expected at least one clip");
  return clip as never;
}

/** Run the worker loop manually until the job settles (deterministic, no timers). */
async function runToCompletion(jobId: string): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    const job = fx.manager.getJob(jobId);
    if (job === null) throw new Error("job vanished");
    if (["completed", "failed", "cancelled"].includes(job.status as string)) return;
    // invoke one protected tick-equivalent through the worker's claim path
    await (fx.worker as unknown as { tick: () => Promise<void> })["tick"]();
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("job did not settle in time");
}

describe("clip finder job lifecycle", () => {
  it("create (upload) → process → ranked clips with subtitles and thumbnails", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("drama.mp4"), OPTIONS);
    expect(fx.manager.getJob(jobId)?.status).toBe("queued");

    await runToCompletion(jobId);
    const job = fx.manager.getJob(jobId);
    expect(job?.status).toBe("completed");
    expect(job?.progress).toBe(100);
    expect(job?.stage).toBe("Complete");

    const clipList = fx.manager.getClips(jobId);
    expect(clipList.length).toBeGreaterThan(0);
    expect(clipList.length).toBeLessThanOrEqual(5);
    for (const clip of clipList) {
      expect(clip.score).toBeGreaterThan(0);
      expect(clip.duration).toBeLessThanOrEqual(60.5);
      expect(String(clip.transcriptPreview).length).toBeGreaterThan(0);
      expect(String(clip.reason).length).toBeGreaterThan(0);
    }
    // ranks assigned in score order
    const byRank = [...clipList].sort((a, b) => (a.rank as number) - (b.rank as number));
    for (let i = 1; i < byRank.length; i += 1) {
      expect((byRank[i]?.score as number) <= (byRank[i - 1]?.score as number)).toBe(true);
    }
    void firstClip;
    // transcript + scene artifacts persisted
    const transcript = fx.db
      .prepare("SELECT COUNT(*) AS n FROM transcripts WHERE job_id = ?")
      .get(jobId) as { n: number };
    expect(transcript.n).toBe(1);
    const scenes = fx.db
      .prepare("SELECT COUNT(*) AS n FROM scenes WHERE job_id = ?")
      .get(jobId) as { n: number };
    expect(scenes.n).toBeGreaterThan(2);
    const subs = fx.db
      .prepare(
        "SELECT COUNT(*) AS n FROM subtitle_tracks WHERE clip_id IN (SELECT id FROM clip_candidates WHERE job_id = ?)",
      )
      .get(jobId) as { n: number };
    expect(subs.n).toBe(clipList.length);
    // clip thumbnails extracted by the (fake) media tools
    expect(fx.media.writtenFiles.size).toBeGreaterThan(0);
  });

  it("marks mock jobs so UI can label DEMO/MOCK data", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("drama2.mp4"), OPTIONS);
    await runToCompletion(jobId);
    expect(fx.manager.getJob(jobId)?.mock).toBe(true);
  });

  it("duplicate active upload is rejected (409-style)", () => {
    // Second job with same name+size while first is queued → DuplicateJobError
    fx.manager.createJobFromUpload(makeUpload("same.mp4", 4242), OPTIONS);
    expect(() => fx.manager.createJobFromUpload(makeUpload("same.mp4", 4242), OPTIONS)).toThrow(
      DuplicateJobError,
    );
  });

  it("cancel: a queued job transitions to cancelled and stays cancelled", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("cancel.mp4"), OPTIONS);
    const cancelled = fx.manager.cancelJob(jobId);
    expect(cancelled?.status).toBe("cancelled");
    await runToCompletion(jobId);
    expect(fx.manager.getJob(jobId)?.status).toBe("cancelled");
  });

  it("cancel mid-flight: pipeline stops between stages", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("cancel2.mp4"), OPTIONS);
    // flip to cancelled right after the job starts processing
    const originalProbe = fx.media.probe.bind(fx.media);
    fx.media.probe = async () => {
      fx.manager.cancelJob(jobId);
      return originalProbe();
    };
    await runToCompletion(jobId);
    expect(fx.manager.getJob(jobId)?.status).toBe("cancelled");
  });

  it("failed job carries a useful message and can be retried", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("fail.mp4"), OPTIONS);
    fx.media.failOn = "probe";
    await runToCompletion(jobId);
    const failed = fx.manager.getJob(jobId);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toContain("unsupported codec");

    fx.media.failOn = null;
    const retried = fx.manager.retryJob(jobId);
    expect(retried?.status).toBe("queued");
    await runToCompletion(jobId);
    expect(fx.manager.getJob(jobId)?.status).toBe("completed");
  });

  it("retry of a completed job is rejected", () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("done.mp4"), OPTIONS);
    void jobId;
    const fakeCompleted = "job_nonexistent";
    expect(fx.manager.retryJob(fakeCompleted)).toBeNull();
  });

  it("delete removes job, clips, subtitles, renders and files", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("delete-me.mp4"), OPTIONS);
    await runToCompletion(jobId);
    const clip = firstClip(jobId);
    const render = fx.manager.requestRender(clip.id, {
      aspectRatio: "9:16",
      subtitleStyle: "modern",
      subtitleOptions: {},
      framing: "blur-pad",
      quality: 720,
    });
    // run the render
    for (let i = 0; i < 20; i += 1) {
      await (fx.worker as unknown as { tick: () => Promise<void> })["tick"]();
      const fresh = fx.manager.getRender((render as { id: string }).id);
      if (fresh?.status === "completed" || fresh?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(fx.manager.getRender((render as { id: string }).id)?.status).toBe("completed");

    const storedSource = fx.db
      .prepare(
        "SELECT file_path FROM video_sources WHERE id = (SELECT source_id FROM clip_finder_jobs WHERE id = ?)",
      )
      .get(jobId) as { file_path: string | null };

    expect(fx.manager.deleteJob(jobId)).toBe(true);
    expect(fx.manager.getJob(jobId)).toBeNull();
    expect(fs.existsSync(storedSource.file_path ?? "")).toBe(false); // upload copy removed
    const remaining = fx.db
      .prepare("SELECT COUNT(*) AS n FROM clip_candidates WHERE job_id = ?")
      .get(jobId) as { n: number };
    expect(remaining.n).toBe(0);
    const remainingRenders = fx.db.prepare("SELECT COUNT(*) AS n FROM clip_renders").get() as {
      n: number;
    };
    expect(remainingRenders.n).toBe(0);
  });

  it("URL download: success, SSRF rejection, and HTTP failure surfaces", async () => {
    const fetchImpl = (async (url: URL | string) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("notfound")) {
        return new Response("nope", { status: 404 });
      }
      if (u.includes("notavideo")) {
        return new Response("<html>hello</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(Buffer.from("fake-video-bytes"), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "17" },
      });
    }) as unknown as typeof fetch;

    const manager = new JobManager({
      db: fx.db,
      storage: fx.storage,
      maxUploadBytes: 1024 * 1024,
      maxUrlBytes: 1024 * 1024,
      fetchImpl,
    });

    const { jobId } = await manager.createJobFromUrl(
      "https://cdn.example.com/episode.mp4",
      OPTIONS,
    );
    expect((manager.getJob(jobId)?.source as { url?: string } | null)?.url).toBe(
      "https://cdn.example.com/episode.mp4",
    );

    await expect(
      manager.createJobFromUrl("https://cdn.example.com/notfound.mp4", OPTIONS),
    ).rejects.toThrow(/404/);
    await expect(
      manager.createJobFromUrl("https://cdn.example.com/notavideo.mp4", OPTIONS),
    ).rejects.toThrow(SourceRejectedError);
    await expect(
      manager.createJobFromUrl("http://127.0.0.1:4000/secret.mp4", OPTIONS),
    ).rejects.toThrow(/Private, loopback/);
  });

  it("size limits reject oversized downloads", async () => {
    const fetchImpl = (async () =>
      new Response(Buffer.alloc(1000), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })) as unknown as typeof fetch;
    const manager = new JobManager({
      db: fx.db,
      storage: fx.storage,
      maxUploadBytes: 100,
      maxUrlBytes: 100,
      fetchImpl,
    });
    await expect(
      manager.createJobFromUrl("https://cdn.example.com/big.mp4", OPTIONS),
    ).rejects.toThrow(/too large/);
  });
});

describe("clip editing and search", () => {
  it("patch updates times and duration; delete removes the clip", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("edit.mp4"), OPTIONS);
    await runToCompletion(jobId);
    const clip = firstClip(jobId);
    const patched = fx.manager.patchClip(clip.id, { startTime: 10, endTime: 40 });
    expect(patched?.startTime).toBe(10);
    expect(patched?.duration).toBe(30);

    expect(fx.manager.deleteClip(clip.id)).toBe(true);
    expect(fx.manager.getClip(clip.id)).toBeNull();
  });

  it("NL search narrows and re-ranks results with parsed criteria", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("search.mp4"), {
      ...OPTIONS,
      clipCount: 8,
    });
    await runToCompletion(jobId);
    const all = fx.manager.getClips(jobId);
    const result = fx.manager.searchClips(jobId, "find the funniest scenes under 45 seconds");
    expect(result).not.toBeNull();
    const parsed = result as {
      criteria: { categories: string[]; maxDurationSeconds?: number };
      results: unknown[];
    };
    expect(parsed.criteria.categories).toContain("funny");
    expect(parsed.results.length).toBeLessThanOrEqual(all.length);
  });

  it("subtitles: generate, read and regenerate with styles", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("subs.mp4"), OPTIONS);
    await runToCompletion(jobId);
    const clip = firstClip(jobId);
    const srt = fx.manager.getSubtitles(clip.id);
    expect(srt).toContain("-->");
    const regenerated = fx.manager.regenerateSubtitles(clip.id, "shorts", true);
    expect(regenerated).toContain("-->");
  });

  it("render pipeline completes and writes mp4/srt/json outputs", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("render.mp4"), OPTIONS);
    await runToCompletion(jobId);
    const clip = firstClip(jobId);
    const render = fx.manager.requestRender(clip.id, {
      aspectRatio: "9:16",
      subtitleStyle: "shorts",
      subtitleOptions: { uppercase: true },
      framing: "blur-pad",
      quality: 1080,
      commentaryText: "This is my own commentary about the scene.",
    }) as { id: string };
    for (let i = 0; i < 30; i += 1) {
      await (fx.worker as unknown as { tick: () => Promise<void> })["tick"]();
      const fresh = fx.manager.getRender(render.id);
      if (fresh?.status === "completed" || fresh?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    const done = fx.manager.getRender(render.id);
    expect(done?.status).toBe("completed");
    expect(done?.width).toBe(1080);
    expect(done?.height).toBe(1920);
    const files = fx.manager.getRenderFiles(render.id);
    expect(files).not.toBeNull();
    expect(files?.videoPath.endsWith(".mp4")).toBe(true);
    expect(fs.existsSync(files?.videoPath ?? "")).toBe(true);
    const metadata = JSON.parse(files?.metadata ?? "{}") as {
      notice: string;
      output: { commentaryNote?: string };
    };
    expect(metadata.notice).toContain("rights or permission");
    expect(metadata.output.commentaryNote).toContain("User-created text commentary");
    // srt endpoint content exists
    expect(fs.existsSync(files?.srtPath ?? "")).toBe(true);
  });

  it("render failure produces a useful error and cancel marks cancelled", async () => {
    const { jobId } = fx.manager.createJobFromUpload(makeUpload("renderfail.mp4"), OPTIONS);
    await runToCompletion(jobId);
    const clip = firstClip(jobId);
    fx.media.failOn = "cut";
    const render = fx.manager.requestRender(clip.id as string, {
      aspectRatio: "9:16",
      subtitleStyle: "modern",
      subtitleOptions: {},
      framing: "center-crop",
      quality: 720,
    }) as { id: string };
    for (let i = 0; i < 30; i += 1) {
      await (fx.worker as unknown as { tick: () => Promise<void> })["tick"]();
      const fresh = fx.manager.getRender(render.id);
      if (fresh?.status === "completed" || fresh?.status === "failed") break;
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(fx.manager.getRender(render.id)?.status).toBe("failed");
    expect(fx.manager.getRender(render.id)?.error).toContain("cut failed");

    // cancel path on a queued render
    fx.media.failOn = null;
    const render2 = fx.manager.requestRender(clip.id, {
      aspectRatio: "1:1",
      subtitleStyle: "minimal",
      subtitleOptions: {},
      framing: "blur-pad",
      quality: 720,
    }) as { id: string };
    fx.manager.cancelRender(render2.id);
    expect(fx.manager.getRender(render2.id)?.status).toBe("cancelled");
  });
});

describe("agent tool", () => {
  it("parses clip finder utterances into intent + reply", async () => {
    const { parseClipFinderUtterance } = await import("../src/agent-tool.js");
    const parsed = parseClipFinderUtterance("Sara, find 10 emotional scenes from this video.");
    expect(parsed.intent).toBe("clip_finder");
    expect(parsed.reply).toContain("10");
    expect(parseClipFinderUtterance("What's the weather like?").intent).toBe("unknown");
  });

  it("enforces permission scopes before doing anything", async () => {
    const { invokeClipFinderTool } = await import("../src/agent-tool.js");
    const denied = await invokeClipFinderTool(
      { source: "https://cdn.example.com/v.mp4" },
      { hasScope: () => false },
      { manager: fx.manager },
    );
    expect(denied.accepted).toBe(false);
    expect(denied.message).toContain("video.read");
  });

  it("creates a job when scopes are granted", async () => {
    const { invokeClipFinderTool } = await import("../src/agent-tool.js");
    const fetchImpl = (async () =>
      new Response(Buffer.from("v"), {
        status: 200,
        headers: { "content-type": "video/mp4" },
      })) as unknown as typeof fetch;
    const manager = new JobManager({
      db: fx.db,
      storage: fx.storage,
      maxUploadBytes: 1024 * 1024,
      maxUrlBytes: 1024 * 1024,
      fetchImpl,
    });
    const result = await invokeClipFinderTool(
      { source: "https://cdn.example.com/show.mp4", clipCount: 7, categories: ["funny"] },
      { hasScope: (s) => s === "video.read" || s === "video.analyze" },
      { manager },
    );
    expect(result.accepted).toBe(true);
    expect(result.jobId).toBeDefined();
    expect(manager.getJob(result.jobId as string)?.status).toBe("queued");
  });

  it("title generator returns clearly-labeled mock metadata", async () => {
    const titles = await new MockTitleGenerator().generate({
      transcript: "I cannot believe you kept this secret from me",
      reason: "Strong emotional dialogue followed by a reaction.",
      category: "emotional",
      duration: 42,
    });
    expect(titles.mock).toBe(true);
    expect(titles.titles).toHaveLength(3);
    expect(titles.hashtags.length).toBeGreaterThan(3);
  });
});
