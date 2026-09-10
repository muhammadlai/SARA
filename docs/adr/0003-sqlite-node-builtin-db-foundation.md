# ADR 0003 — Phase 1 database foundation uses Node's built-in SQLite, not Prisma

- **Status:** Accepted (Phase 1)
- **Context:** Phase 0 shortlisted Prisma as the likely ORM with the final call
  deferred to Phase 2. Two facts changed the calculus in Phase 1: (1) the dev
  environment blocks Prisma's engine CDN (`binaries.prisma.sh` is unreachable),
  so Prisma cannot install, generate or migrate here — and every phase must be
  runnable and demo-verified in this environment; (2) Phase 1 only asks for a
  clean database **abstraction and migration strategy**, not a production ORM.
- **Decision:** `packages/db` is a zero-dependency foundation on Node's
  built-in `node:sqlite`: lazy connection singleton, ordered `.sql` migration
  files tracked in `_sara_migrations`, applied transactionally via
  `npm run migrate -w @sara/db`, plus a health probe. All callers depend only
  on this package's functions.
- **Consequences:**
  - Everything works offline with no native builds or engine downloads;
    `node:sqlite` is marked experimental by Node — acceptable for the local
    foundation and explicitly re-evaluated next phase.
  - Phase 2 decides the production storage stack (stay on this layer, Drizzle,
    or revisit Prisma in environments where its CDN is reachable) behind the
    same package interface; a PostgreSQL adapter is the likely target.
  - `schema.prisma` and Prisma dependencies were removed in the same commit.
