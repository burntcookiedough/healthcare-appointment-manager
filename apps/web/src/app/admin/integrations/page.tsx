"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatDateTime } from "@/lib/dates";
import {
  Layers,
  RefreshCw,
  Mail,
  Calendar,
  Sparkles,
  Pill,
} from "lucide-react";
import { toast } from "sonner";

interface ChannelConfig {
  key: "email" | "calendar" | "llm" | "reminder";
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  subtitle: string;
}

const CHANNELS: ChannelConfig[] = [
  { key: "email", label: "SendGrid Email", icon: Mail, subtitle: "Confirmation notifications" },
  { key: "calendar", label: "Google Calendar", icon: Calendar, subtitle: "Doctor/patient sync" },
  { key: "llm", label: "LLM Summary Adapter", icon: Sparkles, subtitle: "Pre-visit intake synthesis" },
  { key: "reminder", label: "Reminders Channel", icon: Pill, subtitle: "Deterministic SMS dispatcher" },
];

export default function AdminIntegrationsPage() {
  const queryClient = useQueryClient();

  const { data: integrations, isLoading } = useQuery({
    queryKey: ["admin-integrations-list"],
    queryFn: () => apiClient.getAdminIntegrations(),
  });

  const retryMutation = useMutation({
    mutationFn: async (item: { id: string; version?: number }) => {
      if (!item.version) throw new Error("Integration operation version is unavailable.");
      return apiClient.retryIntegration(item.id, { expectedVersion: item.version });
    },
    onSuccess: (updated) => {
      toast.success(`Operation ${updated.id} retry succeeded.`);
      queryClient.invalidateQueries({ queryKey: ["admin-integrations-list"] });
      queryClient.invalidateQueries({ queryKey: ["admin-integrations-overview"] });
    },
    onError: (err: { error?: { message?: string } }) => {
      toast.error(err?.error?.message || "Failed to retry integration operation.");
    },
  });

  const items = React.useMemo(() => integrations || [], [integrations]);

  const channelHealth = React.useMemo(() => {
    return CHANNELS.map((ch) => {
      const channelItems = items.filter((i) => i.channel === ch.key);
      const hasFailed = channelItems.some((i) => i.state === "failed");
      const hasRetrying = channelItems.some((i) => i.state === "retrying");
      const hasPending = channelItems.some((i) => i.state === "pending");

      let status = "Operational";
      let statusClass = "text-[#111111]";
      let dotClass = "bg-[#26734d]";
      let detail: string = ch.subtitle;

      if (hasFailed) {
        const count = channelItems.filter((i) => i.state === "failed").length;
        status = "Degraded";
        statusClass = "text-[#b42318]";
        dotClass = "bg-[#b42318] animate-pulse motion-reduce:animate-none";
        detail = `${count} failed sync(s) requiring retry`;
      } else if (hasRetrying) {
        status = "Retrying";
        statusClass = "text-[#b54708]";
        dotClass = "bg-[#b54708]";
        detail = "Exponential backoff in progress";
      } else if (hasPending) {
        const count = channelItems.filter((i) => i.state === "pending").length;
        status = "Pending";
        statusClass = "text-[#666861]";
        dotClass = "bg-[#666861]";
        detail = `${count} queued sync(s) awaiting delivery`;
      } else {
        status = "Healthy";
        statusClass = "text-[#111111]";
        dotClass = "bg-[#26734d]";
        detail = channelItems.length > 0 ? "Delivery confirmed" : ch.subtitle;
      }

      return {
        ...ch,
        status,
        statusClass,
        dotClass,
        detail,
      };
    });
  }, [items]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            Integration Health & Outbox Governance
          </h1>
          <p className="text-sm text-[#626262] mt-1">
            Monitor asynchronous delivery for email, calendar sync, LLM intakes, and SMS reminders (OUTBOX-001, OUTBOX-003).
          </p>
        </div>
      </div>

      {/* Channel Health Overview Strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        {channelHealth.map((ch) => {
          const Icon = ch.icon;
          return (
            <div key={ch.key} className="rounded-2xl border border-[#e7e7e2] bg-white p-5 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#8e8e89]">{ch.label}</span>
                <Icon className="h-4 w-4 text-[#8e8e89]" />
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-2xl font-black ${ch.statusClass}`}>{ch.status}</span>
                <span className={`h-2 w-2 rounded-full ${ch.dotClass}`} />
              </div>
              <span className={`text-[11px] ${ch.status === "Degraded" ? "text-[#b42318]" : "text-[#626262]"}`}>
                {ch.detail}
              </span>
            </div>
          );
        })}
      </div>

      {/* Outbox Event Table with Manual Retry */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white shadow-sm overflow-hidden">
        <div className="p-6 border-b border-[#f0f0eb] flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-[#111111]">Transactional Outbox Operations</h3>
            <p className="text-xs text-[#626262] mt-0.5">
              Individual asynchronous work items recorded alongside domain transactions.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="p-6">
            <CardSkeleton />
          </div>
        ) : items.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#e7e7e2] bg-[#fbfbf8] font-bold text-[#626262]">
                <tr>
                  <th className="py-4 px-6">Operation ID & Channel</th>
                  <th className="py-4 px-6">Summary</th>
                  <th className="py-4 px-6">Attempts</th>
                  <th className="py-4 px-6">Last Attempt</th>
                  <th className="py-4 px-6">State</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0eb]">
                {items.map((item) => (
                  <tr key={item.id} className="hover:bg-[#fbfbf8]/80 transition-colors">
                    <td className="py-4 px-6">
                      <div className="font-mono font-bold text-[#111111]">{item.id}</div>
                      <div className="text-[11px] text-[#626262] uppercase font-semibold mt-0.5">
                        {item.channel}
                      </div>
                    </td>
                    <td className="py-4 px-6 max-w-xs">
                      <div className="text-[#111111] font-medium">
                        {item.payload_summary ?? "Integration payload summary unavailable."}
                      </div>
                      {item.error_message && (
                        <div className="text-[11px] text-[#b42318] mt-0.5 font-mono">
                          {item.error_code}: {item.error_message}
                        </div>
                      )}
                    </td>
                    <td className="py-4 px-6 font-mono text-[#111111]">
                      {item.attempt_count}
                      {item.max_attempts !== undefined ? ` / ${item.max_attempts}` : ""}
                    </td>
                    <td className="py-4 px-6 text-[#626262]">
                      {item.last_attempt_at ? formatDateTime(item.last_attempt_at) : "Pending"}
                    </td>
                    <td className="py-4 px-6">
                      <StatusBadge status={item.state} size="sm" />
                    </td>
                    <td className="py-4 px-6 text-right">
                      {item.state === "failed" ? (
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => retryMutation.mutate({ id: item.id, version: item.version })}
                          isLoading={
                            retryMutation.isPending &&
                            retryMutation.variables?.id === item.id
                          }
                          className="text-xs"
                        >
                          <RefreshCw className="h-3 w-3 text-[#efff72]" />
                          <span>Retry Work</span>
                        </Button>
                      ) : (
                        <span className="text-[11px] text-[#8e8e89]">No action required</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Layers}
            title="Outbox queue is empty"
            description="All outbox jobs have been processed."
          />
        )}
      </div>
    </div>
  );
}
