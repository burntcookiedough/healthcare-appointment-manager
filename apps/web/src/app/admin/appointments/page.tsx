"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Input } from "@/components/ui/Input";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatDate, formatTime } from "@/lib/dates";
import {
  Calendar,
  Search,
} from "lucide-react";

export default function AdminAppointmentsPage() {
  const [statusFilter, setStatusFilter] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState("");

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["admin-all-appointments"],
    queryFn: () => apiClient.getAppointments("admin"),
  });

  const filtered = React.useMemo(() => {
    if (!appointments) return [];
    return appointments
      .filter((a) => {
        if (statusFilter === "all") return true;
        if (statusFilter === "active") return a.status === "confirmed" || a.status === "in_progress";
        if (statusFilter === "completed") return a.status === "completed";
        if (statusFilter === "cancelled") return a.status.startsWith("cancelled_");
        return a.status === statusFilter;
      })
      .filter((a) => {
        if (!searchQuery.trim()) return true;
        const q = searchQuery.toLowerCase();
        return (
          a.patient_name.toLowerCase().includes(q) ||
          a.doctor_name.toLowerCase().includes(q) ||
          a.id.toLowerCase().includes(q)
        );
      });
  }, [appointments, statusFilter, searchQuery]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            Appointment Operations
          </h1>
          <p className="text-sm text-[#626262] mt-1">
            Global clinic appointment ledger with operational status and lifecycle tracking.
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative max-w-md flex-1">
          <Input
            placeholder="Search by patient, doctor, or booking ID…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e89]" />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {["all", "active", "completed", "cancelled"].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              aria-pressed={statusFilter === st}
              className={`min-h-[44px] rounded-full px-4 py-2 text-xs font-semibold capitalize transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111] ${
                statusFilter === st
                  ? "bg-[#111111] text-white"
                  : "border border-[#e7e7e2] bg-white text-[#626262] hover:border-[#111111]"
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6">
            <CardSkeleton />
          </div>
        ) : filtered.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#e7e7e2] bg-[#fbfbf8] font-bold text-[#626262]">
                <tr>
                  <th className="py-4 px-6">ID & Date</th>
                  <th className="py-4 px-6">Patient</th>
                  <th className="py-4 px-6">Assigned Doctor</th>
                  <th className="py-4 px-6">Scheduled Time</th>
                  <th className="py-4 px-6">Status</th>
                  <th className="py-4 px-6">Integration Outbox</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0eb]">
                {filtered.map((apt) => (
                  <tr key={apt.id} className="hover:bg-[#fbfbf8]/80 transition-colors">
                    <td className="py-4 px-6">
                      <div className="font-mono font-bold text-[#111111]">{apt.id}</div>
                      <div className="text-[11px] text-[#8e8e89]">{formatDate(apt.starts_at)}</div>
                    </td>
                    <td className="py-4 px-6 font-bold text-[#111111]">{apt.patient_name}</td>
                    <td className="py-4 px-6">
                      <div className="font-semibold text-[#111111]">{apt.doctor_name}</div>
                      <div className="text-[11px] text-[#626262]">{apt.doctor_specialization}</div>
                    </td>
                    <td className="py-4 px-6 font-mono text-[#111111]">
                      {formatTime(apt.starts_at)} - {formatTime(apt.ends_at)}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={apt.status} size="sm" />
                    </td>
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-1.5">
                        {apt.integrations.map((item) => (
                          <StatusBadge key={item.id} status={item.state} size="sm" />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Calendar}
            title="No appointments match the filter"
            description="Try selecting a different status tab or clearing your search term."
          />
        )}
      </div>
    </div>
  );
}
