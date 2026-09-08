# Sara — Architecture

This document describes the **target architecture** of Sara and the decisions that keep the
system modular as it grows. It is a living document: every phase that introduces or changes
an architectural decision must update it in the same commit. Significant or contentious
decisions will additionally get a short ADR (Architecture Decision Record) under
`docs/adr/` starting in Phase 1.

## 1. Design goals

1. **Modular monorepo** — frontend, backend, AI layer, memory, integrations, avatar and
   workers are clearly separated, each with a narrow public interface.
2. **Orchestrator-first** — features are not bolted on; a central agent orchestrator
   receives objectives, plans tool use, checks permissions, executes, records and reports.
3. **Provider abstraction** — no hard coupling to any LLM vendor or social platform.
4. **Safety by default** — least privilege, human approval for important external actions,
   append-only audit log.
5. **Production quality over throwaway prototypes** — typed code, validated config,
   structured logging, tests and docs evolve with the code.
6. **Runnable at every phase** — the repo must demo-verify after each increment.

## 2. High-level overview

```text
┌────────────────────────────────────────────────────────────────────┐
│                          Web Dashboard (apps/web)                  │
│  Dashboard · Chat · Tasks · Memory · Content Studio · Social ·     │
│  Calendar · Avatar · Voice · Activity · Integrations · Settings    │
└──────────────────────────────┬─────────────────────────────────────┘
                               │ HTTP / WebSocket (typed client)
┌──────────────────────────────▼─────────────────────────────────────┐
│                            API service (apps/api)                  │
│        auth · REST + realtime · validation · rate limiting         │
└──────┬───────────────────────┬─────────────────────────┬───────────┘
       │                       │                         │
┌──────▼───────┐    ┌──────────▼──────────┐    ┌─────────▼─────────┐
│ Agent Core   │    │  Domain packages    │    │  Database layer   │
│ (packages/   │    │  memory · persona   │    │  Postgres/SQLite  │
│  core)       │───▶│  tools · social     │───▶│  via Prisma       │
│ orchestrator │    │  content · tasks    │    │  audit log        │
└──────┬───────┘    └──────────┬──────────┘    └───────────────────┘
       │                       │
┌──────▼───────────┐   ┌───────▼─────────────┐
│ LLM providers    │   │ Background workers  │
│ adapter (plugg-  │   │ scheduler · publish │
│ able vendors)    │   │ jobs · notifications│
└──────────────────┘   └─────────────────────┘
```

## 3. Monorepo layout (target)

```text
sara/
├── apps/
│   ├── web/                  # Next.js dashboard + chat + avatar UI (Phase 1+)
│   ├── api/                  # Fastify HTTP API service (Phase 1+)
│   └── worker/               # Background workers / scheduler (Phase 6+)
├── packages/
│   ├── config/               # Central env loading + zod validation (Phase 1+)
│   ├── core/                 # Agent orchestrator, agent loop, shared types (Phase 3+)
│   ├── memory/               # Conversation, facts, preferences, events (Phase 4+)
│   ├── persona/              # Personality config + emotion engine (Phase 5+)
│   ├── tasks/                # Task manager + scheduler (Phase 6+)
│   ├── voice/                # STT/TTS adapters (Phase 7+)
│   ├── avatar/               # Avatar state/animation contracts (Phase 8+)
│   ├── tools/                # Tool/plugin registry + built-in tools (Phase 9+)
│   ├── content/              # Content creation pipeline (Phase 10+)
│   └── social/               # SocialProvider abstraction + adapters (Phase 11+)
├── docs/                     # Conventions, strategies, ADRs
├── scripts/                  # Verification harness, dev utilities
└── db/                       # Prisma schema + migrations (owned by data layer)
```

Dependency rule: `apps/*` may import from `packages/*`; `packages/*` never import from
`apps/*`. Cross-package imports go through each package's public entry point only.
This will be enforced mechanically (ESLint boundaries) from Phase 1.

## 4. Module map

The long-term module list mapped to where it lives and when it lands:

