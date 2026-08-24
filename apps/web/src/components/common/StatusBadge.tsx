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
  let bgClass = "bg-[#F6F5F0] text-[#666861] border-[#E5E4DE]";
  let Icon = HelpCircle;

  switch (status) {
    case "confirmed":
    case "succeeded":
      label = status === "confirmed" ? "Confirmed" : "Synced";
      bgClass = "bg-[#EEF5EF] text-[#315B43] border-[#D8E7DB]";
      Icon = CheckCircle2;
      break;

    case "in_progress":
      label = "In Progress";
      bgClass = "bg-[#EEF3F7] text-[#38556B] border-[#D9E3EA]";
      Icon = Clock;
      break;

    case "completed":
      label = "Completed";
      bgClass = "bg-[#F6F5F0] text-[#171815] border-[#E5E4DE] font-semibold";
      Icon = CheckCircle2;
      break;

    case "pending":
      label = "Pending";
      bgClass = "bg-[#F6F5F0] text-[#666861] border-[#E5E4DE]";
      Icon = Clock;
      break;

    case "retrying":
      label = "Retrying";
      bgClass = "bg-[#F7F2DF] text-[#655B36] border-[#E8DEC0]";
      Icon = RefreshCw;
      break;

    case "failed":
      label = "Failed";
      bgClass = "bg-[#F8ECE6] text-[#7A4636] border-[#EBCFC2]";
      Icon = AlertTriangle;
      break;

    case "cancelled_patient":
      label = "Cancelled by Patient";
      bgClass = "bg-[#F8ECE6] text-[#7A4636] border-[#EBCFC2]";
      Icon = XCircle;
      break;

    case "cancelled_doctor":
      label = "Cancelled by Doctor";
      bgClass = "bg-[#F8ECE6] text-[#7A4636] border-[#EBCFC2]";
      Icon = XCircle;
      break;

    case "cancelled_admin":
      label = "Cancelled by Admin";
      bgClass = "bg-[#F8ECE6] text-[#7A4636] border-[#EBCFC2]";
      Icon = XCircle;
      break;

    case "cancelled_doctor_leave":
      label = "Cancelled — Doctor Leave";
      bgClass = "bg-[#F8ECE6] text-[#7A4636] border-[#EBCFC2]";
      Icon = CalendarOff;
      break;

    case "active":
      label = "Hold Active";
      bgClass = "bg-[#EEF5EF] text-[#315B43] border-[#D8E7DB]";
      Icon = Clock;
      break;

    default:
      label = String(status).replace(/_/g, " ");
      break;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border font-medium tracking-tight select-none",
        size === "sm" ? "text-xs py-0.5 px-2" : "text-xs py-1 px-2.5",
        bgClass,
        className
      )}
    >
      <Icon className={cn(size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5", status === "retrying" && "animate-spin")} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
