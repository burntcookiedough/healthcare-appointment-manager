/**
 * Domain-aligned API types matching docs/API_CONTRACT.md, docs/DOMAIN_RULES.md,
 * apps/api/src/healthcare_api/schemas.py, and apps/api/src/healthcare_api/domain_schemas.py.
 */

export type UserRole = "patient" | "doctor" | "admin";

export interface UserContext {
  subject_id: string;
  role: UserRole;
  available_roles: UserRole[];
  profile_id: string | null;
  display_name?: string;
  email?: string;
  avatar_url?: string;
}

export interface PatientProfile {
  id: string;
  version: number;
  created_at: string;
  updated_at: string;
  display_name: string;
  timezone?: string;
  // UI / demo compatibility
  subject_id?: string;
  email?: string;
  phone?: string;
  date_of_birth?: string;
  gender?: "male" | "female" | "other";
  blood_group?: string;
  emergency_contact?: {
    name: string;
    relationship: string;
    phone: string;
  };
  time_zone?: string;
}

export interface ProfileUpdateRequest {
  expected_version: number;
  display_name?: string | null;
  timezone?: string | null;
}

export interface WorkingHourInterval {
  weekday?: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  starts_local?: string; // "09:00:00" or "09:00"
  ends_local?: string; // "17:00:00" or "17:00"
  // UI / fixture helpers
  day_of_week?: number;
  start_time?: string;
  end_time?: string;
  slot_duration_minutes?: number;
}

export type WorkingHoursRule = WorkingHourInterval;

export interface WorkingHoursResponse {
  doctor_id: string;
  version: number;
  timezone: string;
  appointment_durations_minutes: number[];
  intervals: WorkingHourInterval[];
}

export interface WorkingHoursReplaceRequest {
  expected_version: number;
  timezone?: string | null;
  appointment_durations_minutes?: number[] | null;
  intervals: WorkingHourInterval[];
}

export interface DoctorSummary {
  id: string;
  version?: number;
  created_at?: string;
  updated_at?: string;
  display_name?: string;
  name?: string; // Compatibility helper mapping to display_name
  credentials?: string | null;
  specialization?: string | null;
  timezone?: string;
  time_zone?: string; // Compatibility helper mapping to timezone
  appointment_durations_minutes?: number[];
  accepted_durations?: number[]; // Compatibility helper
  is_active: boolean;
  avatar_url?: string | null;
  biography?: string | null;
  next_available_at?: string | null;
  schedule_version?: number;
  experience_years?: number;
  consultation_fee?: number;
}

export interface DoctorDetail extends DoctorSummary {
  appointment_durations_minutes?: number[];
  languages?: string[];
  working_hours?: WorkingHourInterval[];
}

export interface DoctorCreateRequest {
  subject_id?: string;
  display_name?: string;
  credentials?: string | null;
  specialization?: string | null;
  timezone?: string;
  appointment_durations_minutes?: number[];
  // Demo/UI helpers
  name?: string;
  experience_years?: number;
  consultation_fee?: number;
  biography?: string;
  languages?: string[];
  time_zone?: string;
  accepted_durations?: number[];
  working_hours?: WorkingHourInterval[];
}

export interface DoctorUpdateRequest {
  expected_version: number;
  display_name?: string | null;
  credentials?: string | null;
  specialization?: string | null;
  timezone?: string | null;
  is_active?: boolean | null;
}

export interface AvailabilitySlot {
  doctor_id: string;
  starts_at: string; // UTC ISO 8601
  ends_at: string; // UTC ISO 8601
  available: boolean;
  conflict_reason?: string | null;
}

