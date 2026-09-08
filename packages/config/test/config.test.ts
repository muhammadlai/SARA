import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConfigError,
  loadApiConfig,
  loadEnvFileIntoProcess,
  loadWebConfig,
  parseEnvFile,
} from "../src/index.js";

describe("loadApiConfig", () => {
  it("applies safe defaults for an empty environment", () => {
    const { config, warnings } = loadApiConfig({});
    expect(config.apiPort).toBe(4000);
    expect(config.host).toBe("0.0.0.0");
    expect(config.env).toBe("development");
    expect(config.logLevel).toBe("info");
    expect(config.logPretty).toBe(true); // development default
    expect(config.corsOrigins).toEqual([]);
    expect(config.databaseUrl).toBeNull();
    expect(config.operatorUsername).toBe("operator");
    expect(config.operatorPassword).toBeNull();
    // Missing session secret and operator password must be surfaced as warnings.
    expect(warnings.some((w) => w.includes("SESSION_SECRET"))).toBe(true);
    expect(warnings.some((w) => w.includes("OPERATOR_PASSWORD"))).toBe(true);
  });

  it("parses and coerces provided values", () => {
    const { config } = loadApiConfig({
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      API_PORT: "5050",
      CORS_ORIGINS: "https://a.example, https://b.example",
      DATABASE_URL: "file:./data/sara.db",
      SESSION_SECRET: "a-sufficiently-long-secret-value",
      OPERATOR_PASSWORD: "correct-horse-battery",
    });
    expect(config.env).toBe("production");
    expect(config.isProduction).toBe(true);
    expect(config.logLevel).toBe("warn");
    expect(config.logPretty).toBe(false); // production default
    expect(config.apiPort).toBe(5050);
    expect(config.corsOrigins).toEqual(["https://a.example", "https://b.example"]);
    expect(config.databaseUrl).toBe("file:./data/sara.db");
    expect(config.operatorPassword).toBe("correct-horse-battery");
  });

  it("rejects an invalid port with a precise error", () => {
    expect(() => loadApiConfig({ API_PORT: "http" })).toThrow(ConfigError);
    try {
      loadApiConfig({ API_PORT: "http" });
    } catch (err) {
      expect((err as ConfigError).issues.join(" ")).toContain("API_PORT");
    }
  });

  it("rejects an invalid log level and malformed CORS origins", () => {
    expect(() => loadApiConfig({ LOG_LEVEL: "trace" })).toThrow(ConfigError);
    expect(() => loadApiConfig({ CORS_ORIGINS: "not-a-url" })).toThrow(ConfigError);
  });

  it("rejects short session secrets and short operator passwords", () => {
    expect(() => loadApiConfig({ SESSION_SECRET: "short" })).toThrow(ConfigError);
    expect(() => loadApiConfig({ OPERATOR_PASSWORD: "abc" })).toThrow(ConfigError);
  });
});

describe("loadWebConfig", () => {
  it("defaults to the local API", () => {
    expect(loadWebConfig({})).toEqual({ apiInternalUrl: "http://127.0.0.1:4000", appUrl: null });
  });

  it("accepts overrides and rejects garbage", () => {
    expect(loadWebConfig({ API_INTERNAL_URL: "http://api:4000" }).apiInternalUrl).toBe(
      "http://api:4000",
    );
    expect(() => loadWebConfig({ API_INTERNAL_URL: "not a url" })).toThrow(ConfigError);
  });
});

describe("parseEnvFile", () => {
  it("parses KEY=VALUE lines, comments and quotes", () => {
    const parsed = parseEnvFile(
      ["# comment", "", "A=1", 'QUOTED="hello world"', "SINGLE='x y'", "not a pair"].join("\n"),
    );
    expect(parsed).toEqual({ A: "1", QUOTED: "hello world", SINGLE: "x y" });
  });
});

describe("loadEnvFileIntoProcess", () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sara-config-"));

  afterEach(() => {
    fs.rmSync(path.join(tmpRoot, "child"), { recursive: true, force: true });
    fs.rmSync(path.join(tmpRoot, "isolated"), { recursive: true, force: true });
  });

  it("walks up to find the nearest .env and does not override existing vars", () => {
    fs.writeFileSync(path.join(tmpRoot, ".env"), "FROM_ENV_FILE=1\nEXISTING=from-file\n");
    const child = path.join(tmpRoot, "child", "grandchild");
    fs.mkdirSync(child, { recursive: true });

    const env: NodeJS.ProcessEnv = { EXISTING: "preset" };
    const loaded = loadEnvFileIntoProcess(child, env);

    expect(loaded).toBe(path.join(tmpRoot, ".env"));
    expect(env.FROM_ENV_FILE).toBe("1");
    expect(env.EXISTING).toBe("preset"); // existing wins
  });

  it("returns null when no .env exists", () => {
    // Isolated directory tree: nothing above it contains a .env file.
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "sara-config-empty-"));
    const child = path.join(root, "deep", "deeper");
    fs.mkdirSync(child, { recursive: true });
    try {
      expect(loadEnvFileIntoProcess(child, {})).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
