/**
 * @sara/db — database foundation for Sara (Phase 1).
 *
 * A deliberately small, dependency-free layer on Node's built-in SQLite
 * (node:sqlite): a lazy connection singleton, an ordered SQL-file migration
 * runner, and a health probe. The rest of the system depends only on these
 * functions, so the storage engine/ORM for production (Phase 2 decision) can
 * change without touching callers — see ADR 0003.
 *
 * DATABASE_URL forms:
 *   file:./data/sara.db  → SQLite file, relative paths resolve to this package
 *   file:/abs/path.db    → absolute SQLite file
 *   :memory:             → in-memory (tests)
 *   (unset)              → database layer unconfigured; callers degrade
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { ComponentHealth } from "@sara/types";

export type SqliteDatabase = DatabaseSync;

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../migrations");
const PACKAGE_ROOT = path.resolve(MIGRATIONS_DIR, "..");

let database: SqliteDatabase | null = null;

/** Parse DATABASE_URL into a filesystem path (or null when unconfigured). */
export function resolveDatabasePath(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = env.DATABASE_URL;
  if (raw === undefined || raw.length === 0) return null;
  if (raw === ":memory:") return ":memory:";
  const withoutScheme = raw.startsWith("file:") ? raw.slice("file:".length) : raw;
  if (path.isAbsolute(withoutScheme)) return withoutScheme;
  return path.resolve(PACKAGE_ROOT, withoutScheme);
}

/**
 * Get (or lazily create) the process-wide database connection.
 * Throws when DATABASE_URL is not configured — probe with
 * {@link isDatabaseConfigured} first in graceful-degradation paths.
 */
export function getDatabase(env: NodeJS.ProcessEnv = process.env): SqliteDatabase {
  if (database === null) {
    const file = resolveDatabasePath(env);
    if (file === null) {
      throw new Error("DATABASE_URL is not configured — cannot open the database");
    }
    if (file !== ":memory:") {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
    database = new DatabaseSync(file);
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA foreign_keys = ON;");
  }
  return database;
}

/** Close the singleton connection; safe to call repeatedly. */
export function closeDatabase(): void {
  if (database !== null) {
    database.close();
    database = null;
  }
}

/** True when DATABASE_URL is present — i.e. the database layer is in use. */
export function isDatabaseConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveDatabasePath(env) !== null;
}

export interface AppliedMigration {
  name: string;
  alreadyApplied: boolean;
}

/** Read ordered `*.sql` migration files from the migrations directory. */
export function listMigrationFiles(dir: string = MIGRATIONS_DIR): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/**
 * Apply pending migrations in filename order, tracked in `_sara_migrations`.
 * Each migration runs inside a transaction; returns what was applied.
 */
export function migrateDatabase(db: SqliteDatabase = getDatabase()): AppliedMigration[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _sara_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  const done = new Set(
    db
      .prepare("SELECT name FROM _sara_migrations")
      .all()
      .map((row) => row.name as string),
  );

  const applied: AppliedMigration[] = [];
  for (const fileName of listMigrationFiles()) {
    if (done.has(fileName)) {
      applied.push({ name: fileName, alreadyApplied: true });
      continue;
    }
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, fileName), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO _sara_migrations (name) VALUES (?)").run(fileName);
      db.exec("COMMIT");
      applied.push({ name: fileName, alreadyApplied: false });
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(
        `migration ${fileName} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return applied;
}

/**
 * Probe the database with a trivial query. Never throws: failures map to
 * `{ status: "down" }` with a safe (non-leaking) detail string.
 */
export async function checkDatabase(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ComponentHealth> {
  if (!isDatabaseConfigured(env)) {
    return { status: "unconfigured", detail: "DATABASE_URL is not set" };
  }
  const started = performance.now();
  try {
    getDatabase(env).prepare("SELECT 1 AS ok").get();
    return { status: "up", latencyMs: Math.max(1, Math.round(performance.now() - started)) };
  } catch {
    return { status: "down", detail: "database connection failed (see service logs)" };
  }
}
