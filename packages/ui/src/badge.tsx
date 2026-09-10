import type { ReactNode } from "react";

export type BadgeVariant = "default" | "success" | "warning" | "danger" | "accent" | "outline";

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  default: "bg-zinc-800 text-zinc-300 ring-zinc-700",
  success: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  warning: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  danger: "bg-red-500/10 text-red-300 ring-red-500/30",
  accent: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  outline: "bg-transparent text-zinc-400 ring-zinc-700",
};

/** Small pill label used for phases, statuses and meta information. */
export function Badge({
  variant = "default",
  children,
  className = "",
}: {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
