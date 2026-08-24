"use client";

import * as React from "react";
import Link from "next/link";
import { UserRole } from "@/types/api";
import { useAuth } from "@/features/auth/auth-context";
import { Button } from "@/components/ui/Button";
import { CardSkeleton } from "@/components/common/Skeleton";
import { ShieldAlert, ArrowRight, UserCheck } from "lucide-react";

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { user, role, isLoading, setRole } = useAuth();

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  const hasAccess = user ? allowedRoles.includes(role) : false;

  if (!hasAccess) {
    const targetRole = allowedRoles[0];
    const roleLabels: Record<UserRole, string> = {
      patient: "Patient Portal",
      doctor: "Doctor Clinical Workspace",
      admin: "Operations & Admin Console",
    };

    return (
      <div className="mx-auto max-w-2xl py-12 px-4">
        <div className="rounded-3xl border border-[#EBCFC2] bg-white p-8 shadow-sm space-y-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#F8ECE6] text-[#7A4636] border border-[#EBCFC2]">
            <ShieldAlert className="h-7 w-7" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight text-[#171815]">
              Access Barrier & Role Mismatch
            </h1>
            <p className="text-xs text-[#666861] max-w-md mx-auto leading-relaxed">
              This route is restricted to the <strong>{roleLabels[targetRole] || targetRole}</strong>. Your current active persona is <strong>{role}</strong> ({user?.display_name || "Guest"}).
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <Button
              variant="primary"
              onClick={() => setRole(targetRole)}
              className="w-full sm:w-auto text-xs"
            >
              <UserCheck className="h-4 w-4 text-[#EFFE72]" />
              <span>Switch to {targetRole.charAt(0).toUpperCase() + targetRole.slice(1)} Persona</span>
            </Button>

            <Button asChild variant="outline" className="w-full sm:w-auto text-xs">
              <Link href={`/${role}`}>
                <span>Go to My Dashboard</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
