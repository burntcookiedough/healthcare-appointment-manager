"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/common/StatusBadge";
import { CardSkeleton } from "@/components/common/Skeleton";
import {
  Users,
  Calendar,
  AlertTriangle,
  Layers,
  ArrowRight,
  ShieldCheck,
  CalendarOff,
  Activity,
  CheckCircle2,
} from "lucide-react";
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

const CHART_DATA = [
  { time: "09:00", confirmed: 4, in_progress: 1 },
  { time: "11:00", confirmed: 6, in_progress: 2 },
  { time: "13:00", confirmed: 3, in_progress: 1 },
  { time: "15:00", confirmed: 7, in_progress: 3 },
  { time: "17:00", confirmed: 5, in_progress: 0 },
];

const PIE_DATA = [
  { name: "Succeeded", value: 14, color: "#26734d" },
  { name: "Retrying", value: 2, color: "#b54708" },
  { name: "Failed", value: 1, color: "#b42318" },
];

export default function AdminOverviewPage() {
  const { data: doctors, isLoading: isDocsLoading } = useQuery({
    queryKey: ["admin-doctors"],
    queryFn: () => apiClient.getDoctors(),
  });

  const { data: appointments, isLoading: isApptsLoading } = useQuery({
    queryKey: ["admin-appointments"],
    queryFn: () => apiClient.getAppointments("admin"),
  });

  const { data: integrations, isLoading: isIntegrationsLoading } = useQuery({
    queryKey: ["admin-integrations-overview"],
    queryFn: () => apiClient.getAdminIntegrations(),
  });

  const { data: leaves, isLoading: isLeavesLoading } = useQuery({
    queryKey: ["admin-leaves"],
    queryFn: () => apiClient.getDoctorLeaves(),
  });

  const failedIntegrations = integrations?.filter((i) => i.state === "failed") || [];

  return (
    <div className="space-y-8">
      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Total Doctors</span>
            <Users className="h-4 w-4 text-[#111111]" />
          </div>
          <span className="text-3xl font-black text-[#111111] block">
            {doctors?.length || 5}
          </span>
          <span className="text-[11px] text-[#26734d] font-semibold">100% active roster</span>
        </div>

        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Appointments Today</span>
            <Calendar className="h-4 w-4 text-[#111111]" />
          </div>
          <span className="text-3xl font-black text-[#111111] block">
            {appointments?.length || 4}
          </span>
          <span className="text-[11px] text-[#626262]">Across all specialties</span>
        </div>

        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Integration Health</span>
            <Layers className="h-4 w-4 text-[#b54708]" />
          </div>
          <span className="text-3xl font-black text-[#b42318] block">
            {failedIntegrations.length}
          </span>
          <span className="text-[11px] text-[#b42318] font-semibold">
            {failedIntegrations.length > 0 ? "Requires manual retry" : "All channels synced"}
          </span>
        </div>

        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 shadow-xs space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#8e8e89]">Active Leaves</span>
            <CalendarOff className="h-4 w-4 text-[#111111]" />
          </div>
          <span className="text-3xl font-black text-[#111111] block">
            {leaves?.length || 2}
          </span>
          <span className="text-[11px] text-[#626262]">Approved doctor intervals</span>
        </div>
      </div>

      {/* Visual Charts Grid */}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        {/* Left Chart: Today's Consultation Volume */}
        <div className="lg:col-span-8 rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
          <div className="flex items-center justify-between border-b border-[#f0f0eb] pb-4">
            <div>
              <h3 className="text-base font-bold text-[#111111]">
                Today&apos;s Appointment Slot Distribution
              </h3>
              <p className="text-xs text-[#626262]">
                Confirmed vs In-Progress consultations across time windows
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs">
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
              <BarChart data={CHART_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
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
        <div className="lg:col-span-4 rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
          <div className="border-b border-[#f0f0eb] pb-4">
            <h3 className="text-base font-bold text-[#111111]">Outbox Health Ratio</h3>
            <p className="text-xs text-[#626262]">SendGrid, Google Calendar & LLM delivery</p>
          </div>

          <div className="h-44 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={PIE_DATA}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={45}
                  outerRadius={65}
                  paddingAngle={4}
                >
                  {PIE_DATA.map((entry, index) => (
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
              <span className="font-bold text-[#111111]">82%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#b54708]" />
                <span>Retrying</span>
              </span>
              <span className="font-bold text-[#111111]">12%</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-[#b42318]" />
                <span>Failed</span>
              </span>
              <span className="font-bold text-[#111111]">6%</span>
            </div>
          </div>
        </div>
      </div>

      {/* Quick Operations Callout Cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <div className="rounded-3xl border border-[#e7e7e2] bg-[#fbfbf8] p-6 space-y-4 hover:border-[#111111] transition-all">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#e7e7e2] text-[#111111]">
            <CalendarOff className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-[#111111]">Doctor Leave Management</h4>
            <p className="text-xs text-[#626262] mt-1">
              Preview impact on existing appointments before committing doctor leave (LEAVE-002).
            </p>
          </div>
          <Link href="/admin/leave">
            <Button variant="primary" size="sm">
              <span>Schedule & Preview Leave</span>
              <ArrowRight className="h-3.5 w-3.5 text-[#efff72]" />
            </Button>
          </Link>
        </div>

        <div className="rounded-3xl border border-[#e7e7e2] bg-[#fbfbf8] p-6 space-y-4 hover:border-[#111111] transition-all">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white border border-[#e7e7e2] text-[#111111]">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h4 className="text-base font-bold text-[#111111]">Integration Health & Retries</h4>
            <p className="text-xs text-[#626262] mt-1">
              Inspect failed outbox items and trigger idempotent manual retries (OUTBOX-003).
            </p>
          </div>
          <Link href="/admin/integrations">
            <Button variant="primary" size="sm">
              <span>Inspect & Retry Outbox</span>
              <ArrowRight className="h-3.5 w-3.5 text-[#efff72]" />
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
