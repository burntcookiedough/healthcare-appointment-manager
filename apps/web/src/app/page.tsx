"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/common/StatusBadge";
import {
  ArrowRight,
  ShieldCheck,
  User,
  Stethoscope,
  Clock,
  Pill,
  CheckCircle2,
  Sparkles,
} from "lucide-react";

export default function LandingPage() {
  const router = useRouter();
  const { setRole } = useAuth();

  const handleLaunchRole = (role: "patient" | "doctor" | "admin") => {
    setRole(role);
    router.push(`/${role}`);
  };

  return (
    <div className="relative min-h-[calc(100vh-4rem)] bg-grid-pattern overflow-hidden">
      {/* Hero Section */}
      <section className="relative mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-6 lg:px-8 lg:pt-24 lg:pb-28">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8">
          {/* Left Column: Typography & Primary Actions */}
          <div className="lg:col-span-7 space-y-8 text-left">
            {/* Top Non-Pill Eyebrow */}
            <div className="flex items-center gap-2 text-xs font-semibold text-[#666861]">
              <span className="h-1.5 w-6 rounded-xs bg-[#315B43]" aria-hidden="true" />
              <span>Clinical scheduling for modern practices</span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl font-black tracking-tight text-[#171815] sm:text-5xl lg:text-6xl leading-[1.08]">
              Calm clinical scheduling,{" "}
              <span className="underline decoration-[#D8E7DB] decoration-2 underline-offset-8">
                zero slot conflicts.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="max-w-2xl text-base text-[#666861] sm:text-lg leading-relaxed">
              Experience the unified portal designed for patients, doctors, and clinic operators.
              Featuring atomic slot holds, AI pre-visit clinical briefings, and structured medication schedules.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Button asChild variant="primary" size="lg" className="px-6 text-sm font-semibold">
                <Link href="/patient/book">
                  <span>Book an Appointment</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>

              <Button asChild variant="outline" size="lg" className="px-6 text-sm font-semibold">
                <Link href="/login">
                  <span>Explore Demo Roles</span>
                </Link>
              </Button>
            </div>

            {/* Key Trust Signals */}
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-[#E5E4DE]">
              <div>
                <div className="text-xl font-bold text-[#171815]">5-Min</div>
                <div className="text-xs text-[#666861]">Atomic Slot Holds</div>
              </div>
              <div>
                <div className="text-xl font-bold text-[#171815]">100%</div>
                <div className="text-xs text-[#666861]">Original Data Kept</div>
              </div>
              <div>
                <div className="text-xl font-bold text-[#171815]">WCAG 2.2</div>
                <div className="text-xs text-[#666861]">Target Standards</div>
              </div>
            </div>
          </div>

          {/* Right Column: Scheduling Preview Card */}
          <div className="relative lg:col-span-5 flex justify-center">
            {/* Main Work Surface Preview Card */}
            <div className="relative w-full max-w-md rounded-2xl border border-[#E5E4DE] bg-white p-6 shadow-sm space-y-5">
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-[#F6F5F0] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF5EF] text-[#315B43] border border-[#D8E7DB]">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#171815]">Dr. Rajesh Verma</h3>
                    <p className="text-xs text-[#666861]">Cardiology • AIIMS New Delhi</p>
                  </div>
                </div>
                <StatusBadge status="confirmed" size="sm" />
              </div>

              {/* Slot & Time Preview with Hold State */}
              <div className="rounded-xl border border-[#E5E4DE] bg-[#FBFBF8] p-3.5 space-y-2.5">
                <div className="flex items-center justify-between text-xs border-b border-[#E5E4DE] pb-2 text-[#666861]">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5 text-[#315B43]" />
                    <span>Active hold remaining:</span>
                  </span>
                  <span className="font-mono font-bold text-[#315B43]">04:38</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#666861]">Consultation Slot</span>
                  <span className="font-semibold text-[#171815]">Today • 02:30 PM (IST)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#666861]">Patient</span>
                  <span className="font-semibold text-[#171815]">Aarav Sharma (34M)</span>
                </div>
              </div>

              {/* AI Pre-Visit Summary Card */}
              <div className="rounded-xl border border-[#D9E3EA] bg-[#EEF3F7] p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-[#38556B]">
                    <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pre-visit summary</span>
                  </div>
                  <span className="text-[10px] text-[#666861]">AI-assisted · Advisory</span>
                </div>
                <p className="text-xs text-[#171815] leading-relaxed">
                  Patient reports exertional chest tightness for 2 weeks. Home BP trending 140/90 on Amlodipine.
                </p>
              </div>

              {/* Prescriptions & Outbox Status Preview in Footer */}
              <div className="flex items-center justify-between pt-1 text-xs text-[#666861] border-t border-[#F6F5F0]">
                <span className="flex items-center gap-1.5">
                  <Pill className="h-3.5 w-3.5 text-[#315B43]" />
                  <span>3 Structured Medications</span>
                </span>
                <span className="flex items-center gap-1 text-[#315B43] font-medium">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  <span>Calendar & Email Synced</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Instant Role Launchpad Section */}
      <section className="border-t border-[#E5E4DE] bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <h2 className="text-2xl font-black tracking-tight text-[#171815] sm:text-3xl">
              Choose your portal persona
            </h2>
            <p className="text-sm text-[#666861]">
              Switch instantly between dedicated experiences built with purpose-specific density.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Patient Persona Card */}
            <div className="group rounded-2xl border border-[#E5E4DE] bg-[#FBFBF8] p-5 sm:p-6 transition-colors duration-150 hover:border-[#171815] hover:shadow-md space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EEF5EF] text-[#315B43] border border-[#D8E7DB]">
                <User className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#171815]">Patient Experience</h3>
                <p className="mt-1 text-xs text-[#666861] leading-relaxed">
                  Doctor search, interactive slot picker, active hold countdown, symptom submission, and daily medication reminders.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full justify-between"
                onClick={() => handleLaunchRole("patient")}
              >
                <span>Enter as Patient</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Doctor Persona Card */}
            <div className="group rounded-2xl border border-[#E5E4DE] bg-[#FBFBF8] p-5 sm:p-6 transition-colors duration-150 hover:border-[#171815] hover:shadow-md space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#EEF3F7] text-[#38556B] border border-[#D9E3EA]">
                <Stethoscope className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#171815]">Doctor Experience</h3>
                <p className="mt-1 text-xs text-[#666861] leading-relaxed">
                  Daily timeline, clinical workspace with AI intake brief, immutable symptom history, and structured prescription editor.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full justify-between"
                onClick={() => handleLaunchRole("doctor")}
              >
                <span>Enter as Doctor</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Admin Persona Card */}
            <div className="group rounded-2xl border border-[#E5E4DE] bg-[#FBFBF8] p-5 sm:p-6 transition-colors duration-150 hover:border-[#171815] hover:shadow-md space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#F7F2DF] text-[#655B36] border border-[#E8DEC0]">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#171815]">Administrator Portal</h3>
                <p className="mt-1 text-xs text-[#666861] leading-relaxed">
                  Doctor roster management, leave scheduling with affected-appointments impact preview, and integration outbox retries.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full justify-between"
                onClick={() => handleLaunchRole("admin")}
              >
                <span>Enter as Admin</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
