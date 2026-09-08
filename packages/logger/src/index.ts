/**
 * @sara/logger — structured logging for Sara services.
 *
 * One pino instance per process; child loggers carry context
 * (`{ module, requestId, agentRunId }`). Secrets and personal content must
 * never be logged (docs/CODING_CONVENTIONS.md).
 */
import pino from "pino";

export type Logger = pino.Logger;

export interface CreateLoggerOptions {
  name?: string;
  level?: string;
  /** Pretty-print for local development. Production default is JSON. */
  pretty?: boolean;
  /** Fields attached to every log line (e.g. `{ service: "sara-api" }`). */
  base?: Record<string, unknown>;
}

/**
 * Build pino logger options from our option shape. Exported so Fastify can
 * construct its own logger from the exact same options (`logger:` option),
 * keeping a single log format across a process.
 */
export function toPinoOptions(options: CreateLoggerOptions = {}): pino.LoggerOptions {
  const { name = "sara", level = "info", pretty = false, base } = options;
  const pinoOptions: pino.LoggerOptions = { name, level, base: base ?? {} };
  if (pretty) {
    pinoOptions.transport = {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:HH:MM:SS.l", ignore: "pid,hostname" },
    };
  }
  return pinoOptions;
}

export function createLogger(options: CreateLoggerOptions = {}): Logger {
  return pino(toPinoOptions(options));
}
