"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/common/StatusBadge";
import { UrgencyBadge } from "@/components/common/UrgencyBadge";
import { AiBadge } from "@/components/common/AiBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatTime, formatDate } from "@/lib/dates";
import {
  Calendar,
  Clock,
  User,
  ArrowRight,
  Stethoscope,
  Activity,
  CheckCircle2,
} from "lucide-react";

export default function DoctorTimelinePage() {
  const { data: appointments, isLoading, error } = useQuery({
    queryKey: ["doctor-appointments"],
    queryFn: () => apiClient.getAppointments("doctor"),
  });

  const todayAppointments = appointments || [];
  const confirmedCount = todayAppointments.filter((a) => a.status === "confirmed").length;
  const inProgressCount = todayAppointments.filter((a) => a.status === "in_progress").length;
  const completedCount = todayAppointments.filter((a) => a.status === "completed").length;

  return (
    <div className="space-y-8">
      {/* Top Metric Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <div className="rounded-2xl border border-[#e7e7e2] bg-white p-5 shadow-xs">
          <span className="text-xs font-semibold text-[#8e8e89] block">Total Queue Today</span>
          <span className="text-2xl font-black text-[#111111]">{todayAppointments.length}</span>
        </div>
        <div className="rounded-2xl border border-[#e7e7e2] bg-white p-5 shadow-xs">
          <span className="text-xs font-semibold text-[#26734d] block">Confirmed Upcoming</span>
          <span className="text-2xl font-black text-[#111111]">{confirmedCount}</span>
        </div>
        <div className="rounded-2xl border border-[#e7e7e2] bg-white p-5 shadow-xs">
          <span className="text-xs font-semibold text-[#9a6700] block">In Consultation</span>
          <span className="text-2xl font-black text-[#111111]">{inProgressCount}</span>
        </div>
        <div className="rounded-2xl border border-[#e7e7e2] bg-white p-5 shadow-xs">
          <span className="text-xs font-semibold text-[#626262] block">Completed Visits</span>
          <span className="text-2xl font-black text-[#111111]">{completedCount}</span>
        </div>
      </div>

      {/* Today's Timeline Queue */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-[#f0f0eb] pb-4">
          <div>
            <h2 className="text-xl font-bold tracking-tight text-[#111111]">
              Today&apos;s Consultation Schedule
            </h2>
            <p className="text-xs text-[#626262] mt-0.5">
              {formatDate(new Date(), "EEEE, MMMM d, yyyy")} (Asia/Kolkata)
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#26734d] animate-pulse" />
            <span className="text-xs font-semibold text-[#111111]">Live Queue Active</span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-4">
            <CardSkeleton />
            <CardSkeleton />
          </div>
        ) : todayAppointments.length > 0 ? (
          <div className="space-y-4">
            {todayAppointments.map((apt) => (
              <div
                key={apt.id}
                className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 p-5 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111] hover:bg-white transition-all shadow-xs"
              >
                {/* Left: Time & Patient Identity */}
                <div className="flex items-start gap-4">
                  <div className="flex flex-col items-center justify-center min-w-[80px] p-2.5 rounded-xl border border-[#e7e7e2] bg-white text-center">
                    <span className="text-xs font-bold text-[#111111]">
                      {formatTime(apt.starts_at)}
                    </span>
                    <span className="text-[10px] text-[#8e8e89]">
                      {formatTime(apt.ends_at)}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-base font-bold text-[#111111]">{apt.patient_name}</h3>
                      <span className="text-xs font-medium text-[#626262]">
                        ({apt.patient_age || 30}
                        {apt.patient_gender ? ` / ${apt.patient_gender[0].toUpperCase()}` : ""})
                      </span>
                      <StatusBadge status={apt.status} size="sm" />
                      <UrgencyBadge urgency={apt.urgency} />
                    </div>

                    <p className="text-xs text-[#626262] line-clamp-2 max-w-xl">
                      {apt.symptom_summary || "Patient intake recorded. View clinical workspace for details."}
                    </p>
                  </div>
                </div>

                {/* Right: AI Intake Badge & Open Workspace CTA */}
                <div className="flex items-center gap-3 lg:self-center">
                  <div className="hidden sm:block">
                    <AiBadge status="ready" label="Intake Brief" />
                  </div>

                  <Link href={`/doctor/appointments/${apt.id}`}>
                    <Button variant="primary" size="default" className="text-xs">
                      <span>Open Workspace</span>
                      <ArrowRight className="h-3.5 w-3.5 text-[#efff72]" />
                    </Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={Calendar}
            title="No appointments scheduled for today"
            description="Your consultation timeline for today is currently clear."
          />
        )}
      </div>
    </div>
  );
}
