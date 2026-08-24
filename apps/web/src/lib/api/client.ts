/**
 * Frontend Data-Access Boundary.
 * All application UI features call this typed API client layer.
 * Currently backed by our deterministic in-memory mock repository.
 * Once Orval generates `packages/api-client`, this boundary forwards to the generated client.
 */

import { mockDb } from "@/mocks/handlers";
import {
  UserContext,
  UserRole,
  PatientProfile,
  DoctorSummary,
  DoctorDetail,
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
} from "@/types/api";

export const apiClient = {
  // Test isolation reset
  reset: (): void => {
    mockDb.reset();
  },

  // Auth / Context
  getMe: async (): Promise<UserContext> => {
    return mockDb.getMe();
  },

  setUserRole: (role: UserRole): UserContext => {
    return mockDb.setUserRole(role);
  },

  // Patient Profile
  getPatientProfile: async (): Promise<PatientProfile> => {
    return mockDb.getPatientProfile();
  },

  // Doctors
  getDoctors: async (query?: string, specialization?: string): Promise<DoctorSummary[]> => {
    return mockDb.getDoctors(query, specialization);
  },

  getDoctorDetail: async (doctorId: string): Promise<DoctorDetail> => {
    return mockDb.getDoctorDetail(doctorId);
  },

  getDoctorAvailability: async (
    doctorId: string,
    targetDate: Date,
    durationMinutes = 30
  ): Promise<AvailabilitySlot[]> => {
    return mockDb.getDoctorAvailability(doctorId, targetDate, durationMinutes);
  },

  // Holds & Booking
  createHold: async (req: HoldCreateRequest): Promise<Hold> => {
    return mockDb.createHold(req);
  },

  getHold: async (holdId: string): Promise<Hold> => {
    return mockDb.getHold(holdId);
  },

  releaseHold: async (holdId: string): Promise<void> => {
    return mockDb.releaseHold(holdId);
  },

  confirmHold: async (holdId: string, req: HoldConfirmRequest): Promise<AppointmentDetail> => {
    return mockDb.confirmHold(holdId, req);
  },

  // Appointments
  getAppointments: async (role?: UserRole): Promise<AppointmentSummary[]> => {
    return mockDb.getAppointments(role);
  },

  getAppointmentDetail: async (appointmentId: string): Promise<AppointmentDetail> => {
    return mockDb.getAppointmentDetail(appointmentId);
  },

  cancelAppointment: async (
    appointmentId: string,
    reason: string,
    cancelledBy: "patient" | "doctor" | "admin" = "patient"
  ): Promise<AppointmentDetail> => {
    return mockDb.cancelAppointment(appointmentId, reason, cancelledBy);
  },

  rescheduleAppointment: async (
    appointmentId: string,
    newStartsAt: string,
    durationMinutes = 30
  ): Promise<AppointmentDetail> => {
    return mockDb.rescheduleAppointment(appointmentId, newStartsAt, durationMinutes);
  },

  // Clinical Visits & Prescriptions
  getVisit: async (visitId: string): Promise<Visit> => {
    return mockDb.getVisit(visitId);
  },

  getOrCreateVisitForAppointment: async (appointmentId: string, doctorId: string): Promise<Visit> => {
    return mockDb.getOrCreateVisitForAppointment(appointmentId, doctorId);
  },

  saveVisitDraft: async (
    visitId: string,
    notes: string,
    diagnosis: string,
    prescriptionItems: PrescriptionItem[]
  ): Promise<Visit> => {
    return mockDb.saveVisitDraft(visitId, notes, diagnosis, prescriptionItems);
  },

  completeVisit: async (
    visitId: string,
    notes: string,
    diagnosis: string,
    prescriptionItems: PrescriptionItem[],
    followUpInstructions?: string
  ): Promise<Visit> => {
    return mockDb.completeVisit(visitId, notes, diagnosis, prescriptionItems, followUpInstructions);
  },

  // Reminders
  getPatientReminders: async (patientId: string): Promise<MedicationReminder[]> => {
    return mockDb.getPatientReminders(patientId);
  },

  // Doctor Leave
  getDoctorLeaves: async (doctorId?: string): Promise<DoctorLeave[]> => {
    return mockDb.getDoctorLeaves(doctorId);
  },

  previewDoctorLeave: async (doctorId: string, req: LeavePreviewRequest): Promise<LeavePreviewResponse> => {
    return mockDb.previewDoctorLeave(doctorId, req);
  },

  applyDoctorLeave: async (
    doctorId: string,
    startsAt: string,
    endsAt: string,
    reason: string,
    req: LeaveApplyRequest
  ): Promise<DoctorLeave> => {
    return mockDb.applyDoctorLeave(doctorId, startsAt, endsAt, reason, req);
  },

  // Admin Integrations
  getAdminIntegrations: async (): Promise<AdminIntegrationItem[]> => {
    return mockDb.getAdminIntegrations();
  },

  retryIntegration: async (operationId: string): Promise<AdminIntegrationItem> => {
    return mockDb.retryIntegration(operationId);
  },
};
