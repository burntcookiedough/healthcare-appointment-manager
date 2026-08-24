"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { HoldCountdownBadge } from "@/components/common/HoldCountdownBadge";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatDateTime, formatTime, formatDate, formatSlotRange, addDays } from "@/lib/dates";
import { formatCurrencyINR } from "@/lib/utils";
import { Hold, AppointmentDetail } from "@/types/api";
import {
  Stethoscope,
  CheckCircle2,
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ShieldCheck,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";

function BookingWizardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const queryDoctorId = searchParams.get("doctor_id") || "doc-001-rajesh";
  const queryStartsAt = searchParams.get("starts_at");
  const queryDuration = Number(searchParams.get("duration") || 30);

  // Steps: 1: Doctor, 2: Slot, 3: Hold & Symptoms, 4: Confirmed
  const [currentStep, setCurrentStep] = React.useState<number>(() => {
    return queryStartsAt ? 3 : 2;
  });

  const [selectedDoctorId, setSelectedDoctorId] = React.useState<string>(queryDoctorId);
  const [selectedDate, setSelectedDate] = React.useState<Date>(() => new Date());
  const [selectedStartsAt, setSelectedStartsAt] = React.useState<string | null>(queryStartsAt);
  const [selectedDuration, setSelectedDuration] = React.useState<number>(queryDuration);

  const [activeHold, setActiveHold] = React.useState<Hold | null>(null);
  const [isHoldExpired, setIsHoldExpired] = React.useState<boolean>(false);
  const [symptomsText, setSymptomsText] = React.useState<string>("");
  const [symptomsError, setSymptomsError] = React.useState<string>("");
  const [confirmedAppointment, setConfirmedAppointment] = React.useState<AppointmentDetail | null>(null);

  // Query doctors
  const { data: doctors } = useQuery({
    queryKey: ["booking-doctors"],
    queryFn: () => apiClient.getDoctors(),
  });

  // Query selected doctor detail
  const { data: selectedDoctor } = useQuery({
    queryKey: ["booking-doctor-detail", selectedDoctorId],
    queryFn: () => apiClient.getDoctorDetail(selectedDoctorId),
    enabled: Boolean(selectedDoctorId),
  });

  // Query availability slots
  const { data: slots, isLoading: isSlotsLoading } = useQuery({
    queryKey: [
      "booking-slots",
      selectedDoctorId,
      selectedDate.toISOString().split("T")[0],
      selectedDuration,
    ],
    queryFn: () => apiClient.getDoctorAvailability(selectedDoctorId, selectedDate, selectedDuration),
    enabled: Boolean(selectedDoctorId),
  });

  // Next 7 days
  const dateOptions = React.useMemo(() => {
    const arr: Date[] = [];
    const base = new Date();
    for (let i = 0; i < 7; i++) {
      arr.push(addDays(base, i));
    }
    return arr;
  }, []);

  // Mutation: Acquire Hold
  const holdMutation = useMutation({
    mutationFn: async (startsAt: string) => {
      return apiClient.createHold({
        doctor_id: selectedDoctorId,
        starts_at: startsAt,
        duration_minutes: selectedDuration,
      });
    },
    onSuccess: (hold) => {
      setActiveHold(hold);
      setIsHoldExpired(false);
      setSelectedStartsAt(hold.starts_at);
      setCurrentStep(3);
      toast.success("Slot held for 5 minutes. Please describe your symptoms to confirm.");
    },
    onError: (err: any) => {
      const msg = err?.error?.message || "This slot is no longer available. Please choose another.";
      toast.error(msg);
    },
  });

  // Auto-acquire hold if arriving with starts_at query param
  React.useEffect(() => {
    if (queryStartsAt && !activeHold && currentStep === 3) {
      holdMutation.mutate(queryStartsAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryStartsAt]);

  // Mutation: Confirm Booking
  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!activeHold) throw new Error("No active hold found");
      return apiClient.confirmHold(activeHold.id, {
        symptoms_text: symptomsText,
      });
    },
    onSuccess: (appointment) => {
      setConfirmedAppointment(appointment);
      setCurrentStep(4);
      toast.success("Appointment successfully confirmed!");
    },
    onError: (err: any) => {
      const code = err?.error?.code;
      if (code === "HOLD_EXPIRED") {
        setIsHoldExpired(true);
        toast.error("Your reservation hold has expired. Please select a new slot.");
      } else if (code === "VALIDATION_FAILED") {
        setSymptomsError(err?.error?.message || "Please enter valid symptoms description.");
      } else {
        toast.error(err?.error?.message || "Failed to confirm appointment. Please try again.");
      }
    },
  });

  const handleSlotSelect = (startsAt: string) => {
    holdMutation.mutate(startsAt);
  };

  const handleHoldExpire = () => {
    setIsHoldExpired(true);
    toast.error("Your reserved slot hold has expired. Please choose a slot again.");
  };

  const handleConfirmSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!symptomsText || symptomsText.trim().length < 5) {
      setSymptomsError("Please provide a brief description of your symptoms (at least 5 characters).");
      return;
    }
    setSymptomsError("");
    confirmMutation.mutate();
  };

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Wizard Progress Stepper */}
      <nav aria-label="Booking Steps" className="rounded-3xl border border-[#e7e7e2] bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex items-center justify-between">
          {[
            { step: 1, label: "Doctor" },
            { step: 2, label: "Time Slot" },
            { step: 3, label: "Symptoms & Hold" },
            { step: 4, label: "Confirmation" },
          ].map((item, idx) => {
            const isCompleted = currentStep > item.step;
            const isCurrent = currentStep === item.step;
            return (
              <div key={item.step} className="flex items-center gap-2">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold transition-all ${
                    isCompleted
                      ? "bg-[#26734d] text-white"
                      : isCurrent
                      ? "bg-[#111111] text-[#efff72] ring-2 ring-[#efff72]"
                      : "bg-[#f0f0eb] text-[#8e8e89]"
                  }`}
                >
                  {isCompleted ? "✓" : item.step}
                </div>
                <span
                  className={`hidden sm:inline text-xs font-semibold ${
                    isCurrent ? "text-[#111111]" : "text-[#8e8e89]"
                  }`}
                >
                  {item.label}
                </span>
                {idx < 3 && <div className="hidden md:block h-0.5 w-12 bg-[#e7e7e2]" />}
              </div>
            );
          })}
        </div>
      </nav>

      {/* STEP 1: Select Doctor (if not selected) */}
      {currentStep === 1 && (
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
          <div>
            <h2 className="text-xl font-black text-[#111111]">Choose a Specialist</h2>
            <p className="text-xs text-[#626262] mt-1">Select the doctor you wish to consult with.</p>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {doctors?.map((doc) => (
              <div
                key={doc.id}
                onClick={() => {
                  setSelectedDoctorId(doc.id);
                  setCurrentStep(2);
                }}
                className={`p-4 rounded-2xl border transition-all cursor-pointer hover:border-[#111111] hover:shadow-md ${
                  selectedDoctorId === doc.id ? "border-[#111111] bg-[#fbfbf8]" : "border-[#e7e7e2] bg-white"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#efff72] text-[#111111]">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-[#111111]">{doc.name}</h4>
                    <p className="text-xs text-[#26734d] font-semibold">{doc.specialization}</p>
                    <p className="text-xs text-[#626262]">{formatCurrencyINR(doc.consultation_fee)}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* STEP 2: Pick Date & Slot */}
      {currentStep === 2 && selectedDoctor && (
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-[#f0f0eb] pb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#efff72] text-[#111111]">
                <Stethoscope className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-[#111111]">{selectedDoctor.name}</h3>
                <p className="text-xs text-[#626262]">{selectedDoctor.specialization} • {formatCurrencyINR(selectedDoctor.consultation_fee)}</p>
              </div>
            </div>
            <button
              onClick={() => setCurrentStep(1)}
              className="text-xs font-semibold text-[#626262] hover:text-[#111111]"
            >
              Change Doctor
            </button>
          </div>

          {/* Date Selector */}
          <div className="space-y-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[#8e8e89] block">
              Consultation Date
            </label>
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              {dateOptions.map((d, i) => {
                const isSelected =
                  selectedDate.toISOString().split("T")[0] === d.toISOString().split("T")[0];
                return (
                  <button
                    key={i}
                    onClick={() => setSelectedDate(d)}
                    className={`flex flex-col items-center justify-center min-w-[85px] p-3 rounded-2xl border transition-all ${
                      isSelected
                        ? "border-[#111111] bg-[#111111] text-white"
                        : "border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111]"
                    }`}
                  >
                    <span className={`text-[11px] font-semibold ${isSelected ? "text-[#efff72]" : "text-[#626262]"}`}>
                      {formatDate(d, "EEE")}
                    </span>
                    <span className="text-sm font-bold">{formatDate(d, "d MMM")}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Slots */}
          <div className="space-y-3 pt-2">
            <label className="text-xs font-bold uppercase tracking-wider text-[#8e8e89] block">
              Select Advisory Slot to Acquire Hold
            </label>

            {isSlotsLoading || holdMutation.isPending ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
                <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
                <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
                <div className="h-12 bg-[#f0f0eb] rounded-xl animate-pulse" />
              </div>
            ) : slots && slots.length > 0 ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
                {slots.map((slot, i) => (
                  <button
                    key={i}
                    disabled={!slot.available}
                    onClick={() => handleSlotSelect(slot.starts_at)}
                    className={`flex flex-col items-center justify-center p-3.5 rounded-xl border text-center transition-all ${
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
                        <span>{slot.conflict_reason || "Booked"}</span>
                      )}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-[#626262] py-4 text-center">
                No slots available on this date. Please pick another day.
              </p>
            )}
          </div>
        </div>
      )}

      {/* STEP 3: Symptoms Intake with Live Active Hold Countdown */}
      {currentStep === 3 && activeHold && selectedDoctor && (
        <form onSubmit={handleConfirmSubmit} className="space-y-6">
          <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
            {/* Hold Banner with Countdown */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-2xl border border-[#d6ea39] bg-[#efff72]/25 p-4">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-[#26734d]" />
                  <span className="text-sm font-bold text-[#111111]">
                    Temporary Slot Reservation Held
                  </span>
                </div>
                <p className="text-xs text-[#626262] mt-0.5">
                  Complete symptom submission before expiry to commit your booking.
                </p>
              </div>

              {/* Server-derived absolute Hold Countdown */}
              <HoldCountdownBadge
                expiresAt={activeHold.expires_at}
                onExpire={handleHoldExpire}
              />
            </div>

            {/* Expiry Warning Overlay if expired */}
            {isHoldExpired && (
              <div className="rounded-2xl border border-[#fecdca] bg-[#fef3f2] p-4 text-xs text-[#b42318] space-y-2">
                <div className="font-bold flex items-center gap-1.5">
                  <AlertTriangle className="h-4 w-4" />
                  <span>Reservation Hold Expired</span>
                </div>
                <p>
                  Your 5-minute hold has expired. Your entered symptoms have been preserved. Please select an available slot to re-acquire a hold.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentStep(2)}
                  className="mt-1"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Choose Another Slot</span>
                </Button>
              </div>
            )}

            {/* Appointment Summary Box */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 text-xs">
              <div>
                <span className="text-[#8e8e89] block">Doctor</span>
                <span className="font-bold text-[#111111]">{selectedDoctor.name}</span>
                <span className="text-[#626262] block">{selectedDoctor.specialization}</span>
              </div>
              <div>
                <span className="text-[#8e8e89] block">Scheduled Time</span>
                <span className="font-bold text-[#111111]">
                  {formatDate(activeHold.starts_at, "EEE, MMM d, yyyy")}
                </span>
                <span className="text-[#626262] block">
                  {formatTime(activeHold.starts_at)} - {formatTime(activeHold.ends_at)} (IST)
                </span>
              </div>
              <div>
                <span className="text-[#8e8e89] block">Fee</span>
                <span className="font-bold text-[#111111]">
                  {formatCurrencyINR(selectedDoctor.consultation_fee)}
                </span>
                <span className="text-[#26734d] font-semibold block">Pay at Clinic</span>
              </div>
            </div>

            {/* Symptoms Input Form (TEXT-001: Preserved immutably) */}
            <div className="space-y-2">
              <Textarea
                label="Describe your symptoms / Reason for consultation"
                required
                rows={5}
                placeholder="E.g., Experiencing mild chest tightness after exercise for the past week, home BP 140/90 mmHg..."
                value={symptomsText}
                error={symptomsError}
                onChange={(e) => {
                  setSymptomsText(e.target.value);
                  if (symptomsError) setSymptomsError("");
                }}
                helperText="Your original symptom text is preserved immutably and provided directly to your doctor alongside an AI pre-visit intake summary."
              />
            </div>

            {/* Submit / Confirmation Actions */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-[#f0f0eb]">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCurrentStep(2)}
                disabled={confirmMutation.isPending}
              >
                <ArrowLeft className="h-4 w-4" />
                <span>Change Time</span>
              </Button>

              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={isHoldExpired || confirmMutation.isPending}
                isLoading={confirmMutation.isPending}
              >
                <span>Confirm & Commit Booking</span>
                <ArrowRight className="h-4 w-4 text-[#efff72]" />
              </Button>
            </div>
          </div>
        </form>
      )}

      {/* STEP 4: Success / Confirmed Booking */}
      {currentStep === 4 && confirmedAppointment && (
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-8 sm:p-12 shadow-sm text-center space-y-6">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#edfdf4] text-[#26734d]">
            <CheckCircle2 className="h-10 w-10" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-black text-[#111111] sm:text-3xl">
              Appointment Confirmed!
            </h2>
            <p className="text-sm text-[#626262] max-w-md mx-auto">
              Your appointment with <strong>{confirmedAppointment.doctor_name}</strong> is committed in our system.
            </p>
          </div>

          {/* Appointment Record Card */}
          <div className="max-w-lg mx-auto rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-6 text-left space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-[#e7e7e2] pb-3">
              <span className="text-[#8e8e89]">Booking ID</span>
              <span className="font-mono font-bold text-[#111111]">{confirmedAppointment.id}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8e8e89]">Doctor</span>
              <span className="font-bold text-[#111111]">{confirmedAppointment.doctor_name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8e8e89]">Date & Time</span>
              <span className="font-bold text-[#111111]">
                {formatDateTime(confirmedAppointment.starts_at)} (IST)
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#8e8e89]">Status</span>
              <span className="font-semibold text-[#26734d]">Confirmed</span>
            </div>
          </div>

          {/* Action Links */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            <Link href={`/patient/appointments/${confirmedAppointment.id}`}>
              <Button variant="primary" size="default">
                <span>View Appointment Detail</span>
              </Button>
            </Link>
            <Link href="/patient">
              <Button variant="outline" size="default">
                <span>Return to Dashboard</span>
              </Button>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}

export default function BookingWizardPage() {
  return (
    <Suspense fallback={<CardSkeleton />}>
      <BookingWizardContent />
    </Suspense>
  );
}
