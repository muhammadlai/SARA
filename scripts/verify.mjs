#!/usr/bin/env node
/**
 * Sara — repository verification harness.
 *
 * Phase 1 scope: structural checks, env hygiene, secret scan, doc links,
 * workspace sanity, CI workflow coverage. This harness grows with every phase
 * and must pass before any commit is pushed. Zero runtime dependencies.
 *
 * Run: npm run verify
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

const results = [];
let failed = false;

function runCheck(name, fn) {
  try {
    const detail = fn();
    results.push({ name, ok: true, detail: detail ?? "" });
  } catch (err) {
    failed = true;
    results.push({ name, ok: false, detail: err instanceof Error ? err.message : String(err) });
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

// ── File listing helpers ───────────────────────────────────────────────────

const WALK_IGNORE = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  "coverage",
  "data",
  ".turbo",
  ".vercel",
]);

function walk(dir, ignore = WALK_IGNORE) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignore.has(entry.name)) continue;
    const rel = path.relative(ROOT, path.join(dir, entry.name));
    if (entry.isDirectory()) out.push(...walk(path.join(dir, entry.name), ignore));
    else out.push(rel.split(path.sep).join("/"));
  }
  return out;
}

function gitLsFiles() {
  try {
    return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "buffer" })
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  } catch {
    return null; // not a git checkout
  }
}

/** Tracked files only (used for "is X committed?" style checks). */
function trackedFiles() {
  return gitLsFiles() ?? [];
}

/**
 * Tracked files PLUS anything new on disk (so this harness validates fresh,
 * not-yet-committed work too), minus build output and local secret files.
 */
function scanFiles() {
  const tracked = new Set(trackedFiles());
  const onDisk = walk(ROOT).filter(
    (rel) => rel !== ".env" && !/\.(pem|key|db)$/.test(rel) && rel !== "package-lock.json",
  );
  return [...new Set([...tracked, ...onDisk])];
}

// ── Check 1: required files exist and are non-trivial ──────────────────────

const REQUIRED_FILES = [
  // Phase 0 foundation
  ["README.md", 500],
  ["ARCHITECTURE.md", 2000],
  ["DEVELOPMENT_PLAN.md", 3000],
  [".env.example", 200],
  [".gitignore", 100],
  ["package.json", 100],
  ["docs/CODING_CONVENTIONS.md", 1000],
  ["docs/TESTING_STRATEGY.md", 1000],
  ["docs/SECURITY.md", 1000],
  ["scripts/verify.mjs", 500],
  // Phase 1 — monorepo & tooling
  ["vitest.config.ts", 300],
  ["vitest.dom.setup.ts", 50],
  ["eslint.config.mjs", 300],
  [".github/workflows/ci.yml", 400],
  // Phase 1 — apps
  ["apps/api/package.json", 150],
  ["apps/api/src/index.ts", 400],
  ["apps/api/src/server.ts", 800],
  ["apps/api/src/routes/v1/health.ts", 300],
  ["apps/api/src/routes/v1/auth.ts", 600],
  ["apps/web/package.json", 150],
  ["apps/web/next.config.ts", 150],
  ["apps/web/app/layout.tsx", 300],
  ["apps/web/app/page.tsx", 300],
  // Phase 1 — packages
  ["packages/types/package.json", 100],
  ["packages/types/src/index.ts", 500],
  ["packages/config/package.json", 100],
  ["packages/config/src/index.ts", 1500],
  ["packages/logger/package.json", 100],
  ["packages/logger/src/index.ts", 300],
  ["packages/db/package.json", 150],
  ["packages/db/migrations/0001_users.sql", 100],
  ["packages/db/src/index.ts", 500],
  ["packages/ui/package.json", 100],
  ["packages/ui/src/index.ts", 200],
  // Clip Finder feature
  ["packages/clipfinder/package.json", 150],
  ["packages/clipfinder/src/index.ts", 500],
  ["packages/clipfinder/src/pipeline.ts", 1000],
  ["packages/clipfinder/src/scoring.ts", 500],
  ["packages/db/migrations/0002_clip_finder.sql", 500],
  ["apps/api/src/routes/v1/clip-finder.ts", 1000],
  ["apps/web/components/clip-finder/clip-finder-app.tsx", 1000],
  ["docs/clip-finder.md", 1000],
];

