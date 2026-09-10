/**
 * Clip Finder API integration tests: full HTTP surface (validation, auth
 * gating, job lifecycle through the background worker, 404/409 envelopes)
 * with an isolated in-memory DB, fake media tools and mock AI providers.
 */
import "@testing-library/jest-dom/vitest";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  ClipFinderStorage,
  ClipFinderWorker,
  JobManager,
  MockSceneAnalyzer,
  MockSTTProvider,
  MockTitleGenerator,
} from "@sara/clipfinder";
import { buildTestApp, TEST_PASSWORD, type TestApp } from "./helpers.js";
import { FakeMediaTools } from "./clip-finder-fakes.js";

function makeContext() {
  const tmpRoot = fs.mkdtempSync(path.join(import.meta.dirname, "cf-api-"));
  const storage = new ClipFinderStorage(tmpRoot);
  storage.ensureLayout();
  const db = new DatabaseSync(":memory:");
  db.exec(
    fs.readFileSync(
      path.resolve(process.cwd(), "packages/db/migrations/0002_clip_finder.sql"),
      "utf8",
    ),
  );
  const media = new FakeMediaTools();
  const manager = new JobManager({
    db,
    storage,
    maxUploadBytes: 64 * 1024 * 1024,
    maxUrlBytes: 64 * 1024 * 1024,
    mock: true,
    fetchImpl: (async (url: URL | string) => {
      const u = typeof url === "string" ? url : url.toString();
      if (u.includes("denied")) return new Response("no", { status: 403 });
      return new Response(Buffer.from("video-bytes"), {
        status: 200,
        headers: { "content-type": "video/mp4", "content-length": "11" },
      });
    }) as unknown as typeof fetch,
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
  return {
    ctx: {
      config: {
        mock: true,
        concurrency: 1,
        maxUploadBytes: 64 * 1024 * 1024,
        maxUrlBytes: 64 * 1024 * 1024,
        maxDurationMinutes: 120,
        sceneThreshold: 0.3,
        retentionHours: 24,
        dataDir: tmpRoot,
        ffmpegPath: null,
        ffprobePath: null,
        openaiApiKey: null,
        openaiBaseUrl: null,
        whisperModel: null,
        llmModel: null,
      },
      storage,
      db,
      manager,
      worker,
      providers: {
        mock: true,
        mockReason: "test",
        media,
        stt: new MockSTTProvider(),
        analyzer: new MockSceneAnalyzer(),
        titles: new MockTitleGenerator(),
      },
      tool: {
        name: "video_clip_finder" as const,
        description: "test",
        requiredScopes: ["video.read", "video.analyze"],
        renderScopes: ["video.derivative.create"],
        inputSchema: {},
      },
    },
    cleanup: () => {
      worker.stop();
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    },
  };
}

const OPTIONS = {
  clipCount: 3,
  minDurationSeconds: 15,
  maxDurationSeconds: 60,
  aspectRatio: "9:16",
  language: "auto",
  categories: ["general"],
};

describe("clip finder API (auth not configured = local dev)", () => {
  let app: TestApp;
  let cleanup: () => void;

  beforeAll(async () => {
    const made = makeContext();
    cleanup = made.cleanup;
    app = (await buildTestApp({ operatorPassword: null }, made.ctx)) as TestApp;
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("serves the copyright notice", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/clip-finder/notice" });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.notice).toContain("necessary rights or permission");
  });

  it("exposes the video_clip_finder tool manifest with scopes and no publishing", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/clip-finder/tool" });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.tool.name).toBe("video_clip_finder");
    expect(data.tool.requiredScopes).toContain("video.analyze");
    expect(JSON.stringify(data.tool)).not.toContain("publish");
  });

  it("rejects invalid URLs with a helpful envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/clip-finder/jobs",
      payload: { sourceUrl: "http://127.0.0.1/secret.mp4", options: OPTIONS },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/Private, loopback/);
  });

  it("surfaces video-unavailable as a 400 envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/clip-finder/jobs",
      payload: { sourceUrl: "https://cdn.example.com/denied.mp4", options: OPTIONS },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.message).toMatch(/publicly accessible/);
  });

  it("creates a job, worker processes it, clips come out ranked", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/clip-finder/jobs",
      payload: { sourceUrl: "https://cdn.example.com/drama.mp4", options: OPTIONS },
    });
    expect(create.statusCode).toBe(201);
    const job = create.json().data;
    expect(job.status).toBe("queued");
    expect(job.mock).toBe(true);

    // wait for the background worker to finish (fake tools are instant)
    let fresh = job;
    for (let i = 0; i < 60 && fresh.status !== "completed" && fresh.status !== "failed"; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      fresh = (
        await app.inject({ method: "GET", url: `/api/v1/clip-finder/jobs/${job.id}` })
      ).json().data;
    }
    expect(fresh.status).toBe("completed");
    expect(fresh.progress).toBe(100);
    expect(fresh.source.durationSeconds).toBe(180); // probed by the fake tools

    const clips = await app.inject({
      method: "GET",
      url: `/api/v1/clip-finder/jobs/${job.id}/clips`,
    });
    expect(clips.statusCode).toBe(200);
    const list = clips.json().data.clips;
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].rank).toBe(1);
    expect(clips.json().data.notice).toContain("rights or permission");

    // thumbnail endpoint answers with an image
    const thumb = await app.inject({
      method: "GET",
      url: `/api/v1/clip-finder/clips/${list[0].id}/thumbnail`,
    });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers["content-type"]).toContain("image/");

    // subtitles endpoint answers with SRT
    const srt = await app.inject({
      method: "GET",
      url: `/api/v1/clip-finder/clips/${list[0].id}/subtitles`,
    });
    expect(srt.statusCode).toBe(200);
    expect(srt.body).toContain("-->");

    // patch a clip
    const patched = await app.inject({
      method: "PATCH",
      url: `/api/v1/clip-finder/clips/${list[0].id}`,
      payload: { startTime: 5, endTime: 35 },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.duration).toBe(30);

    // queue a render via HTTP and wait for completion
    const renderReq = await app.inject({
      method: "POST",
      url: `/api/v1/clip-finder/clips/${list[0].id}/render`,
      payload: { aspectRatio: "9:16", subtitleStyle: "shorts", framing: "blur-pad", quality: 1080 },
    });
    expect(renderReq.statusCode).toBe(202);
    const renderId = renderReq.json().data.id;
    let render = renderReq.json().data;
    for (let i = 0; i < 60 && render.status !== "completed" && render.status !== "failed"; i += 1) {
      await new Promise((r) => setTimeout(r, 200));
      render = (
        await app.inject({ method: "GET", url: `/api/v1/clip-finder/renders/${renderId}` })
      ).json().data;
    }
    expect(render.status).toBe("completed");
    const file = await app.inject({
      method: "GET",
      url: `/api/v1/clip-finder/renders/${renderId}/file`,
    });
    expect(file.statusCode).toBe(200);
    const meta = await app.inject({
      method: "GET",
      url: `/api/v1/clip-finder/renders/${renderId}/metadata`,
    });
    expect(JSON.parse(meta.body).notice).toContain("rights or permission");
  });

  it("cancel + retry + delete flows over HTTP", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/clip-finder/jobs",
      payload: { sourceUrl: "https://cdn.example.com/another.mp4", options: OPTIONS },
    });
    const jobId = create.json().data.id;
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/v1/clip-finder/jobs/${jobId}/cancel`,
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelled.json().data.status).toBe("cancelled");

    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/clip-finder/jobs/${jobId}/retry`,
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().data.status).toBe("queued");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/v1/clip-finder/jobs/${jobId}`,
    });
    expect(deleted.statusCode).toBe(200);
    const gone = await app.inject({ method: "GET", url: `/api/v1/clip-finder/jobs/${jobId}` });
    expect(gone.statusCode).toBe(404);
  });

  it("404 envelopes for unknown jobs and clips", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/clip-finder/jobs/job_nope" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("NOT_FOUND");
  });

  it("agent endpoint parses utterances and invokes with the operator scope set", async () => {
    const parseOnly = await app.inject({
      method: "POST",
      url: "/api/v1/clip-finder/agent",
      payload: { utterance: "Sara, find 10 emotional scenes from this video." },
    });
    expect(parseOnly.statusCode).toBe(200);
    expect(parseOnly.json().data.intent).toBe("clip_finder");
    expect(parseOnly.json().data.reply).toContain("10");
  });
});

describe("clip finder API (auth configured → protected)", () => {
  let app: TestApp;
  let cleanup: () => void;
  let cookie: string;

  beforeAll(async () => {
    const made = makeContext();
    cleanup = made.cleanup;
    app = (await buildTestApp({ operatorPassword: TEST_PASSWORD }, made.ctx)) as TestApp;
    await app.ready();
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { username: "operator", password: TEST_PASSWORD },
    });
    const raw = login.headers["set-cookie"];
    cookie = Array.isArray(raw) ? (raw[0] as string) : (raw as string);
  });

  afterAll(async () => {
    await app.close();
    cleanup();
  });

  it("rejects unauthenticated reads with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/clip-finder/jobs" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("UNAUTHORIZED");
  });

  it("rejects unauthenticated job creation and mutations", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/v1/clip-finder/jobs",
      payload: { sourceUrl: "https://cdn.example.com/v.mp4", options: OPTIONS },
    });
    expect(create.statusCode).toBe(401);

    const del = await app.inject({ method: "DELETE", url: "/api/v1/clip-finder/jobs/job_x" });
    expect(del.statusCode).toBe(401);
  });

  it("allows reads with a valid session cookie", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/clip-finder/jobs",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
  });

  it("requires a session to cancel a job even when reads pass", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/clip-finder/jobs/job_x/cancel" });
    expect(res.statusCode).toBe(401);
  });
});
