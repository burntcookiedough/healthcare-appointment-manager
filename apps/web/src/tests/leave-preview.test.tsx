import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { apiClient } from "@/lib/api/client";
import { DoctorLeave, AppointmentDetail, AdminIntegrationItem } from "@/types/api";

interface StateSnapshot {
  doctorScheduleVersion: number | null | undefined;
  leaves: DoctorLeave[];
  appointments: AppointmentDetail[];
  integrations: AdminIntegrationItem[];
  holdStatus?: string;
}

async function captureObservableSnapshot(
  doctorId: string,
  appointmentIds: string[] = ["apt-001-upcoming", "apt-002-today-doctor"],
  holdId?: string
): Promise<StateSnapshot> {
  const doc = await apiClient.getDoctorDetail(doctorId);
  const leaves = await apiClient.getDoctorLeaves(doctorId);
  const appointments = await Promise.all(
    appointmentIds.map((id) => apiClient.getAppointmentDetail(id))
  );
  const integrations = await apiClient.getAdminIntegrations();
  let holdStatus: string | undefined = undefined;
  if (holdId) {
    try {
      const hold = await apiClient.getHold(holdId);
      holdStatus = hold.status;
    } catch {
      holdStatus = undefined;
    }
  }
  return {
    doctorScheduleVersion: doc.schedule_version,
    leaves,
    appointments,
    integrations,
    holdStatus,
  };
}

function assertZeroMutation(before: StateSnapshot, after: StateSnapshot) {
  expect(after.doctorScheduleVersion).toBe(before.doctorScheduleVersion);
  expect(after.leaves).toEqual(before.leaves);
  expect(after.appointments).toEqual(before.appointments);
  expect(after.integrations).toEqual(before.integrations);
  if (before.holdStatus !== undefined) {
    expect(after.holdStatus).toBe(before.holdStatus);
  }
}

