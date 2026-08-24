"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AiBadge } from "@/components/common/AiBadge";
import {
  ArrowRight,
  ShieldCheck,
  User,
  Stethoscope,
  Clock,
  Pill,
  CheckCircle2,
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
      {/* Background Decorative Ambient Glows */}
      <div className="pointer-events-none absolute left-1/2 top-12 h-[380px] w-[540px] -translate-x-1/2 rounded-full bg-[#efff72]/20 blur-3xl" />
      <div className="pointer-events-none absolute right-10 top-1/3 h-[280px] w-[360px] rounded-full bg-[#edfdf4]/40 blur-2xl" />

      {/* Hero Section */}
      <section className="relative mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-6 lg:px-8 lg:pt-24 lg:pb-28">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-12 lg:gap-8">
          {/* Left Column: Bold Typography & Primary Actions */}
          <div className="lg:col-span-7 space-y-8 text-left">
            {/* Top Pill Tag */}
            <div className="inline-flex items-center gap-2 rounded-full border border-[#e7e7e2] bg-white px-3.5 py-1.5 shadow-xs">
              <span className="flex h-2 w-2 rounded-full bg-[#26734d]" />
              <span className="text-xs font-semibold text-[#111111]">
                Next-Gen Healthcare Management
              </span>
              <span className="rounded-full bg-[#efff72] px-2 py-0.5 text-[10px] font-bold text-[#111111]">
                Live Demo
              </span>
            </div>

            {/* Main Headline */}
            <h1 className="text-4xl font-black tracking-tight text-[#111111] sm:text-5xl lg:text-6xl leading-[1.08]">
              Calm clinical scheduling,{" "}
              <span className="underline decoration-[#efff72] decoration-wavy decoration-2">
                zero slot conflicts.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="max-w-2xl text-base text-[#626262] sm:text-lg leading-relaxed">
              Experience the unified portal designed for patients, doctors, and clinic operators.
              Featuring atomic slot holds, AI pre-visit clinical briefings, and structured medication schedules.
            </p>

            {/* CTA Buttons */}
            <div className="flex flex-wrap items-center gap-3 pt-2">
              <Link href="/patient/book">
                <Button variant="primary" size="lg" className="px-6 text-sm font-semibold">
                  <span>Book an Appointment</span>
                  <ArrowRight className="h-4 w-4 text-[#efff72]" />
                </Button>
              </Link>

              <Link href="/login">
                <Button variant="outline" size="lg" className="px-6 text-sm font-semibold">
                  <span>Explore Demo Roles</span>
                </Button>
              </Link>
            </div>

            {/* Key Trust Signals */}
            <div className="grid grid-cols-3 gap-4 pt-6 border-t border-[#e7e7e2]">
              <div>
                <div className="text-xl font-bold text-[#111111]">5-Min</div>
                <div className="text-xs text-[#626262]">Atomic Slot Holds</div>
              </div>
              <div>
                <div className="text-xl font-bold text-[#111111]">100%</div>
                <div className="text-xs text-[#626262]">Original Data Kept</div>
              </div>
              <div>
                <div className="text-xl font-bold text-[#111111]">WCAG 2.2</div>
                <div className="text-xs text-[#626262]">Target Standards</div>
              </div>
            </div>
          </div>

          {/* Right Column: Abstract Scheduling Preview & Floating Healthcare Tokens */}
          <div className="relative lg:col-span-5 flex justify-center">
            {/* Main Work Surface Preview Card */}
            <div className="relative w-full max-w-md rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-2xl space-y-5">
              {/* Card Header */}
              <div className="flex items-center justify-between border-b border-[#f0f0eb] pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#efff72] text-[#111111]">
                    <Stethoscope className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[#111111]">Dr. Rajesh Verma</h3>
                    <p className="text-xs text-[#626262]">Cardiology • AIIMS New Delhi</p>
                  </div>
                </div>
                <StatusBadge status="confirmed" size="sm" />
              </div>

              {/* Slot & Time Preview */}
              <div className="rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] p-3.5 space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#626262]">Consultation Slot</span>
                  <span className="font-semibold text-[#111111]">Today • 02:30 PM (IST)</span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-[#626262]">Patient</span>
                  <span className="font-semibold text-[#111111]">Aarav Sharma (34M)</span>
                </div>
              </div>

              {/* AI Pre-Visit Brief Pill */}
              <div className="rounded-2xl border border-[#dceb4a] bg-[#efff72]/20 p-3.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <AiBadge status="ready" label="AI Pre-Visit Intake Brief" />
                  <span className="text-[10px] font-mono text-[#626262]">Ready</span>
                </div>
                <p className="text-xs text-[#111111] leading-relaxed">
                  Patient reports exertional chest tightness for 2 weeks. Home BP trending 140/90 on Amlodipine.
                </p>
              </div>

              {/* Prescriptions Preview */}
              <div className="flex items-center justify-between pt-1 text-xs text-[#626262]">
                <span className="flex items-center gap-1.5">
                  <Pill className="h-3.5 w-3.5 text-[#26734d]" />
                  <span>3 Structured Medications</span>
                </span>
                <span className="font-semibold text-[#111111]">Auto Reminders Active</span>
              </div>
            </div>

            {/* Floating Healthcare Glyph 1: Hold Countdown Token */}
            <div className="animate-float-1 absolute -top-6 -left-6 hidden sm:flex items-center gap-2 rounded-full border border-[#d6ea39] bg-[#efff72] px-3.5 py-1.5 text-xs font-bold text-[#111111] shadow-lg">
              <Clock className="h-3.5 w-3.5 text-[#111111]" />
              <span>Hold Active: 04:38</span>
            </div>

            {/* Floating Healthcare Glyph 2: Outbox Synced Token */}
            <div className="animate-float-2 absolute -bottom-4 -right-4 hidden sm:flex items-center gap-2 rounded-full border border-[#e7e7e2] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#111111] shadow-lg">
              <CheckCircle2 className="h-3.5 w-3.5 text-[#26734d]" />
              <span>Calendar & Email Synced</span>
            </div>
          </div>
        </div>
      </section>

      {/* Instant Role Launchpad Section */}
      <section className="border-t border-[#e7e7e2] bg-white py-16 sm:py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-2xl mx-auto space-y-3">
            <h2 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
              Choose your portal persona
            </h2>
            <p className="text-sm text-[#626262]">
              Switch instantly between dedicated experiences built with purpose-specific density.
            </p>
          </div>

          <div className="mt-12 grid grid-cols-1 gap-6 md:grid-cols-3">
            {/* Patient Persona Card */}
            <div className="group rounded-3xl border border-[#e7e7e2] bg-[#fbfbf8] p-6 transition-all hover:border-[#111111] hover:shadow-xl space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#edfdf4] text-[#26734d]">
                <User className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#111111]">Patient Experience</h3>
                <p className="mt-1 text-xs text-[#626262] leading-relaxed">
                  Doctor search, interactive slot picker, active hold countdown, symptom submission, and daily medication reminders.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full justify-between group-hover:bg-[#111111]"
                onClick={() => handleLaunchRole("patient")}
              >
                <span>Enter as Patient</span>
                <ArrowRight className="h-4 w-4 text-[#efff72]" />
              </Button>
            </div>

            {/* Doctor Persona Card */}
            <div className="group rounded-3xl border border-[#e7e7e2] bg-[#fbfbf8] p-6 transition-all hover:border-[#111111] hover:shadow-xl space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f6f6f2] text-[#111111]">
                <Stethoscope className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#111111]">Doctor Experience</h3>
                <p className="mt-1 text-xs text-[#626262] leading-relaxed">
                  Daily timeline, clinical workspace with AI intake brief, immutable symptom history, and structured prescription editor.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full justify-between"
                onClick={() => handleLaunchRole("doctor")}
              >
                <span>Enter as Doctor</span>
                <ArrowRight className="h-4 w-4 text-[#efff72]" />
              </Button>
            </div>

            {/* Admin Persona Card */}
            <div className="group rounded-3xl border border-[#e7e7e2] bg-[#fbfbf8] p-6 transition-all hover:border-[#111111] hover:shadow-xl space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fff8eb] text-[#b54708]">
                <ShieldCheck className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#111111]">Administrator Portal</h3>
                <p className="mt-1 text-xs text-[#626262] leading-relaxed">
                  Doctor roster management, leave scheduling with affected-appointments impact preview, and integration outbox retries.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full justify-between"
                onClick={() => handleLaunchRole("admin")}
              >
                <span>Enter as Admin</span>
                <ArrowRight className="h-4 w-4 text-[#efff72]" />
              </Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
