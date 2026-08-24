import {
  DoctorDetail,
  DoctorSummary,
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
  AdminIntegrationItem,
  Prescription,
  PrescriptionItem,
  MedicationReminder,
  UserContext,
  UserRole,
} from "@/types/api";
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
import { addDays, parseDate } from "@/lib/dates";

/**
 * Deterministic In-Memory State Store implementing API_CONTRACT.md endpoints.
 */
class MockDatabase {
  private patient: PatientProfile = { ...MOCK_PATIENT };
  private doctors: DoctorDetail[] = JSON.parse(JSON.stringify(MOCK_DOCTORS));
  private appointments: AppointmentDetail[] = JSON.parse(JSON.stringify(MOCK_APPOINTMENTS));
  private holds: Map<string, Hold> = new Map();
  private visits: Map<string, Visit> = new Map([["vis-001-completed", JSON.parse(JSON.stringify(MOCK_VISIT))]]);
  private prescriptions: Map<string, Prescription> = new Map([["rx-001-aarav", JSON.parse(JSON.stringify(MOCK_PRESCRIPTION))]]);
  private leaves: DoctorLeave[] = JSON.parse(JSON.stringify(MOCK_LEAVES));
  private integrations: AdminIntegrationItem[] = JSON.parse(JSON.stringify(MOCK_ADMIN_INTEGRATIONS));
  private activeUser: UserContext = {
    subject_id: "usr-sub-pat-001",
    role: "patient",
    available_roles: ["patient", "doctor", "admin"],
    profile_id: "pat-001-aarav",
    display_name: "Aarav Sharma",
    email: "aarav.sharma@example.in",
  };

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

  // Doctors
  public async getDoctors(query?: string, specialization?: string): Promise<DoctorSummary[]> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();
    if (scenario === "empty") return [];

