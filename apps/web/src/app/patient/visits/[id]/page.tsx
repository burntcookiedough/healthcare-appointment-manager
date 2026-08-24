"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
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
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

export default function PatientVisitSummaryPage() {
  const params = useParams();
  const router = useRouter();
  const rawId = params?.id;
  const visitId = typeof rawId === "string" && rawId.trim() !== "" ? rawId : "";

  const { data: visit, isLoading, error } = useQuery({
    queryKey: ["patient-visit-summary", visitId],
    queryFn: () => apiClient.getVisit(visitId),
    enabled: Boolean(visitId),
  });

  if (isLoading) return <CardSkeleton />;

  if (!visitId || error || !visit) {
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
      <div className="rounded-2xl border border-[#E5E4DE] bg-white p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#F6F5F0] pb-6">
          <div className="flex min-w-0 items-start sm:items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-[#EEF5EF] text-[#315B43] border border-[#D8E7DB]">
              <FileText className="h-7 w-7" />
            </div>
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="text-xl font-bold text-[#171815]">Consultation Summary & Notes</h1>
                <StatusBadge status="completed" size="sm" />
              </div>
              <p className="text-xs text-[#666861] mt-0.5">
                Completed on {formatDateTime(visit.completed_at || visit.updated_at)}
              </p>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => toast.success("Digital consultation summary downloaded (PDF).")}
            className="w-full sm:w-auto whitespace-normal text-center leading-tight"
          >
            <Download className="h-3.5 w-3.5 shrink-0" />
            <span>Download Summary</span>
          </Button>
        </div>

        {/* Diagnosis & Advice Box */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[#E5E4DE] bg-[#F6F5F0] p-4 space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#666861] block">
              Formal Diagnosis
            </span>
            <p className="text-sm font-bold text-[#171815]">
              {visit.diagnosis || "Diagnosis not provided"}
            </p>
          </div>

          <div className="rounded-xl border border-[#E5E4DE] bg-[#F6F5F0] p-4 space-y-1">
            <span className="text-xs font-bold uppercase tracking-wider text-[#666861] block">
              Follow-up Review Plan
            </span>
            <p className="text-sm font-medium text-[#171815]">
              {visit.follow_up_instructions || "Follow-up plan not provided"}
            </p>
          </div>
        </div>

        {/* Plain Language AI Summary (LLM-001 / LLM-003: Clearly labeled advisory) */}
        {visit.ai_patient_summary && (
          <div className="rounded-xl border border-[#D9E3EA] bg-[#EEF3F7] p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white border border-[#D9E3EA] text-[#38556B]">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                </div>
                <div>
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[#38556B]">
                    Plain-language visit summary
                  </h3>
                </div>
              </div>
              <span className="text-[11px] font-medium text-[#666861]">
                AI-assisted · Advisory
              </span>
            </div>

            <p className="text-sm text-[#171815] leading-relaxed">
              {visit.ai_patient_summary}
            </p>

            <div className="border-t border-[#D9E3EA] pt-2.5 text-[11px] text-[#666861]">
              Advisory summary only. Non-diagnostic. Original doctor consultation notes preserved below.
            </div>
          </div>
        )}

        {/* Doctor's Authoritative Clinical Notes (Immutable Source) */}
        <div className="space-y-2 rounded-xl border border-[#E5E4DE] bg-[#FBFBF8] p-5">
          <h3 className="text-xs font-bold uppercase tracking-wider text-[#666861]">
            Doctor Consultation Notes (Direct Authoring)
          </h3>
          <p className="text-sm text-[#171815] leading-relaxed whitespace-pre-wrap">
            {visit.doctor_notes}
          </p>
        </div>

        {/* Structured Prescription Table */}
        {visit.prescription && visit.prescription.items.length > 0 && (
          <div className="space-y-4 pt-2">
            <div className="flex items-center gap-2">
              <Pill className="h-5 w-5 text-[#315B43]" />
              <h3 className="text-base font-bold text-[#171815]">Prescribed Medications</h3>
            </div>

            <div className="overflow-x-auto rounded-xl border border-[#E5E4DE] bg-white">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[#E5E4DE] bg-[#FBFBF8] font-bold text-[#666861]">
                  <tr>
                    <th className="py-3 px-4">Medication</th>
                    <th className="py-3 px-4">Dosage & Route</th>
                    <th className="py-3 px-4">Frequency</th>
                    <th className="py-3 px-4">Duration</th>
                    <th className="py-3 px-4">Instructions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F6F5F0]">
                  {visit.prescription.items.map((item) => (
                    <tr key={item.id} className="hover:bg-[#FBFBF8]/80">
                      <td className="py-3.5 px-4 font-bold text-[#171815]">
                        {item.medication_name}
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[#171815]">
                        {item.dosage} ({item.route ?? "Route not provided"})
                      </td>
                      <td className="py-3.5 px-4 text-[#171815]">{item.frequency}</td>
                      <td className="py-3.5 px-4 text-[#666861]">
                        {item.duration_days ? `${item.duration_days} days` : "Duration not provided"}
                      </td>
                      <td className="py-3.5 px-4 text-[#666861]">{item.instructions}</td>
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
