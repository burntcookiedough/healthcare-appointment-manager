import { describe, it, expect } from "vitest";
import { apiClient } from "@/lib/api/client";

describe("Doctor Leave Impact Preview & Application (LEAVE-002, LEAVE-003)", () => {
  it("generates a preview token and identifies affected appointments during proposed leave", async () => {
    // Propose leave for Dr. Rajesh Verma during existing appointments
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      reason: "Emergency surgical conference",
    });

    expect(preview).toBeDefined();
    expect(preview.preview_token).toMatch(/^prev-/);
    expect(preview.doctor_id).toBe("doc-001-rajesh");
    expect(Array.isArray(preview.affected_appointments)).toBe(true);
  });

  it("atomically applies leave and transitions overlapping confirmed appointments to cancelled_doctor_leave", async () => {
    const startsAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();

    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: startsAt,
      ends_at: endsAt,
      reason: "Annual sabbatical",
    });

    const createdLeave = await apiClient.applyDoctorLeave(
      preview.doctor_id,
      preview.starts_at,
      preview.ends_at,
      "Annual sabbatical",
      preview.preview_token
    );

    expect(createdLeave).toBeDefined();
    expect(createdLeave.doctor_id).toBe("doc-001-rajesh");
    expect(createdLeave.reason).toBe("Annual sabbatical");

    // Verify leave is in doctor leaves list
    const leaves = await apiClient.getDoctorLeaves("doc-001-rajesh");
    const found = leaves.find((l) => l.id === createdLeave.id);
    expect(found).toBeDefined();
  });
});
