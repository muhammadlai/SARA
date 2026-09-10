/**
 * Security middleware: security headers (helmet), CORS restricted to
 * configured origins, cookie parsing and rate limiting.
 */
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@sara/config";
import { GLOBAL_RATE_LIMIT } from "../lib/rate-limits.js";

export async function registerSecurity(app: FastifyInstance, config: ApiConfig): Promise<void> {
  // Sensible security headers (X-Frame-Options, HSTS in production, …).
  await app.register(helmet, { contentSecurityPolicy: false });

  // CORS: browsers are expected to talk same-origin (the web app proxies
  // /api/* server-side), so cross-origin access is allowed only for the
  // explicitly configured origins. Requests without an Origin header
  // (curl, server-to-server) always pass.
  const allowedOrigins = new Set(config.corsOrigins);
  await app.register(cors, {
    credentials: true,
    origin: (origin, cb) => {
      if (origin === undefined || allowedOrigins.has(origin)) return cb(null, true);
      return cb(null, false);
    },
  });

  await app.register(cookie);

  // Multipart uploads (Clip Finder video sources). The route applies the
  // validated CLIP_FINDER_MAX_UPLOAD_MB limit per request on top of this cap.
  await app.register(multipart, {
    limits: {
      fileSize: 2 * 1024 * 1024 * 1024,
      files: 1,
    },
  });

  await app.register(rateLimit, {
    global: true,
    max: GLOBAL_RATE_LIMIT.max,
    timeWindow: GLOBAL_RATE_LIMIT.timeWindow,
  });
}
