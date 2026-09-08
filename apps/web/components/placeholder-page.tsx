import { Badge, EmptyState, PageHeader, PlaceholderFeature } from "@sara/ui";
import { getPlaceholderPage } from "@/lib/placeholders";

/**
 * Shared renderer for module placeholder pages: a real header, a concrete
 * description of what the module will do, and a clean empty state — so future
 * phases replace content, never plumbing.
 */
export function PlaceholderPageView({ pathname }: { pathname: string }) {
  const page = getPlaceholderPage(pathname);
  const Icon = page.icon;
  return (
    <>
      <PageHeader
        title={page.title}
        description={page.description}
        badge={<Badge variant="accent">Phase {page.phase}</Badge>}
      />
      <PlaceholderFeature
        icon={<Icon className="size-6" />}
        title={`${page.title} — arriving in Phase ${page.phase}`}
        description={`This module is part of the Sara roadmap (see DEVELOPMENT_PLAN.md). The route, layout and navigation are already wired, so Phase ${page.phase} plugs functionality straight in.`}
        phaseLabel={`Phase ${page.phase}`}
        points={page.points}
      />
      <div className="mt-6">
        <EmptyState
          title="Nothing here yet — by design"
          description={`"${page.title}" ships in Phase ${page.phase}. Phases are built one at a time so the app always stays runnable.`}
        />
      </div>
    </>
  );
}
