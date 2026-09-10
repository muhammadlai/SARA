/**
 * Sara AI — append-only audit log.
 *
 * Every consequential action (control commands, settings changes, memory
 * deletions, moderation escalations, provider failures) is recorded here.
 * No update/delete paths exist by design.
 */
import type { SqliteDatabase } from "@sara/db";

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string | null;
  details?: Record<string, unknown>;
  at?: string;
}

export class AuditLog {
  constructor(private readonly db: SqliteDatabase) {}

  append(entry: AuditEntry): void {
    this.db
      .prepare(
        "INSERT INTO sara_audit (at, actor, action, target, details_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        entry.at ?? new Date().toISOString(),
        entry.actor,
        entry.action,
        entry.target ?? null,
        entry.details ? JSON.stringify(entry.details) : null,
      );
  }

  recent(limit = 50): Array<{
    id: number;
    at: string;
    actor: string;
    action: string;
    target: string | null;
    details: Record<string, unknown> | null;
  }> {
    const rows = this.db
      .prepare("SELECT * FROM sara_audit ORDER BY id DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      id: Number(r["id"]),
      at: String(r["at"]),
      actor: String(r["actor"]),
      action: String(r["action"]),
      target: r["target"] ? String(r["target"]) : null,
      details: r["details_json"]
        ? (JSON.parse(String(r["details_json"])) as Record<string, unknown>)
        : null,
    }));
  }
}

/** Provider usage ledger — powers the analytics view honestly (real calls only). */
export class ProviderUsage {
  constructor(private readonly db: SqliteDatabase) {}

  record(
    provider: string,
    kind: string,
    ok: boolean,
    latencyMs: number,
    usage?: Record<string, unknown>,
  ): void {
    this.db
      .prepare(
        "INSERT INTO sara_provider_usage (provider, kind, at, latency_ms, ok, usage_json) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        provider,
        kind,
        new Date().toISOString(),
        Math.round(latencyMs),
        ok ? 1 : 0,
        usage ? JSON.stringify(usage) : null,
      );
  }

  summary(): Array<{
    provider: string;
    kind: string;
    calls: number;
    failures: number;
    avgLatencyMs: number;
  }> {
    const rows = this.db
      .prepare(
        "SELECT provider, kind, COUNT(*) AS calls, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failures, AVG(latency_ms) AS avg_ms FROM sara_provider_usage GROUP BY provider, kind ORDER BY calls DESC LIMIT 20",
      )
      .all() as Array<Record<string, unknown>>;
    return rows.map((r) => ({
      provider: String(r["provider"]),
      kind: String(r["kind"]),
      calls: Number(r["calls"]),
      failures: Number(r["failures"]),
      avgLatencyMs: Math.round(Number(r["avg_ms"] ?? 0)),
    }));
  }
}
