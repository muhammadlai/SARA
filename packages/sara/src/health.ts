/**
 * Sara AI — 24/7 reliability layer.
 *
 * Watchdog + health registry: tracks component health (brain LLM chain,
 * TTS chain, avatar, event sources, memory, process) with degradation
 * ladders, samples process metrics, and records provider usage so the
 * dashboard shows the truth (degraded ≠ healthy).
 *
 * Graceful degradation ladder:
 *   LLM fails → fallback provider → offline persona → safe-default line
 *   TTS fails → next TTS → bundled offline voice → captions-only (labeled)
 *   Avatar fails → photo mode → status card (labeled)
 *   Source fails → reconnect with exponential backoff (adapter-owned)
 */
import { createLogger } from "@sara/logger";
import type { ComponentHealth, SystemSnapshot } from "./types.js";

const log = createLogger({ name: "sara-health" });

interface ComponentRecord {
  component: string;
  healthy: boolean;
  degraded: boolean;
  detail: string;
  since: string;
  lastCheckedAt: string;
  /** Consecutive failure count — escalation hook for watchdog actions. */
  failures: number;
}

export type HealthListener = (snapshot: SystemSnapshot) => void;

export class Watchdog {
  private readonly components = new Map<string, ComponentRecord>();
  private listeners: HealthListener[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt = Date.now();
  private lastCpuUsage = process.cpuUsage();
  private lastCpuAt = Date.now();

  constructor(private readonly sampleIntervalMs = 15_000) {}

  register(name: string, detail = "registered"): void {
    this.components.set(name, {
      component: name,
      healthy: true,
      degraded: false,
      detail,
      since: new Date().toISOString(),
      lastCheckedAt: new Date().toISOString(),
      failures: 0,
    });
  }

  report(name: string, opts: { healthy: boolean; degraded?: boolean; detail: string }): void {
    const prev = this.components.get(name);
    const t = new Date().toISOString();
    const failures = opts.healthy ? 0 : (prev?.failures ?? 0) + 1;
    if (prev && !opts.healthy && prev.healthy) {
      log.warn({ component: name, detail: opts.detail }, "component failing");
    }
    if (prev && opts.healthy && !prev.healthy) {
      log.info({ component: name, detail: opts.detail }, "component recovered");
    }
    this.components.set(name, {
      component: name,
      healthy: opts.healthy,
      degraded: opts.degraded ?? false,
      detail: opts.detail,
      since:
        prev && prev.healthy === opts.healthy && prev.degraded === (opts.degraded ?? false)
          ? prev.since
          : t,
      lastCheckedAt: t,
      failures,
    });
    this.emit();
  }

  get(name: string): ComponentHealth | null {
    const rec = this.components.get(name);
    if (!rec) return null;
    const { failures: _f, ...rest } = rec as ComponentHealth & { failures: number };
    void _f;
    return rest;
  }

  onSnapshot(listener: HealthListener): void {
    this.listeners.push(listener);
  }

  /** Collect a full snapshot: components + process metrics. */
  snapshot(): SystemSnapshot {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage();
    const elapsedMs = Math.max(1, Date.now() - this.lastCpuAt);
    const cpuPercent =
      ((cpu.user - this.lastCpuUsage.user + (cpu.system - this.lastCpuUsage.system)) /
        1000 /
        elapsedMs) *
      100;
    this.lastCpuUsage = cpu;
    this.lastCpuAt = Date.now();

    const components = [...this.components.values()].map(({ failures: _f, ...rest }) => {
      void _f;
      return rest as ComponentHealth;
    });
    const failing = components.filter((c) => !c.healthy).length;
    const degraded = components.filter((c) => c.healthy && c.degraded).length;
    return {
      overall: failing > 0 ? "failing" : degraded > 0 ? "degraded" : "healthy",
      components,
      process: {
        uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
        memoryMb: Math.round(mem.rss / 1024 / 1024),
        cpuPercent: Number(cpuPercent.toFixed(1)),
        nodeVersion: process.version,
      },
    };
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const snap = this.snapshot();
      if (snap.overall === "failing") {
        log.warn(
          { failing: snap.components.filter((c) => !c.healthy).map((c) => c.component) },
          "watchdog: failing components",
        );
      }
      this.emit();
    }, this.sampleIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) {
      try {
        l(snap);
      } catch {
        /* listener errors never crash the watchdog */
      }
    }
  }
}

/** Reconnect helper with exponential backoff + jitter (used by adapters). */
export function backoffDelay(attempt: number, baseMs = 1000, maxMs = 60_000): number {
  const exp = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
