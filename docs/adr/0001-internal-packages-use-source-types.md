# ADR 0001 — Internal packages expose types from source, build to `dist`

- **Status:** Accepted (Phase 1)
- **Context:** npm-workspaces monorepo with TypeScript. Cross-package imports
  need type information before any build has produced `dist/`, or every script
  order becomes a hidden dependency.
- **Decision:** Workspace packages keep `"types": "./src/index.ts"` and
  `"main": "./dist/index.js"`. Type checking always resolves to package
  **source**; runtime (node, next) resolves to **built** `dist/`. Root scripts
  (`dev`, `build`, `start`) run `build:packages` first; tests alias `@sara/*`
  to source so they never depend on build order.
- **Consequences:** `npm run typecheck` and `npm run test` work standalone;
  publishing these packages externally would require generated `.d.ts` files
  (not a goal — this is a private application monorepo).
