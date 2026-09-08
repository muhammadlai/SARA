import Link from "next/link";
import { EmptyState } from "@sara/ui";

export default function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="The page you are looking for does not exist. Head back to the dashboard to continue."
      action={
        <Link
          href="/"
          className="rounded-lg bg-violet-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
        >
          Back to Dashboard
        </Link>
      }
    />
  );
}
