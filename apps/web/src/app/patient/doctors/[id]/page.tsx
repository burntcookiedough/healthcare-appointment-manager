"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatCurrencyINR } from "@/lib/utils";
import { formatDate, formatSlotRange, addDays } from "@/lib/dates";
import {
  Stethoscope,
  Clock,
  Globe,
  Award,
  Calendar,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";

const DURATION_OPTIONS = [15, 30, 45];

export default function DoctorDetailPage() {
  const params = useParams();
  const router = useRouter();
  const doctorId = (params?.id as string) || "doc-001-rajesh";

  const [selectedDuration, setSelectedDuration] = React.useState<number>(30);
  const [selectedDate, setSelectedDate] = React.useState<Date>(() => new Date());

  // Query Doctor Profile
  const { data: doctor, isLoading: isDocLoading, error: docError } = useQuery({
    queryKey: ["doctor-detail", doctorId],
    queryFn: () => apiClient.getDoctorDetail(doctorId),
  });

  // Query Availability Slots
  const { data: slots, isLoading: isSlotsLoading } = useQuery({
    queryKey: ["doctor-slots", doctorId, selectedDate.toISOString().split("T")[0], selectedDuration],
    queryFn: () => apiClient.getDoctorAvailability(doctorId, selectedDate, selectedDuration),
    enabled: Boolean(doctor),
  });

  // Next 7 days helper
  const availableDates = React.useMemo(() => {
    const list: Date[] = [];
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      list.push(addDays(base, i));
    }
    return list;
  }, []);

  if (isDocLoading) {
    return <CardSkeleton />;
  }

  if (docError || !doctor) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Doctor profile not found"
        description="We could not find the requested doctor. Please return to the directory."
        actionLabel="Back to Doctors"
        onAction={() => router.push("/patient/doctors")}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Back Link */}
      <Link
        href="/patient/doctors"
        className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-[#626262] hover:text-[#111111] transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        <span>Back to Specialist Directory</span>
      </Link>

      {/* Doctor Header & Bio Card */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-start gap-6 border-b border-[#f0f0eb] pb-6">
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl bg-[#EEF5EF] text-[#315B43] text-2xl font-bold border border-[#D8E7DB]">
            <Stethoscope className="h-10 w-10" />
          </div>

          <div className="space-y-2 flex-1">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-black text-[#171815]">{doctor.name}</h1>
              <span className="rounded-lg bg-[#EEF5EF] border border-[#D8E7DB] px-2.5 py-0.5 text-xs font-semibold text-[#315B43]">
                {doctor.specialization}
              </span>
            </div>
            <p className="text-sm font-medium text-[#666861]">{doctor.credentials}</p>
            <p className="text-sm text-[#171815] leading-relaxed max-w-3xl pt-1">
              {doctor.biography}
            </p>
          </div>

          <div className="rounded-xl border border-[#E5E4DE] bg-[#FBFBF8] p-4 text-center sm:min-w-[160px] space-y-1">
            <span className="text-[11px] font-medium text-[#666861] block">Consultation Fee</span>
            <span className="text-2xl font-black text-[#171815]">
              {formatCurrencyINR(doctor.consultation_fee)}
            </span>
            <span className="text-[10px] text-[#666861] block">per session</span>
          </div>
        </div>

        {/* Doctor Badges / Attributes */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 text-xs">
          <div className="flex items-center gap-2 text-[#666861]">
            <Award className="h-4 w-4 text-[#315B43]" />
            <span>
              Experience: <strong className="text-[#171815]">{doctor.experience_years} Years</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[#666861]">
            <Globe className="h-4 w-4 text-[#315B43]" />
            <span>
              Languages: <strong className="text-[#171815]">{doctor.languages.join(", ")}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 text-[#666861]">
            <Clock className="h-4 w-4 text-[#315B43]" />
            <span>
              Timezone: <strong className="text-[#171815]">{doctor.time_zone}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Available Slots & Booking Section */}
      <div className="rounded-2xl border border-[#E5E4DE] bg-white p-6 sm:p-8 shadow-xs space-y-6">
        <div>
          <h3 className="text-xl font-bold tracking-tight text-[#171815]">
            Select Consultation Date & Time
          </h3>
          <p className="text-xs text-[#666861] mt-1">
            Choose an advisory slot to acquire a 5-minute atomic reservation hold.
          </p>
        </div>

        {/* Step 1: Duration Selector */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-[#666861] block">
            Duration
          </label>
          <div className="flex flex-wrap items-center gap-2">
            {DURATION_OPTIONS.map((dur) => (
              <button
                key={dur}
                onClick={() => setSelectedDuration(dur)}
                className={`min-h-[44px] rounded-lg px-4 py-2 text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#171815] ${
                  selectedDuration === dur
                    ? "bg-[#171815] text-white"
                    : "border border-[#E5E4DE] bg-[#FBFBF8] text-[#666861] hover:border-[#171815]"
                }`}
              >
                {dur} Minutes
              </button>
            ))}
          </div>
        </div>

        {/* Step 2: Date Selector (Horizontal Days) */}
        <div className="space-y-2">
          <label className="text-xs font-bold uppercase tracking-wider text-[#8e8e89] block">
            Select Date
          </label>
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {availableDates.map((d, index) => {
              const isSelected =
                selectedDate.toISOString().split("T")[0] === d.toISOString().split("T")[0];
              return (
                <button
                  key={index}
                  onClick={() => setSelectedDate(d)}
                  className={`flex flex-col items-center justify-center min-h-[44px] min-w-[90px] p-3 rounded-2xl border transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111] ${
                    isSelected
                      ? "border-[#111111] bg-[#111111] text-white shadow-sm"
                      : "border-[#e7e7e2] bg-[#fbfbf8] text-[#111111] hover:border-[#111111]"
                  }`}
                >
                  <span className={`text-[11px] font-semibold ${isSelected ? "text-[#efff72]" : "text-[#626262]"}`}>
                    {formatDate(d, "EEE")}
                  </span>
                  <span className="text-base font-bold">{formatDate(d, "d MMM")}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Step 3: Slots Grid */}
        <div className="space-y-3 pt-2">
          <label className="text-xs font-bold uppercase tracking-wider text-[#8e8e89] block">
            Available Slots on {formatDate(selectedDate, "EEEE, MMMM d, yyyy")}
          </label>

          {isSlotsLoading ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
              <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
              <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
              <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
            </div>
          ) : slots && slots.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              {slots.map((slot, i) => {
                return (
                  <button
                    key={i}
                    disabled={!slot.available}
                    onClick={() => {
                      router.push(
                        `/patient/book?doctor_id=${doctor.id}&starts_at=${encodeURIComponent(
                          slot.starts_at
                        )}&duration=${selectedDuration}`
                      );
                    }}
                    className={`flex flex-col items-center justify-center min-h-[44px] p-3 rounded-xl border text-center transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111] ${
                      slot.available
                        ? "border-[#e7e7e2] bg-white hover:border-[#111111] hover:bg-[#efff72]/20 active:scale-98 cursor-pointer"
                        : "border-[#f0f0eb] bg-[#f6f6f2] text-[#8e8e89] cursor-not-allowed opacity-60"
                    }`}
                  >
                    <span className="text-sm font-bold text-[#111111]">
                      {formatSlotRange(slot.starts_at, slot.ends_at)}
                    </span>
                    <span className="text-[10px] mt-0.5 font-medium">
                      {slot.available ? (
                        <span className="text-[#26734d]">Available</span>
                      ) : (
                        <span>{slot.conflict_reason || "Unavailable"}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Calendar}
              title="No consultation slots available on this date"
              description="The doctor does not have working hours or is on approved leave for this day. Please pick another date."
            />
          )}
        </div>
      </div>
    </div>
  );
}
