"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";
import { formatDate, formatTime, formatDateTime, formatDateOnly, formatSlotRange, addDays } from "@/lib/dates";
import {
  Stethoscope,
  ArrowLeft,
  FileText,
  AlertTriangle,
  RotateCcw,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";

const CANCEL_REASONS = [
  { value: "Schedule conflict", label: "Schedule conflict / Personal emergency" },
  { value: "Symptoms improved", label: "Symptoms improved / Resolved" },
  { value: "Doctor change", label: "Prefer to consult a different specialist" },
  { value: "Other", label: "Other reason" },
];

export default function PatientAppointmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const appointmentId = (params?.id as string) || "apt-001-upcoming";

  const [isCancelDialogOpen, setIsCancelDialogOpen] = React.useState(false);
  const [cancelReason, setCancelReason] = React.useState(CANCEL_REASONS[0].value);

  const [isRescheduleDialogOpen, setIsRescheduleDialogOpen] = React.useState(false);
  const [rescheduleDate, setRescheduleDate] = React.useState<Date>(() => addDays(new Date(), 1));
  const [rescheduleSlot, setRescheduleSlot] = React.useState<string | null>(null);

  // Query appointment detail
  const { data: appointment, isLoading, error } = useQuery({
    queryKey: ["appointment-detail", appointmentId],
    queryFn: () => apiClient.getAppointmentDetail(appointmentId),
  });

  // Query availability for rescheduling
  const { data: rescheduleSlots, isLoading: isReschedSlotsLoading } = useQuery({
    queryKey: ["reschedule-slots", appointment?.doctor_id, formatDateOnly(rescheduleDate, "Asia/Kolkata")],
    queryFn: () =>
      appointment
        ? apiClient.getDoctorAvailability(appointment.doctor_id, rescheduleDate, 30)
        : Promise.resolve([]),
    enabled: Boolean(isRescheduleDialogOpen && appointment),
  });

  // Cancel Mutation
  const cancelMutation = useMutation({
    mutationFn: async () => {
      return apiClient.cancelAppointment(appointmentId, cancelReason, "patient", {
        expectedVersion: appointment?.version ?? 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointment-detail", appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointment-workspace", appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["booking-slots"] });
      queryClient.invalidateQueries({ queryKey: ["reschedule-slots"] });
      setIsCancelDialogOpen(false);
      toast.success("Appointment successfully cancelled.");
    },
    onError: (err: { error?: { message?: string } }) => {
      toast.error(err?.error?.message || "Failed to cancel appointment.");
    },
  });

  // Reschedule Mutation
  const rescheduleMutation = useMutation({
    mutationFn: async () => {
      if (!rescheduleSlot) throw new Error("Please select a new time slot");
      return apiClient.rescheduleAppointment(appointmentId, rescheduleSlot, 30, {
        expectedVersion: appointment?.version ?? 1,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["appointment-detail", appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-timeline"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointment-workspace", appointmentId] });
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["booking-slots"] });
      queryClient.invalidateQueries({ queryKey: ["reschedule-slots"] });
      setIsRescheduleDialogOpen(false);
      toast.success("Appointment successfully rescheduled.");
    },
    onError: (err: { error?: { message?: string } }) => {
      toast.error(err?.error?.message || "Failed to reschedule appointment.");
    },
  });

  if (isLoading) return <CardSkeleton />;

  if (error || !appointment) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="Appointment record not found"
        description="We could not find the specified appointment. It may have been removed or you do not have permission."
        actionLabel="Back to Appointments"
        onAction={() => router.push("/patient/appointments")}
      />
    );
  }

  const isCancellable = appointment.status === "confirmed";

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Back navigation */}
      <Link
        href="/patient/appointments"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-[#626262] hover:text-[#111111]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to My Appointments</span>
      </Link>

      {/* Main Appointment Card */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        {/* Header with Status */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#f0f0eb] pb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111]">
              <Stethoscope className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#111111]">{appointment.doctor_name}</h1>
                <StatusBadge status={appointment.status} size="sm" />
              </div>
              <p className="text-sm text-[#626262]">{appointment.doctor_specialization}</p>
            </div>
          </div>

          {/* Action buttons */}
          {isCancellable && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsRescheduleDialogOpen(true)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reschedule</span>
              </Button>
              <Button
                variant="destructiveOutline"
                size="sm"
                onClick={() => setIsCancelDialogOpen(true)}
              >
                <XCircle className="h-3.5 w-3.5" />
                <span>Cancel Appointment</span>
              </Button>
            </div>
          )}
        </div>

        {/* Info Grid */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 text-xs">
          <div>
            <span className="text-[#8e8e89] block">Appointment Date</span>
            <span className="font-bold text-sm text-[#111111]">
              {formatDate(appointment.starts_at, "EEEE, MMMM d, yyyy")}
            </span>
          </div>
          <div>
            <span className="text-[#8e8e89] block">Time Window</span>
            <span className="font-bold text-sm text-[#111111]">
              {formatTime(appointment.starts_at)} - {formatTime(appointment.ends_at)} (IST)
            </span>
          </div>
          <div>
            <span className="text-[#8e8e89] block">Reference Record</span>
            <span className="font-mono font-bold text-[#111111]">{appointment.id}</span>
          </div>
        </div>

        {/* Cancellation Reason if cancelled */}
        {appointment.cancellation_reason && (
          <div className="rounded-2xl border border-[#fecdca] bg-[#fef3f2] p-4 text-xs text-[#b42318] space-y-1">
            <span className="font-bold block">Cancellation Notice</span>
            <p>{appointment.cancellation_reason}</p>
            {appointment.cancelled_at && (
              <span className="text-[11px] text-[#8e8e89] block">
                Recorded at {formatDateTime(appointment.cancelled_at)}
              </span>
            )}
          </div>
        )}

        {/* Original Submitted Symptoms (TEXT-001: Immutable original text) */}
        <div className="space-y-2 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-[#626262]">
              Submitted Symptoms (Original Source)
            </h3>
            <span className="text-[11px] text-[#8e8e89]">
              Recorded: {formatDateTime(appointment.symptoms_recorded_at || appointment.created_at)}
            </span>
          </div>
          <p className="text-sm text-[#111111] leading-relaxed whitespace-pre-wrap">
            {appointment.original_symptoms_text}
          </p>
        </div>

        {/* Integration Channels Outbox Status */}
        <div className="space-y-3 pt-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#626262]">
            Notifications & Integrations State
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {appointment.integrations.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between rounded-xl border border-[#e7e7e2] bg-white p-3 text-xs"
              >
                <div>
                  <span className="font-bold text-[#111111] capitalize">{item.channel} Channel</span>
                  <p className="text-[11px] text-[#626262]">
                    {item.state === "succeeded"
                      ? "Delivery confirmed"
                      : item.state === "retrying"
                      ? "Retrying in background"
                      : item.error_message || "Processing"}
                  </p>
                </div>
                <StatusBadge status={item.state} size="sm" />
              </div>
            ))}
          </div>
        </div>

        {/* Visit link if completed */}
        {appointment.visit_id && (
          <div className="rounded-2xl border border-[#bbf2cf] bg-[#edfdf4] p-4 flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-[#1e613f]">Doctor Visit Summary Available</h4>
              <p className="text-xs text-[#26734d]">
                Consultation notes and digital prescriptions have been recorded by the doctor.
              </p>
            </div>
            <Button asChild variant="primary" size="sm">
              <Link href={`/patient/visits/${appointment.visit_id}`}>
                <FileText className="h-4 w-4 text-[#efff72]" />
                <span>View Summary</span>
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* CONSEQUENTIAL CANCEL DIALOG */}
      <Dialog open={isCancelDialogOpen} onOpenChange={setIsCancelDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel Appointment</DialogTitle>
            <DialogDescription>
              Are you sure you want to cancel your consultation with{" "}
              <strong>{appointment.doctor_name}</strong> on{" "}
              <strong>{formatDateTime(appointment.starts_at)}</strong>?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <Select
              label="Select Cancellation Reason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              options={CANCEL_REASONS}
            />
            <p className="text-xs text-[#626262]">
              Cancelling will release this slot immediately and notify the doctor. You can schedule another consultation at any time.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsCancelDialogOpen(false)}
              disabled={cancelMutation.isPending}
            >
              Keep Appointment
            </Button>
            <Button
              variant="destructive"
              onClick={() => cancelMutation.mutate()}
              isLoading={cancelMutation.isPending}
            >
              Confirm Cancellation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* CONSEQUENTIAL RESCHEDULE DIALOG */}
      <Dialog open={isRescheduleDialogOpen} onOpenChange={setIsRescheduleDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Reschedule Appointment</DialogTitle>
            <DialogDescription>
              Select a new available date and time with <strong>{appointment.doctor_name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Pick date */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[#626262] block mb-1.5">
                Select New Date
              </label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[1, 2, 3, 4, 5].map((offset) => {
                  const d = addDays(new Date(), offset);
                  const isSel =
                    formatDateOnly(rescheduleDate, "Asia/Kolkata") === formatDateOnly(d, "Asia/Kolkata");
                  return (
                    <button
                      key={offset}
                      type="button"
                      onClick={() => {
                        setRescheduleDate(d);
                        setRescheduleSlot(null);
                      }}
                      aria-pressed={isSel}
                      aria-label={`Select date: ${formatDate(d, "EEE, d MMM")}`}
                      className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111] ${
                        isSel
                          ? "bg-[#111111] text-white border-[#111111]"
                          : "bg-white text-[#111111] border-[#e7e7e2] hover:border-[#111111]"
                      }`}
                    >
                      {formatDate(d, "EEE, d MMM")}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pick slot */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-[#626262] block mb-1.5">
                Select Available Slot
              </label>
              {isReschedSlotsLoading ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-10 bg-[#f0f0eb] rounded-xl animate-pulse" />
                  <div className="h-10 bg-[#f0f0eb] rounded-xl animate-pulse" />
                </div>
              ) : rescheduleSlots && rescheduleSlots.filter((s) => s.available).length > 0 ? (
                <div className="grid grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                  {rescheduleSlots
                    .filter((s) => s.available)
                    .map((s, idx) => {
                      const isChosen = rescheduleSlot === s.starts_at;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setRescheduleSlot(s.starts_at)}
                          aria-pressed={isChosen}
                          aria-label={`Slot ${formatSlotRange(s.starts_at, s.ends_at)}`}
                          className={`min-h-[44px] p-2.5 rounded-xl text-xs font-bold border text-center transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111] ${
                            isChosen
                              ? "bg-[#efff72] text-[#111111] border-[#d6ea39]"
                              : "bg-white text-[#111111] border-[#e7e7e2] hover:border-[#111111]"
                          }`}
                        >
                          {formatSlotRange(s.starts_at, s.ends_at)}
                        </button>
                      );
                    })}
                </div>
              ) : (
                <p className="text-xs text-[#626262] py-2">No available slots on this date.</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsRescheduleDialogOpen(false)}
              disabled={rescheduleMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!rescheduleSlot || rescheduleMutation.isPending}
              isLoading={rescheduleMutation.isPending}
              onClick={() => rescheduleMutation.mutate()}
            >
              Confirm Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
