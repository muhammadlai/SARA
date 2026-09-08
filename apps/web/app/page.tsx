import { Badge, PageHeader } from "@sara/ui";
import { FeatureGrid } from "@/components/feature-grid";
import { SaraCard } from "@/components/sara-card";
import { SystemStatusCard } from "@/components/system-status-card";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your personal AI agent — foundation online."
        badge={<Badge variant="accent">Phase 1 · Scaffold</Badge>}
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          <SaraCard />
          <FeatureGrid />
        </div>
        <div>
          <SystemStatusCard />
        </div>
      </div>
    </>
  );
}
