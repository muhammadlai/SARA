/**
 * `/api/v1` route tree. Versioning convention: every route lives under
 * `routes/v1/`; breaking changes later introduce `routes/v2/` side by side
 * while v1 keeps running (API_VERSION comes from @sara/types).
 */
import type { FastifyInstance } from "fastify";
import { apiOk, API_VERSION } from "@sara/types";
import { SERVICE_VERSION } from "../../version.js";
import { healthRoutes } from "./health.js";
import { authRoutes } from "./auth.js";

export async function v1Routes(app: FastifyInstance): Promise<void> {
  // API index — a friendly discovery endpoint for the version namespace.
  app.get("/", async (request) => {
    return apiOk(
      {
        service: "sara-api",
        version: SERVICE_VERSION,
        apiVersion: API_VERSION,
        endpoints: ["GET /health", "POST /auth/login", "GET /auth/me", "POST /auth/logout"],
      },
      request.id,
    );
  });

  await app.register(healthRoutes);
  await app.register(authRoutes);
}
