"use client";

import { ErrorState } from "@sara/ui";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <ErrorState
      title="Something went wrong"
      message={
        error.message.length > 0
          ? `${error.message} (digest: ${error.digest ?? "n/a"})`
          : "An unexpected error occurred while rendering this page."
      }
      onRetry={reset}
    />
  );
}
