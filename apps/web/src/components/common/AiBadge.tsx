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
  let iconBoxClass = "bg-[#EEF3F7] text-[#38556B] border-[#D9E3EA]";
  let textColor = "text-[#38556B]";
  let Icon = Sparkles;

  if (status === "pending") {
    statusText = "Synthesizing…";
    iconBoxClass = "bg-[#F6F5F0] text-[#666861] border-[#E5E4DE]";
    textColor = "text-[#666861]";
    Icon = Clock;
  } else if (status === "unavailable") {
    statusText = "Unavailable";
    iconBoxClass = "bg-[#F7F2DF] text-[#655B36] border-[#E8DEC0]";
    textColor = "text-[#655B36]";
    Icon = AlertCircle;
  }

  return (
    <div className={cn("inline-flex flex-col gap-0.5", className)}>
      <div className="inline-flex items-center gap-2 select-none">
        <div
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded-md border text-xs shadow-2xs",
            iconBoxClass
          )}
        >
          <Icon className={cn("h-3 w-3", status === "pending" && "animate-spin motion-reduce:animate-none")} aria-hidden="true" />
        </div>
        <div className="flex items-center gap-1.5 text-xs">
          <span className={cn("font-bold tracking-tight", textColor)}>{label}</span>
          {status !== "ready" ? (
            <span className="text-[11px] text-[#666861] font-normal">({statusText})</span>
          ) : (
            <span className="text-[11px] text-[#666861] font-normal">· Advisory</span>
          )}
        </div>
      </div>
      {showDisclaimer && (
        <span className="text-[11px] text-[#666861] mt-0.5">
          Advisory summary only. Non-diagnostic. Original patient inputs preserved.
        </span>
      )}
    </div>
  );
}
