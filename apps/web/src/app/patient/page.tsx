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
  Pill,
  ArrowRight,
  CheckCircle2,
  FileText,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

export default function PatientDashboard() {
  // Query appointments
  const {
    data: appointments,
    isLoading: isApptsLoading,
    error: apptsError,
  } = useQuery({
    queryKey: ["patient-appointments"],
    queryFn: () => apiClient.getAppointments("patient"),
  });

  // Query medication reminders
  const {
    data: reminders,
    isLoading: isRemindersLoading,
  } = useQuery({
    queryKey: ["patient-reminders"],
    queryFn: () => apiClient.getPatientReminders("pat-001-aarav"),
  });

  const [takenDoses, setTakenDoses] = React.useState<Record<string, boolean>>({});

  const handleToggleDose = (id: string, name: string) => {
    setTakenDoses((prev) => {
      const nextState = !prev[id];
      if (nextState) {
        toast.success(`Dose marked as taken: ${name}`);
      }
      return { ...prev, [id]: nextState };
    });
  };

  const upcomingAppointment = appointments?.find(
    (a) => a.status === "confirmed" || a.status === "in_progress"
  );
  const pastAppointments = appointments?.filter((a) => a.status === "completed") || [];

  if (apptsError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Could not load your dashboard"
        description="A network or server error occurred while retrieving your health records. Please try again."
        actionLabel="Retry Loading"
        onAction={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Page Header with Semantic H1 */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
          Patient Care Dashboard
        </h1>
        <p className="text-xs sm:text-sm text-[#626262] mt-1">
          Welcome back, Aarav. View your upcoming consultations, today&apos;s medication schedule, and care history.
        </p>
      </div>
      {/* 1. Upcoming Appointment Hero Banner */}
      <section aria-labelledby="upcoming-heading">
        <div className="flex items-center justify-between mb-4">
          <h2 id="upcoming-heading" className="text-lg font-bold tracking-tight text-[#111111]">
            Next Upcoming Appointment
          </h2>
          <Link
            href="/patient/appointments"
            className="text-xs font-semibold text-[#626262] hover:text-[#111111] flex items-center gap-1"
          >
            <span>View All</span>
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>

        {isApptsLoading ? (
          <CardSkeleton />
        ) : upcomingAppointment ? (
          <div className="rounded-3xl border border-[#e7e7e2] bg-white p-4 sm:p-6 lg:p-8 shadow-sm space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#f0f0eb] pb-6">
              <div className="flex items-start sm:items-center gap-4">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111]">
                  <Stethoscope className="h-7 w-7" aria-hidden="true" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="text-xl font-bold text-[#111111]">
                      {upcomingAppointment.doctor_name}
                    </h3>
                    <StatusBadge status={upcomingAppointment.status} size="sm" />
                  </div>
                  <p className="text-sm font-medium text-[#626262]">
                    {upcomingAppointment.doctor_specialization}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/patient/appointments/${upcomingAppointment.id}`}>
                  <Button variant="outline" size="default">
                    <span>Manage / Reschedule</span>
                  </Button>
                </Link>
                <Link href={`/patient/appointments/${upcomingAppointment.id}`}>
                  <Button variant="primary" size="default">
                    <span>View Clinical Details</span>
                    <ArrowRight className="h-4 w-4 text-[#efff72]" />
                  </Button>
                </Link>
              </div>
            </div>

            {/* Time & Location Grid */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-[#8e8e89]">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Date</span>
                </div>
                <div className="font-bold text-sm text-[#111111]">
                  {formatDate(upcomingAppointment.starts_at, "EEEE, MMMM d, yyyy")}
                </div>
              </div>

              <div className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-[#8e8e89]">
                  <Clock className="h-3.5 w-3.5" />
                  <span>Consultation Time</span>
                </div>
                <div className="font-bold text-sm text-[#111111]">
                  {formatTime(upcomingAppointment.starts_at)} - {formatTime(upcomingAppointment.ends_at)} (IST)
                </div>
              </div>

              <div className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 space-y-1">
                <div className="flex items-center gap-1.5 text-xs text-[#8e8e89]">
                  <CheckCircle2 className="h-3.5 w-3.5 text-[#26734d]" />
                  <span>Integrations Status</span>
                </div>
                <div className="text-xs font-semibold text-[#111111]">
                  Email & Calendar Synced
                </div>
              </div>
            </div>
          </div>
        ) : (
          <EmptyState
            icon={Calendar}
            title="No upcoming appointments scheduled"
            description="You do not have any active appointments booked right now. Search our specialists to schedule your next consultation."
            actionLabel="Find a Doctor & Book"
            onAction={() => window.location.assign("/patient/doctors")}
          />
        )}
      </section>

      {/* 2. Two Column Grid: Today's Medication Reminders + Recent Visits */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Col: Medication Reminders Checklist */}
        <section aria-labelledby="meds-heading" className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="meds-heading" className="text-lg font-bold tracking-tight text-[#111111]">
              Today&apos;s Medication Schedule
            </h2>
            <Link
              href="/patient/prescriptions"
              className="text-xs font-semibold text-[#626262] hover:text-[#111111] flex items-center gap-1"
            >
              <span>Prescription Details</span>
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>

          <div className="rounded-3xl border border-[#e7e7e2] bg-white p-4 sm:p-6 shadow-sm space-y-3">
            {isRemindersLoading ? (
              <div className="space-y-3">
                <div className="h-14 bg-[#f0f0eb] rounded-xl animate-pulse" />
                <div className="h-14 bg-[#f0f0eb] rounded-xl animate-pulse" />
              </div>
            ) : reminders && reminders.length > 0 ? (
              reminders.map((rem) => {
                const isTaken = takenDoses[rem.id];
                return (
                  <div
                    key={rem.id}
                    className={`flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-3.5 sm:p-4 rounded-2xl border transition-colors ${
                      isTaken
                        ? "border-[#bbf2cf] bg-[#edfdf4]"
                        : "border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111]"
                    }`}
                  >
                    <div className="flex items-start sm:items-center gap-3.5">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                          isTaken ? "bg-[#26734d] text-white" : "bg-white text-[#111111] border border-[#e7e7e2]"
                        }`}
                      >
                        <Pill className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-bold text-[#111111]">{rem.medication_name}</h4>
                          <span className="text-xs font-mono font-medium text-[#626262]">
                            {rem.dosage}
                          </span>
                        </div>
                        <p className="text-xs text-[#626262]">{rem.instructions}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-auto">
                      <span className="rounded-full bg-white border border-[#e7e7e2] px-2.5 py-1 text-xs font-mono font-semibold text-[#111111]">
                        {rem.time_of_day}
                      </span>
                      <button
                        onClick={() => handleToggleDose(rem.id, rem.medication_name)}
                        className={`min-h-[44px] px-3.5 rounded-full text-xs font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111] ${
                          isTaken
                            ? "bg-[#26734d] text-white"
                            : "border border-[#e7e7e2] bg-white text-[#111111] hover:bg-[#f0f0eb]"
                        }`}
                        aria-label={`Mark ${rem.medication_name} as ${isTaken ? "not taken" : "taken"}`}
                      >
                        {isTaken ? "✓ Taken" : "Mark Taken"}
                      </button>
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState
                icon={Pill}
                title="No active medication reminders"
                description="You do not have any active prescription schedules scheduled for today."
              />
            )}
          </div>
        </section>

        {/* Right Col: Recent Visits & Quick Booking Action */}
        <section aria-labelledby="visits-heading" className="lg:col-span-5 space-y-4">
          <div className="flex items-center justify-between">
            <h2 id="visits-heading" className="text-lg font-bold tracking-tight text-[#111111]">
              Recent Visit Summaries
            </h2>
            <Link
              href="/patient/appointments"
              className="text-xs font-semibold text-[#626262] hover:text-[#111111]"
            >
              History
            </Link>
          </div>

          <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-sm space-y-4">
            {pastAppointments.length > 0 ? (
              pastAppointments.map((past) => (
                <div
                  key={past.id}
                  className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 space-y-2.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-[#111111]">{past.doctor_name}</span>
                    <span className="text-[11px] text-[#8e8e89]">
                      {formatDate(past.starts_at)}
                    </span>
                  </div>
                  <p className="text-xs text-[#626262] line-clamp-2">
                    {past.symptom_summary || "Consultation completed. View visit notes."}
                  </p>
                  {past.visit_id && (
                    <Link
                      href={`/patient/visits/${past.visit_id}`}
                      className="inline-flex items-center gap-1 text-xs font-bold text-[#111111] hover:underline"
                    >
                      <FileText className="h-3.5 w-3.5 text-[#26734d]" />
                      <span>View Doctor Notes & Prescription</span>
                    </Link>
                  )}
                </div>
              ))
            ) : (
              <p className="text-xs text-[#626262] py-4 text-center">
                No past visit summaries recorded yet.
              </p>
            )}

            <div className="pt-2">
              <Link href="/patient/doctors" className="block w-full">
                <Button variant="accent" className="w-full justify-between">
                  <span>Browse Specialist Directory</span>
                  <ArrowRight className="h-4 w-4 text-[#111111]" />
                </Button>
              </Link>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
