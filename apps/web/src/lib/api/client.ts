/**
 * Frontend Data-Access Boundary.
 * All application UI features call this typed API client layer.
 * In production mode (when NEXT_PUBLIC_DEMO_MODE !== "true" and NEXT_PUBLIC_API_BASE_URL is set),
 * this boundary executes typed HTTP requests to the FastAPI backend with Bearer authentication
 * and Idempotency-Key headers.
 * In demo mode (NEXT_PUBLIC_DEMO_MODE === "true"), it delegates to the deterministic in-memory mock repository.
 */

import { mockDb } from "@/mocks/handlers";
import {
  UserContext,
  UserRole,
  PatientProfile,
  DoctorSummary,
  DoctorDetail,
  DoctorCreateRequest,
  AvailabilitySlot,
  Hold,
  HoldCreateRequest,
  HoldConfirmRequest,
  AppointmentSummary,
  AppointmentDetail,
  Visit,
  PrescriptionItem,
  MedicationReminder,
  DoctorLeave,
  LeavePreviewRequest,
  LeavePreviewResponse,
  LeaveApplyRequest,
  AdminIntegrationItem,
  ApiErrorEnvelope,
} from "@/types/api";
import { formatDateOnly } from "@/lib/dates";
import {
  getStoredSession,
  refreshSessionDeduplicated,
  clearStoredSession,
} from "@/features/auth/supabase-auth";

export const isDemoMode = (): boolean => {
  if (typeof process !== "undefined") {
    if (process.env?.NEXT_PUBLIC_DEMO_MODE === "true") {
      return true;
    }
    if (process.env?.NEXT_PUBLIC_DEMO_MODE === "false") {
      return false;
    }
  }
  // Default to true ONLY if neither API URL nor Supabase URL is configured
  const hasApi = Boolean(process.env.NEXT_PUBLIC_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL);
  const hasSupabase = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  return !hasApi && !hasSupabase;
};

export const getApiBaseUrl = (): string => {
  const raw = process.env.NEXT_PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "";
  return raw.replace(/\/api\/v1\/?$/, "").replace(/\/$/, "");
};

let activeAuthToken: string | null = null;

export function setApiAuthToken(token: string | null): void {
  activeAuthToken = token;
}

export function getApiAuthToken(): string | null {
  if (activeAuthToken) return activeAuthToken;
  const session = getStoredSession();
  return session?.access_token || null;
}

