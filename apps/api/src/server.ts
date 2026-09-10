/**
 * Fastify server assembly: logging, request IDs, security middleware,
 * centralized error handling, versioned routes, Clip Finder + Sara LIVE
 * services and graceful shutdown. Built as a pure factory so tests can
 * `inject()`.
 *
 * The logger is handed to Fastify as pino OPTIONS (via @sara/logger) so the
 * framework owns a single, correctly-typed logger for the whole process.
 */
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import type { ApiConfig } from "@sara/config";
import { toPinoOptions } from "@sara/logger";
import { API_VERSION } from "@sara/types";
import { closeDatabase } from "@sara/db";
import { registerErrorHandlers } from "./lib/errors.js";
import { createEphemeralSecret } from "./lib/auth.js";
import { registerSecurity } from "./plugins/security.js";
import { v1Routes } from "./routes/v1/index.js";
import { clipFinderRoutes } from "./routes/v1/clip-finder.js";
import { createClipFinderContext, type ClipFinderContext } from "./services/clip-finder.js";
import { saraRoutes } from "./routes/v1/sara.js";
import { createSaraContext, type SaraContext } from "./services/sara-live.js";

declare module "fastify" {
  interface FastifyInstance {
    config: ApiConfig;
    sessionSecret: string;
    clipFinder: ClipFinderContext;
    sara: SaraContext;
  }
}

export interface BuildServerOptions {
  config: ApiConfig;
  /** Test seam: inject a Clip Finder context (own DB, fake media tools…). */
  clipFinder?: ClipFinderContext;
  /** Test seam: inject a Sara LIVE context (fake providers). */
  sara?: SaraContext;
}

export async function buildServer({
  config,
  clipFinder,
  sara,
}: BuildServerOptions): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    logger: toPinoOptions({
      name: "sara-api",
      level: config.logLevel,
      pretty: config.logPretty,
      base: { service: "sara-api", env: config.env },
    }),
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    bodyLimit: 2 * 1024 * 1024,
  });

  app.decorate("config", config);
  app.decorate("sessionSecret", config.sessionSecret ?? createEphemeralSecret());
  app.decorate("clipFinder", clipFinder ?? createClipFinderContext());
  app.decorate("sara", sara ?? createSaraContext());

  // Release the database connection when the server closes (graceful shutdown).
  app.addHook("onClose", async (instance) => {
    instance.clipFinder.worker.stop();
    await instance.sara.system.director.stop().catch(() => undefined);
    instance.sara.system.watchdog.stop();
    closeDatabase();
  });

  await registerSecurity(app, config);
  registerErrorHandlers(app);

  await app.register(v1Routes, { prefix: `/api/${API_VERSION}` });
  await app.register(clipFinderRoutes, { prefix: `/api/${API_VERSION}/clip-finder` });
  await app.register(saraRoutes, {
    prefix: `/api/${API_VERSION}/sara`,
    sara: app.sara,
  });

  // Background worker for Clip Finder jobs starts once the server is ready.
  app.addHook("onReady", async () => {
    app.clipFinder.worker.start();
  });

  return app;
}
