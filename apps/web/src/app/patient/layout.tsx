"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/features/auth/auth-context";
import { PlusCircle } from "lucide-react";

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#fbfbf8]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Patient Sub-header Bar */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#e7e7e2] pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#edfdf4] px-2.5 py-0.5 text-xs font-semibold text-[#1e613f]">
                Patient Portal
              </span>
              <span className="text-xs text-[#8e8e89]">ID: pat-001-aarav</span>
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-[#111111]">
              Patient: {user?.display_name || "Aarav Sharma"}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/patient/book"
              className="inline-flex items-center gap-2 rounded-full bg-[#111111] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-[#262626]"
            >
              <PlusCircle className="h-4 w-4 text-[#efff72]" />
              <span>Book New Appointment</span>
            </Link>
          </div>
        </div>

        {/* Content Container */}
        <div>{children}</div>
      </div>
    </div>
  );
}
