# Sara — AI Drama Clip Finder

Find the most engaging moments of a drama video automatically: dialogue is
transcribed, scenes are detected, every scene is scored across 14 dramatic
dimensions, the best moments are ranked into candidate clips, and selected
clips are rendered as vertical shorts with burned-in subtitles — ready for
MP4 + SRT + JSON export.

> **Copyright notice (shown in the UI too):** Make sure you have the necessary
> rights or permission to use the source video. AI editing does not make
> copyrighted material copyright-free.

This feature is **not** a copyright-bypass system. It deliberately does not
implement Content-ID evasion, watermark removal, detection-evasion tricks
(pitch/speed/mirroring/cropping for evasion), or metadata manipulation. It
analyzes and edits only videos the user is permitted to use. Public URLs must
be direct links — the tool never bypasses logins, DRM, paywalls or access
restrictions, and private/loopback addresses are rejected (SSRF guard).

## Architecture

```text
packages/clipfinder            domain core (no HTTP, fully unit-tested)
├── types.ts                   domain types, 14 dimensions, provider contracts
├── schema.ts                  zod schemas (job options, search, render, patch)
├── scoring.ts                 documented weighted scoring algorithm
├── categories.ts              12 categories with dimension profiles
├── nl-search.ts               "find the funniest scenes under 30s" → criteria
├── boundaries.ts              transcript-aware clip boundary snapping
├── dedupe.ts                  overlap removal (IoU)
├── ranking.ts                 scenes → deduped ranked clips
├── subtitles.ts               Unicode SRT generation + ASS style presets
├── ssrf.ts                    URL safety for public sources
├── storage.ts                 workspace layout + retention sweeping
├── pipeline.ts                analysis stages with real progress + cancel
├── render.ts                  cut → aspect → subtitles → MP4/SRT/JSON
├── jobs.ts                    JobManager (CRUD, search, guards)
├── worker.ts                  DB-backed queue, concurrency, boot recovery
├── agent-tool.ts              video_clip_finder manifest + scope enforcement
└── providers/
    ├── ffmpeg.ts              probe/audio/scenes/thumbs/cut/vertical/burn
    ├── whisper.ts             OpenAI-compatible Whisper STT
    ├── llm.ts                 OpenAI-compatible scene analyzer + title writer
    ├── mock.ts                deterministic DEMO/MOCK providers
    └── resolve.ts             real vs mock selection from validated config

apps/api    → /api/v1/clip-finder/* routes (+ in-process worker)
apps/web    → /clip-finder UI (input → progress → results → editor → export)
packages/db → migration 0002_clip_finder.sql (7 tables)
```

The pipeline never runs inside an HTTP request: the API only creates job rows;
the background worker claims queued work (concurrency-limited), reports
progress into the database, and the UI polls. Cancellation is cooperative —
the API flips the DB status and the pipeline checks between stages.

## Processing pipeline (real progress, not simulated)

| Progress | Stage                                                  |
| -------- | ------------------------------------------------------ |
| 0%       | Preparing                                              |
| 10%      | Reading video (probe metadata)                         |
| 20%      | Extracting audio                                       |
| 35%      | Transcribing                                           |
| 50%      | Detecting scenes (ffmpeg scene-change filter)          |
| 65%      | Understanding scenes (per-scene analysis + thumbnails) |
| 75%      | Ranking clips (scoring, boundaries, dedupe)            |
| 85%      | Generating subtitles                                   |
| 95%      | Rendering previews (per-clip thumbnails)               |
| 100%     | Complete                                               |

## Scoring algorithm (documented)

A `SceneUnderstandingProvider` scores each of the **14 dimensions** 0–100:
`dialogue, emotional, storyImportance, humor, suspense, conflict, surprise,
romance, sadness, inspirational, visualActivity, dialogueCompleteness, hook,
contextCompleteness`.

- **Overall score** = normalized weighted sum with the weights in
  `scoring.ts` (emotional 0.12, story 0.12, dialogue 0.10, visualActivity 0.08,
  suspense 0.08, conflict 0.08, dialogueCompleteness 0.07, hook 0.06, humor
  0.06, surprise 0.06, romance 0.05, sadness 0.04, inspirational 0.04,
  contextCompleteness 0.04 — they sum to exactly 1.0). No single dimension
  can dominate.
- **Category scores** reuse the same mechanism with per-category profiles
  (`funny` weights humor 0.7, etc.), so "find the funniest scenes" genuinely
  prioritizes humor.
