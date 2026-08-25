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

    const currentVisit = await apiClient.getVisit("apt-003-completed");
    expect(currentVisit.id).toBe("vis-001-completed");
    const savedVisit = await apiClient.saveVisitDraft(
      currentVisit.id,
      "Updated notes",
      "Updated diagnosis",
      [],
      { expectedVersion: currentVisit.version }
    );

    await expect(
      apiClient.saveVisitDraft(currentVisit.id, "Stale notes", "Updated diagnosis", [], {
        expectedVersion: currentVisit.version,
      })
    ).rejects.toMatchObject({ status: 409 });

    await expect(
      apiClient.saveVisitDraft(currentVisit.id, "Current notes", "Updated diagnosis", [], {
        expectedVersion: savedVisit.version,
      })
    ).resolves.toMatchObject({ version: savedVisit.version + 1 });
  });

  it("ignores a completely blank prescription row while saving a draft", async () => {
    const visit = await apiClient.getOrCreateVisitForAppointment("apt-005-in-progress", "doc-001-rajesh");
    const saved = await apiClient.saveVisitDraft(
      visit.id,
      "Draft consultation notes",
      "Draft diagnosis",
      [
        {
          id: "blank-row",
          medication_name: "",
          dosage: "",
          route: null,
          frequency: "",
          start_date: "",
          duration_days: 0,
          instructions: "",
        },
      ],
      { expectedVersion: visit.version }
    );

    expect(saved.prescription?.items).toEqual([]);
  });

  it("keeps completion strict when a blank prescription row remains", async () => {
    const visit = await apiClient.getOrCreateVisitForAppointment("apt-005-in-progress", "doc-001-rajesh");

    await expect(
      apiClient.completeVisit(
        visit.id,
        "A sufficiently detailed clinical note.",
        "A valid diagnosis",
        [
          {
            id: "blank-row",
            medication_name: "",
            dosage: "",
            route: null,
            frequency: "",
            start_date: "",
            duration_days: 0,
            instructions: "",
          },
        ],
        "Follow up in two weeks",
        { expectedVersion: visit.version }
      )
    ).rejects.toMatchObject({ status: 422 });
  });
});
