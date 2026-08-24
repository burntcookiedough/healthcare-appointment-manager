"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/common/StatusBadge";
import { UrgencyBadge } from "@/components/common/UrgencyBadge";
import { AiBadge } from "@/components/common/AiBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatDate, formatTime, formatDateTime } from "@/lib/dates";
import {
  Stethoscope,
  User,
  ArrowLeft,
  FileText,
  AlertCircle,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { toast } from "sonner";

export default function DoctorAppointmentWorkspacePage() {
  const params = useParams();
  const router = useRouter();
  const appointmentId = (params?.id as string) || "apt-001-upcoming";

  // Query appointment detail
  const { data: appointment, isLoading, error } = useQuery({
    queryKey: ["doctor-appointment-workspace", appointmentId],
    queryFn: () => apiClient.getAppointmentDetail(appointmentId),
  });

  // Mutation to start consultation / open visit draft
  const openVisitMutation = useMutation({
    mutationFn: async () => {
      if (!appointment) throw new Error("Appointment not loaded");
      return apiClient.getOrCreateVisitForAppointment(appointment.id, appointment.doctor_id);
    },
    onSuccess: (visit) => {
      router.push(`/doctor/visits/${visit.id}`);
    },
    onError: (err: { error?: { message?: string } }) => {
      toast.error(err?.error?.message || "Failed to initialize clinical visit workspace.");
    },
  });

  if (isLoading) return <CardSkeleton />;

  if (error || !appointment) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Appointment record not found"
        description="We could not find the specified appointment for clinical intake."
        actionLabel="Back to Timeline"
        onAction={() => router.push("/doctor")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Back Link */}
      <Link
        href="/doctor"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-[#626262] hover:text-[#111111]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Today&apos;s Schedule</span>
      </Link>

      {/* Patient & Consultation Summary Card */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#f0f0eb] pb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111]">
              <User className="h-7 w-7" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-black text-[#111111]">
                  {appointment.patient_name}
                </h1>
                <span className="text-sm font-semibold text-[#626262]">
                  ({appointment.patient_age || 34} yrs • {appointment.patient_gender || "Male"})
                </span>
                <StatusBadge status={appointment.status} size="sm" />
                <UrgencyBadge urgency={appointment.urgency} />
              </div>
              <p className="text-xs text-[#8e8e89] mt-0.5">
                Patient ID: {appointment.patient_id} • Booking: {appointment.id}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {appointment.visit_id ? (
              <Button asChild variant="primary" size="default">
                <Link href={`/doctor/visits/${appointment.visit_id}`}>
                  <FileText className="h-4 w-4 text-[#efff72]" />
                  <span>Resume Consultation Notes</span>
                </Link>
              </Button>
            ) : (
              <Button
                variant="primary"
                size="default"
                onClick={() => openVisitMutation.mutate()}
                isLoading={openVisitMutation.isPending}
              >
                <Stethoscope className="h-4 w-4 text-[#efff72]" />
                <span>Start Consultation & Open Notes</span>
              </Button>
            )}
          </div>
        </div>

        {/* Time Info Bar */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 text-xs">
          <div>
            <span className="text-[#8e8e89] block">Scheduled Window</span>
            <span className="font-bold text-[#111111]">
              {formatTime(appointment.starts_at)} - {formatTime(appointment.ends_at)} (IST)
            </span>
          </div>
          <div>
            <span className="text-[#8e8e89] block">Date</span>
            <span className="font-bold text-[#111111]">
              {formatDate(appointment.starts_at, "EEEE, MMMM d, yyyy")}
            </span>
          </div>
          <div>
            <span className="text-[#8e8e89] block">Data Minimization</span>
            <span className="font-semibold text-[#26734d] flex items-center gap-1">
              <Lock className="h-3 w-3" />
              <span>Restricted Clinical View</span>
            </span>
          </div>
        </div>
      </div>

      {/* DUAL PANEL CLINICAL INTAKE: AI PRE-VISIT BRIEF VS ORIGINAL IMMUTABLE SYMPTOMS */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Column: AI-Assisted Pre-Visit Clinical Brief (LLM-001) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-3xl border border-[#dceb4a] bg-[#efff72]/15 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#dceb4a]/60 pb-3">
              <div className="flex items-center gap-2">
                <AiBadge status={appointment.ai_brief_status} label="AI Pre-Visit Clinical Brief" />
              </div>
              <span className="text-[10px] font-mono text-[#626262]">Model: v2-medical-summary</span>
            </div>

            {appointment.ai_brief_status === "ready" && appointment.ai_brief_summary ? (
              <div className="space-y-4 text-xs">
                <div>
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[#4c5700] block mb-1">
                    Synthesized Intake Summary
                  </span>
                  <p className="text-sm text-[#111111] leading-relaxed bg-white/70 p-3.5 rounded-2xl border border-[#e7e7e2]">
                    {appointment.ai_brief_summary}
                  </p>
                </div>

                {appointment.ai_brief_key_concerns && (
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[#4c5700] block mb-1.5">
                      Suggested Clinical Assessment Points
                    </span>
                    <ul className="space-y-1.5">
                      {appointment.ai_brief_key_concerns.map((concern, idx) => (
                        <li
                          key={idx}
                          className="flex items-start gap-2 bg-white/70 p-2.5 rounded-xl border border-[#e7e7e2] text-xs text-[#111111]"
                        >
                          <span className="font-bold text-[#4c5700]">•</span>
                          <span>{concern}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : appointment.ai_brief_status === "pending" ? (
              <div className="py-6 text-center text-xs text-[#626262] space-y-2">
                <div className="h-6 w-6 border-2 border-[#111111] border-t-transparent rounded-full animate-spin mx-auto" />
                <p>Synthesizing patient symptom intake...</p>
              </div>
            ) : (
              <div className="py-4 text-xs text-[#626262] space-y-1">
                <p className="font-semibold text-[#111111]">AI Brief Service Currently Unavailable</p>
                <p>
                  Graceful degradation active (LLM-002). Proceed directly with original patient symptoms below.
                </p>
              </div>
            )}

            <div className="border-t border-[#dceb4a]/60 pt-3 text-[10px] text-[#626262] leading-tight">
              <strong>Advisory Notice (LLM-001):</strong> Generated AI content is advisory only. Clinical diagnostic authority resides solely with the licensed practitioner.
            </div>
          </div>
        </div>

        {/* Right Column: Immutable Original Patient Symptoms (TEXT-001) */}
        <div className="lg:col-span-6 space-y-4">
          <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-[#f0f0eb] pb-3">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-[#26734d]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-[#111111]">
                  Original Patient Symptoms (Immutable Source)
                </h3>
              </div>
              <span className="text-[10px] text-[#8e8e89]">
                {formatDateTime(appointment.symptoms_recorded_at)}
              </span>
            </div>

            <div className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 text-xs sm:text-sm text-[#111111] leading-relaxed whitespace-pre-wrap min-h-[160px]">
              {appointment.original_symptoms_text}
            </div>

            <div className="rounded-xl border border-[#f0f0eb] bg-[#fbfbf8] p-3 text-[11px] text-[#626262] flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#26734d]" />
              <span>
                Source text preserved losslessly per Domain Contract <strong>TEXT-001</strong>.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