function generateIdempotencyKey(prefix = "idem"): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${Date.now()}-${rand}`;
}

async function requestHttp<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    headers?: Record<string, string>;
    idempotent?: boolean;
    expectedVersion?: number;
    skipAuthRefresh?: boolean;
  } = {}
): Promise<T> {
  const method = options.method || "GET";
  const baseUrl = getApiBaseUrl();

  if (!baseUrl) {
    throw {
      status: 500,
      error: {
        code: "CONFIG_ERROR",
        message: "Missing NEXT_PUBLIC_API_BASE_URL (or NEXT_PUBLIC_API_URL) in production mode.",
      },
      request_id: `req-config-${Date.now()}`,
    };
  }

  const token = getApiAuthToken();

  // Public discovery endpoints allow unauthenticated read access.
  // All other endpoints require an authenticated access token.
  const isPublicDiscovery = (path.startsWith("/doctors") && method === "GET" && !path.includes("/working-hours") && !path.includes("/leave"));
  if (!token && !isPublicDiscovery) {
    throw {
      status: 401,
      error: {
        code: "AUTHENTICATION_REQUIRED",
        message: "Authentication token required for protected endpoint.",
      },
      request_id: `req-auth-${Date.now()}`,
    };
  }

  const url = `${baseUrl}/api/v1${path}`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  if (options.idempotent && (method === "POST" || method === "PUT" || method === "DELETE")) {
    headers["Idempotency-Key"] = generateIdempotencyKey();
  }

  let bodyContent: string | undefined = undefined;
  if (options.body !== undefined) {
    const payload =
      options.expectedVersion !== undefined &&
      typeof options.body === "object" &&
      options.body !== null
        ? { ...(options.body as Record<string, unknown>), expected_version: options.expectedVersion }
        : options.body;
    bodyContent = JSON.stringify(payload);
  }

  const response = await fetch(url, {
    method,
    headers,
    body: bodyContent,
  });

  // Handle 401 token expiry with automatic single refresh & retry
  if (response.status === 401 && !options.skipAuthRefresh) {
    const refreshed = await refreshSessionDeduplicated(setApiAuthToken);
    if (refreshed && refreshed.access_token) {
      return requestHttp<T>(path, { ...options, skipAuthRefresh: true });
    } else {
      clearStoredSession();
      setApiAuthToken(null);
    }
  }

  if (response.status === 204) {
    return undefined as unknown as T;
  }

  if (!response.ok) {
    let errorEnvelope: ApiErrorEnvelope;
    try {
      errorEnvelope = await response.json();
    } catch {
      errorEnvelope = {
        error: {
          code: "HTTP_ERROR",
          message: `Request failed with status ${response.status} (${response.statusText})`,
        },
        request_id: `req-${Date.now()}`,
      };
    }
    throw {
      status: response.status,
      ...errorEnvelope,
    };
  }

  return response.json();
}

export const apiClient = {
  // Test isolation reset
  reset: (): void => {
    mockDb.reset();
    setApiAuthToken(null);
  },

  // Auth / Context
  getMe: async (): Promise<UserContext> => {
    if (isDemoMode()) return mockDb.getMe();
    return requestHttp<UserContext>("/me");
  },

  setUserRole: (role: UserRole): UserContext => {
    if (!isDemoMode()) {
      throw new Error(
        "apiClient.setUserRole is only supported in demo mode (NEXT_PUBLIC_DEMO_MODE=true). In production, role is derived solely from the Supabase session and GET /me."
      );
    }
    return mockDb.setUserRole(role);
  },

  // Patient Profile
  getPatientProfile: async (): Promise<PatientProfile> => {
    if (isDemoMode()) return mockDb.getPatientProfile();
    return requestHttp<PatientProfile>("/me/profile");
  },

  // Doctors
  getDoctors: async (query?: string, specialization?: string): Promise<DoctorSummary[]> => {
    if (isDemoMode()) return mockDb.getDoctors(query, specialization);
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (specialization && specialization !== "All") params.set("specialization", specialization);
    const qs = params.toString();
    const res = await requestHttp<{ items: DoctorSummary[] }>(`/doctors${qs ? `?${qs}` : ""}`);
    return res.items || [];
  },

  getDoctorDetail: async (doctorId: string): Promise<DoctorDetail> => {
    if (isDemoMode()) return mockDb.getDoctorDetail(doctorId);
    return requestHttp<DoctorDetail>(`/doctors/${encodeURIComponent(doctorId)}`);
  },

  createDoctor: async (req: DoctorCreateRequest): Promise<DoctorDetail> => {
    if (isDemoMode()) return mockDb.createDoctor(req);
    return requestHttp<DoctorDetail>("/doctors", {
      method: "POST",
      body: req,
      idempotent: true,
    });
  },

  getDoctorAvailability: async (
    doctorId: string,
    targetDate: Date,
    durationMinutes = 30
  ): Promise<AvailabilitySlot[]> => {
    if (isDemoMode()) return mockDb.getDoctorAvailability(doctorId, targetDate, durationMinutes);
    const dateStr = formatDateOnly(targetDate, "Asia/Kolkata");
    const fromISO = `${dateStr}T00:00:00+05:30`;
    const toISO = `${dateStr}T23:59:59+05:30`;
    return requestHttp<AvailabilitySlot[]>(
      `/doctors/${encodeURIComponent(doctorId)}/availability?from=${encodeURIComponent(
        fromISO
      )}&to=${encodeURIComponent(toISO)}&duration_minutes=${durationMinutes}`
    );
  },

  // Holds & Booking
  createHold: async (req: HoldCreateRequest): Promise<Hold> => {
    if (isDemoMode()) return mockDb.createHold(req);
    return requestHttp<Hold>("/holds", {
      method: "POST",
      body: req,
      idempotent: true,
    });
  },

  getHold: async (holdId: string): Promise<Hold> => {
    if (isDemoMode()) return mockDb.getHold(holdId);
    return requestHttp<Hold>(`/holds/${encodeURIComponent(holdId)}`);
  },

  releaseHold: async (holdId: string): Promise<void> => {
    if (isDemoMode()) return mockDb.releaseHold(holdId);
    return requestHttp<void>(`/holds/${encodeURIComponent(holdId)}`, {
      method: "DELETE",
      idempotent: true,
    });
  },

  confirmHold: async (holdId: string, req: HoldConfirmRequest): Promise<AppointmentDetail> => {
    if (isDemoMode()) return mockDb.confirmHold(holdId, req);
    return requestHttp<AppointmentDetail>(`/holds/${encodeURIComponent(holdId)}/confirm`, {
      method: "POST",
      body: req,
      idempotent: true,
    });
  },

  // Appointments
  getAppointments: async (role?: UserRole): Promise<AppointmentSummary[]> => {
    if (isDemoMode()) return mockDb.getAppointments(role);
    const params = new URLSearchParams();
    if (role) params.set("role", role);
    const qs = params.toString();
    const res = await requestHttp<{ items: AppointmentSummary[] }>(`/appointments${qs ? `?${qs}` : ""}`);
    return res.items || [];
  },

  getAppointmentDetail: async (appointmentId: string): Promise<AppointmentDetail> => {
    if (isDemoMode()) return mockDb.getAppointmentDetail(appointmentId);
    return requestHttp<AppointmentDetail>(`/appointments/${encodeURIComponent(appointmentId)}`);
  },

  cancelAppointment: async (
    appointmentId: string,
    reason: string,
    cancelledBy: "patient" | "doctor" | "admin" = "patient"
  ): Promise<AppointmentDetail> => {
    if (isDemoMode()) return mockDb.cancelAppointment(appointmentId, reason, cancelledBy);
    return requestHttp<AppointmentDetail>(`/appointments/${encodeURIComponent(appointmentId)}/cancel`, {
      method: "POST",
      body: { reason, cancelled_by: cancelledBy },
      idempotent: true,
    });
  },

  rescheduleAppointment: async (
    appointmentId: string,
    newStartsAt: string,
    durationMinutes = 30
  ): Promise<AppointmentDetail> => {
    if (isDemoMode()) return mockDb.rescheduleAppointment(appointmentId, newStartsAt, durationMinutes);
    return requestHttp<AppointmentDetail>(`/appointments/${encodeURIComponent(appointmentId)}/reschedule`, {
      method: "POST",
      body: { starts_at: newStartsAt, duration_minutes: durationMinutes },
      idempotent: true,
    });
  },

  // Clinical Visits & Prescriptions
  getVisit: async (visitId: string): Promise<Visit> => {
    if (isDemoMode()) return mockDb.getVisit(visitId);
    return requestHttp<Visit>(`/visits/${encodeURIComponent(visitId)}`);
  },

  getOrCreateVisitForAppointment: async (appointmentId: string, doctorId: string): Promise<Visit> => {
    if (isDemoMode()) return mockDb.getOrCreateVisitForAppointment(appointmentId, doctorId);
    return requestHttp<Visit>(`/appointments/${encodeURIComponent(appointmentId)}/visit`, {
      method: "POST",
      idempotent: true,
    });
  },

  saveVisitDraft: async (
    visitId: string,
    notes: string,
    diagnosis: string,
    prescriptionItems: PrescriptionItem[]
  ): Promise<Visit> => {
    if (isDemoMode()) return mockDb.saveVisitDraft(visitId, notes, diagnosis, prescriptionItems);
    return requestHttp<Visit>(`/visits/${encodeURIComponent(visitId)}`, {
      method: "PATCH",
      body: { doctor_notes: notes, diagnosis, prescription_items: prescriptionItems },
    });
  },

  completeVisit: async (
    visitId: string,
    notes: string,
    diagnosis: string,
    prescriptionItems: PrescriptionItem[],
    followUpInstructions?: string
  ): Promise<Visit> => {
    if (isDemoMode()) return mockDb.completeVisit(visitId, notes, diagnosis, prescriptionItems, followUpInstructions);
    return requestHttp<Visit>(`/visits/${encodeURIComponent(visitId)}/complete`, {
      method: "POST",
      body: {
        doctor_notes: notes,
        diagnosis,
        prescription_items: prescriptionItems,
        follow_up_instructions: followUpInstructions,
      },
      idempotent: true,
    });
  },

  // Reminders
  getPatientReminders: async (patientId: string): Promise<MedicationReminder[]> => {
    if (isDemoMode()) return mockDb.getPatientReminders(patientId);
    const res = await requestHttp<MedicationReminder[]>(`/prescriptions/reminders?patient_id=${encodeURIComponent(patientId)}`);
    return res || [];
  },

  // Doctor Leave
  getDoctorLeaves: async (doctorId?: string): Promise<DoctorLeave[]> => {
    if (isDemoMode()) return mockDb.getDoctorLeaves(doctorId);
    const path = doctorId ? `/doctors/${encodeURIComponent(doctorId)}/leave` : "/admin/leaves";
    const res = await requestHttp<{ items: DoctorLeave[] } | DoctorLeave[]>(path);
    if (Array.isArray(res)) return res;
    return res.items || [];
  },

  previewDoctorLeave: async (doctorId: string, req: LeavePreviewRequest): Promise<LeavePreviewResponse> => {
    if (isDemoMode()) return mockDb.previewDoctorLeave(doctorId, req);
    return requestHttp<LeavePreviewResponse>(`/doctors/${encodeURIComponent(doctorId)}/leave/preview`, {
      method: "POST",
      body: req,
    });
  },

  applyDoctorLeave: async (
    doctorId: string,
    startsAt: string,
    endsAt: string,
    reason: string,
    req: LeaveApplyRequest
  ): Promise<DoctorLeave> => {
    if (isDemoMode()) return mockDb.applyDoctorLeave(doctorId, startsAt, endsAt, reason, req);
    return requestHttp<DoctorLeave>(`/doctors/${encodeURIComponent(doctorId)}/leave`, {
      method: "POST",
      body: {
        starts_at: startsAt,
        ends_at: endsAt,
        reason,
        preview_token: req.preview_token,
        expected_schedule_version: req.expected_schedule_version,
      },
      idempotent: true,
    });
  },

  // Admin Integrations
  getAdminIntegrations: async (): Promise<AdminIntegrationItem[]> => {
    if (isDemoMode()) return mockDb.getAdminIntegrations();
    const res = await requestHttp<{ items: AdminIntegrationItem[] }>("/admin/integrations");
    return res.items || [];
  },

  retryIntegration: async (operationId: string): Promise<AdminIntegrationItem> => {
    if (isDemoMode()) return mockDb.retryIntegration(operationId);
    return requestHttp<AdminIntegrationItem>(`/admin/integrations/${encodeURIComponent(operationId)}/retry`, {
      method: "POST",
      idempotent: true,
    });
  },
};
