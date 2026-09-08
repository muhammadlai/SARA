/**
 * Fastify server assembly: logging, request IDs, security middleware,
 * centralized error handling, versioned routes and DB cleanup on close.
 * Built as a pure factory so tests can `inject()` without opening ports.
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

declare module "fastify" {
  interface FastifyInstance {
    config: ApiConfig;
    sessionSecret: string;
  }
}

export interface BuildServerOptions {
  config: ApiConfig;
}

export async function buildServer({ config }: BuildServerOptions): Promise<FastifyInstance> {
  const app: FastifyInstance = Fastify({
    logger: toPinoOptions({
      name: "sara-api",
      level: config.logLevel,
      pretty: config.logPretty,
      base: { service: "sara-api", env: config.env },
    }),
    genReqId: (req) => (req.headers["x-request-id"] as string | undefined) ?? randomUUID(),
    bodyLimit: 1024 * 1024,
  });

  app.decorate("config", config);
  app.decorate("sessionSecret", config.sessionSecret ?? createEphemeralSecret());

  // Release the database connection when the server closes (graceful shutdown).
  app.addHook("onClose", async () => {
    closeDatabase();
  });

  await registerSecurity(app, config);
  registerErrorHandlers(app);

  await app.register(v1Routes, { prefix: `/api/${API_VERSION}` });

  return app;
}