export interface AvailabilityResponse {
  items: AvailabilitySlot[];
  next_cursor: string | null;
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

export type UrgencyLevel = "routine" | "soon" | "urgent" | "emergency";

export type IntegrationChannel =
  | "email"
  | "calendar"
  | "llm"
  | "appointment_reminder"
  | "medication_reminder"
  | "reminder"
  | (string & {});

export type IntegrationState = "pending" | "succeeded" | "retrying" | "failed";

export interface IntegrationStatus {
  id: string;
  appointment_id?: string | null;
  channel: IntegrationChannel;
  state: IntegrationState;
  attempt_count: number;
  error_code?: string | null;
  error_message?: string | null;
  last_attempt_at?: string | null;
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface GeneratedArtifact {
  id: string;
  artifact_type: "pre_visit_brief" | "post_visit_summary";
  status: "pending" | "succeeded" | "failed";
  content?: string | null;
  source_record_type: string;
  source_record_id: string;
  source_versions: Record<string, unknown>;
  task_version: string;
  provider?: string | null;
  model?: string | null;
  error_code?: string | null;
  created_at: string;
  updated_at: string;
}

export interface PatientGeneratedArtifact {
  id: string;
  artifact_type: "post_visit_summary";
  status: "pending" | "succeeded" | "failed";
  content?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AppointmentSummary {
  id: string;
  version: number;
  patient_id: string;
  patient_name?: string;
  patient_age?: number;
  patient_gender?: string;
  doctor_id: string;
  doctor_name?: string;
  doctor_specialization?: string;
  starts_at: string;
  ends_at: string;
  status: AppointmentStatus;
  urgency?: UrgencyLevel | string | null;
  created_at: string;
  updated_at: string;
  symptom_summary?: string;
  integrations?: IntegrationStatus[];
  visit_id?: string | null;
}

export type AiBriefStatus = "pending" | "ready" | "unavailable";

export interface AppointmentDetail extends AppointmentSummary {
  patient_name?: string;
  doctor_name?: string;
  doctor_specialization?: string;
  integrations?: IntegrationStatus[];
  symptoms_text?: string | null;
  original_symptoms_text?: string;
  symptoms_recorded_at?: string;
  visit_id?: string | null;
  generated_artifacts?: GeneratedArtifact[];
  ai_brief_status?: AiBriefStatus;
  ai_brief_summary?: string;
  ai_brief_urgency?: UrgencyLevel;
  ai_brief_key_concerns?: string[];
  cancellation_reason?: string;
  cancelled_at?: string;
  cancelled_by?: string;
}

export interface AppointmentCancelRequest {
  expected_version: number;
  reason_code: "patient_request" | "doctor_request" | "admin_request" | "safety";
  note?: string | null;
}

export interface AppointmentRescheduleRequest {
  expected_version: number;
  starts_at: string;
  duration_minutes: number;
}

export interface SymptomVersion {
  id: string;
  version: number;
  symptoms_text: string;
  source: "patient" | "imported";
  created_at: string;
}

export interface SymptomsResponse {
  items: SymptomVersion[];
  generated_artifacts: GeneratedArtifact[];
}

export interface SymptomIntakeRequest {
  symptoms_text: string;
  urgency?: "routine" | "soon" | "urgent" | null;
}

export type PrescriptionFrequency =
  | "once_daily"
  | "twice_daily"
  | "three_times_daily"
  | "every_4_hours"
  | "as_needed"
  | (string & {});

export interface PrescriptionItemInput {
  medication_name: string;
  dosage: string;
  route?: string | null;
  frequency: "once_daily" | "twice_daily" | "three_times_daily" | "every_4_hours" | "as_needed";
  start_date: string; // YYYY-MM-DD
  end_date?: string | null; // YYYY-MM-DD
  duration_days?: number | null;
  instructions: string;
}

export interface PrescriptionItem {
  id: string;
  medication_name: string;
  dosage: string;
  route: string | null;
  frequency: string;
  start_date: string;
  end_date?: string | null;
  duration_days?: number | null;
  instructions: string;
}

export interface Prescription {
  id: string;
  version: number;
  status?: "draft" | "completed";
  advisory_text?: string | null;
  items: PrescriptionItem[];
  created_at?: string;
  updated_at?: string;
  visit_id?: string;
  doctor_id?: string;
  doctor_name?: string;
  patient_id?: string;
  patient_name?: string;
}

export interface PatientPrescription {
  id: string;
  version: number;
  status: "draft" | "completed";
  items: PrescriptionItem[];
}

export interface VisitNote {
  id: string;
  version: number;
  notes_text: string;
  created_at: string;
}

export type VisitStatus = "draft" | "completed";

export interface Visit {
  id: string;
  appointment_id: string;
  doctor_id: string;
  status: VisitStatus;
  version: number;
  urgency?: string | null;
  notes?: VisitNote[];
  doctor_notes?: string; // Helper mapping to notes or latest note text
  diagnosis?: string;
  follow_up_instructions?: string;
  prescription?: Prescription | null;
  generated_artifacts?: GeneratedArtifact[];
  created_at: string;
  updated_at: string;
  completed_at?: string | null;
  patient_id?: string;
  ai_summary_status?: AiBriefStatus;
  ai_patient_summary?: string;
}

export interface PatientVisit {
  id: string;
  appointment_id: string;
  doctor_id: string;
  status: "completed";
  version: number;
  urgency?: string | null;
  prescription?: PatientPrescription | null;
  generated_artifacts?: PatientGeneratedArtifact[];
  created_at: string;
  updated_at: string;
  completed_at: string;
  doctor_notes?: string;
  diagnosis?: string;
  follow_up_instructions?: string;
  ai_patient_summary?: string;
}

export interface VisitUpdateRequest {
  expected_version: number;
  notes_text: string;
  urgency?: "routine" | "soon" | "urgent" | null;
  prescription_items?: PrescriptionItemInput[] | null;
  advisory_text?: string | null;
}

export interface VisitCompleteRequest {
  expected_version: number;
}

export interface VisitAmendmentRequest {
  expected_version: number;
  reason: string;
  notes_text: string;
}

export interface ReminderPreferencesResponse {
  patient_id: string;
  version: number;
  enabled: boolean;
  channel: string;
  timezone: string;
  local_times: string[];
  created_at: string;
  updated_at: string;
}

export interface ReminderPreferencesRequest {
  expected_version: number;
  enabled: boolean;
  channel: "email" | "sms" | "push";
  timezone: string;
  local_times: string[];
}

export interface ReminderOccurrence {
  prescription_item_id?: string | null;
  occurrence_at: string;
  status: string;
  prescription_version: number;
}

export interface ReminderScheduleResponse {
  prescription_id?: string | null;
  prescription_item_id?: string | null;
  items: ReminderOccurrence[];
}

export interface MedicationReminder {
  id: string;
  prescription_item_id: string;
  medication_name: string;
  dosage: string;
  time_of_day: string;
  scheduled_date: string;
  taken: boolean;
  instructions: string;
  route: string;
}

export interface DoctorLeave {
  id: string;
  version?: number;
  doctor_id: string;
  doctor_name?: string;
  starts_at: string; // UTC ISO 8601
  ends_at: string; // UTC ISO 8601
  reason: string | null;
  is_active?: boolean;
  created_at: string;
  updated_at?: string;
  expected_schedule_version?: number;
  schedule_version?: number;
}

export interface LeavePreviewRequest {
  starts_at: string;
  ends_at: string;
  reason?: string | null;
}

export interface LeaveImpactResponse {
  preview_token: string;
  doctor_id: string;
  expected_schedule_version: number;
  starts_at: string;
  ends_at: string;
  affected_hold_ids: string[];
  affected_appointment_ids: string[];
  affected_hold_count: number;
  affected_appointment_count: number;
  expires_at: string;
}

// LeavePreviewResponse compatibility alias
export interface LeavePreviewResponse {
  preview_token: string;
  doctor_id: string;
  starts_at: string;
  ends_at: string;
  reason?: string | null;
  expected_schedule_version?: number;
  affected_hold_ids?: string[];
  affected_appointment_ids?: string[];
  affected_hold_count?: number;
  affected_appointment_count?: number;
  expires_at?: string;
  // Demo-only compatibility projections. Production responses use the fields above.
  schedule_version?: number;
  affected_holds_count?: number;
  affected_appointments?: AppointmentSummary[];
}

export interface LeaveApplyRequest {
  preview_token: string;
  expected_version?: number;
  reason?: string | null;
  expected_schedule_version?: number; // Compatibility alias
}

export interface LeaveEditRequest extends LeaveApplyRequest {
  starts_at?: string | null;
  ends_at?: string | null;
}

export interface AdminIntegrationItem extends IntegrationStatus {
  // Demo compatibility fields. The production API exposes the operation ID as `id`
  // and does not return payload summaries or retry limits.
  operation_id?: string;
  max_attempts?: number;
  payload_summary?: string;
  target_id?: string;
  target_type?: "appointment" | "reminder" | "leave" | "visit";
  next_attempt_at?: string;
}

export interface IntegrationRetryRequest {
  expected_version: number;
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: Array<{ path: string; code: string; message: string }> | null;
    retryable?: boolean;
    details?: Record<string, unknown> | null;
  };
  request_id: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  next_cursor: string | null;
  total_count?: number;
}
