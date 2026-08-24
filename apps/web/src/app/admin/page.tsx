"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import {
  Users,
  Calendar,
  Layers,
  ArrowRight,
  CalendarOff,
} from "lucide-react";
import { isTodayInTimezone } from "@/lib/dates";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

export default function AdminOverviewPage() {
  const { data: doctors, isLoading: isDocsLoading, isError: isDocsError } = useQuery({
    queryKey: ["admin-doctors"],
    queryFn: () => apiClient.getDoctors(),
  });

  const { data: appointments, isLoading: isApptsLoading, isError: isApptsError } = useQuery({
    queryKey: ["admin-appointments"],
    queryFn: () => apiClient.getAppointments("admin"),
  });

  const { data: integrations, isLoading: isIntegrationsLoading, isError: isIntegrationsError } = useQuery({
    queryKey: ["admin-integrations-overview"],
    queryFn: () => apiClient.getAdminIntegrations(),
  });

  const { data: leaves, isLoading: isLeavesLoading, isError: isLeavesError } = useQuery({
    queryKey: ["admin-leaves"],
    queryFn: () => apiClient.getDoctorLeaves(),
  });

  const failedIntegrations = integrations?.filter((i) => i.state === "failed") || [];
  const todayAppointments = React.useMemo(
    () => appointments?.filter((appointment) => isTodayInTimezone(appointment.starts_at, "Asia/Kolkata")) || [],
    [appointments]
  );

  const pieData = React.useMemo(() => {
    if (!integrations || integrations.length === 0) {
      return [{ name: "Succeeded", value: 1, color: "#26734d" }];
    }
    const succeeded = integrations.filter((i) => i.state === "succeeded").length;
    const retrying = integrations.filter((i) => i.state === "retrying").length;
    const failed = integrations.filter((i) => i.state === "failed").length;
    const pending = integrations.filter((i) => i.state === "pending").length;

    const arr = [];
    if (succeeded > 0) arr.push({ name: "Succeeded", value: succeeded, color: "#26734d" });
    if (retrying > 0) arr.push({ name: "Retrying", value: retrying, color: "#b54708" });
    if (failed > 0) arr.push({ name: "Failed", value: failed, color: "#b42318" });
    if (pending > 0) arr.push({ name: "Pending", value: pending, color: "#666861" });
    return arr.length > 0 ? arr : [{ name: "Succeeded", value: 1, color: "#26734d" }];
  }, [integrations]);

  const totalIntegrations = integrations?.length || 0;
  const succeededCount = integrations?.filter((i) => i.state === "succeeded").length || 0;
  const retryingCount = integrations?.filter((i) => i.state === "retrying").length || 0;
  const failedCount = integrations?.filter((i) => i.state === "failed").length || 0;
  const pendingCount = integrations?.filter((i) => i.state === "pending").length || 0;

  const chartData = React.useMemo(() => {
    const buckets = new Map<string, { confirmed: number; in_progress: number }>();

    if (todayAppointments.length > 0) {
      todayAppointments.forEach((apt) => {
        try {
          const d = new Date(apt.starts_at);
          const hourStr = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }).format(d);
          const h = Number(hourStr);
          if (!Number.isInteger(h) || h < 0 || h > 23) return;
          const bucketKey = `${String(h).padStart(2, "0")}:00`;
          const bucket = buckets.get(bucketKey) ?? { confirmed: 0, in_progress: 0 };

          if (apt.status === "confirmed") {
            bucket.confirmed++;
          } else if (apt.status === "in_progress") {
            bucket.in_progress++;
          }
          buckets.set(bucketKey, bucket);
        } catch {
          // ignore parsing error
        }
      });
    }

    return Array.from(buckets.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([time, counts]) => ({
      time,
      confirmed: counts.confirmed,
      in_progress: counts.in_progress,
    }));
  }, [todayAppointments]);

  return (
    <div className="space-y-8">
      {/* Page Header with Semantic H1 */}
      <div>
        <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
          Clinical Operations Overview
        </h1>
        <p className="text-sm text-[#626262] mt-1">
          Real-time system telemetry, active doctor rosters, consultation loads, and outbox integration health.
        </p>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Doctors */}
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-5 sm:p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Total Doctors</span>
            <Users className="h-4 w-4 text-[#111111]" aria-hidden="true" />
          </div>
          <span className="text-3xl font-black text-[#111111] block">
            {isDocsLoading ? "…" : isDocsError ? "—" : (doctors?.length ?? 0)}
          </span>
          <span className="text-[11px] font-semibold text-[#626262]">
            {isDocsLoading
              ? "Loading roster…"
              : isDocsError
              ? "Roster query failed"
              : `${doctors?.length || 0} active doctors`}
          </span>
        </div>

        {/* Card 2: Appointments */}
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-5 sm:p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Appointments Today</span>
            <Calendar className="h-4 w-4 text-[#111111]" aria-hidden="true" />
          </div>
          <span className="text-3xl font-black text-[#111111] block">
            {isApptsLoading ? "…" : isApptsError ? "—" : todayAppointments.length}
          </span>
          <span className="text-[11px] text-[#626262]">
            {isApptsLoading
              ? "Loading appointments…"
              : isApptsError
              ? "Appointments unavailable"
              : "Across all specialties"}
          </span>
        </div>

        {/* Card 3: Integrations */}
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-5 sm:p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Integration Failures</span>
            <Layers className="h-4 w-4 text-[#b54708]" aria-hidden="true" />
          </div>
          <span className="text-3xl font-black text-[#b42318] block">
            {isIntegrationsLoading ? "…" : isIntegrationsError ? "—" : failedIntegrations.length}
          </span>
          <span className="text-[11px] font-semibold text-[#626262]">
            {isIntegrationsLoading
              ? "Checking outbox…"
              : isIntegrationsError
              ? "Integration status unavailable"
              : failedIntegrations.length > 0
              ? `${failedIntegrations.length} failed — requires retry`
              : "All channels operational"}
          </span>
        </div>

        {/* Card 4: Leaves */}
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-5 sm:p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Active Leaves</span>
            <CalendarOff className="h-4 w-4 text-[#111111]" aria-hidden="true" />
          </div>
          <span className="text-3xl font-black text-[#111111] block">
            {isLeavesLoading ? "…" : isLeavesError ? "—" : (leaves?.length ?? 0)}
          </span>
          <span className="text-[11px] text-[#626262]">
            {isLeavesLoading
              ? "Loading leave records…"
              : isLeavesError
              ? "Leave records unavailable"
              : "Approved doctor intervals"}
          </span>
        </div>
      </div>

      {/* Visual Charts Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Chart: Today's Consultation Volume */}
        <div className="lg:col-span-8 rounded-3xl border border-[#e7e7e2] bg-white p-4 sm:p-6 lg:p-8 shadow-sm space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-[#f0f0eb] pb-4">
            <div>
              <h3 className="text-base font-bold text-[#111111]">
                Today&apos;s Appointment Slot Distribution
              </h3>
              <p className="text-xs text-[#626262]">
                Confirmed vs In-Progress consultations across time windows
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-[#111111]" />
                <span>Confirmed</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-sm bg-[#efff72]" />
                <span>In Consultation</span>
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <XAxis dataKey="time" stroke="#8e8e89" fontSize={11} />
                <YAxis stroke="#8e8e89" fontSize={11} allowDecimals={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111111",
                    color: "#ffffff",
                    borderRadius: "12px",
                    border: "none",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="confirmed" fill="#111111" radius={[6, 6, 0, 0]} />
                <Bar dataKey="in_progress" fill="#dff34d" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right Chart: Integration Outbox Sync Status */}
        <div className="lg:col-span-4 rounded-3xl border border-[#e7e7e2] bg-white p-4 sm:p-6 lg:p-8 shadow-sm space-y-6">
          <div className="border-b border-[#f0f0eb] pb-4">
            <h3 className="text-base font-bold text-[#111111]">Outbox Health Ratio</h3>
            <p className="text-xs text-[#626262]">SendGrid, Google Calendar & LLM delivery</p>
          </div>

          <div className="h-44 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  paddingAngle={4}
                >
                  {pieData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#111111",
                    color: "#ffffff",
                    borderRadius: "12px",
                    border: "none",
                    fontSize: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 border-t border-[#f0f0eb] pt-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#26734d]" />
                <span>Succeeded</span>
              </span>
              <span className="font-bold text-[#111111]">
                {totalIntegrations > 0 ? Math.round((succeededCount / totalIntegrations) * 100) : 100}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#b54708]" />
                <span>Retrying</span>
              </span>
              <span className="font-bold text-[#111111]">
                {totalIntegrations > 0 ? Math.round((retryingCount / totalIntegrations) * 100) : 0}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#b42318]" />
                <span>Failed</span>
              </span>
              <span className="font-bold text-[#111111]">
                {totalIntegrations > 0 ? Math.round((failedCount / totalIntegrations) * 100) : 0}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#666861]" />
                <span>Pending</span>
              </span>
              <span className="font-bold text-[#111111]">
                {totalIntegrations > 0 ? Math.round((pendingCount / totalIntegrations) * 100) : 0}%
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Operations Callout Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-3xl border border-[#e7e7e2] bg-[#fbfbf8] p-5 sm:p-6 space-y-4 hover:border-[#111111] transition-colors duration-150">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#e7e7e2] text-[#111111]">
            <CalendarOff className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-[#111111]">Doctor Leave Management</h4>
            <p className="text-xs text-[#626262] mt-1">
              Preview impact on existing appointments before committing doctor leave (LEAVE-002).
            </p>
          </div>
          <Button asChild variant="primary" size="default">
            <Link href="/admin/leave">
              <span>Schedule & Preview Leave</span>
              <ArrowRight className="h-3.5 w-3.5 text-[#efff72]" />
            </Link>
          </Button>
        </div>

        <div className="rounded-3xl border border-[#e7e7e2] bg-[#fbfbf8] p-5 sm:p-6 space-y-4 hover:border-[#111111] transition-colors duration-150">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#e7e7e2] text-[#111111]">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-[#111111]">Integration Health & Retries</h4>
            <p className="text-xs text-[#626262] mt-1">
              Inspect failed outbox items and trigger idempotent manual retries (OUTBOX-003).
            </p>
          </div>
          <Button asChild variant="primary" size="default">
            <Link href="/admin/integrations">
              <span>Inspect & Retry Outbox</span>
              <ArrowRight className="h-3.5 w-3.5 text-[#efff72]" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
