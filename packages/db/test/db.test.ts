import { beforeEach, describe, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import {
  checkDatabase,
  getDatabase,
  isDatabaseConfigured,
  listMigrationFiles,
  migrateDatabase,
  resolveDatabasePath,
} from "../src/index.js";

describe("resolveDatabasePath", () => {
  it("returns null when unconfigured", () => {
    expect(resolveDatabasePath({})).toBeNull();
    expect(resolveDatabasePath({ DATABASE_URL: "" })).toBeNull();
  });

  it("resolves relative file: URLs against the package root", () => {
    const p = resolveDatabasePath({ DATABASE_URL: "file:./data/sara.db" });
    expect(p).toContain("packages/db/data/sara.db");
  });

  it("passes through absolute paths and :memory:", () => {
    expect(resolveDatabasePath({ DATABASE_URL: "file:/tmp/x.db" })).toBe("/tmp/x.db");
    expect(resolveDatabasePath({ DATABASE_URL: ":memory:" })).toBe(":memory:");
  });
});

describe("isDatabaseConfigured", () => {
  it("reflects DATABASE_URL presence", () => {
    expect(isDatabaseConfigured({})).toBe(false);
    expect(isDatabaseConfigured({ DATABASE_URL: ":memory:" })).toBe(true);
  });
});

describe("migrateDatabase", () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(":memory:");
  });

  it("discovers the committed migration files in order", () => {
    const files = listMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0]).toMatch(/^\d{4}_.*\.sql$/);
  });

  it("applies migrations once and is idempotent on re-run", () => {
    const first = migrateDatabase(db);
    expect(first.some((m) => !m.alreadyApplied)).toBe(true);

    const second = migrateDatabase(db);
    expect(second.every((m) => m.alreadyApplied)).toBe(true);
  });

  it("creates the users table with a unique username", () => {
    migrateDatabase(db);
    db.prepare("INSERT INTO users (id, username, display_name) VALUES (?, ?, ?)").run(
      "u1",
      "operator",
      "Operator",
    );
    const row = db.prepare("SELECT username, role FROM users WHERE id = ?").get("u1");
    expect(row).toEqual({ username: "operator", role: "operator" });
    expect(() =>
      db.prepare("INSERT INTO users (id, username) VALUES (?, ?)").run("u2", "operator"),
    ).toThrow();
  });

  it("rolls back a failing migration and leaves no partial record", () => {
    migrateDatabase(db);
    // A duplicate table creation violates the schema → transaction rollback.
    const db2 = new DatabaseSync(":memory:");
    db2.exec("CREATE TABLE users (id TEXT PRIMARY KEY)"); // conflicts with 0001
    expect(() => migrateDatabase(db2)).toThrow(/0001_users\.sql failed/);
    const tracked = db2.prepare("SELECT name FROM _sara_migrations").all();
    expect(tracked).toHaveLength(0);
  });
});

describe("checkDatabase", () => {
  it("reports unconfigured without DATABASE_URL", async () => {
    const health = await checkDatabase({});
    expect(health.status).toBe("unconfigured");
  });

  it("reports up with a working in-memory database", async () => {
    const health = await checkDatabase({ DATABASE_URL: ":memory:" });
    expect(health.status).toBe("up");
    expect(typeof health.latencyMs).toBe("number");
    getDatabase({ DATABASE_URL: ":memory:" }).close(); // shared singleton cleanup
  });
});
