import Link from "next/link";
import { Sparkles } from "lucide-react";
import { Badge, Card } from "@sara/ui";

/** The Sara identity card: who she is, where the project stands, where to go next. */
export function SaraCard() {
  return (
    <Card className="overflow-hidden">
      <div className="relative p-6">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-violet-600/20 blur-3xl"
        />
        <div className="flex items-start gap-4">
          <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-lg shadow-violet-900/40">
            <Sparkles className="size-8 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold tracking-tight text-zinc-50">Sara</h2>
              <Badge variant="success">Foundation online</Badge>
            </div>
            <p className="mt-1 text-sm text-zinc-400">Personal AI agent &amp; virtual character</p>
          </div>
        </div>

        <p className="mt-4 max-w-xl text-sm leading-6 text-zinc-400">
          Phase 1 is live: dashboard shell, API service, validated configuration, structured
          logging, authentication foundation and the database layer. Conversation arrives in Phase 3
          — every module below is already wired to its route so future phases plug straight in.
        </p>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href="/chat"
            className="rounded-lg bg-violet-500 px-3.5 py-2 text-sm font-medium text-white transition hover:bg-violet-400"
          >
            Preview Chat
          </Link>
          <Link
            href="/activity"
            className="rounded-lg border border-zinc-700 px-3.5 py-2 text-sm text-zinc-300 transition hover:bg-zinc-800/60"
          >
            View Activity
          </Link>
        </div>
      </div>
    </Card>
  );
}