    return this.doctors
      .filter((doc) => doc.is_active)
      .filter((doc) => {
        if (specialization && specialization !== "All") {
          return doc.specialization.toLowerCase() === specialization.toLowerCase();
        }
        return true;
      })
      .filter((doc) => {
        if (query && query.trim()) {
          const q = query.toLowerCase();
          return (
            doc.name.toLowerCase().includes(q) ||
            doc.specialization.toLowerCase().includes(q) ||
            doc.credentials.toLowerCase().includes(q)
          );
        }
        return true;
      })
      .map((d) => ({
        id: d.id,
        name: d.name,
        credentials: d.credentials,
        specialization: d.specialization,
        avatar_url: d.avatar_url,
        next_available_at: d.next_available_at,
        experience_years: d.experience_years,
        consultation_fee: d.consultation_fee,
        is_active: d.is_active,
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
    return { ...doc };
  }

  // Doctor Availability Slots
  public async getDoctorAvailability(
    doctorId: string,
    targetDate: Date,
    durationMinutes = 30
  ): Promise<AvailabilitySlot[]> {
    await this.simulateNetwork();
    const doc = this.doctors.find((d) => d.id === doctorId);
    if (!doc) return [];

    const dayOfWeek = targetDate.getDay();
    const rule = doc.working_hours.find((r) => r.day_of_week === dayOfWeek);
    if (!rule) return [];

    const [startH, startM] = rule.start_time.split(":").map(Number);
    const [endH, endM] = rule.end_time.split(":").map(Number);

    const slots: AvailabilitySlot[] = [];
    const dateStr = targetDate.toISOString().split("T")[0];

    // Check existing doctor leaves
    const doctorLeaves = this.leaves.filter((l) => l.doctor_id === doctorId);

    let currentSlotStart = new Date(`${dateStr}T${String(startH).padStart(2, "0")}:${String(startM).padStart(2, "0")}:00.000Z`);
    const dayEnd = new Date(`${dateStr}T${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}:00.000Z`);

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

  // Holds
  public async createHold(req: HoldCreateRequest): Promise<Hold> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();

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
    const slotEnd = new Date(slotStart.getTime() + req.duration_minutes * 60 * 1000);

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

    const hold: Hold = {
      id: `hld-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      patient_id: this.activeUser.profile_id,
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
      doctor_name: doc?.name || "Doctor",
      doctor_specialization: doc?.specialization || "General Medicine",
      starts_at: hold.starts_at,
      ends_at: hold.ends_at,
      status: "confirmed",
      urgency: "routine",
      symptom_summary: req.symptoms_text.slice(0, 100) + "…",
      original_symptoms_text: req.symptoms_text,
      symptoms_recorded_at: new Date().toISOString(),
      ai_brief_status: isPartialFailure ? "unavailable" : "ready",
      ai_brief_summary: isPartialFailure
        ? undefined
        : `Patient reports: ${req.symptoms_text}. Initial intake review generated.`,
      ai_brief_urgency: "routine",
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
    cancelledBy: "patient" | "doctor" | "admin" = "patient"
  ): Promise<AppointmentDetail> {
    await this.simulateNetwork();
    const apt = this.appointments.find((a) => a.id === appointmentId);
    if (!apt) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Appointment not found" } };
    }

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
    durationMinutes = 30
  ): Promise<AppointmentDetail> {
    await this.simulateNetwork();
    const apt = this.appointments.find((a) => a.id === appointmentId);
    if (!apt) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Appointment not found" } };
    }

    const slotStart = new Date(newStartsAt);
    const slotEnd = new Date(slotStart.getTime() + durationMinutes * 60 * 1000);

    apt.starts_at = slotStart.toISOString();
    apt.ends_at = slotEnd.toISOString();
    apt.version += 1;
    apt.updated_at = new Date().toISOString();

    return { ...apt };
  }

  // Clinical Visits & Prescriptions
  public async getVisit(visitId: string): Promise<Visit> {
    await this.simulateNetwork();
    const visit = this.visits.get(visitId);
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

    const newVisit: Visit = {
      id: `vis-${Date.now()}`,
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      appointment_id: appointmentId,
      doctor_id: doctorId,
      patient_id: apt?.patient_id || "pat-001-aarav",
      status: "draft",
      doctor_notes: "",
      diagnosis: "",
      ai_summary_status: "pending",
      prescription: {
        id: `rx-${Date.now()}`,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        visit_id: `vis-${Date.now()}`,
        doctor_id: doctorId,
        doctor_name: doc?.name || "Doctor",
        patient_id: apt?.patient_id || "pat-001-aarav",
        patient_name: apt?.patient_name || "Patient",
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
    prescriptionItems: PrescriptionItem[]
  ): Promise<Visit> {
    await this.simulateNetwork();
    const visit = this.visits.get(visitId);
    if (!visit) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Visit not found" } };
    }

    visit.doctor_notes = notes;
    visit.diagnosis = diagnosis;
    if (visit.prescription) {
      visit.prescription.items = prescriptionItems;
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
    followUpInstructions?: string
  ): Promise<Visit> {
    await this.simulateNetwork();
    const visit = this.visits.get(visitId);
    if (!visit) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Visit not found" } };
    }

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

  // Medication Reminders (Derived deterministically from structured RX fields - RX-002)
  public async getPatientReminders(patientId: string): Promise<MedicationReminder[]> {
    await this.simulateNetwork();
    const scenario = scenarioManager.getScenario();
    if (scenario === "empty") return [];

    const reminders: MedicationReminder[] = [];
    const patientPrescriptions = Array.from(this.prescriptions.values()).filter(
      (rx) => rx.patient_id === patientId
    );

    const todayStr = new Date().toISOString().split("T")[0];

    for (const rx of patientPrescriptions) {
      for (const item of rx.items) {
        // Derive times based on structured frequency string
        const freq = item.frequency.toLowerCase();
        let times: string[] = ["08:00 AM"];

        if (freq.includes("twice") || freq.includes("2 times") || freq.includes("bid")) {
          times = ["08:30 AM", "08:30 PM"];
        } else if (freq.includes("three") || freq.includes("3 times") || freq.includes("tid")) {
          times = ["08:00 AM", "02:00 PM", "08:00 PM"];
        } else if (freq.includes("bedtime") || freq.includes("night") || freq.includes("hs")) {
          times = ["10:00 PM"];
        } else if (freq.includes("morning") || freq.includes("once")) {
          times = ["08:00 AM"];
        }

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
            route: item.route,
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
    const lStart = new Date(req.starts_at);
    const lEnd = new Date(req.ends_at);

    // Find affected active holds
    const affectedHolds = Array.from(this.holds.values()).filter((h) => {
      if (h.doctor_id !== doctorId || h.status !== "active") return false;
      if (new Date(h.expires_at) <= new Date()) return false;
      return lStart < new Date(h.ends_at) && lEnd > new Date(h.starts_at);
    });

    // Find affected confirmed appointments
    const affectedAppointments = this.appointments.filter((apt) => {
      if (apt.doctor_id !== doctorId) return false;
      if (["cancelled_patient", "cancelled_doctor", "cancelled_admin", "cancelled_doctor_leave"].includes(apt.status)) {
        return false;
      }
      return lStart < new Date(apt.ends_at) && lEnd > new Date(apt.starts_at);
    });

    const previewToken = `prev-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    return {
      preview_token: previewToken,
      doctor_id: doctorId,
      starts_at: req.starts_at,
      ends_at: req.ends_at,
      affected_holds_count: affectedHolds.length,
      affected_appointments: affectedAppointments,
      schedule_version: 1,
    };
  }

  public async applyDoctorLeave(
    doctorId: string,
    startsAt: string,
    endsAt: string,
    reason: string,
    _previewToken: string
  ): Promise<DoctorLeave> {
    await this.simulateNetwork();
    const doc = this.doctors.find((d) => d.id === doctorId);
    const lStart = new Date(startsAt);
    const lEnd = new Date(endsAt);

    // Invalidate affected active holds
    for (const hold of this.holds.values()) {
      if (hold.doctor_id === doctorId && hold.status === "active") {
        if (lStart < new Date(hold.ends_at) && lEnd > new Date(hold.starts_at)) {
          hold.status = "released";
          hold.updated_at = new Date().toISOString();
        }
      }
    }

    // Atomically cancel affected appointments as cancelled_doctor_leave (LEAVE-003)
    for (const apt of this.appointments) {
      if (apt.doctor_id === doctorId) {
        if (!["cancelled_patient", "cancelled_doctor", "cancelled_admin", "cancelled_doctor_leave"].includes(apt.status)) {
          if (lStart < new Date(apt.ends_at) && lEnd > new Date(apt.starts_at)) {
            apt.status = "cancelled_doctor_leave";
            apt.cancellation_reason = `Doctor on approved leave: ${reason}`;
            apt.cancelled_at = new Date().toISOString();
            apt.cancelled_by = "admin_leave_manager";
            apt.version += 1;
            apt.updated_at = new Date().toISOString();

            // Record outbox email notification event
            this.integrations.unshift({
              id: `int-leave-${Date.now()}`,
              operation_id: `op-leave-cancel-${apt.id}`,
              channel: "email",
              state: "succeeded",
              target_id: apt.id,
              target_type: "appointment",
              attempt_count: 1,
              max_attempts: 3,
              created_at: new Date().toISOString(),
              last_attempt_at: new Date().toISOString(),
              payload_summary: `Cancellation notification sent to ${apt.patient_name} due to doctor leave`,
            });
          }
        }
      }
    }

    const newLeave: DoctorLeave = {
      id: `leave-${Date.now()}`,
      doctor_id: doctorId,
      doctor_name: doc?.name || "Doctor",
      starts_at: startsAt,
      ends_at: endsAt,
      reason,
      created_at: new Date().toISOString(),
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

  public async retryIntegration(operationId: string): Promise<AdminIntegrationItem> {
    await this.simulateNetwork();
    const item = this.integrations.find((i) => i.operation_id === operationId);
    if (!item) {
      throw { status: 404, error: { code: "RESOURCE_NOT_FOUND", message: "Integration operation not found" } };
    }

    item.state = "succeeded";
    item.attempt_count += 1;
    item.last_attempt_at = new Date().toISOString();
    item.error_code = undefined;
    item.error_message = undefined;

    return { ...item };
  }
}

export const mockDb = new MockDatabase();
