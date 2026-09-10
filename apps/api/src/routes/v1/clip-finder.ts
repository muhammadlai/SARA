/**
 * Clip Finder routes — all under /api/v1/clip-finder, following the project
 * envelope + zod validation conventions. Sessions are enforced when operator
 * auth is configured; destructive/derivative actions always require it.
 */
import type { FastifyInstance } from "fastify";
import path from "node:path";
import fs from "node:fs";
import { apiFail, apiOk } from "@sara/types";
import {
  COPYRIGHT_NOTICE,
  patchClipSchema,
  renderOptionsSchema,
  resolvedOptionsSchema,
  searchSchema,
  invokeClipFinderTool,
  parseClipFinderUtterance,
  SourceRejectedError,
  DuplicateJobError,
} from "@sara/clipfinder";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { requireSessionIfConfigured } from "../../lib/auth-guard.js";
import { LOGIN_RATE_LIMIT } from "../../lib/rate-limits.js";

const idSchema = z.string().min(1).max(80);

const agentSchema = z.object({
  utterance: z.string().min(1).max(500).optional(),
  source: z.string().max(2000).optional(),
  clipCount: z.coerce.number().int().min(1).max(50).optional(),
  categories: z.array(z.string().max(20)).max(12).optional(),
  minDuration: z.coerce.number().min(3).max(600).optional(),
  maxDuration: z.coerce.number().min(5).max(900).optional(),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).optional(),
  language: z.string().max(12).optional(),
  query: z.string().max(500).optional(),
});

