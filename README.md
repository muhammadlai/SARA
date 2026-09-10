# Sara

> Sara is a personal AI agent and virtual character: a modular, self-hosted assistant that
> can chat naturally (text and voice), remember what matters, express a configurable
> personality and emotions, manage tasks, create content, and — where official APIs permit —
> help run a social-media workflow for Facebook, Instagram, YouTube and TikTok.

**Status: Phase 1 — Application scaffold ✅ · AI Drama Clip Finder ✅** (Phase 0 foundation ✅).
Sara is being built incrementally: see [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the roadmap
and [ARCHITECTURE.md](ARCHITECTURE.md) for the architecture. The dashboard shell, API service,
configuration, logging, auth foundation and database layer are live, plus the first agent feature:
the **AI Drama Clip Finder** at `/clip-finder` ([docs/clip-finder.md](docs/clip-finder.md)).

[![CI](https://github.com/muhammadlai/SARA/actions/workflows/ci.yml/badge.svg)](https://github.com/muhammadlai/SARA/actions/workflows/ci.yml)

## What Sara will become

- **Conversation** — natural chat with streaming responses, voice input and voice output
- **Personality & emotions** — a configurable persona with a simulated emotional state
- **Memory** — conversation memory, user preferences, long-term facts, all inspectable and deletable
- **Tasks & scheduling** — a personal task system, scheduler and reminders
- **Agent orchestration** — a central orchestrator that plans, uses tools, asks for approval,
  records every action and reports back
- **Content studio** — writing, captions, hashtags, thumbnails and publishing schedules
- **Social media** — platform adapters (official APIs only) gated by human approval
- **Virtual avatar** — an animated character with expressions, blinking, idle/talking animations
  and lip sync (never impersonating a real person)
- **Safety** — authentication, permission scopes, approval workflow, audit log, rate limiting

## Repository layout

```text
sara/
├── apps/
│   ├── web/                      # Next.js dashboard shell + module routes (Phase 1)
│   └── api/                      # Fastify API service, /api/v1 (Phase 1)
├── packages/
│   ├── types/                    # Shared types, API envelope, phase registry
│   ├── config/                   # zod-validated env loading (single source for process.env)
│   ├── logger/                   # Structured pino logging
│   ├── db/                       # SQLite (node:sqlite) foundation + migrations
│   ├── clipfinder/               # AI Drama Clip Finder domain core (pipeline, scoring, jobs)
│   └── ui/                       # Reusable dashboard UI primitives
├── docs/                         # Conventions, testing strategy, security, ADRs
├── scripts/                      # Repo verification harness
└── .github/workflows/ci.yml      # CI: lint → typecheck → test → build → verify
```

Dependency rule: `apps/*` may import `packages/*`; never the reverse. See the ADRs under
`docs/adr/` for key decisions.

## Quickstart

Requirements: Node.js >= 20 and npm >= 10.

```bash
npm install                # install all workspace dependencies
cp .env.example .env       # then edit .env (set OPERATOR_PASSWORD etc.)
npm run build              # build packages → api → web
npm run db:migrate         # apply database migrations (SQLite)
npm start                  # API on http://localhost:4000 · dashboard on http://localhost:3000
```

Development mode with watch/reload: `npm run dev` (same ports).

The dashboard talks to the API same-origin: browsers call `/api/*` on the web app, which
proxies to the API service — no CORS setup needed (see ADR 0002).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Build packages, then run API + web with reload |
| `npm run build` | Production build (packages, API, web) |
| `npm start` | Run the production builds |
| `npm test` | Vitest suite (node + jsdom projects) |
| `npm run typecheck` | TypeScript strict across all workspaces |
| `npm run lint` / `format:check` | ESLint / Prettier |
| `npm run verify` | Repo hygiene: structure, secrets, env, links, CI gates |
| `npm run db:migrate` | Apply pending migrations (`--` `--status` to list) |

## API (Phase 1)

Base URL: `http://localhost:4000/api/v1` — every response uses the envelope
`{ ok, data }` or `{ ok: false, error: { code, message }, requestId }`.

| Endpoint | Purpose |
| --- | --- |
| `GET /health` | Service health: version, uptime, database probe |
| `POST /auth/login` | Operator login (env credentials; disabled until configured) |
| `GET /auth/me` | Current session (200 also when unauthenticated) |
| `POST /auth/logout` | Clear the session cookie |

Login is rate limited (5 attempts/minute/IP). Sessions are HttpOnly signed cookies.

## Documentation index

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Target architecture, module map, design decisions |
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Phase-by-phase roadmap and definition of done |
| [docs/CODING_CONVENTIONS.md](docs/CODING_CONVENTIONS.md) | Code style, naming, errors, logging, git |
| [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Test pyramid, mocking policy, CI gates |
| [docs/SECURITY.md](docs/SECURITY.md) | Secrets, permission scopes, approvals, audit log |
| [docs/clip-finder.md](docs/clip-finder.md) | AI Drama Clip Finder: pipeline, scoring, API, env, limits |
| [docs/adr/](docs/adr/) | Architecture decision records |

## Ground rules

1. Secrets live only in environment variables — never in code, never in Git (`.env` is ignored).
2. External platforms are reached through official APIs only, behind provider adapters.
3. Important external actions (publishing, deleting, messaging) require **human approval**.
4. Every phase keeps the project runnable and ends with a working demo, tests and a commit.
5. Sara never gets unrestricted destructive access — least privilege by default.
