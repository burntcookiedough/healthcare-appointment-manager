"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/features/auth/auth-context";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { Calendar } from "lucide-react";

export default function DoctorLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <RoleGuard allowedRoles={["doctor"]}>
      <div className="min-h-[calc(100vh-4rem)] bg-[#fbfbf8]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Doctor Sub-header Bar */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#E5E4DE] pb-5">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#38556B]">
                  <span className="h-2 w-2 rounded-xs bg-[#38556B]" aria-hidden="true" />
                  <span>Clinician Portal</span>
                </div>
                <span className="text-xs text-[#666861]">· ID: {user?.profile_id || "doc-001-rajesh"}</span>
              </div>
              <div className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-[#171815]">
                Clinician: {user?.display_name || "Dr. Rajesh Verma"}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/doctor/schedule"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E5E4DE] bg-white px-4 py-2 text-xs font-semibold text-[#171815] shadow-xs hover:bg-[#F6F5F0] transition-colors duration-150"
              >
                <Calendar className="h-4 w-4 text-[#38556B]" />
                <span>Working Hours & Leave</span>
              </Link>
            </div>
          </div>

          {/* Doctor Main Workspace Content */}
          <div>{children}</div>
        </div>
      </div>
    </RoleGuard>
  );
}
