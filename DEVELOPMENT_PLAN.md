# Sara — Development Plan

Sara is built **incrementally**: small, separable phases; each phase keeps the project
runnable, ships a working demo, passes checks, and is committed and pushed before the next
one begins. No phase starts until the previous one is verified.

## Workflow for every phase

1. **Inspect** the current repository before changing anything.
2. **Explain** what exists, what the phase adds, which files change, which dependencies are needed.
3. **Implement** the phase.
4. **Run checks** — lint, typecheck, tests (`npm run verify` grows to cover all of these).
5. **Run the demo** and verify it actually works.
6. **Fix** any failure at its root cause, then rerun checks and demo.
7. **Update documentation** in the same commit.
8. **Document manual test steps** for the phase.
9. **Commit** with a clear, conventional message.
10. **Push** to GitHub. Never claim a push happened unless it succeeded.

## Definition of done (every phase)

- [ ] All checks pass (lint, typecheck, tests) — failures are never silently skipped
- [ ] Demo verified by actually running it; manual test steps written down
- [ ] Docs updated (README status, plan checkboxes, ARCHITECTURE if needed)
- [ ] No secrets in the diff; `.env.example` updated if new env vars are introduced
- [ ] Existing functionality still works (no regressions)
- [ ] Committed with a meaningful message and pushed

## Phase overview

| Phase | Title | Status |
| --- | --- | --- |
| 0 | Project foundation (docs, conventions, verification harness) | ✅ Done |
| 1 | Monorepo scaffold: web app shell + API service + CI | ✅ Done |
| 2 | Database, settings, auth skeleton, audit log schema | ⬜ Next |
| 3 | Chat with Sara — LLM orchestrator v1 + conversation memory | ⬜ Planned |
| 4 | Memory system (preferences, long-term facts, inspection/deletion) | ⬜ Planned |
| 5 | Personality + emotion engine | ⬜ Planned |
| 6 | Task manager, scheduler, notifications, background workers | ⬜ Planned |
| 7 | Voice input and voice output | ⬜ Planned |
| 8 | Virtual avatar (expressions, blink, idle/talk, lip sync) | ⬜ Planned |
| 9 | Tool/plugin system + permission scopes + approval workflow | ⬜ Planned |
| 10 | Content creation studio | ⬜ Planned |
| 11 | Social media integration layer (provider adapters, official APIs) | ⬜ Planned |
| 12 | Analytics, hardening, deployment, release process | ⬜ Planned |

Phases may be split further if they grow too large; splitting is fine, skipping definition-of-done is not.

---

## Phase 0 — Project foundation ✅

**Goal:** establish repo hygiene, documentation and the verification harness so every later
phase has a stable base and a growth path for checks.

**Deliverables:** README, ARCHITECTURE.md, DEVELOPMENT_PLAN.md, `.env.example`, `.gitignore`,
coding conventions, testing strategy, security principles, `scripts/verify.mjs` +
`npm run verify` / `npm run lint:md`.

**Acceptance criteria:** `npm run verify` and `npm run lint:md` pass; docs accurately describe
the target architecture; no application code yet; no secrets anywhere.

**Demo:** `npm run verify` prints a green checklist of structural, hygiene, secret-scan and
link checks.

---

## Phase 1 — Monorepo scaffold ✅

**Goal:** create the real application skeleton: web dashboard shell, API service, shared
packages, CI pipeline.

**Delivered:** npm workspaces with 7 workspaces — `apps/web` (Next.js 15 + Tailwind 4:
responsive shell, sidebar + top bar, 11 module routes with phase-labeled placeholders,
Sara overview card, live System Status card, loading/error/empty states), `apps/api`
(Fastify 5: `/api/v1` versioning, health + auth-foundation routes, centralized error
envelope, pino logging with request IDs, helmet/CORS/rate-limit, graceful shutdown),
`packages/types` (shared envelope/types), `packages/config` (zod env validation +
root-.env loading), `packages/logger`, `packages/db` (node:sqlite foundation + SQL
migrations — ADR 0003), `packages/ui`; ESLint 9 flat + Prettier; Vitest (node + jsdom)
with 70 tests; GitHub Actions CI; ADRs 0001–0003.

**Deviations from plan (documented in ADRs):** Prisma was replaced by a `node:sqlite`
foundation for Phase 1 (engine CDN unreachable in the dev environment — ADR 0003); the
auth foundation and DB layer were pulled forward from Phase 2 as minimal slices per the
Phase 1 brief.

**Acceptance:** `npm run build` + `npm start` serve the dashboard and API; health endpoint
reachable directly and through the dashboard proxy; all checks green. ✅ Verified.

**Demo (verified):** dashboard at `http://localhost:3000` with live API status; `GET
/api/v1/health` direct and via `http://localhost:3000/api/v1/health`; login → session →
`/auth/me` → logout; 404 + rate-limit envelopes; graceful shutdown on SIGTERM.

## Phase 2 — Database, settings, auth skeleton, audit log

