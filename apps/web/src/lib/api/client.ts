/**
 * Frontend Data-Access Boundary.
 * All application UI features call this typed API client layer.
 * In production mode (when NEXT_PUBLIC_DEMO_MODE !== "true" and API URL is set),
 * this boundary executes typed HTTP requests to the FastAPI backend with Bearer authentication
 * and Idempotency-Key headers.
 * In demo mode (NEXT_PUBLIC_DEMO_MODE === "true"), it delegates to the deterministic in-memory mock repository.
 */

import { mockDb } from "@/mocks/handlers";
import {
  UserContext,
  UserRole,
  PatientProfile,
  ProfileUpdateRequest,
  DoctorSummary,
  DoctorDetail,
  DoctorCreateRequest,
  DoctorUpdateRequest,
  WorkingHoursResponse,
  WorkingHoursReplaceRequest,
  AvailabilitySlot,
  AvailabilityResponse,
  Hold,
  HoldCreateRequest,
  HoldConfirmRequest,
  AppointmentSummary,
  AppointmentDetail,
  AppointmentCancelRequest,
  AppointmentRescheduleRequest,
  SymptomIntakeRequest,
  SymptomVersion,
  SymptomsResponse,
  Visit,
  VisitUpdateRequest,
  PrescriptionItem,
  MedicationReminder,
  ReminderPreferencesResponse,
  ReminderPreferencesRequest,
  ReminderScheduleResponse,
  DoctorLeave,
  LeavePreviewRequest,
  LeaveImpactResponse,
  LeavePreviewResponse,
  LeaveApplyRequest,
  AdminIntegrationItem,
  IntegrationStatus,
  IntegrationRetryRequest,
  ApiErrorEnvelope,
} from "@/types/api";
import { formatDateOnly, formatTime } from "@/lib/dates";
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
const DEFAULT_HTTP_TIMEOUT_MS = 30_000;

const PRESCRIPTION_FREQUENCIES = [
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "every_4_hours",
  "as_needed",
] as const;

type PrescriptionFrequencyLiteral = (typeof PRESCRIPTION_FREQUENCIES)[number];

function requireExpectedVersion(expectedVersion: number | undefined, resource: string): number {
  if (typeof expectedVersion !== "number" || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw {
      status: 400,
      error: {
        code: "INVALID_REQUEST",
        message: `A current expected_version is required to update ${resource}.`,
      },
      request_id: `req-version-${Date.now()}`,
    };
  }
  return expectedVersion as number;
}

function asPrescriptionFrequency(value: string, itemId: string): PrescriptionFrequencyLiteral {
  if ((PRESCRIPTION_FREQUENCIES as readonly string[]).includes(value)) {
    return value as PrescriptionFrequencyLiteral;
  }
  throw {
    status: 422,
    error: {
      code: "VALIDATION_FAILED",
      message: `Prescription item ${itemId} has an unsupported frequency.`,
      fields: [{ path: "prescription_items.frequency", code: "invalid_frequency", message: "Use a supported structured frequency." }],
    },
    request_id: `req-frequency-${Date.now()}`,
  };
}

function normalizeDoctor<T extends DoctorSummary>(doctor: T): T {
  return {
    ...doctor,
    name: doctor.name ?? doctor.display_name,
    display_name: doctor.display_name ?? doctor.name,
    timezone: doctor.timezone ?? doctor.time_zone,
    time_zone: doctor.time_zone ?? doctor.timezone,
    accepted_durations: doctor.accepted_durations ?? doctor.appointment_durations_minutes,
  };
}

export function setApiAuthToken(token: string | null): void {
  activeAuthToken = token;
}

export function getApiAuthToken(): string | null {
  if (activeAuthToken) return activeAuthToken;
  const session = getStoredSession();
  return session?.access_token || null;
}

export function generateIdempotencyKey(prefix = "idem"): string {
  const rand = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
  return `${prefix}-${Date.now()}-${rand}`;
}

