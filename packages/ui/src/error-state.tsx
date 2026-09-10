import type { ReactNode } from "react";

/** Consistent error panel with optional retry. Safe for any failure surface. */
export function ErrorState({
  title = "Something went wrong",
  message,
  onRetry,
  retryLabel = "Try again",
  icon,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-center justify-center rounded-2xl border border-red-500/20 bg-red-500/5 px-6 py-10 text-center"
    >
      {icon ? <div className="mb-3 text-red-300">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-red-200">{title}</h3>
      <p className="mt-1 max-w-md text-sm leading-6 text-red-200/70">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-1.5 text-xs font-medium text-red-200 transition hover:bg-red-500/20"
        >
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
