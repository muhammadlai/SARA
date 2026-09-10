/**
 * Sara API entrypoint: env loading → validated config → server → graceful
 * shutdown on SIGINT/SIGTERM.
 */
import { loadApiConfig, loadEnvFileIntoProcess } from "@sara/config";
import { createLogger } from "@sara/logger";
import { buildServer } from "./server.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

async function main(): Promise<void> {
  const envFile = loadEnvFileIntoProcess();
  const { config, warnings } = loadApiConfig();
  const logger = createLogger({
    name: "sara-api",
    level: config.logLevel,
    pretty: config.logPretty,
    base: { service: "sara-api", env: config.env },
  });

  if (envFile !== null) logger.info({ envFile }, "loaded environment file");
  for (const warning of warnings) logger.warn(warning);

  const app = await buildServer({ config });

  try {
    await app.listen({ port: config.apiPort, host: config.host });
  } catch (err) {
    logger.error({ err }, "failed to start API");
    process.exit(1);
  }

  let shuttingDown = false;
  const shutdown = (signal: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutdown signal received, closing server");
    const force = setTimeout(() => {
      logger.error("graceful shutdown timed out — forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();
    app
      .close()
      .then(() => {
        logger.info("shutdown complete");
        process.exit(0);
      })
      .catch((err) => {
        logger.error({ err }, "error during shutdown");
        process.exit(1);
      });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
