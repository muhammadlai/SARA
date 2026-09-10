/**
 * Centralized error model: typed application errors + Fastify error/404
 * handlers that always respond with the shared `{ ok, error, requestId }`
 * envelope. Internal details are logged, never leaked to clients.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import { apiFail, type ErrorCode } from "@sara/types";
import { ZodError } from "zod";

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly statusCode: number = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: "INVALID_INPUT",
  401: "UNAUTHORIZED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};

export function registerErrorHandlers(app: FastifyInstance): void {
  // Fastify 5 defaults TError to `unknown` — pin it to FastifyError.
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    if (error instanceof AppError) {
      request.log.warn({ code: error.code, statusCode: error.statusCode }, error.message);
      return reply.status(error.statusCode).send(
        apiFail(error.code, error.message, {
          details: error.details,
          requestId: request.id,
        }),
      );
    }

    if (error instanceof ZodError) {
      return reply.status(400).send(
        apiFail("INVALID_INPUT", "Invalid request payload", {
          details: error.flatten(),
          requestId: request.id,
        }),
      );
    }

    const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
    if (statusCode < 500) {
      // Framework-level client errors (bad JSON, payload too large, rate limits…).
      request.log.warn({ statusCode }, error.message);
      const code = STATUS_TO_CODE[statusCode] ?? "INVALID_INPUT";
      return reply.status(statusCode).send(apiFail(code, error.message, { requestId: request.id }));
    }

    request.log.error({ err: error }, "unhandled error");
    return reply
      .status(500)
      .send(apiFail("INTERNAL", "Internal server error", { requestId: request.id }));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(
      apiFail("NOT_FOUND", `Route ${request.method} ${request.url} was not found`, {
        requestId: request.id,
      }),
    );
  });
}