| # | Module | Home | Phase |
| --- | --- | --- | --- |
| 1 | Web Dashboard | `apps/web` | 1+ |
| 2 | Sara Chat | `apps/web` + `packages/core` | 3 |
| 3 | AI/LLM Orchestrator | `packages/core` | 3 |
| 4 | Memory System | `packages/memory` | 4 |
| 5 | Personality System | `packages/persona` | 5 |
| 6 | Emotion System | `packages/persona` | 5 |
| 7 | Voice Input | `packages/voice` | 7 |
| 8 | Voice Output | `packages/voice` | 7 |
| 9 | Virtual Avatar | `apps/web` + `packages/avatar` | 8 |
| 10 | Task Manager | `packages/tasks` | 6 |
| 11 | Tool/Plugin System | `packages/tools` | 9 |
| 12 | Research Tools | `packages/tools` | 9+ |
| 13 | Content Creation | `packages/content` | 10 |
| 14 | Social Integrations | `packages/social` | 11 |
| 15 | Scheduling | `packages/tasks` | 6 |
| 16 | Approval System | `apps/api` + `packages/core` | 9 (schema Phase 2) |
| 17 | Security/Permissions | `apps/api` + `packages/config` | 2+ |
| 18 | Audit Logs | `db` + `apps/api` | 2 (schema), 3 (usage) |
| 19 | Database | `db` (Prisma) | 2 |
| 20 | Background Workers | `apps/worker` | 6 |
| 21 | Notifications | `apps/api` + `apps/web` | 6+ |
| 22 | Analytics | `apps/web` | 12 |
| 23 | Settings | `apps/web` + `db` | 2+ |
| 24 | Testing | all packages | 0 (strategy), 1 (CI) |
| 25 | Deployment | infra config | 12 |

## 5. Agent orchestrator (the heart)

The orchestrator is a loop, not a feature. Everything Sara does — answering chat,
preparing a post, running a task — flows through it:

1. **Receive objective** (from chat, scheduler, worker or API).
2. **Plan** — consult conversation/memory context and decide which tools/steps are needed.
3. **Check permissions** — resolve the required capability scope against configured grants.
4. **Gate on approval** — if the action class requires it, create an approval request and
   pause until the human approves or rejects.
5. **Execute** — call tools/providers through their adapters with validated inputs.
6. **Record** — persist results to memory and append an audit-log entry.
7. **Report** — return a structured result (and a human-readable summary) to the caller.

### Example — "Sara, prepare tomorrow's YouTube post"

```text
objective: prepare_youtube_post(date=tomorrow)
 ├─ understand: content creation + platform=YouTube, publish tomorrow
 ├─ plan: draft title → description → hashtags → (optional) thumbnail
 ├─ permission: content.draft      → allowed (local, no approval)
 ├─ generate: title/description/hashtags via LLM provider → preview object
 ├─ approval: social.publish.youtube → REQUIRED → create approval request
 ├─ (user approves in dashboard) → provider.publish() via YouTubeAdapter
 ├─ record: memory(event) + audit(action=publish, approvalRef, result)
 └─ report: "Published … / awaiting your approval …"
```

Note the split: **preparing** content is a low-risk local action; **publishing** is an
external, effectively irreversible action that always goes through the approval gate.

## 6. Provider abstractions

### LLM provider

The agent never calls a vendor SDK directly. It depends on a narrow adapter:

```ts
interface LLMProvider {
  complete(request: LLMRequest): Promise<LLMResponse>;
  stream(request: LLMRequest): AsyncIterable<LLMChunk>;
}
// Implementations: OpenAIAdapter | AnthropicAdapter | OpenAICompatibleAdapter | OllamaAdapter
```

Selected via `LLM_PROVIDER` env var; credentials only ever read from validated env config.

### Social provider

Platforms are isolated adapters behind one interface, so adding a platform never
touches the rest of the system:

```ts
interface SocialProvider {
  readonly platform: "facebook" | "instagram" | "youtube" | "tiktok";
  capabilities(): ProviderCapabilities;          // publish, schedule, delete, metrics…
  publish(post: PreparedPost): Promise<PublishResult>;
  delete(postRef: PostRef): Promise<void>;
  metrics(range: DateRange): Promise<PlatformMetrics>;
}
// Implementations: FacebookProvider | InstagramProvider | YouTubeProvider | TikTokProvider
```

