import { Lock, Clock } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-[#e7e7e2] bg-[#fbfbf8] py-8 text-xs text-[#626262]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#111111]">CareSync Healthcare Portal</span>
            <span>•</span>
            <span>Designed toward WCAG 2.2 AA accessibility targets</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px]">
            <div className="flex items-center gap-1">
              <Lock className="h-3 w-3 text-[#26734d]" aria-hidden="true" />
              <span>Synthetic Mock Data (No PHI exposed)</span>
            </div>
            <div className="flex items-center gap-1">
              <Clock className="h-3 w-3 text-[#626262]" aria-hidden="true" />
              <span>Timezone: Asia/Kolkata (IST)</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
