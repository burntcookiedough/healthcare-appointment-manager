"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AppointmentStatus, IntegrationState } from "@/types/api";
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  XCircle,
  CalendarOff,
  RefreshCw,
  HelpCircle,
} from "lucide-react";

interface StatusBadgeProps {
  status: AppointmentStatus | IntegrationState | string;
  size?: "sm" | "default";
  className?: string;
}

export function StatusBadge({ status, size = "default", className }: StatusBadgeProps) {
  let label = status;
  let bgClass = "bg-[#f0f0eb] text-[#626262] border-[#e7e7e2]";
  let Icon = HelpCircle;

  switch (status) {
    case "confirmed":
    case "succeeded":
      label = status === "confirmed" ? "Confirmed" : "Synced";
      bgClass = "bg-[#edfdf4] text-[#1e613f] border-[#bbf2cf]";
      Icon = CheckCircle2;
      break;

    case "in_progress":
      label = "In Progress";
      bgClass = "bg-[#fffbeb] text-[#9a6700] border-[#fedf89]";
      Icon = Clock;
      break;

    case "completed":
      label = "Completed";
      bgClass = "bg-[#f6f6f2] text-[#111111] border-[#dcdcd4] font-semibold";
      Icon = CheckCircle2;
      break;

    case "pending":
      label = "Pending";
      bgClass = "bg-[#f8f9fa] text-[#555] border-[#e2e4e8]";
      Icon = Clock;
      break;

    case "retrying":
      label = "Retrying";
      bgClass = "bg-[#fff8eb] text-[#b54708] border-[#fedf89]";
      Icon = RefreshCw;
      break;

    case "failed":
      label = "Failed";
      bgClass = "bg-[#fef3f2] text-[#b42318] border-[#fecdca]";
      Icon = AlertTriangle;
      break;

    case "cancelled_patient":
      label = "Cancelled by Patient";
      bgClass = "bg-[#fef3f2] text-[#b42318] border-[#fecdca]";
      Icon = XCircle;
      break;

    case "cancelled_doctor":
      label = "Cancelled by Doctor";
      bgClass = "bg-[#fef3f2] text-[#b42318] border-[#fecdca]";
      Icon = XCircle;
      break;

    case "cancelled_admin":
      label = "Cancelled by Admin";
      bgClass = "bg-[#fef3f2] text-[#b42318] border-[#fecdca]";
      Icon = XCircle;
      break;

    case "cancelled_doctor_leave":
      label = "Cancelled — Doctor Leave";
      bgClass = "bg-[#fef3f2] text-[#b42318] border-[#fecdca]";
      Icon = CalendarOff;
      break;

    case "active":
      label = "Hold Active";
      bgClass = "bg-[#efff72]/30 text-[#4c5700] border-[#d6ea39]";
      Icon = Clock;
      break;

    default:
      label = String(status).replace(/_/g, " ");
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium tracking-tight select-none",
        size === "sm" ? "text-xs py-0.5 px-2" : "text-xs py-1 px-3",
        bgClass,
        className
      )}
    >
      <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5", status === "retrying" && "animate-spin")} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
