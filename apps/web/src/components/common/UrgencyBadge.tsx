"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { UrgencyLevel } from "@/types/api";
import { AlertCircle, AlertOctagon, Activity } from "lucide-react";

interface UrgencyBadgeProps {
  urgency?: UrgencyLevel;
  className?: string;
}

export function UrgencyBadge({ urgency = "routine", className }: UrgencyBadgeProps) {
  let label = "Routine";
  let bgClass = "bg-[#f6f6f2] text-[#626262] border-[#e7e7e2]";
  let Icon = Activity;

  if (urgency === "urgent") {
    label = "Urgent";
    bgClass = "bg-[#fff8eb] text-[#b54708] border-[#fedf89] font-medium";
    Icon = AlertCircle;
  } else if (urgency === "emergency") {
    label = "Emergency";
    bgClass = "bg-[#fef3f2] text-[#b42318] border-[#fecdca] font-semibold";
    Icon = AlertOctagon;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs select-none",
        bgClass,
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
