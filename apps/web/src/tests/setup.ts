import "@testing-library/jest-dom";
import { vi } from "vitest";

// Mock next/navigation for component rendering in vitest
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/patient/book",
  useParams: () => ({ id: "apt-001-upcoming" }),
}));

// Mock ResizeObserver for Recharts / responsive components in jsdom
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

import * as React from "react";

// Mock Recharts ResponsiveContainer for jsdom dimension calculation
vi.mock("recharts", async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return {
    ...original,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        "div",
        { className: "recharts-responsive-container", style: { width: 500, height: 300 } },
        children
      ),
  };
});
