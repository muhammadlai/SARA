/** GET /api/v1/health — service + infrastructure health probe. */
import type { FastifyInstance } from "fastify";
import { checkDatabase } from "@sara/db";
import { apiOk, API_VERSION, type HealthPayload } from "@sara/types";
import { SERVICE_VERSION } from "../../version.js";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async (request) => {
    const database = await checkDatabase();
    const payload: HealthPayload = {
      status: database.status === "down" ? "degraded" : "ok",
      service: "sara-api",
      version: SERVICE_VERSION,
      apiVersion: API_VERSION,
      uptimeSeconds: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database },
    };
    return apiOk(payload, request.id);
  });
}
