import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));
vi.mock("@/components/status-pill", () => ({
  StatusPill: () => <div data-testid="status-pill" />,
}));

import { Shell } from "../components/shell";

describe("Shell", () => {
  it("renders the full main navigation", () => {
    render(
      <Shell>
        <div>page content</div>
      </Shell>,
    );

    const labels = [
      "Dashboard",
      "Chat",
      "Tasks",
      "Memory",
      "Content Studio",
      "Social Media",
      "Avatar",
      "Voice",
      "Activity",
      "Integrations",
      "Settings",
    ];
    for (const label of labels) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0);
    }
    expect(screen.getByText("page content")).toBeInTheDocument();
    expect(screen.getByTestId("status-pill")).toBeInTheDocument();
  });

  it("highlights the active route and exposes the toggle button", () => {
    render(
      <Shell>
        <div />
      </Shell>,
    );
    const dashboard = screen.getByRole("link", { name: /Dashboard/ });
    expect(dashboard).toHaveAttribute("aria-current", "page");

    const toggle = screen.getByRole("button", { name: /navigation/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });
});
