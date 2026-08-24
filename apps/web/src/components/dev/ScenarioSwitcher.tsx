"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { scenarioManager, ScenarioType } from "@/mocks/scenarios";
import { Wrench, ChevronUp, ChevronDown, Check } from "lucide-react";
import { cn } from "@/lib/utils";

const SCENARIOS: Array<{ id: ScenarioType; label: string; desc: string }> = [
  { id: "normal", label: "Normal (Success)", desc: "Standard healthy system responses" },
  { id: "loading", label: "Loading Delay", desc: "Simulate high latency skeleton states" },
  { id: "empty", label: "Empty States", desc: "Simulate empty lists and search results" },
  { id: "validation_error", label: "Validation Failure", desc: "Simulate 422 bad parameters" },
  { id: "request_error", label: "500 Server Error", desc: "Simulate transient server failure" },
  { id: "offline", label: "Network Offline", desc: "Simulate zero connectivity" },
  { id: "forbidden", label: "403 Forbidden", desc: "Simulate unauthorized resource access" },
  { id: "partial_failure", label: "Partial Failure", desc: "Committed booking with failed outbox" },
  { id: "expired_hold", label: "Expired Slot Hold", desc: "Server hold expires in 5 seconds" },
];

export function ScenarioSwitcher() {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = React.useState(false);
  const [currentScenario, setCurrentScenario] = React.useState<ScenarioType>(() =>
    scenarioManager.getScenario()
  );

  React.useEffect(() => {
    return scenarioManager.subscribe((s) => {
      setCurrentScenario(s);
      // Deterministically invalidate active queries so the view refreshes to reflect new scenario
      queryClient.invalidateQueries();
    });
  }, [queryClient]);

  // Hide in production environments per handoff contract
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const handleSelect = (s: ScenarioType) => {
    scenarioManager.setScenario(s);
    setIsOpen(false);
    // Invalidate queries immediately
    queryClient.invalidateQueries();
    // Dispatch custom DOM event
    window.dispatchEvent(new Event("scenario-changed"));
  };

  return (
    <aside
      aria-label="Development Scenario Controller"
      className="fixed bottom-[max(1rem,env(safe-area-inset-bottom,1rem))] right-[max(1rem,env(safe-area-inset-right,1rem))] z-50 font-sans text-xs"
    >
      <div className="rounded-2xl border-2 border-dashed border-[#111111]/30 bg-[#111111] text-white shadow-2xl overflow-hidden backdrop-blur-md">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-controls="dev-scenario-dropdown"
          aria-label={`Development Scenario: ${SCENARIOS.find((s) => s.id === currentScenario)?.label || currentScenario}. Toggle menu`}
          className="flex min-h-[44px] min-w-[44px] items-center gap-2 px-3.5 py-2 font-mono font-medium hover:bg-white/10 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#efff72]"
        >
          <Wrench className="h-4 w-4 text-[#efff72]" aria-hidden="true" />
          <span className="text-[#efff72] font-bold">DEV:</span>
          <span className="max-w-[120px] truncate sm:max-w-none">
            {SCENARIOS.find((s) => s.id === currentScenario)?.label || currentScenario}
          </span>
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>

        {isOpen && (
          <div
            id="dev-scenario-dropdown"
            className="border-t border-white/10 p-2 max-h-72 w-64 overflow-y-auto space-y-1 bg-[#1a1a1a]"
          >
            <div className="px-2 py-1 text-[10px] uppercase font-mono tracking-wider text-white/50">
              Select Edge Scenario
            </div>
            {SCENARIOS.map((sc) => (
              <button
                key={sc.id}
                type="button"
                onClick={() => handleSelect(sc.id)}
                className={cn(
                  "w-full text-left px-2.5 py-2 min-h-[44px] rounded-lg flex items-center justify-between gap-2 transition-colors",
                  currentScenario === sc.id
                    ? "bg-[#efff72] text-[#111111] font-semibold"
                    : "text-white/80 hover:bg-white/10"
                )}
              >
                <div>
                  <div className="font-medium text-xs">{sc.label}</div>
                  <div className={cn("text-[10px] mt-0.5", currentScenario === sc.id ? "text-[#111111]/70" : "text-white/40")}>
                    {sc.desc}
                  </div>
                </div>
                {currentScenario === sc.id && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
              </button>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
