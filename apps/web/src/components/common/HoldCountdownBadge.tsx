"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { getSecondsRemaining, formatCountdown } from "@/lib/dates";
import { announceToScreenReader } from "@/lib/accessibility";
import { Clock, AlertTriangle } from "lucide-react";

interface HoldCountdownBadgeProps {
  expiresAt: string; // ISO 8601 UTC server expiry
  onExpire?: () => void;
  className?: string;
}

export function HoldCountdownBadge({ expiresAt, onExpire, className }: HoldCountdownBadgeProps) {
  const [secondsRemaining, setSecondsRemaining] = React.useState<number>(() =>
    getSecondsRemaining(expiresAt)
  );
  const [isExpired, setIsExpired] = React.useState<boolean>(() => getSecondsRemaining(expiresAt) <= 0);
  const onExpireRef = React.useRef(onExpire);
  onExpireRef.current = onExpire;
  const hasFiredExpireRef = React.useRef(false);

  React.useEffect(() => {
    const initial = getSecondsRemaining(expiresAt);
    setSecondsRemaining(initial);

    if (initial <= 0) {
      setIsExpired(true);
      if (!hasFiredExpireRef.current) {
        hasFiredExpireRef.current = true;
        onExpireRef.current?.();
      }
      return;
    }

    // Reset expired state when expires_at changes to a future instant
    setIsExpired(false);
    hasFiredExpireRef.current = false;

    const intervalId = setInterval(() => {
      const remaining = getSecondsRemaining(expiresAt);
      setSecondsRemaining(remaining);

      if (remaining <= 0) {
        setIsExpired(true);
        clearInterval(intervalId);
        if (!hasFiredExpireRef.current) {
          hasFiredExpireRef.current = true;
          announceToScreenReader("Your reserved slot hold has expired. Please select a slot again.", "assertive");
          onExpireRef.current?.();
        }
      } else if (remaining === 60) {
        announceToScreenReader("One minute remaining to complete your booking hold.", "polite");
      }
    }, 1000);

    // Handle tab visibility change / resume (so backgrounding tab accurately recalculates)
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const fresh = getSecondsRemaining(expiresAt);
        setSecondsRemaining(fresh);
        if (fresh <= 0) {
          setIsExpired(true);
          clearInterval(intervalId);
          if (!hasFiredExpireRef.current) {
            hasFiredExpireRef.current = true;
            onExpireRef.current?.();
          }
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [expiresAt]);

  const isLowTime = secondsRemaining <= 60 && !isExpired;

  if (isExpired) {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-[#EBCFC2] bg-[#F8ECE6] px-3 py-1 text-xs font-semibold text-[#7A4636] shadow-xs select-none",
          className
        )}
        role="alert"
      >
        <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
        <span>Slot Hold Expired</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-xs font-semibold transition-colors shadow-xs select-none",
        isLowTime
          ? "border-[#E8DEC0] bg-[#F7F2DF] text-[#655B36]"
          : "border-[#D8E7DB] bg-[#EEF5EF] text-[#315B43]",
        className
      )}
      aria-live="polite"
      aria-atomic="true"
    >
      <Clock className="h-3.5 w-3.5 text-current" aria-hidden="true" />
      <span>
        Slot held for: <strong className="font-mono font-bold text-sm tracking-tight">{formatCountdown(secondsRemaining)}</strong>
      </span>
    </div>
  );
}