Constraints: official APIs only; each adapter declares its capabilities and whether each
capability requires human approval; platform quirks (auth flows, quotas, media formats)
stay inside the adapter.

## 7. Memory design

| Store | Content | Retention |
| --- | --- | --- |
| Conversation memory | Current session messages + rolling summary | Session + summary |
| User preferences | Tone, likes/dislikes, UI and workflow settings | Until changed/deleted |
| Long-term facts | Distilled durable facts ("user posts on Tuesdays") | Until inspected/deleted |
| Task history | Completed/failed tasks and their outcomes | Audit horizon |
| Important events | Milestones, approvals, notable agent actions | Append-only |

Requirements: every store is inspectable and deletable from the dashboard; writes to
long-term memory are visible in the activity view; no secret material is ever stored in
memory stores.

## 8. Personality & emotion engine

- **Persona config**: name, tone, formality, verbosity, example phrases, boundaries —
  editable in Settings, rendered into the system prompt.
- **Emotional state**: a simulated state vector, e.g.
  `happiness, sadness, excitement, calm, curiosity, concern, confidence, frustration`,
  each `0..1`. Conversation events nudge the vector; it decays toward a configured
  baseline over time; the avatar and response style map onto it.
- **Disclaimer**: these are simulated agent states and personality behaviors, not claims
  that the AI experiences human feelings. The UI will reflect this framing.

## 9. Security architecture

Full principles live in [docs/SECURITY.md](docs/SECURITY.md). Summary:

- **Auth**: single-operator auth with sessions; integrations use per-platform tokens in env/secrets.
- **Permission scopes**: capability strings such as `social.publish.youtube`,
  `memory.write`, `tools.web.fetch`. Sara runs only with granted scopes.
- **Action classes**: `auto-allowed` (local/read) · `requires-approval` (publish, delete,
  send, irreversible) · `forbidden` (explicit deny list).
- **Approval workflow**: approvals are durable records (who, what, when, diff/preview,
  decision) referenced from the audit log.
- **Audit log**: append-only, covers agent actions, approvals, config and memory changes.
- **Rate limiting**: global + per-provider quotas on the API and on outbound tool calls.
- **Prompt-injection hardening**: tool inputs are validated; tool outputs are untrusted
  data, never instructions; destructive tools always re-confirm.

## 10. Data layer

- ORM: Prisma; PostgreSQL in production, SQLite acceptable for local dev.
- Schema areas: users/settings, conversations, memory stores, tasks, jobs, approvals,
  audit log, social posts, provider accounts/tokens (references only — secrets stay in env).
- Migrations are code-reviewed artifacts; the audit log table is append-only (no update/delete paths).

## 11. Background work

- Phase 6+: scheduler (cron-like triggers), job queue (BullMQ + Redis in production;
  in-process runner acceptable earlier), workers for publishing schedules, reminders,
  digest generation and voice/avatar asset jobs.
- Workers share the same domain packages; no business logic lives in the worker itself.

## 12. Tech stack (decisions so far)

| Concern | Choice | Rationale |
| --- | --- | --- |
| Language | TypeScript (strict) everywhere | One language across UI/API/packages; types as contracts |
| Runtime | Node.js >= 20 | Team stack; first-class LLM and web ecosystem |
| Frontend | Next.js + React + Tailwind CSS | Modern dashboard/dev ergonomics; decided finally in Phase 1 |
| API | Fastify | Schema-first, fast, TS-friendly; decided finally in Phase 1 |
| Validation | zod | One schema language for env, API and tool I/O |
| ORM/DB | Prisma + PostgreSQL (SQLite dev) | Typed data access, migrations (final in Phase 2) |
| Tests | Vitest (+ supertest, Playwright later) | See [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) |
| Lint/format | ESLint + Prettier | Enforced from Phase 1 |
| Queue | BullMQ + Redis (later) | Standard, observable; only when workers land |

Anything not listed here is deliberately undecided until the phase that needs it, to avoid
paying complexity early. Changes to this table go through the same commit that introduces
the dependency, plus an ADR when the choice is significant.