**Planned:** Prisma + SQLite dev DB; core schema (settings, users, conversations placeholder,
audit log, approvals placeholder); session auth for the single operator; settings UI v1
(persona name/placeholder fields); audit log viewer (empty but working).

**Acceptance:** migrations run; login works; audit entries written for login/settings changes.

**Demo:** log in, change a setting, see the audit entry appear.

## Phase 3 — Chat with Sara (orchestrator v1)

**Planned:** `packages/core` orchestrator loop; pluggable `LLMProvider` (OpenAI /
Anthropic / OpenAI-compatible via env); streaming chat UI; conversation persistence;
short-term conversation memory; basic system prompt; agent runs recorded in audit log.
No tools yet — that is Phase 9.

**Acceptance:** streamed chat round-trips end-to-end with a real or local LLM;
conversation survives reload; provider switchable via env only.

**Demo:** chat with Sara in the dashboard, reload, continue the conversation.

## Phase 4 — Memory system

**Planned:** `packages/memory`; user preferences, long-term facts (write/read/delete),
memory inspection UI, deletion controls; orchestrator injects relevant memory into prompts.

**Acceptance:** Sara can store/recall/delete facts; UI lists and removes memory entries.

**Demo:** tell Sara a preference, start a new conversation, verify it remembers; delete it, verify it forgets.

## Phase 5 — Personality + emotion engine

**Planned:** `packages/persona`; configurable persona (tone, style, boundaries) rendered
into prompts; simulated emotional state vector with decay; emotion shown in UI (and later
drives avatar); explicit "simulated states" framing.

**Acceptance:** persona editable in Settings and visibly changes replies; emotional state
updates from conversation and decays.

**Demo:** switch persona tone, chat, watch the emotion indicator change.

## Phase 6 — Tasks, scheduler, notifications, workers

**Planned:** `packages/tasks` + `apps/worker`; personal task CRUD with due dates;
scheduler for reminders/digests; notification feed in dashboard; job queue with retry policy.

**Acceptance:** create a task with a reminder; worker fires the notification on time.

**Demo:** create a 2-minute reminder task and receive the notification.

## Phase 7 — Voice input and output

**Planned:** `packages/voice`; browser speech capture → STT provider; TTS provider for
Sara's replies; push-to-talk UI; voice settings (voice selection, speed).

**Acceptance:** speak a message, get a spoken reply end-to-end.

**Demo:** hold to talk, release, hear Sara answer.

## Phase 8 — Virtual avatar

**Planned:** `packages/avatar` contracts + web avatar (2D/3D web technology decided via ADR);
face with eyes/mouth, blinking, idle and talking animations, expressions driven by the
emotion engine, lip sync driven by speech/audio state. Original character only — never a
real person's identity.

**Acceptance:** avatar blinks, idles, visibly reflects emotional state, lip-syncs during speech.

**Demo:** chat with Sara while watching the avatar react and speak.

## Phase 9 — Tools, permissions, approvals

**Planned:** `packages/tools` registry (tool manifest: name, schema, required scope,
action class); permission scope management UI; approval workflow (request → preview →
approve/reject → audit); first built-in tools (research/web fetch via official APIs where
applicable, calculator, notes); orchestrator executes tools only within granted scopes.

**Acceptance:** a tool that requires approval cannot run without it, and every attempt is audited.

**Demo:** ask Sara to use an approval-gated tool; approve it in the dashboard; watch it run and get audited.

## Phase 10 — Content creation studio

**Planned:** `packages/content`; drafts (title, body, captions, hashtags), platform-aware
templates, preview per platform, revision history; image/video hooks behind providers.

**Acceptance:** create, edit and preview a multi-platform post draft end-to-end.

**Demo:** draft a YouTube post in Content Studio, preview it, save revisions.

## Phase 11 — Social media integration layer

**Planned:** `packages/social` with `SocialProvider` interface; `YouTubeProvider` first
(official Data API), then Facebook / Instagram / TikTok strictly as official API access
permits (each may require developer app review); OAuth token storage guidance; scheduling
and publishing pipeline through the approval workflow; metrics ingestion where available.

**Acceptance:** an approved post publishes via the official API to a test destination and
is recorded with its approval reference.

**Demo:** schedule a post, approve it, see it published and audited (on a test account).

## Phase 12 — Analytics, hardening, deployment

**Planned:** usage analytics dashboard; rate-limit tuning; security review pass; Docker
deployment setup; backup/restore notes; tagged releases.

**Acceptance:** deployable artifact; docs for operating Sara on a personal server.

**Demo:** deploy locally via Docker and use Sara end-to-end.

---

## Known external constraints (recorded early)

- Instagram/Facebook Graph API and TikTok require developer app review before publishing
  to real accounts; YouTube Data API has quotas. Phases 11 will use sandbox/test
  destinations and official APIs only, with graceful "capability unavailable" states.
- Voice quality and avatar realism depend on provider choices made in Phases 7–8 (ADR required).
