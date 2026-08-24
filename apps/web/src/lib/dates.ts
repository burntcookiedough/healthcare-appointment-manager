import {
  differenceInSeconds,
  parseISO,
  addDays,
  startOfDay,
  setHours,
  setMinutes,
  isAfter,
  isBefore,
} from "date-fns";

export const APP_TIMEZONE = "Asia/Kolkata";

export function parseDate(dateInput: string | Date): Date {
  if (dateInput instanceof Date) return dateInput;
  if (typeof dateInput === "string") {
    // If string has no timezone offset (e.g. YYYY-MM-DDTHH:mm), treat as ISO or fallback
    return parseISO(dateInput);
  }
  return new Date(dateInput);
}

/**
 * Format an instant in Asia/Kolkata timezone regardless of the browser's local timezone.
 */
export function formatDate(
  dateInput: string | Date,
  pattern = "MMM d, yyyy",
  timeZone = APP_TIMEZONE
): string {
  try {
    const d = parseDate(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    if (pattern === "EEEE, MMMM d, yyyy") {
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(d);
    }

    if (pattern === "EEE, MMM d, yyyy" || pattern === "EEE, MMMM d, yyyy") {
      return new Intl.DateTimeFormat("en-US", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(d);
    }

    if (pattern === "EEE, d MMM") {
      const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);
      const day = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric" }).format(d);
      const month = new Intl.DateTimeFormat("en-US", { timeZone, month: "short" }).format(d);
      return `${weekday}, ${day} ${month}`;
    }

    if (pattern === "EEE") {
      return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(d);
    }

    if (pattern === "d MMM") {
      const day = new Intl.DateTimeFormat("en-US", { timeZone, day: "numeric" }).format(d);
      const month = new Intl.DateTimeFormat("en-US", { timeZone, month: "short" }).format(d);
      return `${day} ${month}`;
    }

    // Default: "MMM d, yyyy"
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(d);
  } catch {
    return String(dateInput);
  }
}

/**
 * Format time in Asia/Kolkata (e.g. "9:00 AM", "02:30 PM")
 */
export function formatTime(dateInput: string | Date, timeZone = APP_TIMEZONE): string {
  try {
    const d = parseDate(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(d);
  } catch {
    return String(dateInput);
  }
}

/**
 * Format date and time in Asia/Kolkata (e.g. "Aug 25, 2026 at 2:30 PM")
 */
export function formatDateTime(
  dateInput: string | Date,
  timeZone = APP_TIMEZONE
): string {
  try {
    const d = parseDate(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    const datePart = formatDate(d, "MMM d, yyyy", timeZone);
    const timePart = formatTime(d, timeZone);
    return `${datePart} at ${timePart}`;
  } catch {
    return String(dateInput);
  }
}

export function formatRelative(dateInput: string | Date): string {
  try {
    const d = parseDate(dateInput);
    const now = new Date();
    const diffSec = Math.round((d.getTime() - now.getTime()) / 1000);
    const absDiff = Math.abs(diffSec);

    if (absDiff < 60) return diffSec >= 0 ? "in a few seconds" : "a few seconds ago";
    const diffMin = Math.round(diffSec / 60);
    if (Math.abs(diffMin) < 60) return diffMin >= 0 ? `in ${diffMin} minutes` : `${Math.abs(diffMin)} minutes ago`;
    const diffHours = Math.round(diffMin / 60);
    if (Math.abs(diffHours) < 24) return diffHours >= 0 ? `in ${diffHours} hours` : `${Math.abs(diffHours)} hours ago`;
    const diffDays = Math.round(diffHours / 24);
    return diffDays >= 0 ? `in ${diffDays} days` : `${Math.abs(diffDays)} days ago`;
  } catch {
    return String(dateInput);
  }
}

export function formatSlotRange(
  startsAt: string | Date,
  endsAt: string | Date,
  timeZone = APP_TIMEZONE
): string {
  try {
    const s = formatTime(startsAt, timeZone);
    const e = formatTime(endsAt, timeZone);
    return `${s} - ${e}`;
  } catch {
    return `${startsAt} - ${endsAt}`;
  }
}

/**
 * Returns date-only string as "YYYY-MM-DD" in Asia/Kolkata without UTC date shifting.
 */
export function formatDateOnly(dateInput: string | Date, timeZone = APP_TIMEZONE): string {
  try {
    const d = parseDate(dateInput);
    if (isNaN(d.getTime())) return String(dateInput);

    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(d); // "YYYY-MM-DD"
  } catch {
    return String(dateInput);
  }
}

/**
 * Parse a datetime-local input string labeled IST (e.g. "2026-08-25T09:00")
 * into a UTC ISO string by resolving it against Asia/Kolkata (+05:30) wall clock.
 */
export function parseLocalISTToUTCISO(dateTimeLocalString: string): string {
  if (!dateTimeLocalString) return "";
  const trimmed = dateTimeLocalString.trim();

  // If it already has an offset (Z or +HH:mm), parse directly
  if (trimmed.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(trimmed)) {
    return new Date(trimmed).toISOString();
  }

  // Format as YYYY-MM-DDTHH:mm[:ss]+05:30
  const normalized = trimmed.length === 16 ? `${trimmed}:00+05:30` : `${trimmed}+05:30`;
  const d = new Date(normalized);
  if (isNaN(d.getTime())) {
    return new Date(trimmed).toISOString();
  }
  return d.toISOString();
}

/**
 * Check if an instant falls on today in the clinic timezone (Asia/Kolkata).
 */
export function isTodayInTimezone(dateInput: string | Date, timeZone = APP_TIMEZONE): boolean {
  try {
    const d = parseDate(dateInput);
    if (isNaN(d.getTime())) return false;

    const dateStr = formatDateOnly(d, timeZone);
    const todayStr = formatDateOnly(new Date(), timeZone);
    return dateStr === todayStr;
  } catch {
    return false;
  }
}

export function getSecondsRemaining(expiresAt: string | Date): number {
  try {
    const expiry = parseDate(expiresAt);
    const now = new Date();
    const diff = differenceInSeconds(expiry, now);
    return Math.max(0, diff);
  } catch {
    return 0;
  }
}

export function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export { isAfter, isBefore, addDays, startOfDay, setHours, setMinutes };
