/**
 * Migration CLI: `npm run migrate -w @sara/db` (add `-- --status` to list).
 * Loads the repo-root .env via @sara/config, then applies pending migrations.
 */
import { loadEnvFileIntoProcess } from "@sara/config";
import {
  getDatabase,
  isDatabaseConfigured,
  listMigrationFiles,
  migrateDatabase,
  closeDatabase,
} from "./index.js";

async function main(): Promise<void> {
  loadEnvFileIntoProcess();
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL is not set — nothing to migrate. See .env.example.");
    process.exit(1);
  }

  const db = getDatabase();
  if (process.argv.includes("--status")) {
    const rows = db.prepare("SELECT name, applied_at FROM _sara_migrations ORDER BY name").all();
    console.log("Applied migrations:");
    for (const row of rows) console.log(`  ✓ ${row.name as string} (${row.applied_at as string})`);
    const pending = listMigrationFiles().filter((name) => !rows.some((r) => r.name === name));
    for (const name of pending) console.log(`  • ${name} (pending)`);
    return;
  }

  const applied = migrateDatabase(db);
  const fresh = applied.filter((m) => !m.alreadyApplied);
  for (const m of fresh) console.log(`applied ${m.name}`);
  console.log(
    fresh.length === 0 ? "database is up to date" : `${fresh.length} migration(s) applied`,
  );
  closeDatabase();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
