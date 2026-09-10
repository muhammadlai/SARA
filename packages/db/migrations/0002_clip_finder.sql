-- 0002_clip_finder.sql — AI Drama Clip Finder (feature phase)
-- Video sources, analysis jobs, transcripts, scenes, ranked clips,
-- renders and subtitle tracks. Times are REAL seconds.

CREATE TABLE IF NOT EXISTS video_sources (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('url', 'upload')),
  url              TEXT,
  file_path        TEXT,
  original_name    TEXT,
  size_bytes       INTEGER,
  status           TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('pending', 'ready', 'failed')),
  duration_seconds REAL,
  width            INTEGER,
  height           INTEGER,
  fps              REAL,
  container        TEXT,
  video_codec      TEXT,
  audio_codec      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS clip_finder_jobs (
  id           TEXT PRIMARY KEY,
  source_id    TEXT NOT NULL REFERENCES video_sources (id),
  status       TEXT NOT NULL DEFAULT 'queued'
               CHECK (status IN ('queued', 'processing', 'transcribing', 'analyzing', 'rendering', 'completed', 'failed', 'cancelled')),
  progress     INTEGER NOT NULL DEFAULT 0,
  stage        TEXT NOT NULL DEFAULT 'Preparing',
  options_json TEXT NOT NULL DEFAULT '{}',
  mock         INTEGER NOT NULL DEFAULT 0,
  error        TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_clip_jobs_status ON clip_finder_jobs (status);
CREATE INDEX IF NOT EXISTS idx_clip_jobs_source ON clip_finder_jobs (source_id);

CREATE TABLE IF NOT EXISTS transcripts (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES clip_finder_jobs (id),
  language      TEXT,
  provider      TEXT NOT NULL,
  text          TEXT NOT NULL,
  segments_json TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_transcripts_job ON transcripts (job_id);

CREATE TABLE IF NOT EXISTS scenes (
  id              TEXT PRIMARY KEY,
  job_id          TEXT NOT NULL REFERENCES clip_finder_jobs (id),
  scene_index     INTEGER NOT NULL,
  start_time      REAL NOT NULL,
  end_time        REAL NOT NULL,
  duration        REAL NOT NULL,
  transcript_text TEXT NOT NULL DEFAULT '',
  thumbnail_path  TEXT,
  visual_json     TEXT NOT NULL DEFAULT '{}',
  analysis_json   TEXT,
  overall_score   REAL,
  categories_json TEXT NOT NULL DEFAULT '[]',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_scenes_job ON scenes (job_id);

CREATE TABLE IF NOT EXISTS clip_candidates (
  id                 TEXT PRIMARY KEY,
  job_id             TEXT NOT NULL REFERENCES clip_finder_jobs (id),
  scene_id           TEXT REFERENCES scenes (id),
  rank               INTEGER NOT NULL,
  category           TEXT NOT NULL,
  start_time         REAL NOT NULL,
  end_time           REAL NOT NULL,
  duration           REAL NOT NULL,
  score              REAL NOT NULL,
  reason             TEXT NOT NULL DEFAULT '',
  transcript_preview TEXT NOT NULL DEFAULT '',
  thumbnail_path     TEXT,
  selected           INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_clips_job ON clip_candidates (job_id);

CREATE TABLE IF NOT EXISTS clip_renders (
  id                    TEXT PRIMARY KEY,
  clip_id               TEXT NOT NULL REFERENCES clip_candidates (id),
  status                TEXT NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued', 'processing', 'rendering', 'completed', 'failed', 'cancelled')),
  progress              INTEGER NOT NULL DEFAULT 0,
  aspect_ratio          TEXT NOT NULL DEFAULT '9:16',
  width                 INTEGER,
  height                INTEGER,
  subtitle_style        TEXT NOT NULL DEFAULT 'modern',
  subtitle_options_json TEXT NOT NULL DEFAULT '{}',
  framing               TEXT NOT NULL DEFAULT 'blur-pad',
  output_path           TEXT,
  srt_path              TEXT,
  json_path             TEXT,
  size_bytes            INTEGER,
  error                 TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  finished_at           TEXT
);

CREATE INDEX IF NOT EXISTS idx_renders_clip ON clip_renders (clip_id);

CREATE TABLE IF NOT EXISTS subtitle_tracks (
  id         TEXT PRIMARY KEY,
  clip_id    TEXT NOT NULL REFERENCES clip_candidates (id),
  language   TEXT NOT NULL DEFAULT 'auto',
  format     TEXT NOT NULL DEFAULT 'srt' CHECK (format IN ('srt', 'vtt')),
  style      TEXT NOT NULL DEFAULT 'modern',
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_subtitles_clip ON subtitle_tracks (clip_id);
