import path from "node:path";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const src = (pkg: string) => path.resolve(root, "packages", pkg, "src", "index.ts");

/**
 * Two Vitest projects:
 *  - node:   API service + node-only packages (config, logger, types)
 *  - dom:    UI package + web components (jsdom + Testing Library)
 *
 * Workspace packages are aliased to their TS sources so tests always run
 * against source, never stale build output.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: [
            "apps/api/test/**/*.test.ts",
            "packages/types/test/**/*.test.ts",
            "packages/config/test/**/*.test.ts",
            "packages/logger/test/**/*.test.ts",
            "packages/db/test/**/*.test.ts",
          ],
          alias: {
            "@sara/types": src("types"),
            "@sara/config": src("config"),
            "@sara/logger": src("logger"),
            "@sara/db": src("db"),
          },
        },
      },
      {
        // esbuild must emit the automatic JSX runtime for TSX in tests
        // (apps/web's tsconfig sets jsx=preserve for Next.js).
        esbuild: { jsx: "automatic" },
        test: {
          name: "dom",
          environment: "jsdom",
          setupFiles: ["vitest.dom.setup.ts"],
          include: ["packages/ui/test/**/*.test.tsx", "apps/web/test/**/*.test.tsx"],
          alias: {
            "@sara/ui": src("ui"),
            "@sara/types": src("types"),
            "@": path.resolve(root, "apps/web"),
          },
        },
      },
    ],
  },
});
