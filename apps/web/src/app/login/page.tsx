"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { UserRole } from "@/types/api";
import { User, Stethoscope, ShieldCheck, ArrowRight, Lock } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { setRole } = useAuth();

  const handleSelectRole = (role: UserRole) => {
    setRole(role);
    if (role === "patient") router.push("/patient");
    else if (role === "doctor") router.push("/doctor");
    else if (role === "admin") router.push("/admin");
  };

  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12 bg-grid-pattern">
      <div className="w-full max-w-md rounded-3xl border border-[#e7e7e2] bg-white p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111] mb-1">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-[#111111]">
            Demo Environment Entry
          </h1>
          <p className="text-xs text-[#626262]">
            Select a synthetic persona to explore the authenticated healthcare experience.
          </p>
        </div>

        <div className="space-y-3 pt-2">
          <button
            type="button"
            onClick={() => handleSelectRole("patient")}
            className="flex min-h-[44px] w-full items-center justify-between p-4 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111] hover:bg-white transition-all text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111]"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#edfdf4] text-[#26734d]">
                <User className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#111111]">Aarav Sharma</div>
                <div className="text-xs text-[#626262]">Patient Persona</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-[#8e8e89] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-all" />
          </button>

          <button
            type="button"
            onClick={() => handleSelectRole("doctor")}
            className="flex min-h-[44px] w-full items-center justify-between p-4 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111] hover:bg-white transition-all text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111]"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f6f6f2] text-[#111111]">
                <Stethoscope className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#111111]">Dr. Rajesh Verma</div>
                <div className="text-xs text-[#626262]">Doctor (Cardiology)</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-[#8e8e89] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-all" />
          </button>

          <button
            type="button"
            onClick={() => handleSelectRole("admin")}
            className="flex min-h-[44px] w-full items-center justify-between p-4 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111] hover:bg-white transition-all text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111]"
          >
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff8eb] text-[#b54708]">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-bold text-[#111111]">Clinic Operations Admin</div>
                <div className="text-xs text-[#626262]">Administrator Persona</div>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-[#8e8e89] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-all" />
          </button>
        </div>

        <div className="pt-2 text-center text-[11px] text-[#8e8e89]">
          Protected by Supabase Auth with server-side RBAC simulation.
        </div>
      </div>
    </div>
  );
}
