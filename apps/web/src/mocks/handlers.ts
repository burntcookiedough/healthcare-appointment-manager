import {
  DoctorDetail,
  DoctorSummary,
  DoctorCreateRequest,
  PatientProfile,
  AppointmentSummary,
  AppointmentDetail,
  AvailabilitySlot,
  Hold,
  HoldCreateRequest,
  HoldConfirmRequest,
  Visit,
  DoctorLeave,
  LeavePreviewRequest,
  LeavePreviewResponse,
  LeaveApplyRequest,
  AdminIntegrationItem,
  Prescription,
  PrescriptionItem,
  MedicationReminder,
  UserContext,
  UserRole,
  ProfileUpdateRequest,
  DoctorUpdateRequest,
  WorkingHoursResponse,
  WorkingHoursReplaceRequest,
  ReminderPreferencesResponse,
  ReminderPreferencesRequest,
} from "@/types/api";
import { formatDateOnly } from "@/lib/dates";
import {
  MOCK_PATIENT,
  MOCK_DOCTORS,
  MOCK_APPOINTMENTS,
  MOCK_VISIT,
  MOCK_LEAVES,
  MOCK_ADMIN_INTEGRATIONS,
  MOCK_PRESCRIPTION,
} from "./data/fixtures";
import { scenarioManager } from "./scenarios";

const STRUCTURED_PRESCRIPTION_FREQUENCIES = new Set([
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "every_4_hours",
  "as_needed",
]);

/**
 * Deterministic In-Memory State Store implementing API_CONTRACT.md endpoints.
 */
class MockDatabase {
  private patient: PatientProfile = { ...MOCK_PATIENT };
  private doctors: DoctorDetail[] = JSON.parse(JSON.stringify(MOCK_DOCTORS));
  private appointments: AppointmentDetail[] = JSON.parse(JSON.stringify(MOCK_APPOINTMENTS));
  private holds: Map<string, Hold> = new Map();
  /** In-memory store of issued leave preview tokens (LEAVE-002: single-use). */
  private leavePreviewTokens: Map<string, { doctor_id: string; starts_at: string; ends_at: string; reason: string | null; schedule_version: number; issued_at: number }> = new Map();
  private visits: Map<string, Visit> = new Map([["vis-001-completed", JSON.parse(JSON.stringify(MOCK_VISIT))]]);
  private prescriptions: Map<string, Prescription> = new Map([["rx-001-aarav", JSON.parse(JSON.stringify(MOCK_PRESCRIPTION))]]);
  private leaves: DoctorLeave[] = JSON.parse(JSON.stringify(MOCK_LEAVES));
  private integrations: AdminIntegrationItem[] = JSON.parse(JSON.stringify(MOCK_ADMIN_INTEGRATIONS));
  private reminderPreferences: ReminderPreferencesResponse = {
    patient_id: "pat-001-aarav",
    version: 1,
    enabled: true,
    channel: "email",
    timezone: "Asia/Kolkata",
    local_times: ["08:00:00", "20:00:00"],
    created_at: "2026-08-24T00:00:00Z",
    updated_at: "2026-08-24T00:00:00Z",
  };
  private activeUser: UserContext = {
    subject_id: "usr-sub-pat-001",
    role: "patient",
    available_roles: ["patient", "doctor", "admin"],
    profile_id: "pat-001-aarav",
    display_name: "Aarav Sharma",
    email: "aarav.sharma@example.in",
  };

  public reset(): void {
    this.patient = JSON.parse(JSON.stringify(MOCK_PATIENT));
    this.doctors = JSON.parse(JSON.stringify(MOCK_DOCTORS));
    this.appointments = JSON.parse(JSON.stringify(MOCK_APPOINTMENTS));
    this.holds = new Map();
    this.leavePreviewTokens = new Map();
    this.visits = new Map([["vis-001-completed", JSON.parse(JSON.stringify(MOCK_VISIT))]]);
    this.prescriptions = new Map([["rx-001-aarav", JSON.parse(JSON.stringify(MOCK_PRESCRIPTION))]]);
    this.leaves = JSON.parse(JSON.stringify(MOCK_LEAVES));
    this.integrations = JSON.parse(JSON.stringify(MOCK_ADMIN_INTEGRATIONS));
    this.reminderPreferences = {
      patient_id: "pat-001-aarav",
      version: 1,
      enabled: true,
      channel: "email",
      timezone: "Asia/Kolkata",
      local_times: ["08:00:00", "20:00:00"],
      created_at: "2026-08-24T00:00:00Z",
      updated_at: "2026-08-24T00:00:00Z",
    };
    this.activeUser = {
      subject_id: "usr-sub-pat-001",
      role: "patient",
      available_roles: ["patient", "doctor", "admin"],
      profile_id: "pat-001-aarav",
      display_name: "Aarav Sharma",
      email: "aarav.sharma@example.in",
    };
  }

  private async simulateNetwork(): Promise<void> {
    const scenario = scenarioManager.getScenario();

    if (scenario === "offline") {
      throw new Error("Network request failed: Client is offline");
    }

    if (scenario === "loading") {
      // Artificial delay
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      // Short realistic delay
      await new Promise((r) => setTimeout(r, 120));
    }

    if (scenario === "request_error") {
      throw {
        status: 500,
        error: {
          code: "INTERNAL_ERROR",
          message: "A transient internal database connection issue occurred. Please retry.",
          retryable: true,
        },
        request_id: `req-${Date.now()}`,
      };
    }
  }

  private requireExpectedVersion(expectedVersion: number | undefined, currentVersion: number, resource: string): void {
    if (
      typeof expectedVersion !== "number" ||
      !Number.isInteger(expectedVersion) ||
      expectedVersion < 1 ||
      expectedVersion !== currentVersion
    ) {
      throw {
        status: 409,
        error: {
          code: "VERSION_CONFLICT",
          message: `${resource} was updated by another request.`,
          details: { current_version: currentVersion },
        },
        request_id: `req-version-${Date.now()}`,
      };
    }
  }

