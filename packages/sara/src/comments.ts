/**
 * Sara AI — comment queue with intelligent prioritization.
 *
 * Not every comment is spoken (that would make LIVE unusable): the queue
 * applies rate limiting (max/minute), per-viewer cooldowns, duplicate
 * suppression and a priority threshold. Questions and follows outrank chat;
 * moderation-rejected comments never enter.
 */
import type {
  CommentQueueLimits,
  LiveEvent,
  ModerationVerdict,
  QueuePriority,
  QueuedComment,
} from "./types.js";
import { detectIntent } from "./languages.js";

export const DEFAULT_QUEUE_LIMITS: CommentQueueLimits = {
  maxPerMinute: 8,
  perViewerCooldownSeconds: 20,
  duplicateWindowSeconds: 60,
  minPriority: 3,
  queueMaxLength: 30,
};

export interface AdmissionDecision {
  admitted: boolean;
  priority?: QueuePriority;
  reason: string;
}

export class CommentQueue {
  private items: QueuedComment[] = [];
  private readonly limits: CommentQueueLimits;
  private lastPerViewer = new Map<string, number>();
  private recentTexts: Array<{ text: string; at: number }> = [];
  private recentViewers: string[] = [];
  private admittedTimestamps: number[] = [];

  constructor(limits: Partial<CommentQueueLimits> = {}) {
    this.limits = { ...DEFAULT_QUEUE_LIMITS, ...limits };
  }

  get depth(): number {
    return this.items.length;
  }

  get limitsValue(): CommentQueueLimits {
    return { ...this.limits };
  }

  /** Runtime re-configuration from the dashboard settings panel. */
  configureLimits(patch: Partial<CommentQueueLimits>): void {
    Object.assign(this.limits, patch);
  }

  /** Responses actually emitted in the last 60s (for pacing + dashboard). */
  responsesPerMinute(now = Date.now()): number {
    const cutoff = now - 60_000;
    return this.admittedTimestamps.filter((t) => t >= cutoff).length;
  }

  /** Decide whether a comment event should be spoken, and at what priority. */
  admit(
    event: LiveEvent,
    moderation: ModerationVerdict,
    now: number = Date.now(),
  ): AdmissionDecision {
    if (event.kind !== "comment") return { admitted: false, reason: "not-a-comment" };
    const text = (event.text ?? "").trim();
    if (!text) return { admitted: false, reason: "empty" };

    const viewerKey = `${event.platform}:${event.userId ?? event.username ?? "anon"}`;
    const lower = text.toLowerCase();

    // Duplicate suppression (same text within window — group them).
    const dupCutoff = now - this.limits.duplicateWindowSeconds * 1000;
    this.recentTexts = this.recentTexts.filter((r) => r.at >= dupCutoff);
    if (this.recentTexts.some((r) => r.text === lower)) {
      return { admitted: false, reason: "duplicate-suppressed" };
    }
    this.recentTexts.push({ text: lower, at: now });

    // Per-viewer cooldown (regulars who talk a lot shouldn't dominate).
    const last = this.lastPerViewer.get(viewerKey);
    const cooldown = this.limits.perViewerCooldownSeconds * 1000;
    const intent = detectIntent(text);
    // Questions bypass the viewer cooldown (answering questions is the job).
    const cooldownOk = last === undefined || now - last >= cooldown || intent.isQuestion;

    // Rate cap.
    const cutoff = now - 60_000;
    this.admittedTimestamps = this.admittedTimestamps.filter((t) => t >= cutoff);
    const rateOk = this.admittedTimestamps.length < this.limits.maxPerMinute;

    const priority = this.priorityFor(event, intent.isQuestion, this.recentViewers.slice(-8));
    const thresholdOk = priority <= this.limits.minPriority;

    const firstTime = !this.recentViewers.includes(viewerKey);

    if (!rateOk && priority === 1) {
      // Top-priority (question/new viewer) still allowed small overflow.
      this.admittedTimestamps.push(now);
      this.remember(viewerKey, now);
      return { admitted: true, priority, reason: "priority-overflow" };
    }
    if (!rateOk) return { admitted: false, priority, reason: "rate-limit" };
    if (!cooldownOk) return { admitted: false, priority, reason: "viewer-cooldown" };
    if (!thresholdOk) return { admitted: false, priority, reason: "below-priority-threshold" };

    this.admittedTimestamps.push(now);
    this.remember(viewerKey, now);
    return { admitted: true, priority, reason: firstTime ? "first-appearance" : "ok" };
  }

  enqueue(
    event: LiveEvent,
    priority: QueuePriority,
    reason: string,
    now = Date.now(),
  ): QueuedComment | null {
    if (this.items.length >= this.limits.queueMaxLength) {
      // Drop the lowest-priority oldest item to make room for higher priority.
      const idx = this.items.findIndex((i) => i.priority > priority);
      if (idx === -1) return null;
      this.items.splice(idx, 1);
    }
    const item: QueuedComment = {
      id: `qc_${this.rid()}`,
      event,
      priority,
      queuedAt: new Date(now).toISOString(),
      reason,
    };
    this.items.push(item);
    this.sort();
    return item;
  }

  /** Pop the next comment to respond to. */
  next(): QueuedComment | null {
    return this.items.shift() ?? null;
  }

  /** Drop everything (emergency stop / takeover). */
  clear(): number {
    const n = this.items.length;
    this.items = [];
    return n;
  }

  snapshot(): Array<{
    username?: string;
    text?: string;
    priority: QueuePriority;
    queuedAt: string;
  }> {
    return this.items.map((i) => ({
      username: i.event.username,
      text: i.event.text,
      priority: i.priority,
      queuedAt: i.queuedAt,
    }));
  }

  private sort(): void {
    // Priority asc (1 first), then FIFO.
    this.items.sort((a, b) => a.priority - b.priority || a.queuedAt.localeCompare(b.queuedAt));
  }

  private priorityFor(
    event: LiveEvent,
    isQuestion: boolean,
    recentViewers: string[],
  ): QueuePriority {
    const text = (event.text ?? "").toLowerCase();
    if (isQuestion) return 1;
    if (/\b(sara)\b/i.test(text)) return 1; // addressed to Sara directly
    const seen = recentViewers.filter(
      (v) => v === `${event.platform}:${event.userId ?? event.username}`,
    ).length;
    if (seen === 0) return 2; // new viewer
    if (text.length > 60) return 2; // interesting conversation starter
    return 3;
  }

  private remember(viewerKey: string, now: number): void {
    this.lastPerViewer.set(viewerKey, now);
    this.recentViewers.push(viewerKey);
    if (this.recentViewers.length > 200) this.recentViewers = this.recentViewers.slice(-200);
  }

  private rid(): string {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 18);
  }
}
