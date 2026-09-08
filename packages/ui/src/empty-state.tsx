import type { ReactNode } from "react";

/** Clean empty state: what belongs here, why it is quiet, what to do next. */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-800 bg-zinc-900/30 px-6 py-14 text-center">
      {icon ? <div className="mb-3 text-zinc-500">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-zinc-200">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-zinc-500">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
