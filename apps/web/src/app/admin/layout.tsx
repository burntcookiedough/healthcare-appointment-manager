"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
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
    <div className="min-h-[calc(100vh-4rem)] bg-[#fbfbf8]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Admin Sub-header Bar */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#e7e7e2] pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#fff8eb] px-2.5 py-0.5 text-xs font-semibold text-[#b54708] border border-[#fedf89]">
                Admin Operations
              </span>
              <span className="text-xs text-[#8e8e89]">Role: Clinic Administrator</span>
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-[#111111]">
              Clinic Operations & Governance
            </div>
          </div>
        </div>

        {/* Admin Navigation Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 border-b border-[#e7e7e2]">
          {links.map((link) => {
            const isActive = pathname === link.href;
            const Icon = link.icon;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-all whitespace-nowrap",
                  isActive
                    ? "bg-[#111111] text-white shadow-xs"
                    : "border border-[#e7e7e2] bg-white text-[#626262] hover:border-[#111111] hover:text-[#111111]"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{link.label}</span>
              </Link>
            );
          })}
        </div>

        {/* Content */}
        <div>{children}</div>
      </div>
    </div>
  );
}