/** Deterministic placeholder image for clips without a thumbnail. */
function mockThumbnailSvg(label: string, sublabel: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="270" viewBox="0 0 480 270">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#2e1065"/><stop offset="1" stop-color="#111827"/>
  </linearGradient></defs>
  <rect width="480" height="270" fill="url(#g)"/>
  <circle cx="240" cy="112" r="34" fill="none" stroke="#a78bfa" stroke-width="3"/>
  <path d="M228 96 L228 128 L258 112 Z" fill="#a78bfa"/>
  <text x="240" y="180" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#e4e4e7">${esc(label)}</text>
  <text x="240" y="205" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#8b8b94">${esc(sublabel)}</text>
  <rect x="14" y="14" rx="6" width="150" height="24" fill="#7c3aed" opacity="0.85"/>
  <text x="89" y="30" text-anchor="middle" font-family="sans-serif" font-size="12" font-weight="bold" fill="#fff">DEMO / MOCK DATA</text>
</svg>`;
}

/** Map JobManager typed errors onto HTTP envelopes. */
function throwMapped(err: unknown): never {
  if (err instanceof SourceRejectedError) {
    throw new AppError("INVALID_INPUT", err.message, 400);
  }
  if (err instanceof DuplicateJobError) {
    throw new AppError("CONFLICT", err.message, 409, { existingJobId: err.jobId });
  }
  throw err;
}

function parseId(value: unknown): string {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new AppError("INVALID_INPUT", "Invalid id", 400);
  return parsed.data;
}

export async function clipFinderRoutes(app: FastifyInstance): Promise<void> {
  const ctx = () => app.clipFinder;

  // ── Copyright notice (also enforced visually in the dashboard) ──────────
  app.get("/notice", async () => {
    return apiOk({ notice: COPYRIGHT_NOTICE }, undefined);
  });

  // ── Agent tool manifest + utterance parsing ─────────────────────────────
  app.get("/tool", async () => {
    return apiOk(
      {
        tool: ctx().tool,
        scopes: {
          read: "video.read",
          analyze: "video.analyze",
          derivative: "video.derivative.create",
        },
        note: "Publishing to social platforms is NOT part of this tool and arrives separately with human approval.",
      },
      undefined,
    );
  });

  app.post(
    "/agent",
    { config: { rateLimit: { max: LOGIN_RATE_LIMIT.max * 4, timeWindow: "1 minute" } } },
    async (request) => {
      const body = agentSchema.parse(request.body ?? {});
      const utterance = body.utterance ?? "";
      let reply = "";
      let intent: "clip_finder" | "unknown" = "unknown";

      if (utterance.length > 0 && body.source === undefined) {
        const parsed = parseClipFinderUtterance(utterance);
        intent = parsed.intent;
        reply = parsed.intent === "clip_finder" ? parsed.reply : "";
        return apiOk({ intent, reply, job: null }, request.id);
      }
      if (body.source !== undefined) {
        const operatorScopes = new Set(["video.read", "video.analyze", "video.derivative.create"]);
        const result = await invokeClipFinderTool(
          {
            source: body.source,
            query: body.query ?? utterance,
            clipCount: body.clipCount,
            categories: body.categories,
            minDuration: body.minDuration,
            maxDuration: body.maxDuration,
            aspectRatio: body.aspectRatio,
            language: body.language,
          },
          { hasScope: (scope) => operatorScopes.has(scope) },
          { manager: ctx().manager },
        );
        const job = result.jobId !== undefined ? ctx().manager.getJob(result.jobId) : null;
        return apiOk({ intent: "clip_finder", reply: result.message, result, job }, request.id);
      }
      return apiFail("INVALID_INPUT", "Provide an utterance and/or a source.", {
        requestId: request.id,
      });
    },
  );

  // ── Job creation (URL via JSON, upload via multipart) ───────────────────
  const createGuard = requireSessionIfConfigured();

  app.post("/jobs", { preHandler: createGuard.preHandler }, async (request, reply) => {
    const contentType = request.headers["content-type"] ?? "";
    if (contentType.includes("multipart/form-data")) {
      const file = await request.file({
        limits: { fileSize: ctx().config.maxUploadBytes, files: 1 },
      });
      if (file === undefined) {
        throw new AppError("INVALID_INPUT", "Expected a video file upload.", 400);
      }
      const tmpPath = path.join(ctx().storage.sourcesDir(), `upload-${request.id}.tmp`);
      await new Promise<void>((resolve, reject) => {
        const out = fs.createWriteStream(tmpPath);
        file.file.pipe(out);
        out.on("finish", () => resolve());
        out.on("error", reject);
        file.file.on("error", reject);
      }).catch(() => {
        fs.rmSync(tmpPath, { force: true });
        throw new AppError("INVALID_INPUT", "Upload failed or exceeded the size limit.", 400);
      });
      const fields: Record<string, string> = {};
      for (const [key, value] of Object.entries(file.fields)) {
        const entry = Array.isArray(value) ? value[0] : value;
        if (
          entry !== undefined &&
          typeof entry === "object" &&
          "value" in entry &&
          typeof entry.value === "string"
        ) {
          fields[key] = entry.value;
        }
      }
      try {
        const { jobId } = ctx().manager.createJobFromUpload(
          {
            tmpPath,
            originalName: file.filename || "upload.bin",
            sizeBytes: fs.statSync(tmpPath).size,
          },
          JSON.parse(fields.options ?? "{}"),
        );
        return reply.status(201).send(apiOk(ctx().manager.getJob(jobId), request.id));
      } catch (err) {
        throwMapped(err);
      }
    }

    const bodySchema = z.object({
      sourceUrl: z.string().min(1).max(2000),
      options: resolvedOptionsSchema.optional(),
    });
    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      throw new AppError(
        "INVALID_INPUT",
        "Expected { sourceUrl, options? }",
        400,
        parsed.error.flatten(),
      );
    }
    try {
      const { jobId } = await ctx().manager.createJobFromUrl(
        parsed.data.sourceUrl,
        parsed.data.options,
      );
      return reply.status(201).send(apiOk(ctx().manager.getJob(jobId), request.id));
    } catch (err) {
      throwMapped(err);
    }
  });

  // ── Job reads ────────────────────────────────────────────────────────────
  app.get("/jobs", { preHandler: requireSessionIfConfigured().preHandler }, async (request) => {
    return apiOk({ jobs: ctx().manager.listJobs() }, request.id);
  });

  app.get("/jobs/:id", { preHandler: requireSessionIfConfigured().preHandler }, async (request) => {
    const job = ctx().manager.getJob(parseId((request.params as { id: string }).id));
    if (job === null) throw new AppError("NOT_FOUND", "Job not found", 404);
    return apiOk(job, request.id);
  });

  app.get(
    "/jobs/:id/clips",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const params = z
        .object({
          id: idSchema,
          category: z.string().max(20).optional(),
          sort: z.enum(["score", "duration", "category", "rank"]).optional(),
        })
        .parse({ ...(request.params as object), ...(request.query as object) });
      const job = ctx().manager.getJob(params.id);
      if (job === null) throw new AppError("NOT_FOUND", "Job not found", 404);
      return apiOk(
        {
          jobId: params.id,
          mock: job.mock,
          notice: COPYRIGHT_NOTICE,
          clips: ctx().manager.getClips(params.id, {
            category: params.category,
            sort: params.sort,
          }),
        },
        request.id,
      );
    },
  );

  // ── NL search over a job's clips ─────────────────────────────────────────
  app.post(
    "/jobs/:id/search",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const params = z.object({ id: idSchema }).parse(request.params);
      const body = searchSchema.parse(request.body);
      const result = ctx().manager.searchClips(params.id, body.query);
      if (result === null) throw new AppError("NOT_FOUND", "Job not found", 404);
      return apiOk(result, request.id);
    },
  );

  // ── Job mutations ────────────────────────────────────────────────────────
  app.post(
    "/jobs/:id/cancel",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const job = ctx().manager.cancelJob(parseId((request.params as { id: string }).id));
      if (job === null) throw new AppError("NOT_FOUND", "Job not found", 404);
      return apiOk(job, request.id);
    },
  );

  app.post(
    "/jobs/:id/retry",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      try {
        const job = ctx().manager.retryJob(parseId((request.params as { id: string }).id));
        if (job === null) throw new AppError("NOT_FOUND", "Job not found", 404);
        return apiOk(job, request.id);
      } catch (err) {
        if (err instanceof Error && err.message.includes("Only failed")) {
          throw new AppError("CONFLICT", err.message, 409);
        }
        throw err;
      }
    },
  );

  app.delete(
    "/jobs/:id",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const deleted = ctx().manager.deleteJob(parseId((request.params as { id: string }).id));
      if (!deleted) throw new AppError("NOT_FOUND", "Job not found", 404);
      return apiOk({ deleted: true }, request.id);
    },
  );

  // ── Clips ────────────────────────────────────────────────────────────────
  app.get(
    "/clips/:id",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const clip = ctx().manager.getClip(parseId((request.params as { id: string }).id));
      if (clip === null) throw new AppError("NOT_FOUND", "Clip not found", 404);
      return apiOk(clip, request.id);
    },
  );

  app.patch(
    "/clips/:id",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const clipId = parseId((request.params as { id: string }).id);
      const patch = patchClipSchema.parse(request.body);
      const clip = ctx().manager.patchClip(clipId, patch);
      if (clip === null) throw new AppError("NOT_FOUND", "Clip not found", 404);
      return apiOk(clip, request.id);
    },
  );

  app.post(
    "/clips/:id/select",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const clipId = parseId((request.params as { id: string }).id);
      const body = z.object({ selected: z.coerce.boolean() }).parse(request.body ?? {});
      const clip = ctx().manager.setClipSelected(clipId, body.selected);
      if (clip === null) throw new AppError("NOT_FOUND", "Clip not found", 404);
      return apiOk(clip, request.id);
    },
  );

  app.post(
    "/clips/:id/subtitles",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const clipId = parseId((request.params as { id: string }).id);
      const body = z
        .object({
          style: z.enum(["classic", "modern", "minimal", "large", "shorts"]).default("modern"),
          uppercase: z.coerce.boolean().default(false),
        })
        .parse(request.body ?? {});
      const srt = ctx().manager.regenerateSubtitles(clipId, body.style, body.uppercase);
      if (srt === null) throw new AppError("NOT_FOUND", "Clip not found", 404);
      return apiOk({ clipId, style: body.style, srt }, request.id);
    },
  );

  app.get(
    "/clips/:id/subtitles",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request, reply) => {
      const clipId = parseId((request.params as { id: string }).id);
      const style = z
        .enum(["classic", "modern", "minimal", "large", "shorts"])
        .default("modern")
        .parse((request.query as { style?: string }).style);
      const srt = ctx().manager.getSubtitles(clipId, style);
      if (srt === null) throw new AppError("NOT_FOUND", "No subtitles for this clip yet", 404);
      reply.type("application/x-subrip; charset=utf-8").send(srt);
    },
  );

  app.get(
    "/clips/:id/thumbnail",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request, reply) => {
      const clipId = parseId((request.params as { id: string }).id);
      const clip = ctx().manager.getClip(clipId);
      if (clip === null) throw new AppError("NOT_FOUND", "Clip not found", 404);
      const thumbPath = ctx().manager.getClipThumbnailPath(clipId);
      if (thumbPath === null) {
        reply
          .type("image/svg+xml")
          .send(
            mockThumbnailSvg(
              `#${clip.rank} · ${clip.categoryLabel}`,
              `Score ${clip.score} · ${Math.round(clip.duration as number)}s`,
            ),
          );
        return reply;
      }
      reply.type("image/jpeg").send(fs.readFileSync(thumbPath));
      return reply;
    },
  );

  app.delete(
    "/clips/:id",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const deleted = ctx().manager.deleteClip(parseId((request.params as { id: string }).id));
      if (!deleted) throw new AppError("NOT_FOUND", "Clip not found", 404);
      return apiOk({ deleted: true }, request.id);
    },
  );

  app.post(
    "/clips/:id/titles",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const clipId = parseId((request.params as { id: string }).id);
      const clip = ctx().manager.getClip(clipId);
      if (clip === null) throw new AppError("NOT_FOUND", "Clip not found", 404);
      const transcript = ctx().manager.getSubtitles(clipId) ?? "";
      const titles = await ctx().providers.titles.generate({
        transcript,
        reason: String(clip.reason ?? ""),
        category: String(clip.category ?? "general"),
        duration: Number(clip.duration ?? 0),
      });
      return apiOk({ clipId, ...titles }, request.id);
    },
  );

  // ── Renders ──────────────────────────────────────────────────────────────
  app.post(
    "/clips/:id/render",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request, reply) => {
      const clipId = parseId((request.params as { id: string }).id);
      const options = renderOptionsSchema.parse(request.body ?? {});
      const render = ctx().manager.requestRender(clipId, options);
      if (render === null) throw new AppError("NOT_FOUND", "Clip not found", 404);
      return reply.status(202).send(apiOk(render, request.id));
    },
  );

  app.get(
    "/renders/:id",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const render = ctx().manager.getRender(parseId((request.params as { id: string }).id));
      if (render === null) throw new AppError("NOT_FOUND", "Render not found", 404);
      return apiOk(render, request.id);
    },
  );

  app.post(
    "/renders/:id/cancel",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request) => {
      const render = ctx().manager.cancelRender(parseId((request.params as { id: string }).id));
      if (render === null) throw new AppError("NOT_FOUND", "Render not found", 404);
      return apiOk(render, request.id);
    },
  );

  app.get(
    "/renders/:id/file",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request, reply) => {
      const renderId = parseId((request.params as { id: string }).id);
      const files = ctx().manager.getRenderFiles(renderId);
      if (files === null || !fs.existsSync(files.videoPath)) {
        throw new AppError(
          "NOT_FOUND",
          "Render output not available (still processing or failed)",
          404,
        );
      }
      const stat = fs.statSync(files.videoPath);
      const range = request.headers.range;
      if (typeof range === "string") {
        const match = /bytes=(\d*)-(\d*)/.exec(range);
        if (match !== null) {
          const start =
            match[1] !== undefined && match[1] !== "" ? Number.parseInt(match[1], 10) : 0;
          const end =
            match[2] !== undefined && match[2] !== ""
              ? Number.parseInt(match[2], 10)
              : stat.size - 1;
          if (start <= end && start < stat.size) {
            const chunk = end - start + 1;
            reply
              .status(206)
              .type("video/mp4")
              .header("content-range", `bytes ${start}-${end}/${stat.size}`)
              .header("accept-ranges", "bytes")
              .header("content-length", chunk);
            fs.createReadStream(files.videoPath, { start, end }).pipe(reply.raw);
            return reply;
          }
        }
      }
      reply
        .status(200)
        .type("video/mp4")
        .header("accept-ranges", "bytes")
        .header("content-length", stat.size)
        .send(fs.createReadStream(files.videoPath));
      return reply;
    },
  );

  app.get(
    "/renders/:id/srt",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request, reply) => {
      const files = ctx().manager.getRenderFiles(parseId((request.params as { id: string }).id));
      if (files === null || files.srtPath === null || !fs.existsSync(files.srtPath)) {
        throw new AppError("NOT_FOUND", "SRT not available", 404);
      }
      reply
        .type("application/x-subrip; charset=utf-8")
        .send(fs.readFileSync(files.srtPath, "utf8"));
      return reply;
    },
  );

  app.get(
    "/renders/:id/metadata",
    { preHandler: requireSessionIfConfigured().preHandler },
    async (request, reply) => {
      const files = ctx().manager.getRenderFiles(parseId((request.params as { id: string }).id));
      if (files === null) throw new AppError("NOT_FOUND", "Render metadata not available", 404);
      reply.type("application/json; charset=utf-8").send(files.metadata);
      return reply;
    },
  );
}

export { mockThumbnailSvg };
