import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Badge } from "../src/badge.js";
import { Card, CardContent, CardHeader } from "../src/card.js";
import { EmptyState } from "../src/empty-state.js";
import { ErrorState } from "../src/error-state.js";
import { PageHeader } from "../src/page-header.js";
import { PlaceholderFeature } from "../src/placeholder-feature.js";
import { Spinner } from "../src/spinner.js";
import { StatusDot } from "../src/status-dot.js";

describe("@sara/ui components", () => {
  it("Badge renders its content", () => {
    render(<Badge variant="accent">Phase 3</Badge>);
    expect(screen.getByText("Phase 3")).toBeInTheDocument();
  });

  it("Card renders header, content and children", () => {
    render(
      <Card>
        <CardHeader title="System status" description="Live view" />
        <CardContent>
          <p>inner content</p>
        </CardContent>
      </Card>,
    );
    expect(screen.getByText("System status")).toBeInTheDocument();
    expect(screen.getByText("Live view")).toBeInTheDocument();
    expect(screen.getByText("inner content")).toBeInTheDocument();
  });

  it("StatusDot renders a pulse indicator", () => {
    const { container } = render(<StatusDot tone="green" pulse />);
    expect(container.querySelector("span")?.className).toContain("relative");
    expect(container.querySelectorAll("span").length).toBeGreaterThanOrEqual(2);
  });

  it("Spinner is announced as loading", () => {
    render(<Spinner />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-label", "Loading");
  });

  it("EmptyState renders title, description and action", () => {
    render(
      <EmptyState
        title="No conversations yet"
        description="Chat arrives in Phase 3."
        action={<button type="button">Learn more</button>}
      />,
    );
    expect(screen.getByText("No conversations yet")).toBeInTheDocument();
    expect(screen.getByText(/Chat arrives in Phase 3/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Learn more" })).toBeInTheDocument();
  });

  it("ErrorState is an alert with a retry button", () => {
    let retried = 0;
    render(<ErrorState message="API unreachable" onRetry={() => (retried += 1)} />);
    expect(screen.getByRole("alert")).toHaveTextContent("API unreachable");
    screen.getByRole("button", { name: "Try again" }).click();
    expect(retried).toBe(1);
  });

  it("PageHeader renders title and badge", () => {
    render(
      <PageHeader
        title="Memory"
        badge={<Badge>Phase 4</Badge>}
        description="What Sara remembers."
      />,
    );
    expect(screen.getByRole("heading", { name: "Memory" })).toBeInTheDocument();
    expect(screen.getByText("Phase 4")).toBeInTheDocument();
  });

  it("PlaceholderFeature renders phase label and capability list", () => {
    render(
      <PlaceholderFeature
        icon={<span data-testid="icon" />}
        title="Chat with Sara"
        description="Streaming chat with the orchestrator."
        phaseLabel="Phase 3"
        points={["Streaming replies", "Conversation memory"]}
      />,
    );
    expect(screen.getByText("Chat with Sara")).toBeInTheDocument();
    expect(screen.getByText("Phase 3")).toBeInTheDocument();
    expect(screen.getByText("Streaming replies")).toBeInTheDocument();
    expect(screen.getByText("Conversation memory")).toBeInTheDocument();
  });
});
