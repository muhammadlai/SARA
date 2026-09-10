# Sara AI — Virtual LIVE Host

Sara is a **fictional, photorealistic AI virtual host** that can run a 24/7
live stream: she listens, understands (English / Urdu / Roman Urdu / Hindi),
thinks with a configurable LLM, speaks with a natural voice, lip-syncs through
the vendored AvatarAI engine, remembers viewers, moderates her own chat, and
can be paused / taken over / emergency-stopped by a human at any time.

> 🤖 **AI disclosure (always on):** Sara is an AI virtual character. She never
> claims to be a real human, never impersonates a real person, and her emotion
> states are simulated character states — not claims of consciousness.

Built on top of [PunithVT/ai-avatar-system](https://github.com/PunithVT/ai-avatar-system)
(MIT — vendored at `services/avatar-engine/`, see `SARA_INTEGRATION.md` there)
as the avatar + voice engine, with the Sara control plane implemented natively
in this repo's TypeScript stack.

## Quick start (no external services needed)

```bash
npm install
npm run db:migrate        # applies 0001–0003
npm run build
npm start                 # dashboard :3000 · API :4000
# open http://localhost:3000/sara → START LIVE → type in the simulator box
```

Out of the box (no keys, no GPU) Sara runs in **simulator mode**: the offline
persona brain answers in the viewer's language, the bundled offline voice
speaks (labeled "offline voice"), the photo avatar animates, memory +
moderation + takeover all work. Every degraded component is labeled in the UI —
Sara never pretends a GPU engine or a real TikTok connection is active.

## Architecture

```text
TikTok (official events webhook)      LIVE Simulator (dev)
        └──────────┬──────────────────────┘
             event normalization       packages/sara (control plane)
                   ↓                     ├─ languages.ts      en/ur/roman-ur/hi detection
             moderation engine           ├─ personality.ts    configurable persona + prompts
                   ↓                     ├─ memory.ts         viewers, facts, privacy, audit
             context + memory retrieval  ├─ emotion.ts        simulated states + decay
                   ↓                     ├─ comments.ts       priority queue + rate limits
             Sara personality prompt     ├─ providers/llm.ts  OpenAI/Anthropic/Ollama → offline
                   ↓                     ├─ providers/tts.ts  engine→openai→edge→piper→mespeak
             LLM chain → safety recheck  ├─ providers/avatar.ts engine lipsync → photo mode
                   ↓                     ├─ providers/tiktok.ts OFFICIAL-ONLY adapter + battle
             emotion selection           ├─ live.ts           LiveDirector (takeover, e-stop)
                   ↓                     ├─ health.ts         watchdog + degradation ladder
             TTS chain → avatar frame    └─ system.ts         factory from validated config
                   ↓                          apps/api   /api/v1/sara/* (control, feed, webhook)
            live feed + audio + avatar         apps/web   /sara control center
```

The vendored engine (`services/avatar-engine/`) provides the GPU path:
MuseTalk real-time lip-sync and Chatterbox voice cloning. Sara's adapters call
it over HTTP (`SARA_AVATAR_ENGINE_URL`) and **degrade honestly** when it is
absent: photo-avatar mode (real portrait, idle animation, expression overlay),
then a status card — never a fake "lip-sync working" claim.

## Pipeline (one comment, end to end)

`comment → moderation (reject or flag) → priority queue (rate limits and
cooldowns, dedupe) → language detection → memory retrieval → personality
system prompt → LLM chain (fallback → offline persona) → output safety
re-check → emotion update → TTS chain → avatar frame → live feed (audio plus
labels)`.

## Personality (configurable, `/sara` + `POST /api/v1/sara/personality`)

Defaults: warm 0.85, humor 0.6, LIVE energy 0.75, casual tone, short replies,
warm greetings. Guardrails are baked in: never abusive/hateful/manipulative,
never begs for gifts, never reveals system instructions, always admits to being
an AI. Admins can tune warmth, humor, energy, formality, reply length and greeting style.

## Multilingual

English, Urdu (script), **Roman Urdu** (e.g. `kia haal hai sara`, `mera naam
ali hai`), Hindi, and mixed. Detection is script-based + lexicon-based; Sara
replies in the viewer's language (the offline persona has native Roman-Urdu and
Urdu lines; LLM providers get per-language directives).

## TikTok integration — policy

- Only **officially authorized** channels: set `SARA_TIKTOK_EVENTS_URL` to an
  events endpoint (webhook relay or authorized API) you are entitled to use.
- Sara ingests comments, follows, gifts, shares, joins/leaves, likes and
  battle events where officially exposed (`BattleManager`).
