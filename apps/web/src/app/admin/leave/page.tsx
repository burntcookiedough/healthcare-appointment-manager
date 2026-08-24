"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
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
import { formatDateTime, parseLocalISTToUTCISO, addDays } from "@/lib/dates";
import { LeavePreviewResponse } from "@/types/api";
import {
  CalendarOff,
  Plus,
  Clock,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import { toast } from "sonner";

export default function AdminLeavePage() {
  const queryClient = useQueryClient();

  const [isScheduleLeaveOpen, setIsScheduleLeaveOpen] = React.useState(false);
  const [selectedDoctorId, setSelectedDoctorId] = React.useState("doc-001-rajesh");
  const [startDateStr, setStartDateStr] = React.useState(() => {
    const d = addDays(new Date(), 1);
    return `${d.toISOString().split("T")[0]}T09:00`;
  });
  const [endDateStr, setEndDateStr] = React.useState(() => {
    const d = addDays(new Date(), 3);
    return `${d.toISOString().split("T")[0]}T18:00`;
  });
  const [leaveReason, setLeaveReason] = React.useState("Attending Medical Conference");

  const [previewResult, setPreviewResult] = React.useState<LeavePreviewResponse | null>(null);
  const [isPreviewDialogOpen, setIsPreviewDialogOpen] = React.useState(false);

  // Query doctors
  const { data: doctors } = useQuery({
    queryKey: ["admin-leave-doctors"],
    queryFn: () => apiClient.getDoctors(),
  });

  // Query all leaves
  const { data: leaves, isLoading } = useQuery({
    queryKey: ["admin-all-leaves"],
    queryFn: () => apiClient.getDoctorLeaves(),
  });

  // Mutation 1: Fetch Impact Preview (LEAVE-002)
  const previewMutation = useMutation({
    mutationFn: async () => {
      const startsAtISO = parseLocalISTToUTCISO(startDateStr);
      const endsAtISO = parseLocalISTToUTCISO(endDateStr);
      return apiClient.previewDoctorLeave(selectedDoctorId, {
        starts_at: startsAtISO,
        ends_at: endsAtISO,
        reason: leaveReason,
      });
    },
    onSuccess: (result) => {
      setPreviewResult(result);
      setIsScheduleLeaveOpen(false);
      setIsPreviewDialogOpen(true);
    },
    onError: (err: { error?: { message?: string } }) => {
      toast.error(err?.error?.message || "Failed to generate leave impact preview.");
    },
  });

  // Mutation 2: Apply Leave with Preview Token (LEAVE-003)
  const applyMutation = useMutation({
    mutationFn: async () => {
      if (!previewResult) throw new Error("No preview token available");
      return apiClient.applyDoctorLeave(
        previewResult.doctor_id,
        previewResult.starts_at,
        previewResult.ends_at,
        leaveReason,
        {
          preview_token: previewResult.preview_token,
          expected_schedule_version: previewResult.schedule_version,
        }
      );
    },
    onSuccess: (_newLeave) => {
      toast.success(
        `Leave scheduled successfully. ${previewResult?.affected_appointments.length || 0} affected appointment(s) updated to cancelled_doctor_leave.`
      );
      setIsPreviewDialogOpen(false);
      setPreviewResult(null);
      queryClient.invalidateQueries({ queryKey: ["admin-all-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["admin-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["patient-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
      queryClient.invalidateQueries({ queryKey: ["doctor-leaves"] });
      queryClient.invalidateQueries({ queryKey: ["booking-slots"] });
      queryClient.invalidateQueries({ queryKey: ["reschedule-slots"] });
    },
    onError: (err: { error?: { message?: string; code?: string } }) => {
      if (err?.error?.code === "LEAVE_PREVIEW_STALE") {
        toast.error("Leave preview is stale due to a schedule update. Please generate a fresh preview.");
        setIsPreviewDialogOpen(false);
        setIsScheduleLeaveOpen(true);
      } else {
        toast.error(err?.error?.message || "Failed to commit doctor leave.");
      }
    },
  });

  const handleStartPreview = (e: React.FormEvent) => {
    e.preventDefault();
    if (!leaveReason) {
      toast.error("Please enter a reason for the leave.");
      return;
    }
    previewMutation.mutate();
  };

  const selectedDoctor = doctors?.find((d) => d.id === selectedDoctorId);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            Doctor Leave Governance
          </h1>
          <p className="text-sm text-[#626262] mt-1">
            Schedule approved leaves with mandatory impact preview and transactional appointment cancellation (LEAVE-002, LEAVE-003).
          </p>
        </div>

        <Button variant="primary" size="default" onClick={() => setIsScheduleLeaveOpen(true)}>
          <Plus className="h-4 w-4 text-[#efff72]" />
          <span>Schedule Doctor Leave</span>
        </Button>
      </div>

      {/* Info Notice on Domain Rules */}
      <div className="rounded-2xl border border-[#fedf89] bg-[#fff8eb] p-4 text-xs text-[#b54708] space-y-1">
        <div className="flex items-center gap-2 font-bold">
          <ShieldAlert className="h-4 w-4" />
          <span>Atomic Leave Cancellation Policy (LEAVE-003)</span>
        </div>
        <p>
          Applying leave atomically invalidates active holds and transitions all overlapping confirmed appointments to <strong>cancelled_doctor_leave</strong> with transactional outbox notifications.
        </p>
      </div>

      {/* Leave List Table */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#f0f0eb]">
          <h3 className="text-base font-bold text-[#111111]">Active & Scheduled Doctor Leaves</h3>
        </div>

        {isLoading ? (
          <div className="p-6">
            <CardSkeleton />
          </div>
        ) : leaves && leaves.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#e7e7e2] bg-[#fbfbf8] font-bold text-[#626262]">
                <tr>
                  <th className="py-4 px-6">Doctor</th>
                  <th className="py-4 px-6">Leave Window (UTC)</th>
                  <th className="py-4 px-6">Reason</th>
                  <th className="py-4 px-6">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0eb]">
                {leaves.map((l) => (
                  <tr key={l.id} className="hover:bg-[#fbfbf8]/80 transition-colors">
                    <td className="py-4 px-6 font-bold text-[#111111]">
                      {l.doctor_name || "Dr. Rajesh Verma"}
                    </td>
                    <td className="py-4 px-6 text-[#111111]">
                      <div className="font-mono">{formatDateTime(l.starts_at)}</div>
                      <div className="text-[#8e8e89] font-mono">to {formatDateTime(l.ends_at)}</div>
                    </td>
                    <td className="py-4 px-6 text-[#626262] max-w-sm">{l.reason}</td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center gap-1 rounded-lg bg-[#F7F2DF] border border-[#E8DEC0] px-2.5 py-0.5 text-xs font-semibold text-[#655B36]">
                        <Clock className="h-3 w-3" />
                        <span>Active Approved</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={CalendarOff}
            title="No doctor leaves recorded"
            description="There are no scheduled leaves in the system."
          />
        )}
      </div>

      {/* STEP 1: SCHEDULE LEAVE INPUT DIALOG */}
      <Dialog open={isScheduleLeaveOpen} onOpenChange={setIsScheduleLeaveOpen}>
        <DialogContent className="max-w-lg">
          <form onSubmit={handleStartPreview} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Propose Doctor Leave Interval</DialogTitle>
              <DialogDescription>
                Select the doctor and requested interval to generate an impact preview before applying.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-2">
              <Select
                label="Select Doctor"
                value={selectedDoctorId}
                onChange={(e) => setSelectedDoctorId(e.target.value)}
                options={doctors?.map((d) => ({ value: d.id, label: `${d.name} (${d.specialization})` }))}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input
                  label="Start Date & Time (IST)"
                  type="datetime-local"
                  required
                  value={startDateStr}
                  onChange={(e) => setStartDateStr(e.target.value)}
                />
                <Input
                  label="End Date & Time (IST)"
                  type="datetime-local"
                  required
                  value={endDateStr}
                  onChange={(e) => setEndDateStr(e.target.value)}
                />
              </div>

              <Input
                label="Leave Reason"
                placeholder="E.g., Medical conference, Personal leave, Surgical duty"
                value={leaveReason}
                required
                onChange={(e) => setLeaveReason(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsScheduleLeaveOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={previewMutation.isPending}>
                <span>Generate Impact Preview</span>
                <ArrowRight className="h-4 w-4 text-[#efff72]" />
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* STEP 2: MANDATORY IMPACT PREVIEW & CONFIRMATION DIALOG (LEAVE-002 / LEAVE-003) */}
      <Dialog open={isPreviewDialogOpen} onOpenChange={setIsPreviewDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Leave Impact Preview & Confirmation</DialogTitle>
            <DialogDescription>
              Review the affected appointments and holds that will be automatically updated upon applying leave for{" "}
              <strong>{selectedDoctor?.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          {previewResult && (
            <div className="space-y-4 py-2 text-xs">
              {/* Preview Token & Summary Stats */}
              <div className="grid grid-cols-2 gap-3 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] p-4">
                <div>
                  <span className="text-[#8e8e89] block">Affected Confirmed Appts:</span>
                  <span className="text-xl font-black text-[#b42318]">
                    {previewResult.affected_appointments.length}
                  </span>
                </div>
                <div>
                  <span className="text-[#8e8e89] block">Affected Active Holds:</span>
                  <span className="text-xl font-black text-[#b54708]">
                    {previewResult.affected_holds_count}
                  </span>
                </div>
              </div>

              {/* List of Affected Appointments */}
              <div>
                <span className="text-xs font-bold uppercase tracking-wider text-[#626262] block mb-2">
                  Appointments that will transition to &quot;cancelled_doctor_leave&quot;:
                </span>

                {previewResult.affected_appointments.length > 0 ? (
                  <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                    {previewResult.affected_appointments.map((apt) => (
                      <div
                        key={apt.id}
                        className="flex items-center justify-between p-3 rounded-xl border border-[#EBCFC2] bg-[#F8ECE6]"
                      >
                        <div>
                          <div className="font-bold text-[#171815]">{apt.patient_name}</div>
                          <div className="text-[11px] text-[#666861]">
                            {formatDateTime(apt.starts_at)}
                          </div>
                        </div>
                        <span className="rounded-lg bg-white border border-[#EBCFC2] px-2 py-0.5 text-[10px] font-bold text-[#7A4636]">
                          Will Cancel
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-[#D8E7DB] bg-[#EEF5EF] text-[#315B43]">
                    ✓ No existing confirmed appointments conflict with this leave interval.
                  </div>
                )}
              </div>

              <div className="p-3 rounded-xl border border-[#E8DEC0] bg-[#F7F2DF] text-[11px] text-[#655B36]">
                <strong>Preview Token:</strong> <code>{previewResult.preview_token}</code>. Applying will commit all cancellations in a single atomic transaction (LEAVE-003).
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsPreviewDialogOpen(false)}
              disabled={applyMutation.isPending}
            >
              Discard Preview
            </Button>
            <Button
              variant="destructive"
              onClick={() => applyMutation.mutate()}
              isLoading={applyMutation.isPending}
            >
              Confirm & Apply Leave
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
