"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/features/auth/auth-context";
import { Calendar } from "lucide-react";

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[#fbfbf8]">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Doctor Sub-header Bar */}
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#e7e7e2] pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-[#f6f6f2] px-2.5 py-0.5 text-xs font-semibold text-[#111111] border border-[#e7e7e2]">
                Clinician Portal
              </span>
              <span className="text-xs text-[#8e8e89]">ID: doc-001-rajesh</span>
            </div>
            <div className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-[#111111]">
              Clinician: {user?.display_name || "Dr. Rajesh Verma"} • Cardiology
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/doctor/schedule"
              className="inline-flex items-center gap-2 rounded-full border border-[#e7e7e2] bg-white px-4 py-2 text-xs font-semibold text-[#111111] shadow-xs hover:bg-[#f6f6f2]"
            >
              <Calendar className="h-4 w-4" />
              <span>Working Hours & Leave</span>
            </Link>
          </div>
        </div>

        {/* Doctor Main Workspace Content */}
        <div>{children}</div>
      </div>
    </div>
  );
}
