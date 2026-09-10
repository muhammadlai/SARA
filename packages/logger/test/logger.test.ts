import { describe, expect, it } from "vitest";
import { createLogger } from "../src/index.js";

describe("createLogger", () => {
  it("honors the requested level", () => {
    const logger = createLogger({ level: "warn" });
    expect(logger.level).toBe("warn");
  });

  it("defaults to info level", () => {
    expect(createLogger().level).toBe("info");
  });

  it("creates child loggers that carry context bindings", () => {
    const logger = createLogger({ name: "sara-api", base: { service: "sara-api" } });
    const child = logger.child({ module: "health" });
    expect(child.bindings()).toMatchObject({ module: "health", service: "sara-api" });
  });
});
