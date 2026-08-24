"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CardSkeleton } from "@/components/common/Skeleton";
import { EmptyState } from "@/components/common/EmptyState";
import { formatDate, formatTime } from "@/lib/dates";
import {
  Calendar,
  Clock,
  Stethoscope,
  ArrowRight,
  PlusCircle,
  FileText,
  AlertCircle,
} from "lucide-react";

export default function PatientAppointmentsPage() {
  const [activeTab, setActiveTab] = React.useState<"active" | "past" | "cancelled">("active");

  const { data: appointments, isLoading, error } = useQuery({
    queryKey: ["patient-appointments"],
    queryFn: () => apiClient.getAppointments("patient"),
  });

  const filteredAppointments = React.useMemo(() => {
    if (!appointments) return [];
    if (activeTab === "active") {
      return appointments.filter((a) => a.status === "confirmed" || a.status === "in_progress");
    } else if (activeTab === "past") {
      return appointments.filter((a) => a.status === "completed");
    } else {
      return appointments.filter((a) => a.status.startsWith("cancelled_"));
    }
  }, [appointments, activeTab]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            My Appointments
          </h2>
          <p className="text-sm text-[#626262] mt-1">
            Review active consultations, reschedule, or view completed visit summaries.
          </p>
        </div>

        <Link href="/patient/book">
          <Button variant="primary" size="default">
            <PlusCircle className="h-4 w-4 text-[#efff72]" />
            <span>Book New Appointment</span>
          </Button>
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-[#e7e7e2] pb-3">
        <button
          onClick={() => setActiveTab("active")}
          className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "active"
              ? "bg-[#111111] text-white"
              : "text-[#626262] hover:bg-[#f0f0eb] hover:text-[#111111]"
          }`}
        >
          Active / Confirmed
        </button>
        <button
          onClick={() => setActiveTab("past")}
          className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "past"
              ? "bg-[#111111] text-white"
              : "text-[#626262] hover:bg-[#f0f0eb] hover:text-[#111111]"
          }`}
        >
          Past Completed
        </button>
        <button
          onClick={() => setActiveTab("cancelled")}
          className={`rounded-full px-4 py-2 text-xs font-bold transition-all ${
            activeTab === "cancelled"
              ? "bg-[#111111] text-white"
              : "text-[#626262] hover:bg-[#f0f0eb] hover:text-[#111111]"
          }`}
        >
          Cancelled
        </button>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="space-y-4">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : filteredAppointments.length > 0 ? (
        <div className="grid grid-cols-1 gap-4">
          {filteredAppointments.map((apt) => (
            <div
              key={apt.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-5 rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-sm hover:border-[#111111] transition-all"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111]">
                  <Stethoscope className="h-6 w-6" />
                </div>
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <h3 className="text-base font-bold text-[#111111]">{apt.doctor_name}</h3>
                    <StatusBadge status={apt.status} size="sm" />
                  </div>
                  <p className="text-xs font-medium text-[#626262]">{apt.doctor_specialization}</p>

                  <div className="flex flex-wrap items-center gap-4 text-xs text-[#626262] pt-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5 text-[#8e8e89]" />
                      <span>{formatDate(apt.starts_at, "EEE, MMM d, yyyy")}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-[#8e8e89]" />
                      <span>{formatTime(apt.starts_at)} (IST)</span>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2.5 sm:self-center">
                {apt.visit_id && (
                  <Link href={`/patient/visits/${apt.visit_id}`}>
                    <Button variant="outline" size="sm" className="text-xs">
                      <FileText className="h-3.5 w-3.5 text-[#26734d]" />
                      <span>Visit Notes</span>
                    </Button>
                  </Link>
                )}

                <Link href={`/patient/appointments/${apt.id}`}>
                  <Button variant="primary" size="sm" className="text-xs">
                    <span>Manage Details</span>
                    <ArrowRight className="h-3 w-3 text-[#efff72]" />
                  </Button>
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Calendar}
          title={`No ${activeTab} appointments`}
          description={
            activeTab === "active"
              ? "You do not have any upcoming appointments. Schedule one with our verified specialists."
              : `No appointments found in ${activeTab} status.`
          }
          actionLabel={activeTab === "active" ? "Book an Appointment" : undefined}
          onAction={activeTab === "active" ? () => window.location.assign("/patient/book") : undefined}
        />
      )}
    </div>
  );
}
