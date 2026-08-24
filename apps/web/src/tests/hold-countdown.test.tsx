import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { HoldCountdownBadge } from "@/components/common/HoldCountdownBadge";

describe("HoldCountdownBadge Component", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calculates remaining time from absolute server expires_at", () => {
    // 3 minutes (180 seconds) in future
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);

    const expiresAt = new Date("2026-08-24T12:03:00.000Z").toISOString();

    render(<HoldCountdownBadge expiresAt={expiresAt} />);

    expect(screen.getByText("3:00")).toBeInTheDocument();
    expect(screen.getByText(/Slot held for:/)).toBeInTheDocument();
  });

  it("decrements time as clock advances", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);

    const expiresAt = new Date("2026-08-24T12:02:00.000Z").toISOString();

    render(<HoldCountdownBadge expiresAt={expiresAt} />);
    expect(screen.getByText("2:00")).toBeInTheDocument();

    // Advance 30 seconds
    act(() => {
      vi.advanceTimersByTime(30000);
    });

    expect(screen.getByText("1:30")).toBeInTheDocument();
  });

  it("transitions to expired state and invokes onExpire when time runs out", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);

    const expiresAt = new Date("2026-08-24T12:00:05.000Z").toISOString(); // 5 seconds
    const onExpireMock = vi.fn();

    render(<HoldCountdownBadge expiresAt={expiresAt} onExpire={onExpireMock} />);

    // Advance past 5 seconds
    act(() => {
      vi.advanceTimersByTime(6000);
    });

    expect(screen.getByText("Slot Hold Expired")).toBeInTheDocument();
    expect(onExpireMock).toHaveBeenCalled();
  });

  it("renders expired badge immediately if expires_at is in the past", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);

    const expiresAt = new Date("2026-08-24T11:59:00.000Z").toISOString(); // Past
    const onExpireMock = vi.fn();

    render(<HoldCountdownBadge expiresAt={expiresAt} onExpire={onExpireMock} />);

    expect(screen.getByText("Slot Hold Expired")).toBeInTheDocument();
    expect(onExpireMock).toHaveBeenCalledTimes(1);
  });

  it("resets expired state when expires_at prop updates to a future instant", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);

    const expiredInstant = new Date("2026-08-24T11:59:00.000Z").toISOString();
    const onExpireMock = vi.fn();

    const { rerender } = render(<HoldCountdownBadge expiresAt={expiredInstant} onExpire={onExpireMock} />);
    expect(screen.getByText("Slot Hold Expired")).toBeInTheDocument();
    expect(onExpireMock).toHaveBeenCalledTimes(1);

    // Prop updates to a new future instant (renewed hold)
    const futureInstant = new Date("2026-08-24T12:05:00.000Z").toISOString();
    rerender(<HoldCountdownBadge expiresAt={futureInstant} onExpire={onExpireMock} />);

    expect(screen.queryByText("Slot Hold Expired")).not.toBeInTheDocument();
    expect(screen.getByText("5:00")).toBeInTheDocument();
    expect(screen.getByText(/Slot held for:/)).toBeInTheDocument();
  });

  it("fires onExpire only once per expiry transition", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    vi.setSystemTime(now);

    const expiresAt = new Date("2026-08-24T12:00:02.000Z").toISOString();
    const onExpireMock = vi.fn();

    render(<HoldCountdownBadge expiresAt={expiresAt} onExpire={onExpireMock} />);

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText("Slot Hold Expired")).toBeInTheDocument();
    expect(onExpireMock).toHaveBeenCalledTimes(1);

    // Further timer ticks do not fire onExpire again
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpireMock).toHaveBeenCalledTimes(1);
  });
});
