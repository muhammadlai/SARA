import type { ReactNode } from "react";
import { Badge } from "./badge.js";
import { Card } from "./card.js";

/**
 * Uniform placeholder for modules that arrive in a later phase: what the
 * module will do, and exactly when to expect it. Keeps every route honest and
 * plug-ready instead of pretending features exist.
 */
export function PlaceholderFeature({
  icon,
  title,
  description,
  phaseLabel,
  points = [],
}: {
  icon: ReactNode;
  title: string;
  description: string;
  phaseLabel: string;
  points?: string[];
}) {
  return (
    <Card>
      <div className="flex flex-col items-start gap-5 p-6 sm:flex-row">
        <div className="rounded-2xl bg-violet-500/10 p-3 text-violet-300 ring-1 ring-violet-500/20">
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold text-zinc-100">{title}</h3>
            <Badge variant="accent">{phaseLabel}</Badge>
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{description}</p>
          {points.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {points.map((point) => (
                <li key={point} className="flex items-start gap-2.5 text-sm text-zinc-400">
                  <span
                    aria-hidden
                    className="mt-[7px] size-1.5 shrink-0 rounded-full bg-violet-400/70"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
