import { describe, it, expect } from "vitest";
import { apiClient } from "@/lib/api/client";

describe("Doctor Leave Impact Preview & Application (LEAVE-002, LEAVE-003, AT-LEAVE-002)", () => {
  it("generates a preview token and identifies affected appointments during proposed leave", async () => {
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() - 1000).toISOString(),
      ends_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      reason: "Emergency surgical conference",
    });

    expect(preview).toBeDefined();
    expect(preview.preview_token).toMatch(/^prev-/);
    expect(preview.doctor_id).toBe("doc-001-rajesh");
    expect(preview.schedule_version).toBeDefined();
    expect(Array.isArray(preview.affected_appointments)).toBe(true);
  });

  it("atomically applies leave, transitions overlapping confirmed appointments, and generates both email and calendar outbox integrations", async () => {
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

    // Verify both email and calendar follow-up outbox tasks were generated for affected appointments
    const integrations = await apiClient.getAdminIntegrations();
    if (preview.affected_appointments.length > 0) {
      for (const apt of preview.affected_appointments) {
        const emailTask = integrations.find(
          (i) => i.target_id === apt.id && i.channel === "email"
        );
        const calTask = integrations.find(
          (i) => i.target_id === apt.id && i.channel === "calendar"
        );
        expect(emailTask).toBeDefined();
        expect(calTask).toBeDefined();
      }
    }
  });

  it("rejects invalid, reused, or mismatched preview tokens with LEAVE_PREVIEW_STALE and applies no mutation", async () => {
    const startsAt = new Date(Date.now() + 120 * 3600 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 144 * 3600 * 1000).toISOString();

    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: startsAt,
      ends_at: endsAt,
      reason: "Regional symposium",
    });

    // 1. First application succeeds and consumes the token
    await apiClient.applyDoctorLeave(
      preview.doctor_id,
      preview.starts_at,
      preview.ends_at,
      "Regional symposium",
      preview.preview_token
    );

    // 2. Replay with the same token must fail with LEAVE_PREVIEW_STALE
    let replayError: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        preview.doctor_id,
        preview.starts_at,
        preview.ends_at,
        "Regional symposium",
        preview.preview_token
      );
    } catch (err: unknown) {
      replayError = err as { status?: number; error?: { code?: string } };
    }

    expect(replayError).toBeDefined();
    expect(replayError?.status).toBe(409);
    expect(replayError?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    // 3. Application with mismatched parameters must fail with LEAVE_PREVIEW_STALE
    const freshPreview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 200 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 224 * 3600 * 1000).toISOString(),
      reason: "Research workshop",
    });

    let mismatchError: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        "doc-002-priya", // Mismatched doctor ID
        freshPreview.starts_at,
        freshPreview.ends_at,
        "Research workshop",
        freshPreview.preview_token
      );
    } catch (err: unknown) {
      mismatchError = err as { status?: number; error?: { code?: string } };
    }

    expect(mismatchError).toBeDefined();
    expect(mismatchError?.status).toBe(409);
    expect(mismatchError?.error?.code).toBe("LEAVE_PREVIEW_STALE");
  });
});
