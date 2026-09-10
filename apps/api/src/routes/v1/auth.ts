/**
 * Auth foundation endpoints (Phase 1):
 *   POST /api/v1/auth/login   — exchange operator credentials for a session cookie
 *   GET  /api/v1/auth/me      — current session info (200 even when unauthenticated)
 *   POST /api/v1/auth/logout  — clear the session cookie
 *
 * Login is disabled (503) until OPERATOR_PASSWORD is configured, and is rate
 * limited to blunt brute-force attempts. Phase 2 replaces env credentials
 * with database-backed users.
 */
import type { FastifyInstance } from "fastify";
import { apiOk, type SessionInfo } from "@sara/types";
import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { LOGIN_RATE_LIMIT } from "../../lib/rate-limits.js";
import { requireSession } from "../../lib/auth-guard.js";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSession,
  verifyPassword,
  verifySession,
  hashPassword,
  type SessionClaims,
} from "../../lib/auth.js";

const loginSchema = z.object({
  username: z.string().min(1).max(100),
  password: z.string().min(1).max(200),
});

declare module "fastify" {
  interface FastifyRequest {
    session?: SessionClaims;
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/auth/login",
    {
      config: { rateLimit: { max: LOGIN_RATE_LIMIT.max, timeWindow: LOGIN_RATE_LIMIT.timeWindow } },
    },
    async (request, reply) => {
      const config = app.config;

      const parsed = loginSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new AppError(
          "INVALID_INPUT",
          "Expected body { username, password }",
          400,
          parsed.error.flatten(),
        );
      }
      if (config.operatorPassword === null) {
        throw new AppError(
          "AUTH_NOT_CONFIGURED",
          "Authentication is not configured. Set OPERATOR_PASSWORD in the environment to enable login.",
          503,
        );
      }

      const { username, password } = parsed.data;
      const storedHash = hashPassword(config.operatorPassword);
      if (username !== config.operatorUsername || !verifyPassword(password, storedHash)) {
        throw new AppError("UNAUTHORIZED", "Invalid username or password", 401);
      }

      const token = signSession({ sub: username }, app.sessionSecret);
      reply.setCookie(SESSION_COOKIE_NAME, token, {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProduction,
        maxAge: SESSION_TTL_SECONDS,
      });
      request.log.info({ username }, "operator signed in");
      return apiOk({ user: { username } }, request.id);
    },
  );

  app.get("/auth/me", async (request) => {
    const token = request.cookies[SESSION_COOKIE_NAME];
    const claims = token === undefined ? null : verifySession(token, app.sessionSecret);
    const info: SessionInfo = claims
      ? { authenticated: true, user: { username: claims.sub } }
      : { authenticated: false };
    return apiOk(info, request.id);
  });

  app.post("/auth/logout", async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
    return apiOk({ loggedOut: true }, request.id);
  });

  void requireSession; // re-exported via lib/auth-guard for route guards
}
