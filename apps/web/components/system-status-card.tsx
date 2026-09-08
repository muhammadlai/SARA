"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, CardContent, CardHeader, ErrorState, Spinner, StatusDot } from "@sara/ui";
import { fetchHealth, formatUptime, type HealthView } from "@/lib/health";

const POLL_MS = 30_000;

/**
 * Dashboard system status: live API health, version, database state and
 * uptime — with explicit loading, degraded, offline and retry states. This is
 * the visible proof of the frontend ⇄ backend connection.
 */
export function SystemStatusCard() {
  const [view, setView] = useState<HealthView>({
    status: "online" as HealthView["status"],
  } as HealthView);
  const [checked, setChecked] = useState(false);

  const refresh = useCallback(async () => {
    const next = await fetchHealth();
    setView(next);
    setChecked(true);
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [refresh]);

  if (!checked) {
    return (
      <Card>
        <CardHeader title="System status" description="Checking the API service…" />
        <CardContent>
          <div className="flex items-center gap-2.5 py-6 text-sm text-zinc-400">
            <Spinner className="size-4 text-violet-300" />
            Connecting to Sara API…
          </div>
        </CardContent>
      </Card>
    );
  }

  if (view.status === "offline") {
    return (
      <Card>
        <CardHeader title="System status" actions={<StatusDot tone="red" />} />
        <CardContent>
          <ErrorState
            title="API unreachable"
            message={view.error ?? "Could not reach the Sara API service."}
            onRetry={() => void refresh()}
          />
        </CardContent>
      </Card>
    );
  }

  const online = view.status === "online";
  const health = view.health;
  const db = health?.checks.database;

  return (
    <Card>
      <CardHeader
        title="System status"
        description="Live API + infrastructure health"
        actions={<StatusDot tone={online ? "green" : "amber"} pulse />}
      />
      <CardContent>
        <dl className="space-y-3 text-sm">
          <Row label="API service">
            <Badge variant={online ? "success" : "warning"}>{online ? "Online" : "Degraded"}</Badge>
          </Row>
          <Row label="Response time">
            <span className="text-zinc-300">{view.latencyMs} ms</span>
          </Row>
          <Row label="API version">
            <span className="font-mono text-xs text-zinc-300">{health?.version}</span>
          </Row>
          <Row label="Database">
            {db?.status === "up" ? (
              <Badge variant="success">Connected</Badge>
            ) : db?.status === "down" ? (
              <Badge variant="danger">Unreachable</Badge>
            ) : (
              <Badge variant="default">Not configured · Phase 2</Badge>
            )}
          </Row>
          <Row label="Uptime">
            <span className="text-zinc-300">
              {health ? formatUptime(health.uptimeSeconds) : "—"}
            </span>
          </Row>
        </dl>
      </CardContent>
    </Card>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium text-zinc-200">{children}</dd>
    </div>
  );
}
