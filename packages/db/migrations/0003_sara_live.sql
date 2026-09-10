-- Sara AI — virtual LIVE host: viewers, memory, sessions, events, moderation, audit.
-- Uses the same conventions as 0002_clip_finder.sql (TEXT ids, *_json payloads,
-- status CHECKs, indexes for the hot paths).

CREATE TABLE IF NOT EXISTS sara_viewers (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'simulator',
  platform_user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  interaction_count INTEGER NOT NULL DEFAULT 0,
  is_follower INTEGER NOT NULL DEFAULT 0,
  is_regular INTEGER NOT NULL DEFAULT 0,
  language TEXT,
  profile_json TEXT,
  UNIQUE (platform, platform_user_id)
);
CREATE INDEX IF NOT EXISTS idx_sara_viewers_platform ON sara_viewers (platform, platform_user_id);
CREATE INDEX IF NOT EXISTS idx_sara_viewers_last_seen ON sara_viewers (last_seen_at DESC);

CREATE TABLE IF NOT EXISTS sara_memories (
  id TEXT PRIMARY KEY,
  viewer_id TEXT REFERENCES sara_viewers(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('fact', 'preference', 'interaction', 'context')),
  content TEXT NOT NULL,
  salience REAL NOT NULL DEFAULT 0.5,
  source TEXT NOT NULL DEFAULT 'conversation',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_sara_memories_viewer ON sara_memories (viewer_id);
CREATE INDEX IF NOT EXISTS idx_sara_memories_kind ON sara_memories (kind);

CREATE TABLE IF NOT EXISTS sara_live_sessions (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'simulator',
  state TEXT NOT NULL CHECK (state IN ('idle', 'starting', 'live', 'paused', 'takeover', 'muted', 'stopped', 'error')),
  started_at TEXT,
  stopped_at TEXT,
  viewer_peak INTEGER NOT NULL DEFAULT 0,
  comment_count INTEGER NOT NULL DEFAULT 0,
  response_count INTEGER NOT NULL DEFAULT 0,
  event_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  config_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sara_sessions_state ON sara_live_sessions (state);

CREATE TABLE IF NOT EXISTS sara_events (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sara_live_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('comment', 'follow', 'unfollow', 'gift', 'share', 'join', 'leave', 'battle_start', 'battle_update', 'battle_end', 'like', 'system')),
  platform TEXT NOT NULL DEFAULT 'simulator',
  username TEXT,
  viewer_id TEXT REFERENCES sara_viewers(id) ON DELETE SET NULL,
  payload_json TEXT,
  priority INTEGER NOT NULL DEFAULT 5,
  moderation_action TEXT NOT NULL DEFAULT 'allow' CHECK (moderation_action IN ('allow', 'flag', 'reject', 'escalate')),
  processed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sara_events_session ON sara_events (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sara_events_kind ON sara_events (kind);

CREATE TABLE IF NOT EXISTS sara_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sara_live_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('viewer', 'sara', 'operator', 'system')),
  viewer_id TEXT REFERENCES sara_viewers(id) ON DELETE SET NULL,
  username TEXT,
  text TEXT NOT NULL,
  language TEXT,
  emotion TEXT,
  engine_json TEXT,
  in_reply_to TEXT REFERENCES sara_messages(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sara_messages_session ON sara_messages (session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sara_moderation (
  id TEXT PRIMARY KEY,
  event_id TEXT REFERENCES sara_events(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('allow', 'flag', 'reject', 'escalate')),
  matched_rules_json TEXT,
  score REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sara_moderation_created ON sara_moderation (created_at DESC);

CREATE TABLE IF NOT EXISTS sara_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sara_audit_at ON sara_audit (at DESC);

CREATE TABLE IF NOT EXISTS sara_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sara_provider_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  latency_ms INTEGER,
  ok INTEGER NOT NULL DEFAULT 1,
  usage_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sara_usage_provider ON sara_provider_usage (provider, at DESC);
