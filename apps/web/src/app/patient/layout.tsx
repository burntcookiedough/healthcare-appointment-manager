"use client";

import * as React from "react";
import Link from "next/link";
import { useAuth } from "@/features/auth/auth-context";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { PlusCircle } from "lucide-react";

export default function PatientLayout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  return (
    <RoleGuard allowedRoles={["patient"]}>
      <div className="min-h-[calc(100vh-4rem)] bg-[#fbfbf8]">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Patient Sub-header Bar */}
          <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-[#E5E4DE] pb-5">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-[#315B43]">
                  <span className="h-2 w-2 rounded-xs bg-[#315B43]" aria-hidden="true" />
                  <span>Patient Portal</span>
                </div>
                <span className="text-xs text-[#666861]">· ID: {user?.profile_id || "pat-001-aarav"}</span>
              </div>
              <div className="mt-1 text-xl sm:text-2xl font-bold tracking-tight text-[#171815]">
                Patient: {user?.display_name || "Aarav Sharma"}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Link
                href="/patient/book"
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[#171815] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors duration-150 hover:bg-[#282924] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#171815]"
              >
                <PlusCircle className="h-4 w-4 text-[#EEF5EF]" />
                <span>Book New Appointment</span>
              </Link>
            </div>
          </div>

          {/* Content Container */}
          <div>{children}</div>
        </div>
      </div>
    </RoleGuard>
  );
}
