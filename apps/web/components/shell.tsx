"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Menu, Sparkles, X } from "lucide-react";
import { StatusDot } from "@sara/ui";
import { isActivePath, NAV_ITEMS } from "@/lib/nav";
import { StatusPill } from "@/components/status-pill";

/**
 * Dashboard shell: responsive sidebar navigation, sticky top bar and content
 * area. All module routes render inside this frame.
 */
export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const nav = (
    <nav aria-label="Main navigation" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
      {NAV_ITEMS.map((item) => {
        const active = isActivePath(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
              active
                ? "bg-violet-500/10 text-violet-200 ring-1 ring-inset ring-violet-500/20"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100"
            }`}
          >
            <Icon className={`size-4.5 shrink-0 ${active ? "text-violet-300" : "text-zinc-500"}`} />
            <span className="truncate">{item.label}</span>
            {item.phase === null ? (
              <StatusDot tone="green" className="ml-auto" />
            ) : (
              <span className="ml-auto rounded-md bg-zinc-800 px-1.5 py-0.5 font-mono text-[10px] text-zinc-400">
                P{item.phase}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );

  const brand = (
    <div className="flex items-center gap-3 border-b border-zinc-800/80 px-5 py-4">
      <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 shadow-md shadow-violet-900/40">
        <Sparkles className="size-5 text-white" />
      </div>
      <div>
        <div className="text-sm font-semibold tracking-tight text-zinc-50">Sara</div>
        <div className="text-[11px] text-zinc-500">Personal AI Agent</div>
      </div>
    </div>
  );

  return (
    <div className="min-h-dvh">
      {open ? (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-zinc-800/80 bg-zinc-900/70 backdrop-blur transition-transform duration-200 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {brand}
        {nav}
        <div className="border-t border-zinc-800/80 px-5 py-3 text-[11px] text-zinc-600">
          v0.2.0 · Phase 1 — Application scaffold
        </div>
      </aside>

      <div className="flex min-h-dvh flex-col lg:pl-72">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-zinc-800/80 bg-zinc-950/80 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-100 lg:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
          <span className="font-semibold tracking-tight lg:hidden">Sara</span>
          <div className="ml-auto">
            <StatusPill />
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>

        <footer className="border-t border-zinc-800/80 px-4 py-4 text-xs text-zinc-600 sm:px-6">
          Sara — personal AI agent · Phase 1 scaffold ·{" "}
          <Link
            href="https://github.com/muhammadlai/SARA"
            target="_blank"
            rel="noreferrer"
            className="text-zinc-500 underline-offset-4 hover:text-zinc-300 hover:underline"
          >
            GitHub
          </Link>
        </footer>
      </div>
    </div>
  );
}
