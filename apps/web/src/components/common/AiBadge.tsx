"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { AiBriefStatus } from "@/types/api";
import { Sparkles, Clock, AlertCircle } from "lucide-react";

interface AiBadgeProps {
  status?: AiBriefStatus;
  label?: string;
  showDisclaimer?: boolean;
  className?: string;
}

export function AiBadge({
  status = "ready",
  label = "AI-Assisted",
  showDisclaimer = false,
  className,
}: AiBadgeProps) {
  let statusText = "Ready";
  let bgClass = "bg-[#efff72]/30 text-[#434e00] border-[#dceb4a]";
  let Icon = Sparkles;

  if (status === "pending") {
    statusText = "Synthesizing…";
    bgClass = "bg-[#f6f6f2] text-[#626262] border-[#e7e7e2]";
    Icon = Clock;
  } else if (status === "unavailable") {
    statusText = "Unavailable";
    bgClass = "bg-[#fff8eb] text-[#9a6700] border-[#fedf89]";
    Icon = AlertCircle;
  }

  return (
    <div className={cn("inline-flex flex-col gap-0.5", className)}>
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-tight select-none",
          bgClass
        )}
      >
        <Icon className={cn("h-3 w-3", status === "pending" && "animate-spin")} aria-hidden="true" />
        <span>{label}</span>
        {status !== "ready" && <span className="opacity-75 font-normal">({statusText})</span>}
      </div>
      {showDisclaimer && (
        <span className="text-[10px] text-[#626262]">
          Advisory summary only. Non-diagnostic. Original patient inputs preserved.
        </span>
      )}
    </div>
  );
}
