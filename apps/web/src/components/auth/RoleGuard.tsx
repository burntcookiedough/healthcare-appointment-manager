"use client";

import * as React from "react";
import Link from "next/link";
import { UserRole } from "@/types/api";
import { useAuth } from "@/features/auth/auth-context";
import { Button } from "@/components/ui/Button";
import { CardSkeleton } from "@/components/common/Skeleton";
import { ShieldAlert, ArrowRight, UserCheck, Lock } from "lucide-react";

interface RoleGuardProps {
  allowedRoles: UserRole[];
  children: React.ReactNode;
}

export function RoleGuard({ allowedRoles, children }: RoleGuardProps) {
  const { user, role, isLoading, isDemoMode, setRole } = useAuth();

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto space-y-4">
        <CardSkeleton />
        <CardSkeleton />
      </div>
    );
  }

  // 1. Unauthenticated in production mode -> Direct to login
  if (!user && !isDemoMode) {
    return (
      <div className="mx-auto max-w-md py-16 px-4">
        <div className="rounded-3xl border border-[#e7e7e2] bg-white p-8 shadow-sm space-y-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111] border border-[#d8e7db]">
            <Lock className="h-7 w-7" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h1 className="text-xl font-bold tracking-tight text-[#111111]">
              Authentication Required
            </h1>
            <p className="text-xs text-[#626262] max-w-sm mx-auto leading-relaxed">
              You must be signed in with an authorized clinical or patient account to access this portal section.
            </p>
          </div>

          <Button asChild variant="primary" className="w-full text-xs">
            <Link href="/login">
              <span>Sign In with Credentials</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const effectiveRole = role || user?.role;
  const hasAccess = effectiveRole ? allowedRoles.includes(effectiveRole) : false;

  // 2. Role mismatch -> Truthful access denied screen
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
              Access Denied: Role Restricted
            </h1>
            <p className="text-xs text-[#666861] max-w-md mx-auto leading-relaxed">
              This route is restricted to the <strong>{roleLabels[targetRole] || targetRole}</strong>. Your authenticated identity has role <strong>{effectiveRole || "Unassigned"}</strong> ({user?.display_name || user?.email || "User"}).
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            {isDemoMode ? (
              <Button
                variant="primary"
                onClick={() => setRole(targetRole)}
                className="w-full sm:w-auto text-xs"
              >
                <UserCheck className="h-4 w-4 text-[#EFFE72]" />
                <span>Switch to {targetRole.charAt(0).toUpperCase() + targetRole.slice(1)} Persona</span>
              </Button>
            ) : null}

            {effectiveRole && (
              <Button asChild variant={isDemoMode ? "outline" : "primary"} className="w-full sm:w-auto text-xs">
                <Link href={`/${effectiveRole}`}>
                  <span>Go to My Dashboard</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            )}

            {!isDemoMode && (
              <Button asChild variant="outline" className="w-full sm:w-auto text-xs">
                <Link href="/login">
                  <span>Sign In as Different User</span>
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