  private requireCurrentVersion(version: number | null | undefined, resource: string): number {
    if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
      throw {
        status: 503,
        error: { code: "DEPENDENCY_UNAVAILABLE", message: `${resource} version is unavailable.` },
        request_id: `req-version-${Date.now()}`,
      };
    }
    return version as number;
  }

  private validatePrescriptionItems(items: PrescriptionItem[]): void {
    for (const [index, item] of items.entries()) {
      const isBlank =
        !item.medication_name?.trim() &&
        !item.dosage?.trim() &&
        !item.route?.trim() &&
        !item.frequency?.trim() &&
        !item.start_date?.trim() &&
        !item.end_date?.trim() &&
        (item.duration_days === undefined || item.duration_days === null || item.duration_days === 0) &&
        !item.instructions?.trim();
      if (isBlank) {
        throw {
          status: 422,
          error: { code: "VALIDATION_FAILED", message: `Prescription item ${index + 1} is incomplete.` },
        };
      }
      if (!item.medication_name?.trim() || !item.dosage?.trim()) {
        throw {
          status: 422,
          error: { code: "VALIDATION_FAILED", message: `Prescription item ${index + 1} is missing medication name or dosage.` },
        };
      }
      if (!STRUCTURED_PRESCRIPTION_FREQUENCIES.has(item.frequency)) {
        throw {
          status: 422,
          error: { code: "VALIDATION_FAILED", message: `Prescription item ${index + 1} has an unsupported frequency.` },
        };
      }
      if (!item.start_date || !item.instructions?.trim()) {
        throw {
          status: 422,
          error: { code: "VALIDATION_FAILED", message: `Prescription item ${index + 1} is missing required instructions or start date.` },
        };
      }
    }
  }

  // Auth / Session
  public async getMe(): Promise<UserContext> {
    await this.simulateNetwork();
    return { ...this.activeUser };
  }

  public setUserRole(role: UserRole): UserContext {
    if (role === "patient") {
      this.activeUser = {
        subject_id: "usr-sub-pat-001",
        role: "patient",
        available_roles: ["patient", "doctor", "admin"],
        profile_id: "pat-001-aarav",
        display_name: "Aarav Sharma",
        email: "aarav.sharma@example.in",
      };
    } else if (role === "doctor") {
      this.activeUser = {
        subject_id: "usr-sub-doc-001",
        role: "doctor",
        available_roles: ["patient", "doctor", "admin"],
        profile_id: "doc-001-rajesh",
        display_name: "Dr. Rajesh Verma",
        email: "dr.rajesh.verma@example.in",
      };
    } else {
      this.activeUser = {
        subject_id: "usr-sub-adm-001",
        role: "admin",
        available_roles: ["patient", "doctor", "admin"],
        profile_id: "adm-001-ops",
        display_name: "Clinic Operations Admin",
        email: "admin.ops@healthcare-portal.in",
      };
    }
    return { ...this.activeUser };
  }

  // Patient Profile
  public async getPatientProfile(): Promise<PatientProfile> {
    await this.simulateNetwork();
    return { ...this.patient };
  }

  public async updatePatientProfile(req: ProfileUpdateRequest): Promise<PatientProfile> {
    await this.simulateNetwork();
    this.requireExpectedVersion(req.expected_version, this.patient.version, "Patient profile");
    if (req.display_name !== undefined && req.display_name !== null) {
      this.patient.display_name = req.display_name;
    }
    if (req.timezone !== undefined && req.timezone !== null) {
      this.patient.timezone = req.timezone;
    }
    this.patient.version += 1;
    this.patient.updated_at = new Date().toISOString();
    return { ...this.patient };
  }

  // Doctors
  public async getDoctors(query?: string, specialization?: string): Promise<DoctorSummary[]> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();
    if (scenario === "empty") return [];

    return this.doctors
      .filter((doc) => doc.is_active)
      .filter((doc) => {
        if (specialization && specialization !== "All") {
          return doc.specialization?.toLowerCase() === specialization.toLowerCase();
        }
        return true;
      })
      .filter((doc) => {
        if (query && query.trim()) {
          const q = query.toLowerCase();
          return (
            doc.name?.toLowerCase().includes(q) === true ||
            doc.display_name?.toLowerCase().includes(q) === true ||
            doc.specialization?.toLowerCase().includes(q) === true ||
            doc.credentials?.toLowerCase().includes(q) === true
          );
        }
        return true;
      })
      .map((d) => ({
        id: d.id,
        name: d.name ?? d.display_name,
        display_name: d.display_name ?? d.name,
        credentials: d.credentials,
        specialization: d.specialization,
        timezone: d.timezone ?? d.time_zone,
        time_zone: d.time_zone ?? d.timezone,
        avatar_url: d.avatar_url,
        next_available_at: d.next_available_at,
        experience_years: d.experience_years,
        consultation_fee: d.consultation_fee,
        appointment_durations_minutes: d.appointment_durations_minutes ?? d.accepted_durations,
        accepted_durations: d.accepted_durations ?? d.appointment_durations_minutes,
        is_active: d.is_active,
        schedule_version: d.schedule_version,
      }));
  }

  public async getDoctorDetail(doctorId: string): Promise<DoctorDetail> {
    await this.simulateNetwork();
    const doc = this.doctors.find((d) => d.id === doctorId);
    if (!doc) {
      throw {
        status: 404,
        error: { code: "RESOURCE_NOT_FOUND", message: "Doctor not found" },
      };
    }
    return { ...doc, name: doc.name ?? doc.display_name, display_name: doc.display_name ?? doc.name };
  }

  public async createDoctor(req: DoctorCreateRequest): Promise<DoctorDetail> {
    await this.simulateNetwork();
    const displayName = (req.display_name ?? req.name)?.trim();
    if (!displayName) {
      throw {
        status: 422,
        error: { code: "VALIDATION_FAILED", message: "Doctor display name is required." },
      };
    }
    const specialization = req.specialization?.trim();
    if (!specialization) {
      throw {
        status: 422,
        error: { code: "VALIDATION_FAILED", message: "Doctor specialization is required." },
      };
    }
    const durations = req.appointment_durations_minutes ?? req.accepted_durations;
    if (!durations || durations.length === 0 || !durations.every((duration) => Number.isInteger(duration) && duration >= 5 && duration <= 480)) {
      throw {
        status: 422,
        error: { code: "VALIDATION_FAILED", message: "Appointment durations must be whole minutes between 5 and 480." },
      };
    }
    const normalizedDurations = Array.from(new Set(durations)).sort((a, b) => a - b);
    const newDoc: DoctorDetail = {
      id: `doc-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      version: 1,
      name: displayName,
      display_name: displayName,
      credentials: req.credentials ?? null,
      specialization,
      experience_years: req.experience_years,
      consultation_fee: req.consultation_fee,
      biography: req.biography,
      languages: req.languages,
      accepted_durations: normalizedDurations,
      appointment_durations_minutes: normalizedDurations,
      time_zone: req.time_zone ?? req.timezone,
      timezone: req.timezone ?? req.time_zone,
      is_active: true,
      schedule_version: 1,
      next_available_at: undefined,
      working_hours: req.working_hours,
    };
    this.doctors.push(newDoc);
    return { ...newDoc };
  }

  public async updateDoctor(doctorId: string, req: DoctorUpdateRequest): Promise<DoctorDetail> {
    await this.simulateNetwork();
    const doctor = this.doctors.find((item) => item.id === doctorId);
    if (!doctor) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Doctor not found" } };
    }
    const currentVersion = this.requireCurrentVersion(doctor.version, "Doctor profile");
    this.requireExpectedVersion(req.expected_version, currentVersion, "Doctor profile");
    if (req.display_name !== undefined && req.display_name !== null) {
      doctor.name = req.display_name;
      doctor.display_name = req.display_name;
    }
    if (req.credentials !== undefined) doctor.credentials = req.credentials;
    if (req.specialization !== undefined && req.specialization !== null) doctor.specialization = req.specialization;
    if (req.timezone !== undefined && req.timezone !== null) {
      doctor.timezone = req.timezone;
      doctor.time_zone = req.timezone;
    }
    if (req.is_active !== undefined && req.is_active !== null) doctor.is_active = req.is_active;
    doctor.version = currentVersion + 1;
    doctor.updated_at = new Date().toISOString();
    return { ...doctor };
  }

  // Doctor Availability Slots
  public async getDoctorAvailability(
    doctorId: string,
    targetDate: Date,
    durationMinutes: number
  ): Promise<AvailabilitySlot[]> {
    await this.simulateNetwork();
    const doc = this.doctors.find((d) => d.id === doctorId);
    if (!doc) return [];

    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) return [];
    const timezone = doc.timezone ?? doc.time_zone;
    if (!timezone) return [];
    const acceptedDurations = doc.appointment_durations_minutes ?? doc.accepted_durations;
    if (!acceptedDurations?.includes(durationMinutes)) return [];
    const dateStr = formatDateOnly(targetDate, timezone);
    // Determine day of week in Asia/Kolkata
    const targetDateAtNoon = new Date(`${dateStr}T12:00:00`);
    const dayOfWeek = targetDateAtNoon.getDay();

    const rule = (doc.working_hours || []).find(
      (r) => (r.day_of_week ?? r.weekday) === dayOfWeek
    );
    if (!rule) return [];

    const startTime = rule.start_time ?? rule.starts_local;
    const endTime = rule.end_time ?? rule.ends_local;
    if (!startTime || !endTime) return [];
    const [startH, startM] = startTime.split(":").map(Number);
    const [endH, endM] = endTime.split(":").map(Number);
    if (
      !Number.isInteger(startH) ||
      !Number.isInteger(startM) ||
      !Number.isInteger(endH) ||
      !Number.isInteger(endM)
    ) return [];

    const slots: AvailabilitySlot[] = [];

    // Check existing doctor leaves
    const doctorLeaves = this.leaves.filter((l) => l.doctor_id === doctorId);

    // Resolve local working hour rule in Asia/Kolkata (+05:30 wall-clock)
    let currentSlotStart = new Date(
      `${dateStr}T${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}:00+05:30`
    );
    const dayEnd = new Date(
      `${dateStr}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00+05:30`
    );

    while (currentSlotStart < dayEnd) {
      const slotEnd = new Date(currentSlotStart.getTime() + durationMinutes * 60 * 1000);
      if (slotEnd > dayEnd) break;

      const slotStartISO = currentSlotStart.toISOString();
      const slotEndISO = slotEnd.toISOString();

      // Check if slot falls in leave
      const isUnderLeave = doctorLeaves.some((leave) => {
        const lStart = new Date(leave.starts_at);
        const lEnd = new Date(leave.ends_at);
        return currentSlotStart < lEnd && slotEnd > lStart;
      });

      // Check if active appointment exists
      const hasConfirmedAppointment = this.appointments.some((apt) => {
        if (apt.doctor_id !== doctorId) return false;
        if (["cancelled_patient", "cancelled_doctor", "cancelled_admin", "cancelled_doctor_leave"].includes(apt.status)) {
          return false;
        }
        const aStart = new Date(apt.starts_at);
        const aEnd = new Date(apt.ends_at);
        return currentSlotStart < aEnd && slotEnd > aStart;
      });

      // Check if active hold exists
      const hasActiveHold = Array.from(this.holds.values()).some((hold) => {
        if (hold.doctor_id !== doctorId || hold.status !== "active") return false;
        if (new Date(hold.expires_at) <= new Date()) return false;
        const hStart = new Date(hold.starts_at);
        const hEnd = new Date(hold.ends_at);
        return currentSlotStart < hEnd && slotEnd > hStart;
      });

      const isAvailable = !isUnderLeave && !hasConfirmedAppointment && !hasActiveHold;

      slots.push({
        doctor_id: doctorId,
        starts_at: slotStartISO,
        ends_at: slotEndISO,
        available: isAvailable,
        conflict_reason: isUnderLeave
          ? "Doctor on approved leave"
          : hasConfirmedAppointment || hasActiveHold
          ? "Slot booked"
          : undefined,
      });

      currentSlotStart = slotEnd;
    }

    return slots;
  }

  public async getDoctorWorkingHours(doctorId: string): Promise<WorkingHoursResponse> {
    await this.simulateNetwork();
    const doctor = this.doctors.find((item) => item.id === doctorId);
    if (!doctor) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Doctor not found" } };
    }
    const timezone = doctor.timezone ?? doctor.time_zone;
    const durations = doctor.appointment_durations_minutes ?? doctor.accepted_durations;
    const scheduleVersion = this.requireCurrentVersion(doctor.schedule_version, "Doctor schedule");
    if (!timezone || !durations || durations.length === 0) {
      throw { status: 503, error: { code: "DEPENDENCY_UNAVAILABLE", message: "Doctor schedule is unavailable." } };
    }
    return {
      doctor_id: doctor.id,
      version: scheduleVersion,
      timezone,
      appointment_durations_minutes: [...durations],
      intervals: (doctor.working_hours ?? []).map((interval) => ({
        weekday: interval.weekday ?? interval.day_of_week,
        starts_local: interval.starts_local ?? interval.start_time,
        ends_local: interval.ends_local ?? interval.end_time,
      })),
    };
  }

  public async replaceDoctorWorkingHours(
    doctorId: string,
    req: WorkingHoursReplaceRequest
  ): Promise<WorkingHoursResponse> {
    await this.simulateNetwork();
    const doctor = this.doctors.find((item) => item.id === doctorId);
    if (!doctor) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Doctor not found" } };
    }
    const currentScheduleVersion = this.requireCurrentVersion(doctor.schedule_version, "Doctor schedule");
    const currentDoctorVersion = this.requireCurrentVersion(doctor.version, "Doctor profile");
    this.requireExpectedVersion(req.expected_version, currentScheduleVersion, "Doctor schedule");
    const durations = req.appointment_durations_minutes;
    if (
      durations !== undefined &&
      durations !== null &&
      !durations.every((duration) => Number.isInteger(duration) && duration >= 5 && duration <= 480)
    ) {
      throw {
        status: 422,
        error: {
          code: "VALIDATION_FAILED",
          message: "Appointment durations must be whole minutes between 5 and 480.",
          fields: [{ path: "appointment_durations_minutes", code: "invalid_duration", message: "Use whole minutes from 5 through 480." }],
        },
      };
    }
    if (req.timezone !== undefined && req.timezone !== null) {
      doctor.timezone = req.timezone;
      doctor.time_zone = req.timezone;
    }
    if (durations !== undefined && durations !== null) {
      const normalizedDurations = Array.from(new Set(durations)).sort((a, b) => a - b);
      doctor.appointment_durations_minutes = normalizedDurations;
      doctor.accepted_durations = [...normalizedDurations];
    }
    doctor.working_hours = req.intervals.map((interval) => ({ ...interval }));
    doctor.schedule_version = currentScheduleVersion + 1;
    doctor.version = currentDoctorVersion + 1;
    doctor.updated_at = new Date().toISOString();
    return this.getDoctorWorkingHours(doctorId);
  }

  // Holds
  public async createHold(req: HoldCreateRequest): Promise<Hold> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();

    if (!Number.isInteger(req.duration_minutes) || req.duration_minutes < 1) {
      throw {
        status: 422,
        error: { code: "VALIDATION_FAILED", message: "A positive appointment duration is required." },
      };
    }

    if (scenario === "validation_error") {
      throw {
        status: 422,
        error: {
          code: "VALIDATION_FAILED",
          message: "Requested appointment duration is outside permitted parameters.",
          fields: [{ path: "duration_minutes", code: "invalid_duration", message: "Duration must be 15, 30, or 45 mins" }],
        },
      };
    }

    const slotStart = new Date(req.starts_at);
    if (Number.isNaN(slotStart.getTime())) {
      throw {
        status: 422,
        error: { code: "VALIDATION_FAILED", message: "A valid appointment start time is required." },
      };
    }
    const duration = req.duration_minutes;
    const slotEnd = new Date(slotStart.getTime() + duration * 60 * 1000);

    // Check conflicts (BOOK-002)
    const hasConflict = this.appointments.some((apt) => {
      if (apt.doctor_id !== req.doctor_id) return false;
      if (["cancelled_patient", "cancelled_doctor", "cancelled_admin", "cancelled_doctor_leave"].includes(apt.status)) {
        return false;
      }
      return slotStart < new Date(apt.ends_at) && slotEnd > new Date(apt.starts_at);
    });

    if (hasConflict) {
      throw {
        status: 409,
        error: {
          code: "SLOT_CONFLICT",
          message: "The selected time slot was just booked by another patient. Please select a different time.",
          retryable: false,
        },
      };
    }

    // Set server-authoritative hold expiry:
    // If scenario is expired_hold, set expiry in the past or 5 seconds from now
    const holdDurationMs = scenario === "expired_hold" ? 5 * 1000 : 5 * 60 * 1000; // 5 minutes standard
    const expiresAt = new Date(Date.now() + holdDurationMs).toISOString();

    const patientId = this.activeUser.profile_id;
    if (!patientId) {
      throw {
        status: 401,
        error: { code: "AUTHENTICATION_REQUIRED", message: "An authenticated patient profile is required to hold a slot." },
      };
    }

    const hold: Hold = {
      id: `hld-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      patient_id: patientId,
      doctor_id: req.doctor_id,
      starts_at: req.starts_at,
      ends_at: slotEnd.toISOString(),
      status: "active",
      expires_at: expiresAt,
    };

    this.holds.set(hold.id, hold);
    return { ...hold };
  }

  public async getHold(holdId: string): Promise<Hold> {
    await this.simulateNetwork();
    const hold = this.holds.get(holdId);
    if (!hold) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Hold reservation not found" } };
    }
    // Update status if expired
    if (hold.status === "active" && new Date(hold.expires_at) <= new Date()) {
      hold.status = "expired";
    }
    return { ...hold };
  }

  public async releaseHold(holdId: string): Promise<void> {
    await this.simulateNetwork();
    const hold = this.holds.get(holdId);
    if (hold) {
      hold.status = "released";
      hold.updated_at = new Date().toISOString();
    }
  }

  public async confirmHold(holdId: string, req: HoldConfirmRequest): Promise<AppointmentDetail> {
    await this.simulateNetwork();
    const hold = this.holds.get(holdId);

    if (!hold) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Hold reservation not found" } };
    }

    // Check if expired (HOLD-002)
    if (hold.status !== "active" || new Date(hold.expires_at) <= new Date()) {
      hold.status = "expired";
      throw {
        status: 409,
        error: {
          code: "HOLD_EXPIRED",
          message: "Your hold reservation has expired. Please select a slot again to book.",
          retryable: false,
        },
      };
    }

    if (!req.symptoms_text || req.symptoms_text.trim().length < 5) {
      throw {
        status: 422,
        error: {
          code: "VALIDATION_FAILED",
          message: "Please describe your symptoms before confirming.",
          fields: [{ path: "symptoms_text", code: "min_length", message: "Symptoms description is required" }],
        },
      };
    }

    // Convert hold atomically (BOOK-004)
    hold.status = "converted";
    hold.updated_at = new Date().toISOString();

    const doc = this.doctors.find((d) => d.id === hold.doctor_id);

    const scenario = scenarioManager.getScenario();
    const isPartialFailure = scenario === "partial_failure";

    const appointment: AppointmentDetail = {
      id: `apt-${Date.now()}`,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      patient_id: hold.patient_id,
      patient_name: this.patient.display_name,
      patient_age: 34,
      patient_gender: "male",
      doctor_id: hold.doctor_id,
      doctor_name: doc?.display_name ?? doc?.name,
      doctor_specialization: doc?.specialization ?? undefined,
      starts_at: hold.starts_at,
      ends_at: hold.ends_at,
      status: "confirmed",
      urgency: null,
      symptom_summary: req.symptoms_text.slice(0, 100) + "…",
      original_symptoms_text: req.symptoms_text,
      symptoms_recorded_at: new Date().toISOString(),
      ai_brief_status: isPartialFailure ? "unavailable" : "ready",
      ai_brief_summary: isPartialFailure
        ? undefined
        : `Patient reports: ${req.symptoms_text}. Initial intake review generated.`,
      integrations: [
        {
          id: `int-${Date.now()}-email`,
          channel: "email",
          state: isPartialFailure ? "failed" : "succeeded",
          attempt_count: 1,
          error_code: isPartialFailure ? "SENDGRID_AUTHENTICATION_ERROR" : undefined,
          error_message: isPartialFailure ? "Email notification failed; retrying in background." : undefined,
        },
        {
          id: `int-${Date.now()}-cal`,
          channel: "calendar",
          state: "succeeded",
          attempt_count: 1,
        },
        {
          id: `int-${Date.now()}-llm`,
          channel: "llm",
          state: isPartialFailure ? "failed" : "succeeded",
          attempt_count: 1,
        },
      ],
    };

    this.appointments.unshift(appointment);
    return { ...appointment };
  }

  // Appointments
  public async getAppointments(role?: UserRole): Promise<AppointmentSummary[]> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();
    if (scenario === "empty") return [];

    let list = [...this.appointments];
    if (role === "doctor") {
      list = list.filter((a) => a.doctor_id === this.activeUser.profile_id);
    } else if (role === "patient") {
      list = list.filter((a) => a.patient_id === this.activeUser.profile_id);
    }

    return list.map((a) => ({
      id: a.id,
      version: a.version,
      created_at: a.created_at,
      updated_at: a.updated_at,
      patient_id: a.patient_id,
      patient_name: a.patient_name,
      patient_age: a.patient_age,
      patient_gender: a.patient_gender,
      doctor_id: a.doctor_id,
      doctor_name: a.doctor_name,
      doctor_specialization: a.doctor_specialization,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
      status: a.status,
      urgency: a.urgency,
      symptom_summary: a.symptom_summary,
      integrations: a.integrations,
      visit_id: a.visit_id,
    }));
  }

  public async getAppointmentDetail(appointmentId: string): Promise<AppointmentDetail> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();
    if (scenario === "forbidden") {
      throw {
        status: 403,
        error: {
          code: "FORBIDDEN",
          message: "You are not authorized to view this clinical appointment record.",
        },
      };
    }

    const apt = this.appointments.find((a) => a.id === appointmentId);
    if (!apt) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Appointment not found" } };
    }
    return { ...apt };
  }

  public async cancelAppointment(
    appointmentId: string,
    reason: string,
    cancelledBy: "patient" | "doctor" | "admin" = "patient",
    expectedVersion?: number
  ): Promise<AppointmentDetail> {
    await this.simulateNetwork();
    const apt = this.appointments.find((a) => a.id === appointmentId);
    if (!apt) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Appointment not found" } };
    }
    this.requireExpectedVersion(expectedVersion, apt.version, "Appointment");

    const statusMap = {
      patient: "cancelled_patient" as const,
      doctor: "cancelled_doctor" as const,
      admin: "cancelled_admin" as const,
    };

    apt.status = statusMap[cancelledBy];
    apt.cancellation_reason = reason;
    apt.cancelled_at = new Date().toISOString();
    apt.cancelled_by = cancelledBy;
    apt.version += 1;
    apt.updated_at = new Date().toISOString();

    return { ...apt };
  }

  public async rescheduleAppointment(
    appointmentId: string,
    newStartsAt: string,
    durationMinutes: number,
    expectedVersion?: number
  ): Promise<AppointmentDetail> {
    await this.simulateNetwork();
    const apt = this.appointments.find((a) => a.id === appointmentId);
    if (!apt) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Appointment not found" } };
    }
    this.requireExpectedVersion(expectedVersion, apt.version, "Appointment");

    if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
      throw {
        status: 422,
        error: { code: "VALIDATION_FAILED", message: "A positive appointment duration is required." },
      };
    }

    const slotStart = new Date(newStartsAt);
    if (Number.isNaN(slotStart.getTime())) {
      throw {
        status: 422,
        error: { code: "VALIDATION_FAILED", message: "A valid appointment start time is required." },
      };
    }
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

    apt.starts_at = slotStart.toISOString();
    apt.ends_at = slotEnd.toISOString();
    apt.version += 1;
    apt.updated_at = new Date().toISOString();

    return { ...apt };
  }

  // Clinical Visits & Prescriptions
  public async getVisit(appointmentId: string): Promise<Visit> {
    await this.simulateNetwork();
    const visit = Array.from(this.visits.values()).find((candidate) => candidate.appointment_id === appointmentId);
    if (!visit) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Clinical visit record not found" } };
    }
    return { ...visit };
  }

  public async getOrCreateVisitForAppointment(appointmentId: string, doctorId: string): Promise<Visit> {
    await this.simulateNetwork();
    const existing = Array.from(this.visits.values()).find((v) => v.appointment_id === appointmentId);
    if (existing) return { ...existing };

    const apt = this.appointments.find((a) => a.id === appointmentId);
    const doc = this.doctors.find((d) => d.id === doctorId);
    if (!apt || !doc) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Appointment or doctor not found" } };
    }

    const visitId = `vis-${Date.now()}`;
    const prescriptionId = `rx-${Date.now()}`;
    const newVisit: Visit = {
      id: visitId,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      appointment_id: appointmentId,
      doctor_id: doctorId,
      patient_id: apt.patient_id,
      status: "draft",
      doctor_notes: "",
      diagnosis: "",
      ai_summary_status: "pending",
      prescription: {
        id: prescriptionId,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        visit_id: visitId,
        doctor_id: doctorId,
        doctor_name: doc.display_name ?? doc.name,
        patient_id: apt.patient_id,
        patient_name: apt.patient_name,
        items: [],
      },
    };

    if (apt) {
      apt.status = "in_progress";
      apt.visit_id = newVisit.id;
    }

    this.visits.set(newVisit.id, newVisit);
    return { ...newVisit };
  }

  public async saveVisitDraft(
    visitId: string,
    notes: string,
    diagnosis: string,
    prescriptionItems: PrescriptionItem[],
    expectedVersion?: number,
    followUpInstructions?: string | null
  ): Promise<Visit> {
    await this.simulateNetwork();
    const visit = this.visits.get(visitId);
    if (!visit) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Visit not found" } };
    }
    this.requireExpectedVersion(expectedVersion, visit.version, "Visit");
    const draftItems = prescriptionItems.filter((item) => {
      return !(
        !item.medication_name?.trim() &&
        !item.dosage?.trim() &&
        !item.route?.trim() &&
        !item.frequency?.trim() &&
        !item.start_date?.trim() &&
        !item.end_date?.trim() &&
        (item.duration_days === undefined || item.duration_days === null || item.duration_days === 0) &&
        !item.instructions?.trim()
      );
    });
    this.validatePrescriptionItems(draftItems);

    visit.doctor_notes = notes;
    visit.diagnosis = diagnosis;
    if (followUpInstructions !== undefined) {
      visit.follow_up_instructions = followUpInstructions;
    }
    if (visit.prescription) {
      visit.prescription.items = draftItems;
      visit.prescription.updated_at = new Date().toISOString();
      visit.prescription.version += 1;
    }
    visit.version += 1;
    visit.updated_at = new Date().toISOString();

    return { ...visit };
  }

  public async completeVisit(
    visitId: string,
    notes: string,
    diagnosis: string,
    prescriptionItems: PrescriptionItem[],
    followUpInstructions?: string,
    expectedVersion?: number
  ): Promise<Visit> {
    await this.simulateNetwork();
    const visit = this.visits.get(visitId);
    if (!visit) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Visit not found" } };
    }
    this.requireExpectedVersion(expectedVersion, visit.version, "Visit");
    this.validatePrescriptionItems(prescriptionItems);

    if (!notes || notes.trim().length < 5) {
      throw {
        status: 422,
        error: {
          code: "VALIDATION_FAILED",
          message: "Clinical consultation notes cannot be empty before finalizing.",
        },
      };
    }

    visit.doctor_notes = notes;
    visit.diagnosis = diagnosis;
    visit.follow_up_instructions = followUpInstructions;
    visit.status = "completed";
    visit.completed_at = new Date().toISOString();
    if (visit.prescription) {
      visit.prescription.items = prescriptionItems;
    }
    visit.ai_summary_status = "ready";
    visit.ai_patient_summary = `Consultation completed by doctor. Notes and structured medication instructions are available for patient reference.`;
    visit.version += 1;
    visit.updated_at = new Date().toISOString();

    // Mark appointment completed
    const apt = this.appointments.find((a) => a.id === visit.appointment_id);
    if (apt) {
      apt.status = "completed";
      apt.version += 1;
      apt.updated_at = new Date().toISOString();
    }

    // Save prescription into repository
    if (visit.prescription) {
      this.prescriptions.set(visit.prescription.id, visit.prescription);
    }

    return { ...visit };
  }

  public async amendVisit(
    visitId: string,
    reason: string,
    notesText: string,
    expectedVersion: number
  ): Promise<Visit> {
    await this.simulateNetwork();
    const visit = this.visits.get(visitId);
    if (!visit) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Visit not found" } };
    }
    this.requireExpectedVersion(expectedVersion, visit.version, "Visit");
    if (visit.status !== "completed") {
      throw { status: 409, error: { code: "INVALID_STATE_TRANSITION", message: "Only completed visits can be amended." } };
    }
    visit.doctor_notes = `${visit.doctor_notes ?? ""}\n\nAmendment (${reason}):\n${notesText}`.trim();
    visit.version += 1;
    visit.updated_at = new Date().toISOString();
    return { ...visit };
  }

  // Medication Reminders (Derived deterministically from structured RX fields - RX-002)
  public async getReminderPreferences(): Promise<ReminderPreferencesResponse> {
    await this.simulateNetwork();
    return { ...this.reminderPreferences, local_times: [...this.reminderPreferences.local_times] };
  }

  public async updateReminderPreferences(req: ReminderPreferencesRequest): Promise<ReminderPreferencesResponse> {
    await this.simulateNetwork();
    this.requireExpectedVersion(req.expected_version, this.reminderPreferences.version, "Reminder preferences");
    this.reminderPreferences = {
      ...this.reminderPreferences,
      version: this.reminderPreferences.version + 1,
      enabled: req.enabled,
      channel: req.channel,
      timezone: req.timezone,
      local_times: [...req.local_times],
      updated_at: new Date().toISOString(),
    };
    return this.getReminderPreferences();
  }

  public async getPatientReminders(patientId: string): Promise<MedicationReminder[]> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();
    if (scenario === "empty") return [];

    const reminders: MedicationReminder[] = [];
    const patientPrescriptions = Array.from(this.prescriptions.values()).filter(
      (rx) => rx.patient_id === patientId
    );

    const todayStr = formatDateOnly(new Date(), this.reminderPreferences.timezone);

    for (const rx of patientPrescriptions) {
      for (const item of rx.items) {
        // Derive times only from the structured frequency enum. Unknown and as-needed
        // prescriptions have no deterministic occurrences and are not fabricated.
        const times = {
          once_daily: ["09:00 AM"],
          twice_daily: ["09:00 AM", "09:00 PM"],
          three_times_daily: ["08:00 AM", "02:00 PM", "08:00 PM"],
          every_4_hours: ["12:00 AM", "04:00 AM", "08:00 AM", "12:00 PM", "04:00 PM", "08:00 PM"],
          as_needed: [],
        }[item.frequency] ?? [];

        for (const time of times) {
          reminders.push({
            id: `rem-${item.id}-${time.replace(/\s+/g, "")}`,
            prescription_item_id: item.id,
            medication_name: item.medication_name,
            dosage: item.dosage,
            time_of_day: time,
            scheduled_date: todayStr,
            taken: false,
            instructions: item.instructions,
            route: item.route ?? "Route not provided",
          });
        }
      }
    }

    return reminders;
  }

  // Doctor Leave Management (LEAVE-001, LEAVE-002, LEAVE-003)
  public async getDoctorLeaves(doctorId?: string): Promise<DoctorLeave[]> {
    await this.simulateNetwork();
    if (doctorId) {
      return this.leaves.filter((l) => l.doctor_id === doctorId);
    }
    return [...this.leaves];
  }

  public async previewDoctorLeave(doctorId: string, req: LeavePreviewRequest): Promise<LeavePreviewResponse> {
    await this.simulateNetwork();
    const doc = this.doctors.find((d) => d.id === doctorId);
    if (!doc) {
      throw {
        status: 404,
        error: { code: "RESOURCE_NOT_FOUND", message: "Doctor not found" },
      };
    }

    const lStart = new Date(req.starts_at);
    const lEnd = new Date(req.ends_at);
    if (isNaN(lStart.getTime()) || isNaN(lEnd.getTime()) || lStart >= lEnd) {
      throw {
        status: 422,
        error: { code: "INVALID_INTERVAL", message: "Leave start time must precede end time." },
      };
    }

    // Find affected active holds
    const affectedHolds = Array.from(this.holds.values()).filter((h) => {
      if (h.doctor_id !== doctorId || h.status !== "active") return false;
      if (new Date(h.expires_at) <= new Date()) return false;
      return lStart < new Date(h.ends_at) && lEnd > new Date(h.starts_at);
    });

    // Find affected confirmed appointments ONLY (LEAVE-003: only confirmed are affected)
    const affectedAppointments = this.appointments.filter((apt) => {
      if (apt.doctor_id !== doctorId) return false;
      if (apt.status !== "confirmed") return false;
      return lStart < new Date(apt.ends_at) && lEnd > new Date(apt.starts_at);
    });

    const previewToken = `prev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const scheduleVersion = doc.schedule_version;
    if (typeof scheduleVersion !== "number" || !Number.isInteger(scheduleVersion) || scheduleVersion < 1) {
      throw { status: 503, error: { code: "DEPENDENCY_UNAVAILABLE", message: "Doctor schedule version is unavailable." } };
    }

    // Store token for single-use enforcement and binding validation (LEAVE-002)
    this.leavePreviewTokens.set(previewToken, {
      doctor_id: doctorId,
      starts_at: req.starts_at,
      ends_at: req.ends_at,
      reason: req.reason || null,
      schedule_version: scheduleVersion,
      issued_at: Date.now(),
    });

    return {
      preview_token: previewToken,
      doctor_id: doctorId,
      starts_at: req.starts_at,
      ends_at: req.ends_at,
      reason: req.reason,
      affected_holds_count: affectedHolds.length,
      affected_hold_count: affectedHolds.length,
      affected_hold_ids: affectedHolds.map((hold) => hold.id),
      affected_appointments: affectedAppointments,
      affected_appointment_count: affectedAppointments.length,
      affected_appointment_ids: affectedAppointments.map((appointment) => appointment.id),
      expected_schedule_version: scheduleVersion,
      schedule_version: scheduleVersion,
      expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    };
  }

  public async applyDoctorLeave(
    doctorId: string,
    startsAt: string,
    endsAt: string,
    reason: string | null | undefined,
    req: LeaveApplyRequest
  ): Promise<DoctorLeave> {
    await this.simulateNetwork();

    // 1. Validate token existence
    const tokenMeta = this.leavePreviewTokens.get(req.preview_token);
    if (!tokenMeta) {
      throw {
        status: 409,
        error: {
          code: "LEAVE_PREVIEW_STALE",
          message:
            "The leave preview token is invalid or has already been used. Please generate a new impact preview.",
          retryable: false,
        },
      };
    }

    // 2. Validate token expiry (15-minute TTL)
    const TOKEN_TTL_MS = 15 * 60 * 1000;
    if (Date.now() - tokenMeta.issued_at > TOKEN_TTL_MS) {
      this.leavePreviewTokens.delete(req.preview_token);
      throw {
        status: 409,
        error: {
          code: "LEAVE_PREVIEW_STALE",
          message:
            "The leave preview token has expired (15-minute TTL). Please generate a new impact preview.",
          retryable: false,
        },
      };
    }

    // 3. Validate doctor existence
    const doc = this.doctors.find((d) => d.id === doctorId);
    if (!doc) {
      this.leavePreviewTokens.delete(req.preview_token);
      throw {
        status: 404,
        error: { code: "RESOURCE_NOT_FOUND", message: "Doctor not found." },
      };
    }

    // 4. Validate interval
    const lStart = new Date(startsAt);
    const lEnd = new Date(endsAt);
    if (isNaN(lStart.getTime()) || isNaN(lEnd.getTime()) || lStart >= lEnd) {
      this.leavePreviewTokens.delete(req.preview_token);
      throw {
        status: 409,
        error: {
          code: "LEAVE_PREVIEW_STALE",
          message: "Invalid leave interval parameters.",
          retryable: false,
        },
      };
    }

    // 5. Exact doctor/start/end/reason match AND schedule version match
    const doctorCurrentScheduleVersion = this.requireCurrentVersion(doc.schedule_version, "Doctor schedule");
    const doctorCurrentVersion = this.requireCurrentVersion(doc.version, "Doctor profile");
    const expectedScheduleVersion = req.expected_version ?? req.expected_schedule_version;
    if (
      tokenMeta.doctor_id !== doctorId ||
      tokenMeta.starts_at !== startsAt ||
      tokenMeta.ends_at !== endsAt ||
      tokenMeta.reason !== (reason ?? null) ||
      typeof expectedScheduleVersion !== "number" ||
      !Number.isInteger(expectedScheduleVersion) ||
      expectedScheduleVersion < 1 ||
      tokenMeta.schedule_version !== expectedScheduleVersion ||
      doctorCurrentScheduleVersion !== expectedScheduleVersion
    ) {
      this.leavePreviewTokens.delete(req.preview_token);
      throw {
        status: 409,
        error: {
          code: "LEAVE_PREVIEW_STALE",
          message:
            "The leave parameters or schedule version do not match the current doctor schedule. Please generate a new impact preview.",
          retryable: false,
        },
      };
    }

    // 6. Stage prospective changes
    // Determine affected active holds
    const affectedHolds: Hold[] = [];
    for (const hold of this.holds.values()) {
      if (hold.doctor_id === doctorId && hold.status === "active") {
        if (new Date(hold.expires_at) > new Date() && lStart < new Date(hold.ends_at) && lEnd > new Date(hold.starts_at)) {
          affectedHolds.push(hold);
        }
      }
    }

    // Determine affected confirmed appointments ONLY
    const affectedConfirmedAppointments: AppointmentDetail[] = [];
    for (const apt of this.appointments) {
      if (apt.doctor_id === doctorId && apt.status === "confirmed") {
        if (lStart < new Date(apt.ends_at) && lEnd > new Date(apt.starts_at)) {
          affectedConfirmedAppointments.push(apt);
        }
      }
    }

    // Construct integration outbox records (OUTBOX-001, OUTBOX-002, DATA-001)
    const stagedIntegrations: AdminIntegrationItem[] = [];
    const timestampISO = new Date().toISOString();
    for (const apt of affectedConfirmedAppointments) {
      // 1. Email notification intent
      stagedIntegrations.push({
        id: `int-leave-email-${apt.id}`,
        operation_id: `op-leave-email-${apt.id}`,
        channel: "email",
        state: "pending",
        target_id: apt.id,
        target_type: "appointment",
        attempt_count: 0,
        max_attempts: 3,
        version: 1,
        created_at: timestampISO,
        updated_at: timestampISO,
        payload_summary: "Doctor-leave appointment cancellation notification queued.",
      });

      // 2. Calendar cancellation intent
      stagedIntegrations.push({
        id: `int-leave-cal-${apt.id}`,
        operation_id: `op-leave-cal-${apt.id}`,
        channel: "calendar",
        state: "pending",
        target_id: apt.id,
        target_type: "appointment",
        attempt_count: 0,
        max_attempts: 3,
        version: 1,
        created_at: timestampISO,
        updated_at: timestampISO,
        payload_summary: "Doctor-leave appointment cancellation notification queued.",
      });
    }

    // 7. Atomic Commit of all staged mutations
    // Consume single-use token
    this.leavePreviewTokens.delete(req.preview_token);

    // Release affected active holds
    for (const hold of affectedHolds) {
      hold.status = "released";
      hold.updated_at = timestampISO;
    }

    // Transition only confirmed appointments to cancelled_doctor_leave
    for (const apt of affectedConfirmedAppointments) {
      apt.status = "cancelled_doctor_leave";
      apt.cancellation_reason = reason
        ? `Doctor on approved leave: ${reason}`
        : "Doctor on approved leave";
      apt.cancelled_at = timestampISO;
      apt.cancelled_by = "admin_leave_manager";
      apt.version += 1;
      apt.updated_at = timestampISO;
      if (!apt.integrations) {
        apt.integrations = [];
      }
      apt.integrations.push(
        {
          id: `int-leave-email-${apt.id}`,
          channel: "email",
          state: "pending",
          attempt_count: 0,
          version: 1,
          created_at: timestampISO,
          updated_at: timestampISO,
        },
        {
          id: `int-leave-cal-${apt.id}`,
          channel: "calendar",
          state: "pending",
          attempt_count: 0,
          version: 1,
          created_at: timestampISO,
          updated_at: timestampISO,
        }
      );
    }

    // Prepend new outbox integration records
    this.integrations.unshift(...stagedIntegrations);

    // Increment doctor's schedule version
    doc.schedule_version = doctorCurrentScheduleVersion + 1;
    doc.version = doctorCurrentVersion + 1;

    // Create doctor leave record
    const newLeave: DoctorLeave = {
      id: `leave-${Date.now()}`,
      doctor_id: doctorId,
      doctor_name: doc.display_name ?? doc.name,
      starts_at: startsAt,
      ends_at: endsAt,
      reason: reason ?? null,
      created_at: timestampISO,
    };
    this.leaves.unshift(newLeave);

    return { ...newLeave };
  }

  // Admin Integrations & Retries
  public async getAdminIntegrations(): Promise<AdminIntegrationItem[]> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();
    if (scenario === "empty") return [];
    return [...this.integrations];
  }

  public async retryIntegration(operationId: string, expectedVersion: number): Promise<AdminIntegrationItem> {
    await this.simulateNetwork();
    const item = this.integrations.find((i) => i.id === operationId || i.operation_id === operationId);
    if (!item) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Integration operation not found" } };
    }
    const currentVersion = this.requireCurrentVersion(item.version, "Integration operation");
    this.requireExpectedVersion(expectedVersion, currentVersion, "Integration operation");

    item.state = "succeeded";
    item.attempt_count += 1;
    item.last_attempt_at = new Date().toISOString();
    item.error_code = undefined;
    item.error_message = undefined;
    item.version = currentVersion + 1;

    return { ...item };
  }
}

export const mockDb = new MockDatabase();
