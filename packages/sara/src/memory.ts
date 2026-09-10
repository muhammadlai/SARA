/**
 * Sara AI — memory system.
 *
 * Short-term (session context window, recent viewers) and long-term
 * (facts/preferences/interactions per viewer) memory over the existing
 * SQLite database. Includes salience-ranked retrieval, privacy controls
 * (view + delete everything), and an audit hook so admin actions are
 * recorded. Deliberately avoids storing sensitive personal data: facts are
 * short voluntary snippets ("name is Ali", "likes cooking").
 */
import type { SqliteDatabase } from "@sara/db";
import type { MemoryKind, MemoryRecord, SaraLanguage, ViewerRecord } from "./types.js";

export interface MemoryRetrieveOptions {
  viewerId?: string | null;
  limit?: number;
  kinds?: MemoryKind[];
}

export interface RememberInput {
  viewerId?: string | null;
  kind: MemoryKind;
  content: string;
  salience?: number;
  source?: string;
  /** Auto-expiry for low-value context (session-scoped). */
  ttlSeconds?: number;
}

function now(): string {
  return new Date().toISOString();
}

function rid(prefix: string): string {
  return `${prefix}_${globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

/** Facts Sara should not persist (best-effort local screening). */
const SENSITIVE_PATTERNS = [
  /\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/, // phone-ish
  /\b\d+\/(address|house|street)\b/i,
  /\b(password|pwd|otp|pin code|credit card|cvv|cnic|aadhaar)\b/i,
  /\b\d{4}[- ]?\d{4}[- ]?\d{4}\b/, // card-ish
];

export class MemoryStore {
  constructor(private readonly db: SqliteDatabase) {}

  ensureSchema(): void {
    // Migration 0003_sara_live.sql owns the schema; nothing to do here when
    // running under the API. In-memory tests call this after applying it.
  }

  // ── Viewers ────────────────────────────────────────────────────────────────
  upsertViewer(input: {
    platform: string;
    platformUserId: string;
    displayName: string;
    language?: SaraLanguage | null;
  }): ViewerRecord {
    const existing = this.db
      .prepare("SELECT * FROM sara_viewers WHERE platform = ? AND platform_user_id = ?")
      .get(input.platform, input.platformUserId) as Record<string, unknown> | undefined;
    const t = now();
    if (existing) {
      this.db
        .prepare(
          "UPDATE sara_viewers SET last_seen_at = ?, display_name = ?, interaction_count = interaction_count + 1, language = COALESCE(?, language) WHERE id = ?",
        )
        .run(t, input.displayName, input.language ?? null, String(existing["id"]));
      const isRegular = Number(existing["interaction_count"]) + 1 >= 3;
      if (isRegular && !Number(existing["is_regular"])) {
        this.db
          .prepare("UPDATE sara_viewers SET is_regular = 1 WHERE id = ?")
          .run(String(existing["id"]));
      }
      return this.viewer(String(existing["id"]))!;
    }
    const id = rid("vw");
    this.db
      .prepare(
        "INSERT INTO sara_viewers (id, platform, platform_user_id, display_name, first_seen_at, last_seen_at, interaction_count, language) VALUES (?, ?, ?, ?, ?, ?, 1, ?)",
      )
      .run(
        id,
        input.platform,
        input.platformUserId,
        input.displayName,
        t,
        t,
        input.language ?? null,
      );
    return this.viewer(id)!;
  }

  viewer(id: string): ViewerRecord | null {
    const row = this.db.prepare("SELECT * FROM sara_viewers WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    return row ? this.toViewer(row) : null;
  }

  findViewer(platform: string, platformUserId: string): ViewerRecord | null {
    const row = this.db
      .prepare("SELECT * FROM sara_viewers WHERE platform = ? AND platform_user_id = ?")
      .get(platform, platformUserId) as Record<string, unknown> | undefined;
    return row ? this.toViewer(row) : null;
  }

  setFollower(platform: string, platformUserId: string, isFollower: boolean): void {
    this.db
      .prepare(
        "UPDATE sara_viewers SET is_follower = ? WHERE platform = ? AND platform_user_id = ?",
      )
      .run(isFollower ? 1 : 0, platform, platformUserId);
  }

  recentViewers(limit = 12): ViewerRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM sara_viewers ORDER BY last_seen_at DESC LIMIT ?")
      .all(limit) as Array<Record<string, unknown>>;
    return rows.map((r) => this.toViewer(r));
  }

  // ── Memories ───────────────────────────────────────────────────────────────
  remember(input: RememberInput): MemoryRecord | null {
    const content = input.content.trim().slice(0, 400);
    if (!content) return null;
    if (SENSITIVE_PATTERNS.some((re) => re.test(content))) return null; // privacy screen

    // Merge duplicates per viewer: same content → bump salience instead.
    const dup = input.viewerId
      ? (this.db
          .prepare(
            "SELECT id FROM sara_memories WHERE viewer_id = ? AND content = ? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 1",
          )
          .get(input.viewerId, content) as { id: string } | undefined)
      : undefined;
    const t = now();
    if (dup) {
      this.db
        .prepare(
          "UPDATE sara_memories SET salience = MIN(1, salience + 0.1), updated_at = ? WHERE id = ?",
        )
        .run(t, dup.id);
      return this.get(dup.id);
    }

    const id = rid("mem");
    const expires = input.ttlSeconds
      ? new Date(Date.now() + input.ttlSeconds * 1000).toISOString()
      : null;
    this.db
      .prepare(
        "INSERT INTO sara_memories (id, viewer_id, kind, content, salience, source, created_at, updated_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.viewerId ?? null,
        input.kind,
        content,
        input.salience ?? 0.5,
        input.source ?? "conversation",
        t,
        t,
        expires,
      );
    return this.get(id);
  }

  get(id: string): MemoryRecord | null {
    const row = this.db
      .prepare(
        "SELECT * FROM sara_memories WHERE id = ? AND deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?)",
      )
      .get(id, now()) as Record<string, unknown> | undefined;
    return row ? this.toMemory(row) : null;
  }

  /**
   * Relevance-ranked retrieval: viewer-scoped first (salience desc), then
   * global context. `query` words boost matching content (cheap lexical rank).
   */
  retrieve(opts: MemoryRetrieveOptions & { query?: string }): MemoryRecord[] {
    const limit = opts.limit ?? 8;
    const rows = (
      opts.viewerId
        ? this.db
            .prepare(
              "SELECT * FROM sara_memories WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) AND (viewer_id = ? OR viewer_id IS NULL) ORDER BY salience DESC, updated_at DESC LIMIT 64",
            )
            .all(now(), opts.viewerId)
        : this.db
            .prepare(
              "SELECT * FROM sara_memories WHERE deleted_at IS NULL AND (expires_at IS NULL OR expires_at > ?) ORDER BY salience DESC, updated_at DESC LIMIT 64",
            )
            .all(now())
    ) as Array<Record<string, unknown>>;

    let records = rows.map((r) => this.toMemory(r));
    if (opts.kinds) records = records.filter((r) => opts.kinds!.includes(r.kind));
    if (opts.query) {
      const words = opts.query
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 2);
      records = records
        .map((r) => {
          const hits = words.filter((w) => r.content.toLowerCase().includes(w)).length;
          return { r, boost: hits * 0.15 };
        })
        .sort((a, b) => b.r.salience + b.boost - (a.r.salience + a.boost))
        .map((x) => x.r);
    }
    return records.slice(0, limit);
  }

  forget(id: string): boolean {
    const res = this.db
      .prepare("UPDATE sara_memories SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL")
      .run(now(), id);
    return res.changes > 0;
  }

  forgetViewer(viewerId: string): number {
    const res = this.db
      .prepare("UPDATE sara_memories SET deleted_at = ? WHERE viewer_id = ? AND deleted_at IS NULL")
      .run(now(), viewerId);
    return Number(res.changes);
  }

  /** Full privacy wipe: everything about a viewer (GDPR-style delete). */
  deleteViewerCompletely(viewerId: string): void {
    this.db.prepare("DELETE FROM sara_memories WHERE viewer_id = ?").run(viewerId);
    this.db.prepare("UPDATE sara_events SET viewer_id = NULL WHERE viewer_id = ?").run(viewerId);
    this.db.prepare("UPDATE sara_messages SET viewer_id = NULL WHERE viewer_id = ?").run(viewerId);
    this.db.prepare("DELETE FROM sara_viewers WHERE id = ?").run(viewerId);
  }

  purgeExpiredContext(): number {
    const res = this.db
      .prepare("DELETE FROM sara_memories WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(now());
    return Number(res.changes);
  }

  // ── Mapping ────────────────────────────────────────────────────────────────
  private toViewer(row: Record<string, unknown>): ViewerRecord {
    return {
      id: String(row["id"]),
      platform: String(row["platform"]),
      platformUserId: String(row["platform_user_id"]),
      displayName: String(row["display_name"]),
      firstSeenAt: String(row["first_seen_at"]),
      lastSeenAt: String(row["last_seen_at"]),
      interactionCount: Number(row["interaction_count"]),
      isFollower: Number(row["is_follower"]) === 1,
      isRegular: Number(row["is_regular"]) === 1,
      language: (row["language"] as SaraLanguage | null) ?? null,
    };
  }

  private toMemory(row: Record<string, unknown>): MemoryRecord {
    return {
      id: String(row["id"]),
      viewerId: row["viewer_id"] ? String(row["viewer_id"]) : null,
      kind: String(row["kind"]) as MemoryKind,
      content: String(row["content"]),
      salience: Number(row["salience"]),
      createdAt: String(row["created_at"]),
      updatedAt: String(row["updated_at"]),
    };
  }
}
