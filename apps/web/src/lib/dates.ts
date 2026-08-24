import {
  format as dfFormat,
  formatDistanceToNow as dfFormatDistanceToNow,
  isAfter,
  isBefore,
  differenceInSeconds,
  parseISO,
  addDays,
  startOfDay,
  setHours,
  setMinutes,
} from "date-fns";

export const APP_TIMEZONE = "Asia/Kolkata";

export function parseDate(dateInput: string | Date): Date {
  return typeof dateInput === "string" ? parseISO(dateInput) : dateInput;
}

export function formatDate(dateInput: string | Date, pattern = "MMM d, yyyy"): string {
  try {
    const d = parseDate(dateInput);
    return dfFormat(d, pattern);
  } catch {
    return String(dateInput);
  }
}

export function formatTime(dateInput: string | Date): string {
  try {
    const d = parseDate(dateInput);
    return dfFormat(d, "h:mm a");
  } catch {
    return String(dateInput);
  }
}

export function formatDateTime(dateInput: string | Date): string {
  try {
    const d = parseDate(dateInput);
    return dfFormat(d, "MMM d, yyyy 'at' h:mm a");
  } catch {
    return String(dateInput);
  }
}

export function formatRelative(dateInput: string | Date): string {
  try {
    const d = parseDate(dateInput);
    return dfFormatDistanceToNow(d, { addSuffix: true });
  } catch {
    return String(dateInput);
  }
}

export function formatSlotRange(startsAt: string | Date, endsAt: string | Date): string {
  try {
    const s = parseDate(startsAt);
    const e = parseDate(endsAt);
    return `${dfFormat(s, "h:mm a")} - ${dfFormat(e, "h:mm a")}`;
  } catch {
    return `${startsAt} - ${endsAt}`;
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
