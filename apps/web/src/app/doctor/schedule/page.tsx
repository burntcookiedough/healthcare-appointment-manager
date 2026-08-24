"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatDateTime } from "@/lib/dates";
import { useAuth } from "@/features/auth/auth-context";
import { Clock, ArrowLeft } from "lucide-react";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export default function DoctorSchedulePage() {
  const { user } = useAuth();
  const doctorId = user?.profile_id;

  const { data: doctor, isLoading: isDocLoading } = useQuery({
    queryKey: ["doctor-detail-schedule", doctorId],
    queryFn: () => (doctorId ? apiClient.getDoctorDetail(doctorId) : Promise.reject("No doctor ID")),
    enabled: Boolean(doctorId),
  });

  const { data: leaves, isLoading: isLeavesLoading } = useQuery({
    queryKey: ["doctor-leaves", doctorId],
    queryFn: () => (doctorId ? apiClient.getDoctorLeaves(doctorId) : Promise.resolve([])),
    enabled: Boolean(doctorId),
  });

  if (isDocLoading || isLeavesLoading) return <CardSkeleton />;

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <Link
        href="/doctor"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-[#626262] hover:text-[#111111]"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Timeline</span>
      </Link>

      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
          Clinical Schedule & Approved Leave
        </h1>
        <p className="text-sm text-[#626262] mt-1">
          Review recurring availability windows and recorded absence intervals.
        </p>
      </div>

      {/* Working Hours Schedule Card */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-[#f0f0eb] pb-4">
          <div>
            <h2 className="text-xl font-bold text-[#111111]">Configured Working Hours</h2>
            <p className="text-xs text-[#626262] mt-0.5">
              Operating Timezone: <strong>{doctor?.time_zone || "Asia/Kolkata"}</strong> (LEAVE-001)
            </p>
          </div>
          <span className="rounded-lg bg-[#EEF5EF] border border-[#D8E7DB] px-3 py-1 text-xs font-bold text-[#315B43]">
            Active Schedule
          </span>
        </div>

        <div className="space-y-3">
          {(doctor?.working_hours || []).map((rule, idx) => {
            const dayIdx = rule.day_of_week ?? rule.weekday ?? 0;
            const startTime = rule.start_time ?? rule.starts_local ?? "09:00";
            const endTime = rule.end_time ?? rule.ends_local ?? "17:00";
            const duration = rule.slot_duration_minutes ?? doctor?.appointment_durations_minutes?.[0] ?? 30;
            return (
              <div
                key={idx}
                className="flex items-center justify-between p-4 rounded-xl border border-[#E5E4DE] bg-[#FBFBF8]"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white border border-[#E5E4DE] text-[#171815] font-bold text-xs">
                    {DAYS[dayIdx]?.slice(0, 3) || "Mon"}
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#171815]">{DAYS[dayIdx] || "Weekday"}</h4>
                    <p className="text-xs text-[#666861]">
                      Slot interval: {duration} minutes
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 text-xs font-mono font-bold text-[#171815]">
                  <Clock className="h-4 w-4 text-[#666861]" />
                  <span>
                    {startTime} - {endTime}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Approved Leaves Table */}
      <div className="rounded-2xl border border-[#E5E4DE] bg-white p-6 sm:p-8 shadow-xs space-y-6">
        <div className="flex items-center justify-between border-b border-[#F6F5F0] pb-4">
          <div>
            <h2 className="text-xl font-bold text-[#171815]">Approved Leave Intervals</h2>
            <p className="text-xs text-[#666861] mt-0.5">
              Leave periods automatically prevent patient holds and slot generation (LEAVE-001).
            </p>
          </div>
        </div>

        {leaves && leaves.length > 0 ? (
          <div className="space-y-3">
            {leaves.map((leave) => (
              <div
                key={leave.id}
                className="p-4 rounded-xl border border-[#E5E4DE] bg-[#FBFBF8] space-y-2 text-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[#171815] text-sm">{leave.reason}</span>
                  <span className="rounded-lg bg-[#F7F2DF] border border-[#E8DEC0] px-2.5 py-0.5 text-xs font-semibold text-[#655B36]">
                    Approved Leave
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-4 text-[#626262]">
                  <span>
                    From: <strong>{formatDateTime(leave.starts_at)}</strong>
                  </span>
                  <span>
                    To: <strong>{formatDateTime(leave.ends_at)}</strong>
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-[#626262] py-4 text-center">No approved leaves scheduled.</p>
        )}
      </div>
    </div>
  );
}