describe("Doctor Leave Impact Preview & Application (LEAVE-002, LEAVE-003, OUTBOX-001..003, DATA-001)", () => {
  beforeEach(() => {
    apiClient.reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("valid preview and apply: generates preview, validates version, cancels confirmed appointments, creates dual pending outbox items, and increments doctor schedule version", async () => {
    // Current doctor state before leave
    const initialDoc = await apiClient.getDoctorDetail("doc-001-rajesh");
    const initialVersion = initialDoc.schedule_version;
    if (typeof initialVersion !== "number") {
      throw new Error("The demo doctor fixture must expose a schedule version for leave tests.");
    }

    // Guaranteed overlapping range covering apt-001-upcoming and apt-002-today-doctor
    const startsAt = new Date(Date.now() - 3600 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
    const reason = "Specialist Cardiology Conference in Geneva";

    // Create an active hold in this window to verify hold release
    const hold = await apiClient.createHold({
      doctor_id: "doc-001-rajesh",
      starts_at: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      duration_minutes: 30,
    });
    expect(hold.status).toBe("active");

    // 1. Preview
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
    });

    expect(preview.preview_token).toMatch(/^prev-/);
    expect(preview.doctor_id).toBe("doc-001-rajesh");
    expect(preview.starts_at).toBe(startsAt);
    expect(preview.ends_at).toBe(endsAt);
    expect(preview.reason).toBe(reason);
    expect(preview.expected_schedule_version).toBe(initialVersion);
    expect(preview.affected_hold_count).toBeGreaterThanOrEqual(1);

    // Guaranteed affected confirmed appointments
    const affectedIds = preview.affected_appointment_ids ?? [];
    expect(affectedIds.length).toBeGreaterThan(0);
    expect(affectedIds).toContain("apt-001-upcoming");
    expect(affectedIds).toContain("apt-002-today-doctor");

    // 2. Apply with the production LeaveApplyRequest shape.
    const createdLeave = await apiClient.applyDoctorLeave(
      preview.doctor_id,
      preview.starts_at,
      preview.ends_at,
      preview.reason,
      {
        preview_token: preview.preview_token,
        expected_version: preview.expected_schedule_version,
      }
    );

    expect(createdLeave).toBeDefined();
    expect(createdLeave.doctor_id).toBe("doc-001-rajesh");
    expect(createdLeave.reason).toBe(reason);

    // 3. Verify Doctor schedule version incremented
    const updatedDoc = await apiClient.getDoctorDetail("doc-001-rajesh");
    expect(updatedDoc.schedule_version).toBe(initialVersion + 1);

    // 4. Verify Active Hold was released
    const updatedHold = await apiClient.getHold(hold.id);
    expect(updatedHold.status).toBe("released");

    // 5. Verify Only Confirmed appointments transitioned to cancelled_doctor_leave
    const apt1 = await apiClient.getAppointmentDetail("apt-001-upcoming");
    expect(apt1.status).toBe("cancelled_doctor_leave");
    expect(apt1.cancelled_by).toBe("admin_leave_manager");
    expect(apt1.cancellation_reason).toContain(reason);

    const apt2 = await apiClient.getAppointmentDetail("apt-002-today-doctor");
    expect(apt2.status).toBe("cancelled_doctor_leave");

    // Verify non-confirmed overlapping appointments remained unchanged
    const inProgApt = await apiClient.getAppointmentDetail("apt-005-in-progress");
    expect(inProgApt.status).toBe("in_progress");

    const completedApt = await apiClient.getAppointmentDetail("apt-006-completed-doc1");
    expect(completedApt.status).toBe("completed");

    const cancelledApt = await apiClient.getAppointmentDetail("apt-007-cancelled-patient");
    expect(cancelledApt.status).toBe("cancelled_patient");

    // 6. Verify Outbox Records: exactly 1 pending email and 1 pending calendar per cancelled appointment
    const integrations = await apiClient.getAdminIntegrations();
    for (const aptId of affectedIds) {
      const emailTasks = integrations.filter(
        (i) => i.target_id === aptId && i.channel === "email" && i.state === "pending"
      );
      const calTasks = integrations.filter(
        (i) => i.target_id === aptId && i.channel === "calendar" && i.state === "pending"
      );

      expect(emailTasks.length).toBe(1);
      expect(calTasks.length).toBe(1);

      const emailTask = emailTasks[0];
      const calTask = calTasks[0];

      // Must be pending, attempt_count 0, last_attempt_at not set
      expect(emailTask.state).toBe("pending");
      expect(emailTask.attempt_count).toBe(0);
      expect(emailTask.last_attempt_at).toBeUndefined();
      expect(emailTask.payload_summary).not.toContain("Aarav");
      expect(emailTask.payload_summary).not.toContain("Priya");
      expect(emailTask.payload_summary).toBe("Doctor-leave appointment cancellation notification queued.");

      expect(calTask.state).toBe("pending");
      expect(calTask.attempt_count).toBe(0);
      expect(calTask.last_attempt_at).toBeUndefined();
      expect(calTask.payload_summary).not.toContain("Aarav");
      expect(calTask.payload_summary).not.toContain("Priya");
      expect(calTask.payload_summary).toBe("Doctor-leave appointment cancellation notification queued.");
    }
  });

  it("rejects application with missing or nonexistent preview token with status 409 LEAVE_PREVIEW_STALE and zero mutation", async () => {
    const beforeSnapshot = await captureObservableSnapshot("doc-001-rajesh");

    let err: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        "doc-001-rajesh",
        new Date().toISOString(),
        new Date(Date.now() + 3600 * 1000).toISOString(),
        "Nonexistent token leave",
        {
          preview_token: "prev-nonexistent-token-12345",
          expected_version: 1,
        }
      );
    } catch (e: unknown) {
      err = e as { status?: number; error?: { code?: string } };
    }

    expect(err).toBeDefined();
    expect(err?.status).toBe(409);
    expect(err?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    // Zero mutation check across schedule version, leaves, appointments, integrations
    const afterSnapshot = await captureObservableSnapshot("doc-001-rajesh");
    assertZeroMutation(beforeSnapshot, afterSnapshot);
  });

  it("rejects reused preview token with status 409 LEAVE_PREVIEW_STALE and zero subsequent mutation", async () => {
    const startsAt = new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const endsAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const reason = "Sabbatical leave";

    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
    });

    // 1st application succeeds
    await apiClient.applyDoctorLeave(
      preview.doctor_id,
      preview.starts_at,
      preview.ends_at,
      reason,
      {
        preview_token: preview.preview_token,
        expected_version: preview.expected_schedule_version,
      }
    );

    const snapshotAfterFirst = await captureObservableSnapshot("doc-001-rajesh");

    // 2nd application with same token must fail
    let replayErr: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        preview.doctor_id,
        preview.starts_at,
        preview.ends_at,
        reason,
        {
          preview_token: preview.preview_token,
        expected_version: preview.expected_schedule_version,
        }
      );
    } catch (e: unknown) {
      replayErr = e as { status?: number; error?: { code?: string } };
    }

    expect(replayErr).toBeDefined();
    expect(replayErr?.status).toBe(409);
    expect(replayErr?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    // Zero mutation check after rejected second application
    const snapshotAfterSecond = await captureObservableSnapshot("doc-001-rajesh");
    assertZeroMutation(snapshotAfterFirst, snapshotAfterSecond);
  });

  it("rejects expired preview token after 15 minutes TTL using controlled Date.now spy with zero mutation", async () => {
    const realNow = Date.now();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(realNow);

    // Create a hold to test hold status remains active upon rejection
    const hold = await apiClient.createHold({
      doctor_id: "doc-001-rajesh",
      starts_at: new Date(realNow + 50 * 3600 * 1000).toISOString(),
      duration_minutes: 30,
    });

    const startsAt = new Date(realNow + 48 * 3600 * 1000).toISOString();
    const endsAt = new Date(realNow + 72 * 3600 * 1000).toISOString();
    const reason = "Conference leave";

    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
    });

    // Advance mock Date.now by 16 minutes (beyond 15-minute TTL)
    nowSpy.mockReturnValue(realNow + 16 * 60 * 1000);

    const beforeSnapshot = await captureObservableSnapshot(
      "doc-001-rajesh",
      ["apt-001-upcoming", "apt-002-today-doctor"],
      hold.id
    );

    let expiredErr: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        preview.doctor_id,
        preview.starts_at,
        preview.ends_at,
        reason,
        {
          preview_token: preview.preview_token,
          expected_version: preview.expected_schedule_version,
        }
      );
    } catch (e: unknown) {
      expiredErr = e as { status?: number; error?: { code?: string } };
    }

    expect(expiredErr).toBeDefined();
    expect(expiredErr?.status).toBe(409);
    expect(expiredErr?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    const afterSnapshot = await captureObservableSnapshot(
      "doc-001-rajesh",
      ["apt-001-upcoming", "apt-002-today-doctor"],
      hold.id
    );
    assertZeroMutation(beforeSnapshot, afterSnapshot);

    nowSpy.mockRestore();
  });

  it("rejects mismatched doctor_id with LEAVE_PREVIEW_STALE and zero mutation", async () => {
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      reason: "Research workshop",
    });

    const beforeDoc1 = await captureObservableSnapshot("doc-001-rajesh");
    const beforeDoc2 = await captureObservableSnapshot("doc-002-ananya");

    let err: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        "doc-002-ananya", // Mismatched doctor
        preview.starts_at,
        preview.ends_at,
        preview.reason,
        {
          preview_token: preview.preview_token,
          expected_version: preview.expected_schedule_version,
        }
      );
    } catch (e: unknown) {
      err = e as { status?: number; error?: { code?: string } };
    }

    expect(err).toBeDefined();
    expect(err?.status).toBe(409);
    expect(err?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    const afterDoc1 = await captureObservableSnapshot("doc-001-rajesh");
    const afterDoc2 = await captureObservableSnapshot("doc-002-ananya");
    assertZeroMutation(beforeDoc1, afterDoc1);
    assertZeroMutation(beforeDoc2, afterDoc2);
  });

  it("rejects mismatched start time with LEAVE_PREVIEW_STALE and zero mutation", async () => {
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      reason: "Research workshop",
    });

    const beforeSnapshot = await captureObservableSnapshot("doc-001-rajesh");

    let err: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        preview.doctor_id,
        new Date(Date.now() + 50 * 3600 * 1000).toISOString(), // Mismatched starts_at
        preview.ends_at,
        preview.reason,
        {
          preview_token: preview.preview_token,
          expected_version: preview.expected_schedule_version,
        }
      );
    } catch (e: unknown) {
      err = e as { status?: number; error?: { code?: string } };
    }

    expect(err).toBeDefined();
    expect(err?.status).toBe(409);
    expect(err?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    const afterSnapshot = await captureObservableSnapshot("doc-001-rajesh");
    assertZeroMutation(beforeSnapshot, afterSnapshot);
  });

  it("rejects mismatched end time with LEAVE_PREVIEW_STALE and zero mutation", async () => {
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      reason: "Research workshop",
    });

    const beforeSnapshot = await captureObservableSnapshot("doc-001-rajesh");

    let err: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        preview.doctor_id,
        preview.starts_at,
        new Date(Date.now() + 80 * 3600 * 1000).toISOString(), // Mismatched ends_at
        preview.reason,
        {
          preview_token: preview.preview_token,
          expected_version: preview.expected_schedule_version,
        }
      );
    } catch (e: unknown) {
      err = e as { status?: number; error?: { code?: string } };
    }

    expect(err).toBeDefined();
    expect(err?.status).toBe(409);
    expect(err?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    const afterSnapshot = await captureObservableSnapshot("doc-001-rajesh");
    assertZeroMutation(beforeSnapshot, afterSnapshot);
  });

  it("rejects mismatched reason with LEAVE_PREVIEW_STALE and zero mutation", async () => {
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      reason: "Original reason",
    });

    const beforeSnapshot = await captureObservableSnapshot("doc-001-rajesh");

    let err: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        preview.doctor_id,
        preview.starts_at,
        preview.ends_at,
        "Changed reason without regenerating preview", // Mismatched reason
        {
          preview_token: preview.preview_token,
          expected_version: preview.expected_schedule_version,
        }
      );
    } catch (e: unknown) {
      err = e as { status?: number; error?: { code?: string } };
    }

    expect(err).toBeDefined();
    expect(err?.status).toBe(409);
    expect(err?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    const afterSnapshot = await captureObservableSnapshot("doc-001-rajesh");
    assertZeroMutation(beforeSnapshot, afterSnapshot);
  });

  it("rejects mismatched expected_version with LEAVE_PREVIEW_STALE and zero mutation", async () => {
    const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
      reason: "Annual retreat",
    });

    const beforeSnapshot = await captureObservableSnapshot("doc-001-rajesh");

    let err: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        preview.doctor_id,
        preview.starts_at,
        preview.ends_at,
        preview.reason,
        {
          preview_token: preview.preview_token,
          expected_version: 999, // Mismatched schedule version
        }
      );
    } catch (e: unknown) {
      err = e as { status?: number; error?: { code?: string } };
    }

    expect(err).toBeDefined();
    expect(err?.status).toBe(409);
    expect(err?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    const afterSnapshot = await captureObservableSnapshot("doc-001-rajesh");
    assertZeroMutation(beforeSnapshot, afterSnapshot);
  });

  it("token becomes stale if doctor schedule version changes before application (concurrent modification) with zero additional mutation", async () => {
    // Generate Preview A
    const previewA = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 100 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 120 * 3600 * 1000).toISOString(),
      reason: "Leave A",
    });

    // An intervening leave operation is committed, bumping doc-001 schedule version
    const previewIntervening = await apiClient.previewDoctorLeave("doc-001-rajesh", {
      starts_at: new Date(Date.now() + 200 * 3600 * 1000).toISOString(),
      ends_at: new Date(Date.now() + 220 * 3600 * 1000).toISOString(),
      reason: "Intervening leave",
    });

    await apiClient.applyDoctorLeave(
      previewIntervening.doctor_id,
      previewIntervening.starts_at,
      previewIntervening.ends_at,
      previewIntervening.reason,
      {
        preview_token: previewIntervening.preview_token,
        expected_version: previewIntervening.expected_schedule_version,
      }
    );

    // Snapshot observable state after the legitimate intervening mutation
    const snapshotAfterIntervening = await captureObservableSnapshot("doc-001-rajesh");

    // Now applying Preview A must fail because doctor's current schedule version changed
    let staleErr: { status?: number; error?: { code?: string } } | null = null;
    try {
      await apiClient.applyDoctorLeave(
        previewA.doctor_id,
        previewA.starts_at,
        previewA.ends_at,
        previewA.reason,
        {
          preview_token: previewA.preview_token,
          expected_version: previewA.expected_schedule_version,
        }
      );
    } catch (e: unknown) {
      staleErr = e as { status?: number; error?: { code?: string } };
    }

    expect(staleErr).toBeDefined();
    expect(staleErr?.status).toBe(409);
    expect(staleErr?.error?.code).toBe("LEAVE_PREVIEW_STALE");

    // Verify zero additional mutation occurred from rejected stale application
    const snapshotAfterStaleAttempt = await captureObservableSnapshot("doc-001-rajesh");
    assertZeroMutation(snapshotAfterIntervening, snapshotAfterStaleAttempt);
  });
});