runCheck("required files present", () => {
  const problems = [];
  for (const [file, minBytes] of REQUIRED_FILES) {
    const p = path.join(ROOT, file);
    if (!fs.existsSync(p)) problems.push(`${file} (missing)`);
    else if (fs.statSync(p).size < minBytes)
      problems.push(`${file} (suspiciously small, ${fs.statSync(p).size} bytes)`);
  }
  assert(problems.length === 0, `missing/empty: ${problems.join(", ")}`);
  return `${REQUIRED_FILES.length} files verified`;
});

// ── Check 2: monorepo workspace sanity ─────────────────────────────────────

const EXPECTED_WORKSPACES = [
  "@sara/api",
  "@sara/web",
  "@sara/types",
  "@sara/config",
  "@sara/logger",
  "@sara/db",
  "@sara/ui",
];

runCheck("npm workspaces complete", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert(
    Array.isArray(rootPkg.workspaces) && rootPkg.workspaces.includes("apps/*"),
    "root package.json must declare apps/* workspaces",
  );
  for (const name of EXPECTED_WORKSPACES) {
    const scope =
      name === "@sara/api"
        ? "apps/api"
        : name === "@sara/web"
          ? "apps/web"
          : `packages/${name.replace("@sara/", "")}`;
    const pkgPath = path.join(ROOT, scope, "package.json");
    assert(fs.existsSync(pkgPath), `missing workspace package: ${scope}/package.json`);
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    assert(pkg.name === name, `${scope}/package.json name must be "${name}" (got "${pkg.name}")`);
  }
  return `${EXPECTED_WORKSPACES.length} workspaces: ${EXPECTED_WORKSPACES.join(", ")}`;
});

// ── Check 3: CI workflow covers the required gates ─────────────────────────

runCheck("CI workflow gates", () => {
  const wf = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  for (const marker of [
    "npm ci",
    "npm run lint",
    "npm run typecheck",
    "npm run test",
    "npm run build",
  ]) {
    assert(wf.includes(marker), `ci.yml is missing required step: ${marker}`);
  }
  return "install → lint → typecheck → test → build";
});

// ── Check 4: no secret material is tracked ─────────────────────────────────

const SECRET_PATTERNS = [
  [/ghp_[A-Za-z0-9]{20,}/, "GitHub personal access token"],
  [/gh[ousr]_[A-Za-z0-9]{20,}/, "GitHub OAuth/app token"],
  [/github_pat_[A-Za-z0-9_]{20,}/, "GitHub fine-grained PAT"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/sk-[A-Za-z0-9_-]{20,}/, "OpenAI-style secret key"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key material"],
  [/eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}/, "JWT token"],
];
// High-entropy generic blob; skipped for files where long base64 is legitimate.
const GENERIC_SECRET = /[A-Za-z0-9+/_-]{45,}={0,2}/;
const GENERIC_SKIP = /(^|\/)(package-lock\.json|.*\.svg|.*\.min\..*|verify\.mjs)$/;
const TEXT_EXT = new Set([
  ".md",
  ".mjs",
  ".cjs",
  ".js",
  ".ts",
  ".tsx",
  ".json",
  ".yml",
  ".yaml",
  ".txt",
  ".example",
  ".gitignore",
  ".prisma",
  ".sql",
  ".css",
]);

