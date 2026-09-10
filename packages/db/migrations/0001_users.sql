-- 0001_users.sql — Phase 1 foundation
-- Root identity table. Later phases extend carefully (conversations, memories,
-- tasks, content, social accounts, scheduled jobs, append-only audit log).

CREATE TABLE IF NOT EXISTS users (
  id           TEXT PRIMARY KEY,
  username     TEXT NOT NULL UNIQUE,
  display_name TEXT,
  -- "operator" today; finer roles arrive with permission scopes (Phase 9).
  role         TEXT NOT NULL DEFAULT 'operator',
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