export interface HttpRequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  headers?: Record<string, string>;
  idempotent?: boolean;
  idempotencyKey?: string;
  expectedVersion?: number;
  skipAuthRefresh?: boolean;
}

export async function requestHttp<T>(
  path: string,
  options: HttpRequestOptions = {}
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

  // ONLY /health/live and /health/ready are public.
  // Every other API endpoint (including doctor discovery) requires an authenticated bearer token.
  const isPublic = path === "/health/live" || path === "/health/ready";
  if (!token && !isPublic) {
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

  // Preserve or generate exactly one idempotency key per user intent
  let stableIdempotencyKey = options.idempotencyKey;
  if (options.idempotent || stableIdempotencyKey) {
    if (!stableIdempotencyKey) {
      stableIdempotencyKey = generateIdempotencyKey();
    }
    headers["Idempotency-Key"] = stableIdempotencyKey;
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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_HTTP_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: bodyContent,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle 401 token expiry with automatic deduplicated refresh & retry reusing the exact same idempotency key
  if (response.status === 401 && !options.skipAuthRefresh) {
    const refreshed = await refreshSessionDeduplicated(setApiAuthToken);
    if (refreshed && refreshed.access_token) {
      return requestHttp<T>(path, {
        ...options,
        idempotencyKey: stableIdempotencyKey,
        skipAuthRefresh: true,
      });
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

  updatePatientProfile: async (req: ProfileUpdateRequest): Promise<PatientProfile> => {
    if (isDemoMode()) return mockDb.updatePatientProfile(req);
    return requestHttp<PatientProfile>("/me/profile", {
      method: "PATCH",
      body: req,
    });
  },

  // Doctors
  getDoctors: async (search?: string, specialization?: string): Promise<DoctorSummary[]> => {
    if (isDemoMode()) return (await mockDb.getDoctors(search, specialization)).map(normalizeDoctor);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    params.set("active_only", "true");
    const qs = params.toString();
    const res = await requestHttp<{ items: DoctorSummary[]; next_cursor: string | null }>(
      `/doctors${qs ? `?${qs}` : ""}`
    );
    let items = res.items || [];
    if (specialization && specialization !== "All") {
      items = items.filter((d) => d.specialization === specialization);
    }
    return items.map(normalizeDoctor);
  },

  getDoctorDetail: async (doctorId: string): Promise<DoctorDetail> => {
    if (isDemoMode()) return normalizeDoctor(await mockDb.getDoctorDetail(doctorId));
    return normalizeDoctor(await requestHttp<DoctorDetail>(`/doctors/${encodeURIComponent(doctorId)}`));
  },

  createDoctor: async (req: DoctorCreateRequest, options?: { idempotencyKey?: string }): Promise<DoctorDetail> => {
    if (isDemoMode()) return mockDb.createDoctor(req);
    const displayName = req.display_name ?? req.name;
    if (!req.subject_id || !displayName?.trim()) {
      throw {
        status: 400,
        error: {
          code: "INVALID_REQUEST",
          message: "A verified subject_id and display name are required to provision a doctor.",
        },
        request_id: `req-doctor-${Date.now()}`,
      };
    }
    const body = {
      subject_id: req.subject_id,
      display_name: displayName,
      credentials: req.credentials ?? null,
      specialization: req.specialization ?? null,
      ...(req.timezone || req.time_zone
        ? { timezone: req.timezone ?? req.time_zone }
        : {}),
      ...(req.appointment_durations_minutes || req.accepted_durations
        ? { appointment_durations_minutes: req.appointment_durations_minutes ?? req.accepted_durations }
        : {}),
    };
    return normalizeDoctor(await requestHttp<DoctorDetail>("/doctors", {
      method: "POST",
      body,
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    }));
  },

  updateDoctor: async (doctorId: string, req: DoctorUpdateRequest): Promise<DoctorSummary> => {
    if (isDemoMode()) return normalizeDoctor(await mockDb.updateDoctor(doctorId, req));
    return normalizeDoctor(await requestHttp<DoctorSummary>(`/doctors/${encodeURIComponent(doctorId)}`, {
      method: "PATCH",
      body: req,
    }));
  },

  getDoctorWorkingHours: async (doctorId: string): Promise<WorkingHoursResponse> => {
    if (isDemoMode()) {
      return mockDb.getDoctorWorkingHours(doctorId);
    }
    return requestHttp<WorkingHoursResponse>(`/doctors/${encodeURIComponent(doctorId)}/working-hours`);
  },

  replaceDoctorWorkingHours: async (
    doctorId: string,
    req: WorkingHoursReplaceRequest
  ): Promise<WorkingHoursResponse> => {
    if (isDemoMode()) {
      return mockDb.replaceDoctorWorkingHours(doctorId, req);
    }
    return requestHttp<WorkingHoursResponse>(`/doctors/${encodeURIComponent(doctorId)}/working-hours`, {
      method: "PUT",
      body: req,
    });
  },

  getDoctorAvailability: async (
    doctorId: string,
    targetDate: Date,
    durationMinutes: number
  ): Promise<AvailabilitySlot[]> => {
    if (isDemoMode()) return mockDb.getDoctorAvailability(doctorId, targetDate, durationMinutes);
    const dateStr = formatDateOnly(targetDate, "Asia/Kolkata");
    const fromISO = `${dateStr}T00:00:00+05:30`;
    const toISO = `${dateStr}T23:59:59+05:30`;
    const res = await requestHttp<AvailabilityResponse>(
      `/doctors/${encodeURIComponent(doctorId)}/availability?from=${encodeURIComponent(
        fromISO
      )}&to=${encodeURIComponent(toISO)}&duration_minutes=${durationMinutes}`
    );
    return res.items || [];
  },

  // Holds & Booking
  createHold: async (req: HoldCreateRequest, options?: { idempotencyKey?: string }): Promise<Hold> => {
    if (isDemoMode()) return mockDb.createHold(req);
    return requestHttp<Hold>("/holds", {
      method: "POST",
      body: req,
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  getHold: async (holdId: string): Promise<Hold> => {
    if (isDemoMode()) return mockDb.getHold(holdId);
    return requestHttp<Hold>(`/holds/${encodeURIComponent(holdId)}`);
  },

  releaseHold: async (holdId: string, options?: { idempotencyKey?: string }): Promise<void> => {
    if (isDemoMode()) return mockDb.releaseHold(holdId);
    return requestHttp<void>(`/holds/${encodeURIComponent(holdId)}`, {
      method: "DELETE",
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  confirmHold: async (
    holdId: string,
    req: HoldConfirmRequest,
    options?: { idempotencyKey?: string }
  ): Promise<AppointmentDetail> => {
    if (isDemoMode()) return mockDb.confirmHold(holdId, req);
    return requestHttp<AppointmentDetail>(`/holds/${encodeURIComponent(holdId)}/confirm`, {
      method: "POST",
      body: req,
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  // Appointments
  getAppointments: async (
    roleOrStatusFilter?: UserRole | string,
    filters?: { from?: string; to?: string }
  ): Promise<AppointmentSummary[]> => {
    if (isDemoMode()) return mockDb.getAppointments(roleOrStatusFilter as UserRole);
    const params = new URLSearchParams();
    if (roleOrStatusFilter && !["patient", "doctor", "admin"].includes(roleOrStatusFilter)) {
      params.set("status", roleOrStatusFilter);
    }
    if (filters?.from) params.set("from", filters.from);
    if (filters?.to) params.set("to", filters.to);
    const qs = params.toString();
    const res = await requestHttp<{ items: AppointmentSummary[]; next_cursor: string | null }>(
      `/appointments${qs ? `?${qs}` : ""}`
    );
    return res.items || [];
  },

  getAppointmentDetail: async (appointmentId: string): Promise<AppointmentDetail> => {
    if (isDemoMode()) return mockDb.getAppointmentDetail(appointmentId);
    return requestHttp<AppointmentDetail>(`/appointments/${encodeURIComponent(appointmentId)}`);
  },

  cancelAppointment: async (
    appointmentId: string,
    reasonOrRequest: string | AppointmentCancelRequest,
    cancelledBy: "patient" | "doctor" | "admin" = "patient",
    options?: { expectedVersion?: number; idempotencyKey?: string }
  ): Promise<AppointmentSummary> => {
    if (isDemoMode()) {
      const reasonStr = typeof reasonOrRequest === "string" ? reasonOrRequest : reasonOrRequest.note || reasonOrRequest.reason_code;
      const expectedVersion =
        typeof reasonOrRequest === "string"
          ? requireExpectedVersion(options?.expectedVersion, "the appointment")
          : reasonOrRequest.expected_version;
      return mockDb.cancelAppointment(appointmentId, reasonStr, cancelledBy, expectedVersion);
    }

    let payload: AppointmentCancelRequest;
    if (typeof reasonOrRequest === "string") {
      let code: "patient_request" | "doctor_request" | "admin_request" | "safety" = "patient_request";
      if (cancelledBy === "doctor") code = "doctor_request";
      else if (cancelledBy === "admin") code = "admin_request";

      payload = {
        expected_version: requireExpectedVersion(options?.expectedVersion, "the appointment"),
        reason_code: code,
        note: reasonOrRequest,
      };
    } else {
      payload = {
        ...reasonOrRequest,
        expected_version: requireExpectedVersion(reasonOrRequest.expected_version, "the appointment"),
      };
    }

    return requestHttp<AppointmentSummary>(`/appointments/${encodeURIComponent(appointmentId)}/cancel`, {
      method: "POST",
      body: payload,
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  rescheduleAppointment: async (
    appointmentId: string,
    newStartsAtOrRequest: string | AppointmentRescheduleRequest,
    durationMinutes: number,
    options?: { expectedVersion?: number; idempotencyKey?: string }
  ): Promise<AppointmentSummary> => {
    if (isDemoMode()) {
      const starts = typeof newStartsAtOrRequest === "string" ? newStartsAtOrRequest : newStartsAtOrRequest.starts_at;
      const dur = typeof newStartsAtOrRequest === "string" ? durationMinutes : newStartsAtOrRequest.duration_minutes;
      const expectedVersion =
        typeof newStartsAtOrRequest === "string"
          ? requireExpectedVersion(options?.expectedVersion, "the appointment")
          : newStartsAtOrRequest.expected_version;
      return mockDb.rescheduleAppointment(appointmentId, starts, dur, expectedVersion);
    }

    const payload: AppointmentRescheduleRequest =
      typeof newStartsAtOrRequest === "string"
        ? {
            expected_version: requireExpectedVersion(options?.expectedVersion, "the appointment"),
            starts_at: newStartsAtOrRequest,
            duration_minutes: durationMinutes,
          }
        : {
            ...newStartsAtOrRequest,
            expected_version: requireExpectedVersion(newStartsAtOrRequest.expected_version, "the appointment"),
          };

    return requestHttp<AppointmentSummary>(`/appointments/${encodeURIComponent(appointmentId)}/reschedule`, {
      method: "POST",
      body: payload,
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  getAppointmentSymptoms: async (appointmentId: string): Promise<SymptomsResponse> => {
    if (isDemoMode()) {
      const apt = await mockDb.getAppointmentDetail(appointmentId);
      return {
        items: [
          {
            id: `sym-${apt.id}`,
            version: 1,
            symptoms_text: apt.original_symptoms_text || apt.symptoms_text || "",
            source: "patient",
            created_at: apt.symptoms_recorded_at || apt.created_at,
          },
        ],
        generated_artifacts: apt.generated_artifacts || [],
      };
    }
    return requestHttp<SymptomsResponse>(`/appointments/${encodeURIComponent(appointmentId)}/symptoms`);
  },

  addAppointmentSymptoms: async (
    appointmentId: string,
    req: SymptomIntakeRequest
  ): Promise<SymptomVersion> => {
    if (isDemoMode()) {
      return {
        id: `sym-new-${Date.now()}`,
        version: 2,
        symptoms_text: req.symptoms_text,
        source: "patient",
        created_at: new Date().toISOString(),
      };
    }
    return requestHttp<SymptomVersion>(`/appointments/${encodeURIComponent(appointmentId)}/symptoms`, {
      method: "POST",
      body: req,
    });
  },

  // Clinical Visits & Prescriptions
  getVisit: async (appointmentIdOrVisitId: string): Promise<Visit> => {
    if (isDemoMode()) return mockDb.getVisit(appointmentIdOrVisitId);
    // FastAPI route is GET /appointments/{appointment_id}/visit
    return requestHttp<Visit>(`/appointments/${encodeURIComponent(appointmentIdOrVisitId)}/visit`);
  },

  getOrCreateVisitForAppointment: async (
    appointmentId: string,
    doctorId?: string,
    options?: { idempotencyKey?: string }
  ): Promise<Visit> => {
    if (isDemoMode()) {
      if (!doctorId) {
        throw {
          status: 400,
          error: { code: "INVALID_REQUEST", message: "A doctor profile is required to create a visit." },
        };
      }
      return mockDb.getOrCreateVisitForAppointment(appointmentId, doctorId);
    }
    return requestHttp<Visit>(`/appointments/${encodeURIComponent(appointmentId)}/visit`, {
      method: "POST",
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  saveVisitDraft: async (
    visitId: string,
    notesOrRequest: string | VisitUpdateRequest,
    diagnosis?: string,
    prescriptionItems?: PrescriptionItem[],
    options?: { expectedVersion?: number }
  ): Promise<Visit> => {
    if (isDemoMode()) {
      const notes = typeof notesOrRequest === "string" ? notesOrRequest : notesOrRequest.notes_text;
      const diag = typeof notesOrRequest === "string" ? (diagnosis || "") : (notesOrRequest.advisory_text ?? "");
      const items = typeof notesOrRequest === "string" ? (prescriptionItems || []) : (notesOrRequest.prescription_items as PrescriptionItem[] || []);
      const expectedVersion =
        typeof notesOrRequest === "string"
          ? requireExpectedVersion(options?.expectedVersion, "the visit")
          : notesOrRequest.expected_version;
      return mockDb.saveVisitDraft(visitId, notes, diag, items, expectedVersion);
    }

    const payload: VisitUpdateRequest =
      typeof notesOrRequest === "string"
        ? {
            expected_version: requireExpectedVersion(options?.expectedVersion, "the visit"),
            notes_text: notesOrRequest,
            prescription_items: prescriptionItems
              ? prescriptionItems.map((item) => ({
                  medication_name: item.medication_name,
                  dosage: item.dosage,
                  route: item.route,
                  frequency: asPrescriptionFrequency(item.frequency, item.id),
                  start_date: item.start_date,
                  end_date: item.end_date ?? null,
                  duration_days: item.duration_days ?? null,
                  instructions: item.instructions,
                }))
              : null,
            advisory_text: diagnosis ?? null,
          }
        : {
            ...notesOrRequest,
            expected_version: requireExpectedVersion(notesOrRequest.expected_version, "the visit"),
          };

    return requestHttp<Visit>(`/visits/${encodeURIComponent(visitId)}`, {
      method: "PATCH",
      body: payload,
    });
  },

  completeVisit: async (
    visitId: string,
    notes?: string,
    diagnosis?: string,
    prescriptionItems?: PrescriptionItem[],
    followUpInstructions?: string,
    options?: { expectedVersion?: number; idempotencyKey?: string }
  ): Promise<Visit> => {
    if (isDemoMode()) {
      const expectedVersion = requireExpectedVersion(options?.expectedVersion, "the visit");
      return mockDb.completeVisit(
        visitId,
        notes || "",
        diagnosis || "",
        prescriptionItems || [],
        followUpInstructions,
        expectedVersion
      );
    }
    const expectedVersion = requireExpectedVersion(options?.expectedVersion, "the visit");
    return requestHttp<Visit>(`/visits/${encodeURIComponent(visitId)}/complete`, {
      method: "POST",
      body: { expected_version: expectedVersion },
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  amendVisit: async (
    visitId: string,
    reason: string,
    notesText: string,
    options?: { expectedVersion?: number; idempotencyKey?: string }
  ): Promise<Visit> => {
    if (isDemoMode()) {
      return mockDb.amendVisit(visitId, reason, notesText, requireExpectedVersion(options?.expectedVersion, "the visit"));
    }
    const expectedVersion = requireExpectedVersion(options?.expectedVersion, "the visit");
    return requestHttp<Visit>(`/visits/${encodeURIComponent(visitId)}/amendments`, {
      method: "POST",
      body: {
        expected_version: expectedVersion,
        reason,
        notes_text: notesText,
      },
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  // Reminders
  getReminderPreferences: async (): Promise<ReminderPreferencesResponse> => {
    if (isDemoMode()) return mockDb.getReminderPreferences();
    return requestHttp<ReminderPreferencesResponse>("/me/reminder-preferences");
  },

  updateReminderPreferences: async (
    req: ReminderPreferencesRequest
  ): Promise<ReminderPreferencesResponse> => {
    if (isDemoMode()) return mockDb.updateReminderPreferences(req);
    return requestHttp<ReminderPreferencesResponse>("/me/reminder-preferences", {
      method: "PUT",
      body: req,
    });
  },

  getReminderSchedule: async (prescriptionId: string, limit = 100): Promise<ReminderScheduleResponse> => {
    if (isDemoMode()) {
      return {
        prescription_id: prescriptionId,
        items: [],
      };
    }
    return requestHttp<ReminderScheduleResponse>(
      `/prescriptions/${encodeURIComponent(prescriptionId)}/reminder-schedule?limit=${limit}`
    );
  },

  getPatientReminders: async (patientId: string): Promise<MedicationReminder[]> => {
    if (isDemoMode()) return mockDb.getPatientReminders(patientId);
    // Production reminders come from completed visits and the executable reminder-schedule route.
    // The appointments collection is already scoped to the authenticated patient by the API.
    const appointments = await apiClient.getAppointments("completed");
    if (appointments.length === 0) return [];
    const preferences = await apiClient.getReminderPreferences().catch(() => null);
    const timezone = preferences?.timezone;
    if (!timezone) return [];
    const today = formatDateOnly(new Date(), timezone);
    const visits = await Promise.allSettled(appointments.map((appointment) => apiClient.getVisit(appointment.id)));
    const prescriptions = visits
      .filter((result): result is PromiseFulfilledResult<Visit> => result.status === "fulfilled")
      .map((result) => result.value.prescription)
      .filter((prescription): prescription is NonNullable<Visit["prescription"]> => Boolean(prescription));
    const schedules = await Promise.allSettled(
      prescriptions.map(async (prescription) => ({
        prescription,
        schedule: await apiClient.getReminderSchedule(prescription.id, 365),
      }))
    );

    return schedules.flatMap((result) => {
      if (result.status !== "fulfilled") return [];
      const { prescription, schedule } = result.value;
      const occurrences = Array.isArray(schedule.items) ? schedule.items : [];
      return occurrences.flatMap((occurrence) => {
        try {
          if (!occurrence.prescription_item_id) return [];
          const item = prescription.items.find((candidate) => candidate.id === occurrence.prescription_item_id);
          if (!item || formatDateOnly(occurrence.occurrence_at, timezone) !== today) return [];
          return [{
            id: `rem-${prescription.id}-${occurrence.prescription_item_id}-${occurrence.occurrence_at}`,
            prescription_item_id: item.id,
            medication_name: item.medication_name,
            dosage: item.dosage,
            time_of_day: formatTime(occurrence.occurrence_at, timezone),
            scheduled_date: formatDateOnly(occurrence.occurrence_at, timezone),
            taken: occurrence.status.toLowerCase() === "taken",
            instructions: item.instructions,
            route: item.route ?? "Route not provided",
          } satisfies MedicationReminder];
        } catch {
          return [];
        }
      });
    });
  },

  // Doctor Leave
  getDoctorLeaves: async (doctorId?: string): Promise<DoctorLeave[]> => {
    if (isDemoMode()) return mockDb.getDoctorLeaves(doctorId);
    const path = doctorId ? `/doctors/${encodeURIComponent(doctorId)}/leave` : "/admin/leaves";
    const res = await requestHttp<
      { items: DoctorLeave[]; next_cursor: string | null } | DoctorLeave[]
    >(path);
    if (Array.isArray(res)) return res;
    return res.items || [];
  },

  previewDoctorLeave: async (
    doctorId: string,
    req: LeavePreviewRequest
  ): Promise<LeavePreviewResponse> => {
    if (isDemoMode()) return mockDb.previewDoctorLeave(doctorId, req);
    const impact = await requestHttp<LeaveImpactResponse>(
      `/doctors/${encodeURIComponent(doctorId)}/leave/preview`,
      {
        method: "POST",
        body: req,
      }
    );
    return impact;
  },

  applyDoctorLeave: async (
    doctorId: string,
    startsAt: string,
    endsAt: string,
    reason: string | null | undefined,
    req: LeaveApplyRequest,
    options?: { idempotencyKey?: string }
  ): Promise<DoctorLeave> => {
    if (isDemoMode()) return mockDb.applyDoctorLeave(doctorId, startsAt, endsAt, reason ?? req.reason ?? null, req);
    const expectedVersion = requireExpectedVersion(
      req.expected_version ?? req.expected_schedule_version,
      "the doctor schedule"
    );
    const body: LeaveApplyRequest = {
      preview_token: req.preview_token,
      expected_version: expectedVersion,
      reason: reason ?? req.reason ?? null,
    };
    return requestHttp<DoctorLeave>(`/doctors/${encodeURIComponent(doctorId)}/leave`, {
      method: "POST",
      body,
      idempotent: true,
      idempotencyKey: options?.idempotencyKey,
    });
  },

  // Admin Integrations
  getAdminIntegrations: async (filters?: { state?: string; channel?: string }): Promise<AdminIntegrationItem[]> => {
    if (isDemoMode()) return mockDb.getAdminIntegrations();
    const params = new URLSearchParams();
    if (filters?.state) params.set("state", filters.state);
    if (filters?.channel) params.set("channel", filters.channel);
    const qs = params.toString();
    const res = await requestHttp<{ items: AdminIntegrationItem[]; next_cursor: string | null }>(
      `/admin/integrations${qs ? `?${qs}` : ""}`
    );
    return res.items || [];
  },

  retryIntegration: async (
    operationId: string,
    options?: { expectedVersion?: number; idempotencyKey?: string }
  ): Promise<IntegrationStatus> => {
    const expectedVersion = requireExpectedVersion(options?.expectedVersion, "the integration operation");
    if (isDemoMode()) return mockDb.retryIntegration(operationId, expectedVersion);
    const payload: IntegrationRetryRequest = {
      expected_version: expectedVersion,
    };
    return requestHttp<IntegrationStatus>(
      `/admin/integrations/${encodeURIComponent(operationId)}/retry`,
      {
        method: "POST",
        body: payload,
        idempotent: true,
        idempotencyKey: options?.idempotencyKey,
      }
    );
  },

  // Health
  getHealthLive: async (): Promise<{ status: "ok" }> => {
    return requestHttp<{ status: "ok" }>("/health/live");
  },

  getHealthReady: async (): Promise<{ status: "ok" }> => {
    return requestHttp<{ status: "ok" }>("/health/ready");
  },
};