- **Rank adjustments:** +2 duration-fit bonus for clips inside the requested
  window (down to −4 for drift); overlaps (IoU > 0.30) are dropped in favor of
  the higher-ranked clip.
- **Clip boundaries** snap to transcript gaps and sentence conclusions with
  configurable padding, never arbitrary fixed chunks.

## Categories

Emotional · Funny · Romantic · Sad · Shocking · Suspense · Argument ·
Inspirational · Important Story Moment · Best Dialogue · Best Hook ·
General Highlight.

Natural-language requests are parsed by a deterministic rule engine
(`nl-search.ts`): "top 10", "between 20 and 45 seconds", "YouTube Shorts",
"funniest", "where the characters argue", and so on.

## Supported input

- **Local upload** via the dashboard (MP4, MKV, MOV, WebM, AVI, TS… — anything
  ffmpeg reads), size-limited by `CLIP_FINDER_MAX_UPLOAD_MB`.
- **Public direct video URL** (http/https, must look like a video, redirect
  targets are re-validated, size-capped). Login/DRM/paywalled sources are
  expected to fail with a clear message — no bypass is attempted.

## Languages

Transcription follows the selected STT model. The built-in Whisper provider
(`whisper-1` default) supports **Urdu, Hindi and English** among many others,
and subtitles are generated with full Unicode (RTL included). The UI language
field accepts any BCP-47 hint or `auto`. Scene _analysis_ quality depends on
the configured LLM; prompts are language-agnostic.

## Vertical shorts & subtitles

- Aspect ratios: **9:16** (default), **16:9**, **1:1** — 1080p or 720p.
- Framing: **blur-pad** (whole frame visible over a blurred background — nobody
  gets cut off) or **center-crop**. Face-aware framing is _not_ implemented
  (see Limitations); blur-pad is the safe default precisely because it never
  crops people out.
- Subtitle styles: Classic, Modern, Minimal, Large, Shorts — with font size,
  position, background and capitalization options; burned in via libass.
- Optional **commentary overlay**: your own words rendered as clearly-labeled
  `[Commentary]` subtitles, always distinct from the original audio. Adding
  commentary does **not** make copyrighted content legally safe.

## API (all responses use the standard envelope)

```text
GET    /api/v1/clip-finder/notice                      copyright notice
GET    /api/v1/clip-finder/tool                        agent tool manifest
POST   /api/v1/clip-finder/agent                       utterance → intent/job
POST   /api/v1/clip-finder/jobs                        create (JSON url | multipart upload)
GET    /api/v1/clip-finder/jobs                        list
GET    /api/v1/clip-finder/jobs/:id                    status + progress
GET    /api/v1/clip-finder/jobs/:id/clips?sort=…       ranked clips
POST   /api/v1/clip-finder/jobs/:id/search             NL search over clips
POST   /api/v1/clip-finder/jobs/:id/cancel             cancel
POST   /api/v1/clip-finder/jobs/:id/retry              retry failed/cancelled
DELETE /api/v1/clip-finder/jobs/:id                    delete job + artifacts
GET    /api/v1/clip-finder/clips/:id                   clip detail
PATCH  /api/v1/clip-finder/clips/:id                   adjust start/end
POST   /api/v1/clip-finder/clips/:id/select            select/deselect
DELETE /api/v1/clip-finder/clips/:id                   delete clip (+renders)
POST   /api/v1/clip-finder/clips/:id/subtitles         regenerate SRT
GET    /api/v1/clip-finder/clips/:id/subtitles         download SRT
GET    /api/v1/clip-finder/clips/:id/thumbnail         JPEG (or labeled SVG)
POST   /api/v1/clip-finder/clips/:id/render            queue a render
POST   /api/v1/clip-finder/clips/:id/titles            titles/descriptions/hashtags
GET    /api/v1/clip-finder/renders/:id                 render status
POST   /api/v1/clip-finder/renders/:id/cancel          cancel render
GET    /api/v1/clip-finder/renders/:id/file            MP4 (Range-capable)
GET    /api/v1/clip-finder/renders/:id/srt             SRT download
GET    /api/v1/clip-finder/renders/:id/metadata        JSON metadata
```

When operator auth is configured (`OPERATOR_PASSWORD`), all endpoints require a
valid session; with auth unconfigured (local development) reads and mutations
are open — configure a password to lock Sara down.

## Agent integration

`video_clip_finder` is registered with the permission scopes
`READ_VIDEO` (`video.read`), `ANALYZE_VIDEO` (`video.analyze`) and — for
renders/exports — `CREATE_DERIVATIVE` (`video.derivative.create`). Scope
checks are enforced in `agent-tool.ts` and tested. **Publishing to social
platforms is explicitly not part of this tool**; it arrives separately behind
the approval workflow.

