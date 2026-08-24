import { describe, it, expect } from "vitest";
import { apiClient } from "@/lib/api/client";
import { PrescriptionItem } from "@/types/api";

describe("Structured Prescriptions and Deterministic Reminders (RX-001, RX-002)", () => {
  it("completes a clinical visit with structured prescription items and persists them", async () => {
    const items: PrescriptionItem[] = [
      {
        id: "test-rx-1",
        medication_name: "Metformin Hydrochloride",
        dosage: "500mg",
        route: "Oral",
        frequency: "twice_daily",
        start_date: "2026-08-24",
        duration_days: 30,
        instructions: "Take with breakfast and dinner",
      },
      {
        id: "test-rx-2",
        medication_name: "Atorvastatin Calcium",
        dosage: "10mg",
        route: "Oral",
        frequency: "once_daily",
        start_date: "2026-08-24",
        duration_days: 30,
        instructions: "Take at night",
      },
    ];

    const completed = await apiClient.completeVisit(
      "vis-001-completed",
      "Comprehensive cardiometabolic consultation notes.",
      "Type 2 Diabetes Mellitus with Dyslipidemia (E11.69)",
      items,
      "Follow up with HbA1c in 3 months",
      { expectedVersion: 1 }
    );

    expect(completed.status).toBe("completed");
    expect(completed.prescription?.items).toHaveLength(2);
    expect(completed.prescription?.items[0].medication_name).toBe("Metformin Hydrochloride");
  });

  it("derives deterministic reminder times from structured frequency without parsing prose (RX-002)", async () => {
    const reminders = await apiClient.getPatientReminders("pat-001-aarav");
    expect(reminders.length).toBeGreaterThan(0);

    // Verify derived timing fields
    const morningReminders = reminders.filter((r) => r.time_of_day.includes("09:00 AM"));
    expect(morningReminders.length).toBeGreaterThan(0);

    // Verify structured dosage is attached
    for (const rem of reminders) {
      expect(rem.medication_name).toBeDefined();
      expect(rem.dosage).toBeDefined();
      expect(rem.time_of_day).toMatch(/AM|PM/);
    }
  });
});
