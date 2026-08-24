/**
 * Focused Contract-Integration Verification Suite.
 * Validates executable FastAPI HTTP wire contracts, payload structures, idempotency key lifecycles,
 * auth boundaries, and error envelope handling.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { apiClient, setApiAuthToken } from "@/lib/api/client";
import { setStoredSession, clearStoredSession } from "@/features/auth/supabase-auth";

describe("FastAPI Contract Integration & Wire Accuracy Suite", () => {
  const originalEnv = { ...process.env };
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clearStoredSession();
    setApiAuthToken(null);
    globalThis.fetch = mockFetch;

    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    process.env.NEXT_PUBLIC_API_BASE_URL = "http://127.0.0.1:8000";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://mock.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("1. Doctor search uses ?search= parameter and parses { items, next_cursor } collection envelope", async () => {
    setApiAuthToken("valid-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            id: "doc-101",
            version: 1,
            created_at: "2026-08-24T00:00:00Z",
            updated_at: "2026-08-24T00:00:00Z",
            display_name: "Dr. Ananya Rao",
            credentials: "MBBS, MD",
            specialization: "Cardiology",
            timezone: "Asia/Kolkata",
            appointment_durations_minutes: [30],
            is_active: true,
            avatar_url: null,
            biography: "Cardiology expert.",
            next_available_at: "2026-08-25T09:00:00Z",
          },
        ],
        next_cursor: null,
      }),
    });

    const doctors = await apiClient.getDoctors("Cardio");

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/doctors");
    expect(url).toContain("search=Cardio");
    expect(url).not.toContain("query=");
    expect(init.headers["Authorization"]).toBe("Bearer valid-token");
    expect(doctors).toHaveLength(1);
    expect(doctors[0].id).toBe("doc-101");
    expect(doctors[0].display_name).toBe("Dr. Ananya Rao");
  });

  it("2. Doctor discovery requires authentication token in production mode", async () => {
    setApiAuthToken(null);
    clearStoredSession();

    await expect(apiClient.getDoctors()).rejects.toMatchObject({
      status: 401,
      error: { code: "AUTHENTICATION_REQUIRED" },
    });

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("3. Health live and ready endpoints are public without token", async () => {
    setApiAuthToken(null);
    clearStoredSession();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });

    const liveRes = await apiClient.getHealthLive();
    expect(liveRes).toEqual({ status: "ok" });
    expect(mockFetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/health/live");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "ok" }),
    });

    const readyRes = await apiClient.getHealthReady();
    expect(readyRes).toEqual({ status: "ok" });
    expect(mockFetch.mock.calls[1][0]).toBe("http://127.0.0.1:8000/api/v1/health/ready");
  });

  it("4. Doctor availability unwraps { items, next_cursor } envelope cleanly", async () => {
    setApiAuthToken("valid-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        items: [
          {
            doctor_id: "doc-101",
            starts_at: "2026-08-25T09:00:00+05:30",
            ends_at: "2026-08-25T09:30:00+05:30",
            available: true,
            conflict_reason: null,
          },
          {
            doctor_id: "doc-101",
            starts_at: "2026-08-25T09:30:00+05:30",
            ends_at: "2026-08-25T10:00:00+05:30",
            available: false,
            conflict_reason: "booked",
          },
        ],
        next_cursor: null,
      }),
    });

    const slots = await apiClient.getDoctorAvailability("doc-101", new Date("2026-08-25T00:00:00Z"), 30);
    expect(slots).toHaveLength(2);
    expect(slots[0].available).toBe(true);
    expect(slots[1].available).toBe(false);
  });

  it("5. Hold creation sends required fields and an Idempotency-Key header", async () => {
    setApiAuthToken("valid-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: "hld-555",
        version: 1,
        created_at: "2026-08-24T10:00:00Z",
        updated_at: "2026-08-24T10:00:00Z",
        patient_id: "pat-001",
        doctor_id: "doc-101",
        starts_at: "2026-08-25T09:00:00Z",
        ends_at: "2026-08-25T09:30:00Z",
        status: "active",
        expires_at: "2026-08-24T10:05:00Z",
      }),
    });

    const hold = await apiClient.createHold({
      doctor_id: "doc-101",
      starts_at: "2026-08-25T09:00:00Z",
      duration_minutes: 30,
    });

    expect(hold.id).toBe("hld-555");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/api/v1/holds");
    expect(init.method).toBe("POST");
    const idemKey = init.headers["Idempotency-Key"];
    expect(idemKey).toBeDefined();
    expect(idemKey.length).toBeGreaterThanOrEqual(16);
    expect(idemKey.length).toBeLessThanOrEqual(128);
    expect(/^[\x21-\x7e]+$/.test(idemKey)).toBe(true);
  });

  it("6. DELETE /holds/{id} handles 204 No Content without JSON parsing errors", async () => {
    setApiAuthToken("valid-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 204,
      statusText: "No Content",
      text: async () => "",
    });

    await expect(apiClient.releaseHold("hld-555")).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/api/v1/holds/hld-555");
    expect(init.method).toBe("DELETE");
    expect(init.headers["Idempotency-Key"]).toBeDefined();
  });

  it("7. Appointment cancellation passes expected_version, reason_code, and note with Idempotency-Key", async () => {
    setApiAuthToken("valid-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "apt-123",
        version: 2,
        patient_id: "pat-001",
        doctor_id: "doc-101",
        starts_at: "2026-08-25T09:00:00Z",
        ends_at: "2026-08-25T09:30:00Z",
        status: "cancelled_patient",
        urgency: null,
        created_at: "2026-08-24T10:00:00Z",
        updated_at: "2026-08-24T10:02:00Z",
      }),
    });

    const res = await apiClient.cancelAppointment(
      "apt-123",
      "Unable to attend due to work",
      "patient",
      { expectedVersion: 1 }
    );

    expect(res.status).toBe("cancelled_patient");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/api/v1/appointments/apt-123/cancel");
    expect(init.method).toBe("POST");
    expect(init.headers["Idempotency-Key"]).toBeDefined();
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      expected_version: 1,
      reason_code: "patient_request",
      note: "Unable to attend due to work",
    });
  });

  it("8. Appointment reschedule passes expected_version, starts_at, and duration_minutes", async () => {
    setApiAuthToken("valid-token");
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "apt-123",
        version: 2,
        patient_id: "pat-001",
        doctor_id: "doc-101",
        starts_at: "2026-08-26T11:00:00Z",
        ends_at: "2026-08-26T11:30:00Z",
        status: "confirmed",
        urgency: null,
        created_at: "2026-08-24T10:00:00Z",
        updated_at: "2026-08-24T10:05:00Z",
      }),
    });

    await apiClient.rescheduleAppointment("apt-123", "2026-08-26T11:00:00Z", 30, {
      expectedVersion: 1,
    });

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:8000/api/v1/appointments/apt-123/reschedule");
    expect(init.method).toBe("POST");
    expect(init.headers["Idempotency-Key"]).toBeDefined();
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      expected_version: 1,
      starts_at: "2026-08-26T11:00:00Z",
      duration_minutes: 30,
    });
  });

  it("9. Clinical visit fetches via GET /appointments/{id}/visit and mutates via /visits/{id}", async () => {
    setApiAuthToken("valid-token");

    // 1. GET visit
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "vis-999",
        appointment_id: "apt-123",
        doctor_id: "doc-101",
        status: "draft",
        version: 1,
        urgency: "routine",
        notes: [{ id: "not-1", version: 1, notes_text: "Initial consultation", created_at: "2026-08-24T10:00:00Z" }],
        prescription: null,
        generated_artifacts: [],
        created_at: "2026-08-24T10:00:00Z",
        updated_at: "2026-08-24T10:00:00Z",
      }),
    });

    const visit = await apiClient.getVisit("apt-123");
    expect(visit.id).toBe("vis-999");
    expect(mockFetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/appointments/apt-123/visit");

    // 2. PATCH visit draft
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "vis-999",
        appointment_id: "apt-123",
        doctor_id: "doc-101",
        status: "draft",
        version: 2,
        notes: [{ id: "not-2", version: 2, notes_text: "Updated notes", created_at: "2026-08-24T10:05:00Z" }],
        prescription: null,
        generated_artifacts: [],
        created_at: "2026-08-24T10:00:00Z",
        updated_at: "2026-08-24T10:05:00Z",
      }),
    });

    await apiClient.saveVisitDraft("vis-999", "Updated notes", "Hypertension", [], { expectedVersion: 1 });
    const patchInit = mockFetch.mock.calls[1][1];
    expect(mockFetch.mock.calls[1][0]).toBe("http://127.0.0.1:8000/api/v1/visits/vis-999");
    expect(patchInit.method).toBe("PATCH");
    const patchBody = JSON.parse(patchInit.body);
    expect(patchBody.expected_version).toBe(1);
    expect(patchBody.notes_text).toBe("Updated notes");

    // 3. Complete visit
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "vis-999",
        appointment_id: "apt-123",
        doctor_id: "doc-101",
        status: "completed",
        version: 3,
        notes: [{ id: "not-2", version: 2, notes_text: "Updated notes", created_at: "2026-08-24T10:05:00Z" }],
        prescription: null,
        generated_artifacts: [],
        created_at: "2026-08-24T10:00:00Z",
        updated_at: "2026-08-24T10:10:00Z",
        completed_at: "2026-08-24T10:10:00Z",
      }),
    });

    await apiClient.completeVisit("vis-999", undefined, undefined, undefined, undefined, { expectedVersion: 2 });
    const completeInit = mockFetch.mock.calls[2][1];
    expect(mockFetch.mock.calls[2][0]).toBe("http://127.0.0.1:8000/api/v1/visits/vis-999/complete");
    expect(completeInit.method).toBe("POST");
    expect(completeInit.headers["Idempotency-Key"]).toBeDefined();
    const completeBody = JSON.parse(completeInit.body);
    expect(completeBody.expected_version).toBe(2);
  });

  it("10. The same Idempotency-Key is preserved across an automatic 401 token refresh retry", async () => {
    setStoredSession({
      access_token: "expired-token",
      refresh_token: "valid-refresh-token",
      expires_in: 3600,
      expires_at: Date.now() - 1000,
      token_type: "bearer",
      user: { id: "u-patient", email: "patient@example.com" },
    });
    setApiAuthToken("expired-token");

    // First attempt -> 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ error: { code: "AUTHENTICATION_REQUIRED", message: "Token expired" } }),
    });

    // Supabase refresh endpoint
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "new-valid-token",
        refresh_token: "new-refresh-token",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "u-patient", email: "patient@example.com" },
      }),
    });

    // Retried request with refreshed token -> 201
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({
        id: "hld-777",
        version: 1,
        created_at: "2026-08-24T10:00:00Z",
        updated_at: "2026-08-24T10:00:00Z",
        patient_id: "pat-001",
        doctor_id: "doc-101",
        starts_at: "2026-08-25T09:00:00Z",
        ends_at: "2026-08-25T09:30:00Z",
        status: "active",
        expires_at: "2026-08-24T10:05:00Z",
      }),
    });

    const hold = await apiClient.createHold({
      doctor_id: "doc-101",
      starts_at: "2026-08-25T09:00:00Z",
      duration_minutes: 30,
    });

    expect(hold.id).toBe("hld-777");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    const firstAttemptHeaders = mockFetch.mock.calls[0][1].headers;
    const retryAttemptHeaders = mockFetch.mock.calls[2][1].headers;

    expect(firstAttemptHeaders["Authorization"]).toBe("Bearer expired-token");
    expect(retryAttemptHeaders["Authorization"]).toBe("Bearer new-valid-token");

    // Idempotency keys must be non-empty and EXACTLY identical
    const key1 = firstAttemptHeaders["Idempotency-Key"];
    const key2 = retryAttemptHeaders["Idempotency-Key"];
    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
    expect(key1).toBe(key2);
  });

  it("11. Two distinct user mutation intents generate two distinct Idempotency-Keys", async () => {
    setApiAuthToken("valid-token");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "hld-1", version: 1, status: "active" }),
    });
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 201,
      json: async () => ({ id: "hld-2", version: 1, status: "active" }),
    });

    await apiClient.createHold({ doctor_id: "doc-1", starts_at: "2026-08-25T09:00:00Z", duration_minutes: 30 });
    await apiClient.createHold({ doctor_id: "doc-2", starts_at: "2026-08-25T10:00:00Z", duration_minutes: 30 });

    const key1 = mockFetch.mock.calls[0][1].headers["Idempotency-Key"];
    const key2 = mockFetch.mock.calls[1][1].headers["Idempotency-Key"];

    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
    expect(key1).not.toBe(key2);
  });

  it("12. Structured domain error codes (SLOT_CONFLICT, VERSION_CONFLICT) are preserved in error objects", async () => {
    setApiAuthToken("valid-token");

    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({
        error: {
          code: "SLOT_CONFLICT",
          message: "The requested time slot has already been reserved.",
        },
        request_id: "req-conflict-999",
      }),
    });

    await expect(
      apiClient.createHold({ doctor_id: "doc-1", starts_at: "2026-08-25T09:00:00Z", duration_minutes: 30 })
    ).rejects.toMatchObject({
      status: 409,
      error: {
        code: "SLOT_CONFLICT",
        message: "The requested time slot has already been reserved.",
      },
      request_id: "req-conflict-999",
    });
  });

  it("13. Reminders and integration retry contracts adhere to expected_version and wire schemas", async () => {
    setApiAuthToken("valid-token");

    // Reminder preferences
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        patient_id: "pat-001",
        version: 2,
        enabled: true,
        channel: "email",
        timezone: "Asia/Kolkata",
        local_times: ["08:00:00", "20:00:00"],
        created_at: "2026-08-24T00:00:00Z",
        updated_at: "2026-08-24T12:00:00Z",
      }),
    });

    const pref = await apiClient.updateReminderPreferences({
      expected_version: 1,
      enabled: true,
      channel: "email",
      timezone: "Asia/Kolkata",
      local_times: ["08:00:00", "20:00:00"],
    });

    expect(pref.version).toBe(2);
    expect(mockFetch.mock.calls[0][0]).toBe("http://127.0.0.1:8000/api/v1/me/reminder-preferences");
    expect(mockFetch.mock.calls[0][1].method).toBe("PUT");

    // Integration retry
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        id: "int-888",
        appointment_id: "apt-123",
        channel: "email",
        state: "pending",
        attempt_count: 1,
        version: 2,
        created_at: "2026-08-24T00:00:00Z",
        updated_at: "2026-08-24T12:05:00Z",
      }),
    });

    const retryRes = await apiClient.retryIntegration("int-888", { expectedVersion: 1 });
    expect(retryRes.id).toBe("int-888");
    expect(mockFetch.mock.calls[1][0]).toBe("http://127.0.0.1:8000/api/v1/admin/integrations/int-888/retry");
    expect(mockFetch.mock.calls[1][1].method).toBe("POST");
    expect(mockFetch.mock.calls[1][1].headers["Idempotency-Key"]).toBeDefined();
    const retryBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(retryBody).toEqual({ expected_version: 1 });
  });
});
