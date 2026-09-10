/**
 * Clip Finder storage layout & retention.
 *
 *   <dataDir>/sources/<jobId><ext>     uploaded/downloaded originals (kept
 *                                      until the job is deleted)
 *   <dataDir>/jobs/<jobId>/…           temp artifacts (audio, thumbnails)
 *   <dataDir>/renders/<renderId>.mp4   finished renders + .srt + .json
 *
 * Retention: temp artifacts and renders older than the configured period are
 * swept periodically. Originals are only removed by explicit job deletion —
 * never automatically (and the user's own file outside Sara is untouched).
 */
import fs from "node:fs";
import path from "node:path";

export class ClipFinderStorage {
  constructor(readonly rootDir: string) {}

  sourcesDir(): string {
    return path.join(this.rootDir, "sources");
  }
  jobsDir(): string {
    return path.join(this.rootDir, "jobs");
  }
  rendersDir(): string {
    return path.join(this.rootDir, "renders");
  }
  jobDir(jobId: string): string {
    return path.join(this.jobsDir(), jobId);
  }

  ensureLayout(): void {
    for (const dir of [this.rootDir, this.sourcesDir(), this.jobsDir(), this.rendersDir()]) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  sourcePath(jobId: string, extension: string): string {
    const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
    return path.join(this.sourcesDir(), `${jobId}${safeExt}`);
  }

  jobArtifactPath(jobId: string, name: string): string {
    return path.join(this.jobDir(jobId), name);
  }

  renderPath(renderId: string, extension: string): string {
    const safeExt = extension.startsWith(".") ? extension : `.${extension}`;
    return path.join(this.rendersDir(), `${renderId}${safeExt}`);
  }

  /** Remove a job's temp dir; optionally also its source file. */
  removeJobWorkspace(jobId: string, sourceFile: string | null): void {
    fs.rmSync(this.jobDir(jobId), { recursive: true, force: true });
    if (sourceFile !== null && sourceFile.startsWith(this.sourcesDir())) {
      fs.rmSync(sourceFile, { force: true });
    }
  }

  removeRenderFile(filePath: string | null): void {
    if (filePath !== null && filePath.startsWith(this.rendersDir())) {
      fs.rmSync(filePath, { force: true });
    }
  }

  /** Delete files under `dir` (non-recursive) older than `maxAgeMs`. */
  private sweepDir(dir: string, maxAgeMs: number): number {
    if (!fs.existsSync(dir)) return 0;
    let removed = 0;
    const cutoff = Date.now() - maxAgeMs;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // Job temp dirs: sweep their contents, drop empty dirs.
        for (const inner of fs.readdirSync(full)) {
          const innerPath = path.join(full, inner);
          try {
            if (fs.statSync(innerPath).mtimeMs < cutoff) {
              fs.rmSync(innerPath, { force: true });
              removed += 1;
            }
          } catch {
            // ignore transient errors during sweep
          }
        }
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {
          // ignore
        }
      } else {
        try {
          if (fs.statSync(full).mtimeMs < cutoff) {
            fs.rmSync(full, { force: true });
            removed += 1;
          }
        } catch {
          // ignore
        }
      }
    }
    return removed;
  }

  /** Apply retention to temp artifacts and renders; sources are never swept. */
  sweepRetention(retentionHours: number): { temp: number; renders: number } {
    const maxAgeMs = retentionHours * 3600 * 1000;
    return {
      temp: this.sweepDir(this.jobsDir(), maxAgeMs),
      renders: this.sweepDir(this.rendersDir(), maxAgeMs),
    };
  }
}
