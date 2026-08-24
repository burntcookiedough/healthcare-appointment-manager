/**
 * Domain-aligned API types matching docs/API_CONTRACT.md and docs/DOMAIN_RULES.md.
 * These types define the contract-shaped boundary for the frontend.
 */

export type UserRole = "patient" | "doctor" | "admin";

export interface UserContext {
  subject_id: string;
  role: UserRole;
  available_roles: UserRole[];
  profile_id: string;
  display_name: string;
  email: string;
  avatar_url?: string;
}

export interface PatientProfile {
  id: string;
  version: number;
  subject_id: string;
  display_name: string;
  email: string;
  phone: string;
  date_of_birth: string;
  gender: "male" | "female" | "other";
  blood_group?: string;
  emergency_contact?: {
    name: string;
    relationship: string;
    phone: string;
  };
  time_zone: string;
  created_at: string;
  updated_at: string;
}

export interface WorkingHoursRule {
  day_of_week: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  start_time: string; // "09:00"
  end_time: string; // "17:00"
  slot_duration_minutes: number;
}

export interface DoctorSummary {
  id: string;
  name: string;
  credentials: string;
  specialization: string;
  avatar_url?: string;
  next_available_at: string;
  experience_years: number;
  consultation_fee: number;
  is_active: boolean;
  schedule_version: number;
}

export interface DoctorDetail extends DoctorSummary {
  biography: string;
  languages: string[];
  accepted_durations: number[]; // [15, 30, 45]
  time_zone: string; // "Asia/Kolkata"
  working_hours: WorkingHoursRule[];
}

export interface AvailabilitySlot {
  doctor_id: string;
  starts_at: string; // UTC ISO 8601
  ends_at: string; // UTC ISO 8601
  available: boolean;
  conflict_reason?: string;
}

export type HoldStatus = "active" | "released" | "expired" | "converted";

export interface Hold {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  patient_id: string;
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  status: HoldStatus;
  expires_at: string; // UTC ISO 8601 - authoritative absolute server expiry
}

export interface HoldCreateRequest {
  doctor_id: string;
  starts_at: string;
  duration_minutes: number;
}

export interface HoldConfirmRequest {
  symptoms_text: string;
}

export type AppointmentStatus =
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled_patient"
  | "cancelled_doctor"
  | "cancelled_admin"
  | "cancelled_doctor_leave";

export type UrgencyLevel = "routine" | "urgent" | "emergency";

export type IntegrationChannel =
  | "email"
  | "calendar"
  | "llm"
  | "appointment_reminder"
  | "medication_reminder";

export type IntegrationState = "pending" | "succeeded" | "retrying" | "failed";

export interface IntegrationStatus {
  id: string;
  channel: IntegrationChannel;
  state: IntegrationState;
  last_attempt_at?: string;
  attempt_count: number;
  error_code?: string;
  error_message?: string;
  appointment_id?: string;
}

export interface AppointmentSummary {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  patient_id: string;
  patient_name: string;
  patient_age?: number;
  patient_gender?: string;
  doctor_id: string;
  doctor_name: string;
  doctor_specialization: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  urgency?: UrgencyLevel;
  symptom_summary?: string;
  integrations: IntegrationStatus[];
  visit_id?: string;
}

export type AiBriefStatus = "pending" | "ready" | "unavailable";

export interface AppointmentDetail extends AppointmentSummary {
  original_symptoms_text: string;
  symptoms_recorded_at: string;
  ai_brief_status: AiBriefStatus;
  ai_brief_summary?: string;
  ai_brief_urgency?: UrgencyLevel;
  ai_brief_key_concerns?: string[];
  cancellation_reason?: string;
  cancelled_at?: string;
  cancelled_by?: string;
}

export interface PrescriptionItem {
  id: string;
  medication_name: string;
  dosage: string; // e.g. "500mg"
  route: string; // e.g. "Oral", "Topical", "Inhalation"
  frequency: string; // e.g. "Twice daily after meals", "Once daily morning"
  start_date: string; // YYYY-MM-DD
  end_date?: string; // YYYY-MM-DD
  duration_days?: number;
  instructions: string;
}

export interface Prescription {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  visit_id: string;
  doctor_id: string;
  doctor_name: string;
  patient_id: string;
  patient_name: string;
  items: PrescriptionItem[];
}

export interface MedicationReminder {
  id: string;
  prescription_item_id: string;
  medication_name: string;
  dosage: string;
  time_of_day: string; // e.g. "08:00 AM", "02:00 PM", "08:00 PM"
  scheduled_date: string; // YYYY-MM-DD
  taken: boolean;
  instructions: string;
  route: string;
}

export type VisitStatus = "draft" | "completed";

export interface Visit {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  appointment_id: string;
  doctor_id: string;
  patient_id: string;
  status: VisitStatus;
  doctor_notes: string;
  diagnosis?: string;
  follow_up_instructions?: string;
  completed_at?: string;
  prescription?: Prescription;
  ai_summary_status: AiBriefStatus;
  ai_patient_summary?: string;
}

export interface DoctorLeave {
  id: string;
  doctor_id: string;
  doctor_name?: string;
  starts_at: string; // UTC ISO 8601
  ends_at: string; // UTC ISO 8601
  reason: string;
  created_at: string;
}

export interface LeavePreviewRequest {
  starts_at: string;
  ends_at: string;
  reason: string;
}

export interface LeavePreviewResponse {
  preview_token: string;
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  reason: string;
  affected_holds_count: number;
  affected_appointments: AppointmentSummary[];
  schedule_version: number;
}

export interface LeaveApplyRequest {
  preview_token: string;
  expected_schedule_version: number;
}

export interface AdminIntegrationItem {
  id: string;
  operation_id: string;
  channel: IntegrationChannel;
  state: IntegrationState;
  target_id: string;
  target_type: "appointment" | "reminder" | "leave" | "visit";
  error_code?: string;
  error_message?: string;
  attempt_count: number;
  max_attempts: number;
  created_at: string;
  last_attempt_at?: string;
  next_attempt_at?: string;
  payload_summary: string;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: Array<{ path: string; code: string; message: string }>;
    retryable?: boolean;
    details?: Record<string, unknown>;
  };
  request_id: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  next_cursor: string | null;
  total_count?: number;
}
