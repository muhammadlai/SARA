"use client";

import { useEffect, useState } from "react";
import { StatusDot } from "@sara/ui";
import { fetchHealth, type HealthView } from "@/lib/health";

const POLL_MS = 60_000;

/** Compact API status indicator for the top bar. */
export function StatusPill() {
  const [view, setView] = useState<HealthView>({
    status: "online" as HealthView["status"],
  } as HealthView);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      const next = await fetchHealth();
      if (!cancelled) {
        setView(next);
        setChecked(true);
      }
    };
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const tone = !checked
    ? "gray"
    : view.status === "offline"
      ? "red"
      : view.status === "degraded"
        ? "amber"
        : "green";
  const label = !checked
    ? "API checking…"
    : view.status === "offline"
      ? "API offline"
      : view.status === "degraded"
        ? "API degraded"
        : "API online";

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900/70 px-3 py-1 text-xs text-zinc-300">
      <StatusDot tone={tone} pulse={checked && view.status !== "offline"} />
      {label}
    </span>
  );
}
