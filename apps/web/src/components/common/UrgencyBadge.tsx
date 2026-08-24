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
  let bgClass = "bg-[#F6F5F0] text-[#666861] border-[#E5E4DE]";
  let Icon = Activity;

  if (urgency === "urgent") {
    label = "Urgent";
    bgClass = "bg-[#F7F2DF] text-[#655B36] border-[#E8DEC0] font-medium";
    Icon = AlertCircle;
  } else if (urgency === "emergency") {
    label = "Emergency";
    bgClass = "bg-[#F8ECE6] text-[#7A4636] border-[#EBCFC2] font-semibold";
    Icon = AlertOctagon;
  }

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs select-none",
        bgClass,
        className
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
