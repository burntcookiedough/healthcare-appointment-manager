"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { AiBadge } from "@/components/common/AiBadge";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatDateTime } from "@/lib/dates";
import {
  FileText,
  Pill,
  ArrowLeft,
  Download,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

export default function PatientVisitSummaryPage() {
  const params = useParams();
  const router = useRouter();
  const visitId = (params?.id as string) || "vis-001-completed";

  const { data: visit, isLoading, error } = useQuery({
    queryKey: ["patient-visit-summary", visitId],
    queryFn: () => apiClient.getVisit(visitId),
  });

  if (isLoading) return <CardSkeleton />;

  if (error || !visit) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Visit summary not found"
        description="We could not find the consultation record for this visit."
        actionLabel="Back to Appointments"
        onAction={() => router.push("/patient/appointments")}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Back Link */}
      <Link
        href="/patient/appointments"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-[#626262] hover:text-[#111111]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Appointments</span>
      </Link>

      {/* Header Card */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#f0f0eb] pb-6">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111]">
              <FileText className="h-7 w-7" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#111111]">Consultation Summary & Notes</h1>
                <StatusBadge status="completed" size="sm" />
              </div>
              <p className="text-xs text-[#626262] mt-0.5">
                Completed on {formatDateTime(visit.completed_at || visit.updated_at)}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.success("Digital consultation summary downloaded (PDF).")}
          >
            <Download className="h-3.5 w-3.5" />
            <span>Download Summary</span>
          </Button>
        </div>

        {/* Diagnosis & Advice Box */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8e8e89] block">
              Formal Diagnosis
            </span>
            <p className="text-sm font-bold text-[#111111]">
              {visit.diagnosis || "Clinical evaluation completed"}
            </p>
          </div>

          <div className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#8e8e89] block">
              Follow-up Review Plan
            </span>
            <p className="text-sm font-medium text-[#111111]">
              {visit.follow_up_instructions || "As needed if symptoms persist"}
            </p>
          </div>
        </div>

        {/* Plain Language AI Summary (LLM-001 / LLM-003: Clearly labeled advisory) */}
        {visit.ai_patient_summary && (
          <div className="rounded-2xl border border-[#dceb4a] bg-[#efff72]/20 p-5 space-y-2">
            <div className="flex items-center justify-between">
              <AiBadge status="ready" label="Plain-Language Visit Brief" showDisclaimer />
            </div>
            <p className="text-sm text-[#111111] leading-relaxed">
              {visit.ai_patient_summary}
            </p>
          </div>
        )}

        {/* Doctor's Authoritative Clinical Notes (Immutable Source) */}
        <div className="space-y-2 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#626262]">
            Doctor Consultation Notes (Direct Authoring)
          </h3>
          <p className="text-sm text-[#111111] leading-relaxed whitespace-pre-wrap">
            {visit.doctor_notes}
          </p>
        </div>

        {/* Structured Prescription Table */}
        {visit.prescription && visit.prescription.items.length > 0 && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <Pill className="h-5 w-5 text-[#26734d]" />
              <h3 className="text-base font-bold text-[#111111]">Prescribed Medications</h3>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-[#e7e7e2] bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#e7e7e2] bg-[#fbfbf8] font-bold text-[#626262]">
                  <tr>
                    <th className="py-3 px-4">Medication</th>
                    <th className="py-3 px-4">Dosage & Route</th>
                    <th className="py-3 px-4">Frequency</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Instructions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f0eb]">
                  {visit.prescription.items.map((item) => (
                    <tr key={item.id} className="hover:bg-[#fbfbf8]/80">
                      <td className="py-3.5 px-4 font-bold text-[#111111]">
                        {item.medication_name}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[#111111]">
                        {item.dosage} ({item.route})
                      </td>
                      <td className="py-3.5 px-4 text-[#111111]">{item.frequency}</td>
                      <td className="py-3.5 px-4 text-[#626262]">
                        {item.duration_days ? `${item.duration_days} days` : "As directed"}
                      </td>
                      <td className="py-3.5 px-4 text-[#626262]">{item.instructions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
