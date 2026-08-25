"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { RoleGuard } from "@/components/auth/RoleGuard";
import {
  Users,
  CalendarOff,
  Activity,
  Calendar,
  Layers,
} from "lucide-react";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const links = [
    { href: "/admin", label: "Overview & KPIs", icon: Activity },
    { href: "/admin/doctors", label: "Doctor Roster", icon: Users },
    { href: "/admin/leave", label: "Leave Management", icon: CalendarOff },
    { href: "/admin/appointments", label: "All Appointments", icon: Calendar },
    { href: "/admin/integrations", label: "Integration Health", icon: Layers },
  ];

  return (
    <RoleGuard allowedRoles={["admin"]}>
      <div className="min-h-[calc(100vh-4rem)] bg-[#fbfbf8]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Admin Sub-header Bar */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#E5E4DE] pb-5">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#655B36]">
                  <span className="h-2 w-2 rounded-xs bg-[#655B36]" aria-hidden="true" />
                  <span>Admin Operations</span>
                </div>
                <span className="text-xs text-[#666861]">· Role: Clinic Administrator</span>
              </div>
              <div className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-[#171815]">
                Clinic Operations & Governance
              </div>
            </div>
          </div>

          {/* Admin Navigation Pills */}
          <nav aria-label="Admin Navigation" className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 border-b border-[#E5E4DE]">
            {links.map((link) => {
              const isActive = pathname === link.href;
              const Icon = link.icon;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition-colors duration-150 whitespace-nowrap focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#171815]",
                    isActive
                      ? "bg-[#171815] text-white shadow-xs"
                      : "border border-[#E5E4DE] bg-white text-[#666861] hover:border-[#171815] hover:text-[#171815]"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{link.label}</span>
                </Link>
              );
            })}
          </nav>

          {/* Content */}
          <div>{children}</div>
        </div>
      </div>
    </RoleGuard>
  );
}
