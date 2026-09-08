# Sara

> Sara is a personal AI agent and virtual character: a modular, self-hosted assistant that
> can chat naturally (text and voice), remember what matters, express a configurable
> personality and emotions, manage tasks, create content, and — where official APIs permit —
> help run a social-media workflow for Facebook, Instagram, YouTube and TikTok.

**Status: Phase 0 — Project Foundation (in progress).** Sara is being built incrementally.
Nothing beyond the foundation exists yet; see [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)
for the full roadmap and [ARCHITECTURE.md](ARCHITECTURE.md) for the target architecture.

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
├── README.md                     # This file
├── ARCHITECTURE.md               # Target architecture and stack decisions
├── DEVELOPMENT_PLAN.md           # Phased roadmap and definition of done
├── .env.example                  # Environment template (placeholders only — never real secrets)
├── docs/                         # Conventions, testing strategy, security principles
├── scripts/                      # Repo verification harness and tooling
├── apps/                         # (Phase 1+) web dashboard and API service
└── packages/                     # (Phase 1+) core, memory, persona, tools, social, content
```

## Quickstart (Phase 0)

Requirements: Node.js >= 20 and npm >= 10.

```bash
npm install          # installs dev tooling (markdownlint)
npm run verify       # structural verification: docs, env hygiene, secret scan, links
npm run lint:md      # markdown lint
```

`npm run verify` is the Phase 0 gate: it must pass before every commit, and it will grow
into the full check harness (typecheck, lint, tests, demo) in later phases.

## Documentation index

| Document | Purpose |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Target architecture, module map, design decisions |
| [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) | Phase-by-phase roadmap and definition of done |
| [docs/CODING_CONVENTIONS.md](docs/CODING_CONVENTIONS.md) | Code style, naming, errors, logging, git |
| [docs/TESTING_STRATEGY.md](docs/TESTING_STRATEGY.md) | Test pyramid, mocking policy, CI gates |
| [docs/SECURITY.md](docs/SECURITY.md) | Secrets, permission scopes, approvals, audit log |

## Ground rules

1. Secrets live only in environment variables — never in code, never in Git (`.env` is ignored).
2. External platforms are reached through official APIs only, behind provider adapters.
3. Important external actions (publishing, deleting, messaging) require **human approval**.
4. Every phase keeps the project runnable and ends with a working demo, tests and a commit.
5. Sara never gets unrestricted destructive access — least privilege by default.