## Environment variables

| Variable                                               | Default                   | Purpose                                                                        |
| ------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------ |
| `MOCK_CLIP_FINDER`                                     | auto                      | Force mock AI providers (labeled DEMO/MOCK). Auto-on when no `OPENAI_API_KEY`. |
| `OPENAI_API_KEY`                                       | —                         | Enables Whisper STT + LLM analysis/titles (official or compatible endpoint).   |
| `OPENAI_BASE_URL`                                      | api.openai.com/v1         | OpenAI-compatible endpoint override (e.g. self-hosted).                        |
| `WHISPER_MODEL`                                        | `whisper-1`               | Transcription model.                                                           |
| `LLM_MODEL`                                            | `gpt-4o-mini`             | Analysis/titles model.                                                         |
| `CLIP_FINDER_CONCURRENCY`                              | `1`                       | Parallel jobs (1–4).                                                           |
| `CLIP_FINDER_MAX_UPLOAD_MB`                            | `512`                     | Upload size cap.                                                               |
| `CLIP_FINDER_MAX_URL_SIZE_MB`                          | `1024`                    | URL download cap.                                                              |
| `CLIP_FINDER_MAX_DURATION_MIN`                         | `120`                     | Max source duration.                                                           |
| `CLIP_FINDER_SCENE_THRESHOLD`                          | `0.3`                     | Scene-change sensitivity.                                                      |
| `CLIP_FINDER_RETENTION_HOURS`                          | `24`                      | Auto-cleanup age for temp artifacts and renders.                               |
| `CLIP_FINDER_DATA_DIR`                                 | `<repo>/data/clip-finder` | Storage root.                                                                  |
| `CLIP_FINDER_FFMPEG_PATH` / `CLIP_FINDER_FFPROBE_PATH` | npm-bundled               | Explicit binary paths.                                                         |

## Storage & retention

The storage root defaults to `data/clip-finder` next to the API process (`apps/api/data/clip-finder` under `npm start`; set `CLIP_FINDER_DATA_DIR` to pin it). `<dataDir>/sources/` holds uploaded/downloaded originals (removed only by
explicit job deletion — never automatically). `jobs/<id>/` holds temp
artifacts (audio, thumbnails); `renders/` holds finished MP4/SRT/JSON. A
retention sweep runs at boot and every 6 hours, deleting temp artifacts and
renders older than `CLIP_FINDER_RETENTION_HOURS`.

## Local setup & testing

```bash
npm install
cp .env.example .env          # set OPERATOR_PASSWORD to protect mutations
npm run build
npm run db:migrate            # applies 0001 + 0002
npm start                     # dashboard :3000 · API :4000
npm test                      # 146 tests incl. full pipeline integration
```

## Limitations (honest list)

- **Face-aware framing** is not implemented; blur-pad framing is the default
  because it never cuts people out. Center-crop is naive (center of frame).
- **Mock mode** produces synthetic transcripts/analyses (clearly labeled
  DEMO/MOCK in API responses and UI). Media operations remain real.
- Scene detection is content-agnostic (pixel-change based); slow dissolves may
  merge scenes, in which case even segmentation applies (flagged as fallback).
- 1080×1920 renders of long clips take real CPU time; 720p is available for
  weaker machines.
- No Whisper/LLM credentials → no real transcription/analysis (mock labels
  make this impossible to confuse with real output).
- No end-to-end Playwright test yet (Phase 8+); coverage is via API
  integration tests over the real worker/pipeline.

## Troubleshooting

| Symptom                                       | Fix                                                                                                         |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| "ffmpeg binary not found"                     | Set `CLIP_FINDER_FFMPEG_PATH`/`CLIP_FINDER_FFPROBE_PATH`, or reinstall so `@ffmpeg-installer/*` is present. |
| Job fails at "Reading video" with codec error | Source codec unsupported by the bundled ffmpeg — remux/transcode first.                                     |
| "not publicly accessible" on a URL            | The source requires auth/DRM — download it yourself (with permission) and upload instead.                   |
| Login returns 503                             | `OPERATOR_PASSWORD` unset — auth is disabled; set it in `.env`.                                             |
| Renders slow                                  | Use 720p quality, or reduce clip length.                                                                    |
| Mock badges everywhere                        | Expected without `OPENAI_API_KEY` (or with `MOCK_CLIP_FINDER=true`).                                        |
