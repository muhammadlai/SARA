# Sara — Coding Conventions

These conventions apply to every phase. They exist so the codebase stays predictable as it
grows across many modules. Tooling will enforce most of this from Phase 1 (ESLint +
Prettier + strict TypeScript); until then, review enforces it.

## Language and formatting

- **TypeScript everywhere**, `strict: true` (including `noUncheckedIndexedAccess`).
- **No `any`.** Use `unknown` plus narrowing, or a precise type.
- Formatting: Prettier defaults (2-space indent, double quotes, trailing commas where valid).
- Prefer `const`, immutability, and pure functions in `packages/*` (side effects live at
  the edges: apps, adapters, workers).

## Naming

| Thing | Convention | Example |
| --- | --- | --- |
| Files (TS modules) | kebab-case | `llm-provider.ts` |
| React components | PascalCase file matching component | `TaskCard.tsx` |
| Types/interfaces | PascalCase, no `I` prefix | `SocialProvider` |
| Enums/union values | lower-kebab or lower_snake strings | `"requires-approval"` |
| Constants | SCREAMING_SNAKE_CASE | `MAX_UPLOAD_BYTES` |
| Env variables | UPPER_SNAKE_CASE, grouped by domain | `OPENAI_API_KEY` |
| Booleans | `is/has/can/should` prefix | `isPublishable` |
| Tests | `<module>.test.ts` next to the code | `orchestrator.test.ts` |

## Project structure rules

- `apps/*` may import `packages/*`; `packages/*` must never import `apps/*`.
- Packages expose a single public entry point (`src/index.ts`); deep imports across
  package boundaries are forbidden.
- Side-effectful adapters (LLM vendors, social platforms, DB) implement a package-local
  interface; business logic depends only on the interface.
- One responsibility per module; if a file exceeds ~300 lines, look for a split.

## Configuration and secrets

- All environment access goes through the central config module (`packages/config`):
  zod-validated, fail-fast at startup. **Never** read `process.env` outside it.
- Never hard-code keys, tokens, passwords or URLs-with-credentials.
- New env vars are added to `.env.example` (placeholder values only) in the same commit.
- Secrets never appear in logs, error messages, audit entries or test fixtures.

## Error handling

- Validate inputs at boundaries (HTTP handlers, tool inputs, provider responses) with zod.
- Throw typed errors (`class AppError extends Error` with a `code`), never naked strings.
- No silent `catch`. Either handle meaningfully or rethrow with context.
- Fail fast on startup for invalid config; degrade gracefully at runtime for optional
  subsystems (e.g. a social platform that is not configured returns "unavailable", not a crash).
- User-facing errors are safe and actionable; internal details go to logs, not to the UI.

## Logging

- Structured logging (JSON), one logger instance per process, child loggers with context
  (`{ module, requestId, agentRunId }`).
- Levels: `debug` (dev detail), `info` (state transitions, job results), `warn`
  (recoverable anomaly), `error` (needs attention). No `console.log` in committed code.
- Every HTTP request logs method, path, status and duration. Agent runs log plan, tool
  calls, approvals and outcome.
- Never log secrets or personal content in full (truncate/redact).

## Git conventions

- **Conventional Commits** with a phase scope, e.g.
  `feat(phase-3): streaming chat UI with conversation persistence`.
  Types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `ci`.
- Branches: work happens on the session branch provided by the environment; PRs target `main`.
- Small commits: one logical change per commit; docs updates ride with the code they describe.
- Before every push: `git status` clean, correct branch, no secrets in diff, checks green.
- Never rewrite pushed history on shared branches.

## Dependencies

- Prefer official SDKs for external platforms; avoid unmaintained wrappers.
- Justify every new dependency in the commit/PR description; remove unused ones promptly.
- Pin with caret ranges (`^`); lockfile (`package-lock.json`) is committed.
- No dependencies that phone home at build time without review.

## Documentation

- Public package APIs get short doc comments (what/why, not how).
- README status table and DEVELOPMENT_PLAN checkboxes update in the same commit as the phase.
- Architecture changes update ARCHITECTURE.md; significant choices add an ADR under `docs/adr/`.
