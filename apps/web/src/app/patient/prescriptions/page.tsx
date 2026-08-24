"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { Pill, Clock, CheckCircle2, AlertCircle, FileText, ArrowRight } from "lucide-react";
import { toast } from "sonner";

export default function PatientPrescriptionsPage() {
  const { data: reminders, isLoading } = useQuery({
    queryKey: ["patient-prescriptions-reminders"],
    queryFn: () => apiClient.getPatientReminders("pat-001-aarav"),
  });

  const [takenMap, setTakenMap] = React.useState<Record<string, boolean>>({});

  const handleToggle = (id: string, name: string) => {
    setTakenMap((prev) => {
      const next = !prev[id];
      if (next) toast.success(`Dose marked as taken: ${name}`);
      return { ...prev, [id]: next };
    });
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            Medication Schedule & Prescriptions
          </h2>
          <p className="text-sm text-[#626262] mt-1">
            Deterministic reminder timeline derived directly from doctor-verified structured prescription data.
          </p>
        </div>
      </div>

      {/* Safety Notice */}
      <div className="rounded-2xl border border-[#e7e7e2] bg-white p-4 text-xs text-[#626262] flex items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[#edfdf4] text-[#26734d]">
          <CheckCircle2 className="h-4 w-4" />
        </div>
        <p className="leading-relaxed">
          <strong>Deterministic Scheduling (RX-002):</strong> All medication dose times are computed from explicit dosage, frequency, and timezone parameters. Free-form clinical prose is never parsed to generate reminders.
        </p>
      </div>

      {/* Timeline Schedule Cards */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-4">
        <h3 className="text-base font-bold text-[#111111] mb-2">Today&apos;s Medication Timeline</h3>

        {isLoading ? (
          <div className="space-y-3">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : reminders && reminders.length > 0 ? (
          <div className="space-y-3">
            {reminders.map((rem) => {
              const isTaken = takenMap[rem.id];
              return (
                <div
                  key={rem.id}
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border transition-all ${
                    isTaken
                      ? "border-[#bbf2cf] bg-[#edfdf4]"
                      : "border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111]"
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div
                      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${
                        isTaken
                          ? "bg-[#26734d] text-white"
                          : "bg-white text-[#111111] border border-[#e7e7e2]"
                      }`}
                    >
                      <Pill className="h-5 w-5" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-base font-bold text-[#111111]">
                          {rem.medication_name}
                        </h4>
                        <span className="rounded-full bg-white border border-[#e7e7e2] px-2.5 py-0.5 text-xs font-mono font-bold text-[#111111]">
                          {rem.dosage}
                        </span>
                        <span className="text-xs text-[#8e8e89]">({rem.route})</span>
                      </div>
                      <p className="text-xs text-[#626262] leading-relaxed">
                        {rem.instructions}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:self-center">
                    <div className="flex items-center gap-1.5 rounded-full bg-white border border-[#e7e7e2] px-3 py-1 text-xs font-mono font-semibold text-[#111111]">
                      <Clock className="h-3.5 w-3.5 text-[#8e8e89]" />
                      <span>{rem.time_of_day}</span>
                    </div>

                    <button
                      onClick={() => handleToggle(rem.id, rem.medication_name)}
                      className={`h-9 px-4 rounded-full text-xs font-semibold transition-all ${
                        isTaken
                          ? "bg-[#26734d] text-white hover:bg-[#1e613f]"
                          : "border border-[#e7e7e2] bg-white text-[#111111] hover:bg-[#f0f0eb]"
                      }`}
                    >
                      {isTaken ? "✓ Dose Taken" : "Mark Taken"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={Pill}
            title="No active prescription reminders"
            description="You do not have any active prescription schedules at this time."
          />
        )}
      </div>
    </div>
  );
}