runCheck("no secrets in tracked files", () => {
  const hits = [];
  for (const rel of scanFiles()) {
    if (!TEXT_EXT.has(path.extname(rel)) && rel !== ".gitignore" && rel !== ".env.example")
      continue;
    const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
    content.split("\n").forEach((line, i) => {
      for (const [pattern, label] of SECRET_PATTERNS) {
        if (pattern.test(line)) hits.push(`${rel}:${i + 1} → ${label}`);
      }
      const stripped = line.replace(/[-_=*~`|#]{10,}/g, ""); // md table borders etc.
      if (!GENERIC_SKIP.test(rel) && GENERIC_SECRET.test(stripped)) {
        hits.push(`${rel}:${i + 1} → high-entropy blob (possible secret)`);
      }
    });
  }
  assert(hits.length === 0, `suspected secrets:\n     ${hits.join("\n     ")}`);
  return "named patterns + high-entropy scan clean";
});

// ── Check 5: env hygiene ───────────────────────────────────────────────────

runCheck(".env.example contains only placeholders", () => {
  const allowedExact = new Set([
    "development",
    "production",
    "test",
    "info",
    "debug",
    "warn",
    "error",
    "0.0.0.0",
    "127.0.0.1",
    "operator",
    "changeme",
  ]);
  const offenders = [];
  const lines = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8").split("\n");
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const eq = line.indexOf("=");
    assert(eq > 0, `.env.example:${i + 1} is not KEY=VALUE or comment: "${line}"`);
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    assert(
      /^[A-Z][A-Z0-9_]*$/.test(key),
      `.env.example:${i + 1} key "${key}" must be UPPER_SNAKE_CASE`,
    );
    if (value === "") return; // empty = intentionally unfilled, fine
    const ok =
      allowedExact.has(value.toLowerCase()) ||
      /^\d+$/.test(value) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(value) ||
      /^file:/.test(value) ||
      /^(changeme|your[-_]|example|placeholder|<)/i.test(value);
    if (!ok) offenders.push(`.env.example:${i + 1} ${key}=${value}`);
  });
  assert(offenders.length === 0, `non-placeholder values:\n     ${offenders.join("\n     ")}`);
  return "all values empty or obvious placeholders";
});

runCheck(".env is ignored by git and untracked", () => {
  const tracked = trackedFiles();
  assert(
    !tracked.includes(".env"),
    ".env is tracked by git — remove it from the index immediately",
  );
  for (const rel of tracked) {
    assert(!/\.(pem|key|db)$/.test(rel), `secret/db material tracked: ${rel}`);
  }
  let ignored = false;
  try {
    execFileSync("git", ["check-ignore", "-q", ".env"], { cwd: ROOT });
    ignored = true;
  } catch {
    ignored = fs.existsSync(path.join(ROOT, ".env"))
      ? false
      : "n/a (no .env present; .gitignore rule in place)";
  }
  assert(ignored !== false, ".env exists but is NOT gitignored — add it to .gitignore");
  return typeof ignored === "string" ? ignored : ".env ignored by git";
});

// ── Check 6: relative documentation links resolve ──────────────────────────

runCheck("markdown links resolve", () => {
  const mdFiles = scanFiles().filter((f) => f.endsWith(".md"));
  const broken = [];
  const linkRe = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const rel of mdFiles) {
    const content = fs.readFileSync(path.join(ROOT, rel), "utf8");
    let m;
    while ((m = linkRe.exec(content)) !== null) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/.test(target)) continue;
      const clean = target.split("#")[0];
      if (!clean) continue; // pure anchor link
      const resolved = path.resolve(path.dirname(path.join(ROOT, rel)), clean);
      if (!fs.existsSync(resolved)) broken.push(`${rel} → ${target}`);
    }
  }
  assert(broken.length === 0, `broken relative links:\n     ${broken.join("\n     ")}`);
  return `${mdFiles.length} markdown files checked`;
});

// ── Report ─────────────────────────────────────────────────────────────────

const green = (s) => `\x1b[32m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const gray = (s) => `\x1b[90m${s}\x1b[0m`;

console.log(`\n${bold("Sara — repo verification")}${" ".repeat(4)}(node ${process.version})\n`);
for (const r of results) {
  console.log(
    ` ${r.ok ? green("PASS") : red("FAIL")}  ${r.name}${r.detail ? gray(` — ${r.detail}`) : ""}`,
  );
}
const passed = results.filter((r) => r.ok).length;
console.log(
  `\n${failed ? red("✗ verify failed") : green("✓ all checks passed")} ${gray(`(${passed}/${results.length})`)}\n`,
);
process.exit(failed ? 1 : 0);
