/**
 * Session guards. `requireSession` protects a route when auth is configured;
 * `requireSessionIfConfigured` keeps local development open when no operator
 * password is set (login disabled) while enforcing sessions in real setups.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "./errors.js";
import { SESSION_COOKIE_NAME, verifySession } from "./auth.js";

export interface SessionGuard {
  preHandler: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
}

export function requireSession(): SessionGuard {
  return {
    preHandler: async (request, _reply) => {
      const token = request.cookies[SESSION_COOKIE_NAME];
      const claims =
        token === undefined ? null : verifySession(token, request.server.sessionSecret);
      if (claims === null) {
        throw new AppError("UNAUTHORIZED", "Authentication required", 401);
      }
      request.session = claims;
    },
  };
}

export function requireSessionIfConfigured(): SessionGuard {
  return {
    preHandler: async (request, _reply) => {
      if (request.server.config.operatorPassword === null) return; // auth not configured (local dev)
      const token = request.cookies[SESSION_COOKIE_NAME];
      const claims =
        token === undefined ? null : verifySession(token, request.server.sessionSecret);
      if (claims === null) {
        throw new AppError("UNAUTHORIZED", "Authentication required", 401);
      }
      request.session = claims;
    },
  };
}
