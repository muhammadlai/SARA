# Sara — Testing Strategy

Testing is a gate, not an afterthought. Every phase adds tests for what it introduces, and
the verification harness runs them before any push. Failures are never silently skipped.

## Principles

1. **Deterministic.** Tests never depend on network, real LLMs, real social APIs, wall-clock
   time or randomness without seeding.
2. **No real external calls, ever.** LLM providers and social platforms are always mocked or
   stubbed in tests. Official APIs are exercised only in explicitly manual, opt-in checks.
3. **Fast feedback.** Unit suite runs in seconds; slower suites are separated.
4. **Behavior, not implementation.** Test public interfaces of packages and HTTP endpoints,
   not private internals.
5. **The demo is also a test.** Each phase documents manual demo steps; those steps must
   actually be performed and pass.

## Test pyramid

| Layer | Tool | Scope | Status |
| --- | --- | --- | --- |
| Static | TypeScript strict, ESLint | Types, lint rules, boundary rules | ✅ Phase 1 |
| Unit | Vitest | Config validation, auth crypto, migration runner, UI components | ✅ Phase 1 |
| Integration | Vitest + Fastify `inject()` | HTTP endpoints with security middleware, no open ports | ✅ Phase 1 |
| Contract | Vitest with recorded fixtures | Provider adapters behave per contract (LLM, social) | Phase 3 |
| End-to-end | Playwright | Real browser flows: login, chat, approve a post | Phase 8+ |
| Repo checks | `scripts/verify.mjs` | Structure, env hygiene, secret scan, doc links, CI gates | ✅ Phase 0 |

## Conventions

- Test files: `<module>.test.ts` colocated with the source (or `__tests__/` when grouping is clearer).
- Naming: `describe("<unit>")` / `it("does <behavior>")` — read as a sentence.
- Arrange–Act–Assert; one behavior per test; no inter-test ordering.
- Fixtures live in `fixtures/` near their tests; factories over giant shared setups.
- Flaky tests are fixed or quarantined with an issue link — never permanently skipped.
- Coverage: meaningful assertions over metric chasing; target ≥ 70% lines for
  `packages/core` business logic once it exists, and 100% for config/secrets handling.

## What must be tested per phase

- **Config/secrets handling** — invalid env fails fast with a clear error.
- **Permissions and approvals** — a denied scope is truly denied; approvals are required
  and recorded; this is security-critical and always tested explicitly.
- **Audit logging** — important actions produce audit entries.
- **Provider adapters** — request shape, error mapping, retry policy (with mocked HTTP).
- **Migration correctness** — schema migrations apply cleanly and are reversible in dev.

## CI

From Phase 1, GitHub Actions runs on every push and PR:

```text
install → lint → typecheck → unit tests → integration tests → repo verify
```

CI is a merge gate; a red CI means the phase is not done. Manual external-API checks are
documented per phase and run by the operator, never by CI.

## Manual QA culture

Each phase ends with written manual test steps (the "demo"). These are kept in the phase's
PR description / docs so regressions in later phases can re-walk them.
