import type { ApiConfig } from "@sara/config";
import type { ClipFinderContext } from "../src/services/clip-finder.js";
import { buildServer } from "../src/server.js";

/** Deterministic base config for tests; override per scenario. */
export function testConfig(overrides: Partial<ApiConfig> = {}): ApiConfig {
  return {
    env: "test",
    isProduction: false,
    logLevel: "silent",
    logPretty: false,
    apiPort: 0,
    host: "127.0.0.1",
    corsOrigins: [],
    databaseUrl: null,
    sessionSecret: "test-session-secret-0123456789abcdef",
    operatorUsername: "operator",
    operatorPassword: null,
    ...overrides,
  };
}

/** Build a full server instance with a silent logger, for `inject()` tests. */
export async function buildTestApp(
  overrides: Partial<ApiConfig> = {},
  clipFinder?: ClipFinderContext,
) {
  return buildServer({ config: testConfig(overrides), clipFinder });
}

export type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

export const TEST_PASSWORD = "test-password-123";
