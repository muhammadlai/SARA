import Link from "next/link";
import { Badge } from "@sara/ui";
import { NAV_ITEMS } from "@/lib/nav";

const SHORT_BLURBS: Record<string, string> = {
  "/chat": "Natural conversations with streaming replies and memory.",
  "/tasks": "Personal task system with reminders and schedules.",
  "/memory": "Preferences, long-term facts, full inspect/delete control.",
  "/content-studio": "Drafts, captions, hashtags and platform previews.",
  "/social-media": "Facebook, Instagram, YouTube, TikTok via official APIs.",
  "/avatar": "Animated character with expressions and lip sync.",
  "/voice": "Speech input and spoken replies.",
  "/activity": "Audit log of everything Sara does.",
  "/integrations": "Connect external platforms and providers.",
  "/settings": "Persona, permissions, safety controls.",
};

/** Quick links to every module, with the phase it arrives in. */
export function FeatureGrid() {
  const features = NAV_ITEMS.filter((item) => item.href !== "/");
  return (
    <section>
      <h2 className="mb-3 text-sm font-semibold text-zinc-300">Modules</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Link
              key={feature.href}
              href={feature.href}
              className="group rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-violet-500/40 hover:bg-zinc-900"
            >
              <div className="flex items-center justify-between">
                <Icon className="size-5 text-violet-300" />
                <Badge variant="outline">Phase {feature.phase}</Badge>
              </div>
              <div className="mt-3 text-sm font-medium text-zinc-100">{feature.label}</div>
              <p className="mt-1 text-xs leading-5 text-zinc-500">{SHORT_BLURBS[feature.href]}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