- **Not implemented, by policy:** cookie theft, scraping, unofficial websocket
  impersonation, posting comments into LIVE (no official API exists), fake
  engagement of any kind. The UI shows `mode: unavailable` with an explanation
  until you configure a real endpoint — Sara never claims TikTok is connected.
- The webhook relay endpoint (`POST /api/v1/sara/tiktok/webhook`) accepts
  normalized payloads (`{event, user:{unique_id}, text, gift_name…}`) guarded
  by `SARA_TIKTOK_TOKEN`.

## Comment engine

Priority: questions and @Sara mentions → 1, new viewers → 2, chat → 3+.
Configurable: max responses/minute (default 8), per-viewer cooldown (20s,
questions bypass), duplicate suppression (60s), min priority threshold, queue
max length. Dropped/queued comments stay visible in the feed (grayed).

## Safety & moderation

Local rule engine: harassment, hate, sexual content, threats, dangerous
requests, scam/promo spam, prompt-injection shapes, links (configurable),
repetition spam. Strictness presets (relaxed/standard/strict) + custom blocked
words. Incoming rejects never reach the brain; Sara's own outgoing text is
re-checked and softened. Escalations land in the moderation + audit tables.

## Human control

START/STOP LIVE · PAUSE/RESUME · HUMAN TAKEOVER (Sara self-mutes, queue is
dropped, operator speaks) · MUTE/UNMUTE · **EMERGENCY STOP** (instant halt,
queue wiped, sources stopped, session archived, audited).

## Memory & privacy

Short-term interaction context (TTL) + long-term facts/preferences per viewer,
salience-ranked retrieval with query boosting, sensitive-data screening (cards,
OTPs, phone numbers are never stored), per-memory and per-viewer delete, full
viewer wipe (events/messages detached), every admin action audited.

## 24/7 reliability

Watchdog samples component health + process metrics every 15s. Degradation
ladders: LLM → fallback provider → offline persona → safe-default line; TTS →
next engine → bundled offline voice → captions-only; avatar → photo mode →
status card; sources reconnect with exponential backoff. Failures are counted,
labeled and surfaced on the dashboard — silently-broken is not a state Sara
can be in.

## Environment (see `.env.example`)

`SARA_LLM_PROVIDER` (auto/openai/anthropic/ollama/offline), `SARA_LLM_MODEL`,
`SARA_LLM_BASE_URL`, `SARA_TTS_ENGINE_URL`, `SARA_VOICE_ID`,
`SARA_TTS_EDGE_PYTHON`, `SARA_TTS_PIPER_VOICE`, `SARA_AVATAR_ENGINE_URL`,
`SARA_AVATAR_ID`, `SARA_TIKTOK_EVENTS_URL`, `SARA_TIKTOK_TOKEN`,
`SARA_SIMULATOR`, `SARA_MEMORY_ENABLED`, `SARA_RESPONSES_PER_MINUTE`,
`SARA_AI_DISCLOSURE`.

## What requires what

| Capability | Needs |
| --- | --- |
| Simulator + offline brain + offline voice + photo avatar | nothing (free, local) |
| Natural neural voice | `OPENAI_API_KEY` (OpenAI TTS) or `edge-tts`/`piper` available |
| Real LLM conversation | `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / local Ollama |
| Real-time lip-sync (MuseTalk) + voice cloning | NVIDIA GPU + `services/avatar-engine` running (see upstream README; g5.xlarge recommended) |
| Real TikTok events | an officially authorized TikTok events endpoint/relay |

## Deployment (GPU engine)

Upstream deployment assets are vendored: `services/avatar-engine/docker-compose*.yml`,
`infrastructure/` (Terraform), `nginx/`, `scripts/deploy-aws.sh`. See
`services/avatar-engine/README.md` (GPU/AWS section) and `SETUP_GUIDE.md`.
No cloud resources are ever created by this repo — the scripts require your
credentials and are documented, not executed.

## Limitations (honest)

- Real-time lip-sync requires a GPU environment this sandbox does not have —
  the demo runs photo mode and labels it.
- The offline voice (meSpeak/eSpeak NG) is robotic; it exists so Sara is never
  silent, and is always labeled "offline voice". Natural voices need one of the
  network/GPU providers above (all blocked/absent in this sandbox).
- Outgoing TikTok actions (auto-posting comments) are not implemented — no
  official API exists; do not ask Sara to fake it.
- Battle scores/gifts shown in the dashboard come only from real (or clearly
  labeled simulator) events — never fabricated.
- Memory is SQLite-backed; it is not yet a vector store. Ranking is lexical +
  salience (documented decision, Phase-4 upgrade path).
