"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { useAuth } from "@/features/auth/auth-context";
import { Pill, Clock, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function PatientPrescriptionsPage() {
  const { user } = useAuth();
  const patientId = user?.profile_id;

  const { data: reminders, isLoading } = useQuery({
    queryKey: ["patient-prescriptions-reminders", patientId],
    queryFn: () => (patientId ? apiClient.getPatientReminders(patientId) : Promise.resolve([])),
    enabled: Boolean(patientId),
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
          <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            Medication Schedule & Prescriptions
          </h1>
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
        <h2 className="text-base font-bold text-[#111111] mb-2">Today&apos;s Medication Timeline</h2>

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
                  className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 sm:p-5 rounded-2xl border transition-colors duration-150 ${
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
                        <h3 className="text-base font-bold text-[#171815]">
                          {rem.medication_name}
                        </h3>
                        <span className="rounded-lg bg-white border border-[#E5E4DE] px-2 py-0.5 text-xs font-mono font-bold text-[#171815]">
                          {rem.dosage}
                        </span>
                        <span className="text-xs text-[#666861]">({rem.route})</span>
                      </div>
                      <p className="text-xs text-[#666861] leading-relaxed">
                        {rem.instructions}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 sm:self-center">
                    <div className="flex items-center gap-1.5 rounded-lg bg-white border border-[#E5E4DE] px-2.5 py-1 text-xs font-mono font-semibold text-[#171815]">
                      <Clock className="h-3.5 w-3.5 text-[#666861]" />
                      <span>{rem.time_of_day}</span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleToggle(rem.id, rem.medication_name)}
                      aria-pressed={Boolean(isTaken)}
                      aria-label={`Mark ${rem.medication_name} dose as ${isTaken ? "taken" : "pending"}`}
                      className={`min-h-[44px] px-4 rounded-xl text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#171815] ${
                        isTaken
                          ? "bg-[#315B43] text-white hover:bg-[#254633]"
                          : "border border-[#E5E4DE] bg-white text-[#171815] hover:bg-[#F6F5F0]"
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
