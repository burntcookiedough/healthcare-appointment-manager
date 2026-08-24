import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { UrgencyBadge } from "@/components/common/UrgencyBadge";
import { apiClient } from "@/lib/api/client";

describe("Clinical truthfulness and optimistic-concurrency regressions", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    apiClient.reset();
  });

  it("renders the explicit soon urgency without silently relabeling it as routine", () => {
    render(<UrgencyBadge urgency="soon" />);

    expect(screen.getByText("Soon")).toBeInTheDocument();
    expect(screen.queryByText("Routine")).not.toBeInTheDocument();
  });

  it("renders an honest unavailable state for missing or unknown urgency", () => {
    const { rerender } = render(<UrgencyBadge urgency={null} />);

    expect(screen.getByText("Urgency unavailable")).toBeInTheDocument();
    rerender(<UrgencyBadge urgency="not-returned-by-api" />);
    expect(screen.getByText("Urgency unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Routine")).not.toBeInTheDocument();
  });

  it("requires the current visit version and accepts the returned version for the next draft", async () => {
    await expect(
      apiClient.saveVisitDraft("vis-001-completed", "Updated notes", "Updated diagnosis", [])
    ).rejects.toMatchObject({ status: 400 });

    const currentVisit = await apiClient.getVisit("vis-001-completed");
    const savedVisit = await apiClient.saveVisitDraft(
      "vis-001-completed",
      "Updated notes",
      "Updated diagnosis",
      [],
      { expectedVersion: currentVisit.version }
    );

    await expect(
      apiClient.saveVisitDraft("vis-001-completed", "Stale notes", "Updated diagnosis", [], {
        expectedVersion: currentVisit.version,
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      apiClient.saveVisitDraft("vis-001-completed", "Current notes", "Updated diagnosis", [], {
        expectedVersion: savedVisit.version,
      })
    ).resolves.toMatchObject({ version: savedVisit.version + 1 });
  });
});
