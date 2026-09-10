/**
 * Sara LIVE service context for the API process.
 *
 * Builds the @sara/live system (brain, director, sources, watchdog) once and
 * shares it across requests. Uses a lazy database proxy so the API boots (and
 * tests run) without DATABASE_URL — the connection opens on first use.
 */
import { createRequire } from "node:module";
import { loadSaraConfig, type SaraConfig } from "@sara/config";
import { isDatabaseConfigured, type SqliteDatabase } from "@sara/db";
import { buildSaraSystem, type SaraSystem } from "@sara/live";

export interface SaraContext {
  config: SaraConfig;
  system: SaraSystem;
}

export interface SaraDeps {
  sara?: SaraSystem;
}

/** Proxy DB that opens the real connection on first property access. */
function lazyDatabase(): SqliteDatabase {
  let real: SqliteDatabase | null = null;
  return new Proxy({} as SqliteDatabase, {
    get(_target, prop) {
      if (real === null) {
        const require2 = createRequire(import.meta.url);
        const { getDatabase } = require2("@sara/db") as { getDatabase: () => SqliteDatabase };
        real = getDatabase();
      }
      // Bind native methods to the real connection (sqlite rejects foreign receivers).
      const value = Reflect.get(real as object, prop);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

export function createSaraContext(deps: SaraDeps = {}): SaraContext {
  const config = loadSaraConfig();
  if (deps.sara) return { config, system: deps.sara };

  const db: SqliteDatabase = isDatabaseConfigured() ? lazyDatabase() : lazyDatabase();
  const system = buildSaraSystem({ db, config });
  return { config, system };
}
