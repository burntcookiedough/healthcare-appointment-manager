"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { UserRole } from "@/types/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  User,
  Stethoscope,
  ShieldCheck,
  ArrowRight,
  Lock,
  KeyRound,
  AlertCircle,
  CheckCircle2,
  LogOut,
} from "lucide-react";
import { toast } from "sonner";

export default function LoginPage() {
  const router = useRouter();
  const { user, isDemoMode, setRole, login, register, logout, isLoading: isAuthLoading } = useAuth();

  const [authMode, setAuthMode] = React.useState<"signin" | "register">("signin");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [confirmationNotice, setConfirmationNotice] = React.useState<string | null>(null);

  // Demo Mode persona selection
  const handleSelectDemoRole = (role: UserRole) => {
    setRole(role);
    if (role === "patient") router.push("/patient");
    else if (role === "doctor") router.push("/doctor");
    else if (role === "admin") router.push("/admin");
  };

  // Production Auth Submit
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setConfirmationNotice(null);

    if (!email || !email.includes("@")) {
      setFormError("Please enter a valid email address.");
      return;
    }
    if (!password || password.length < 6) {
      setFormError("Password must be at least 6 characters.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (authMode === "signin") {
        const authenticatedUser = await login(email, password);
        toast.success(`Welcome back, ${authenticatedUser.display_name || authenticatedUser.email}`);
        router.push(`/${authenticatedUser.role}`);
      } else {
        if (!displayName.trim()) {
          setFormError("Please provide your full display name.");
          setIsSubmitting(false);
          return;
        }
        const result = await register(email, password, displayName);
        if (result.user) {
          toast.success(`Account registered: ${result.user.display_name}`);
          router.push(`/${result.user.role}`);
        } else if (result.requiresConfirmation) {
          setConfirmationNotice(
            "Account registration initiated. Please check your email to verify your address before signing in."
          );
        }
      }
    } catch (err: unknown) {
      const errorObj = err as { message?: string; error?: { message?: string } };
      const msg =
        errorObj?.error?.message ||
        errorObj?.message ||
        "Authentication failed. Please check your credentials and try again.";
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1. DEMO MODE UI: Calm Persona Switcher
  if (isDemoMode) {
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
              onClick={() => handleSelectDemoRole("patient")}
              className="flex min-h-[44px] w-full items-center justify-between p-4 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111] hover:bg-white transition-colors duration-150 text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111]"
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
              <ArrowRight className="h-4 w-4 text-[#8e8e89] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-transform duration-150" />
            </button>

            <button
              type="button"
              onClick={() => handleSelectDemoRole("doctor")}
              className="flex min-h-[44px] w-full items-center justify-between p-4 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111] hover:bg-white transition-colors duration-150 text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111]"
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
              <ArrowRight className="h-4 w-4 text-[#8e8e89] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-transform duration-150" />
            </button>

            <button
              type="button"
              onClick={() => handleSelectDemoRole("admin")}
              className="flex min-h-[44px] w-full items-center justify-between p-4 rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] hover:border-[#111111] hover:bg-white transition-colors duration-150 text-left group focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#111111]"
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
              <ArrowRight className="h-4 w-4 text-[#8e8e89] group-hover:text-[#111111] group-hover:translate-x-0.5 transition-transform duration-150" />
            </button>
          </div>

          <div className="pt-2 text-center text-[11px] text-[#8e8e89]">
            Demo mode active (`NEXT_PUBLIC_DEMO_MODE=true`).
          </div>
        </div>
      </div>
    );
  }

  // 2. PRODUCTION MODE: Authenticated state overview
  if (user) {
    return (
      <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12 bg-grid-pattern">
        <div className="w-full max-w-md rounded-3xl border border-[#e7e7e2] bg-white p-8 shadow-2xl space-y-6 text-center">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111] mb-1">
            <CheckCircle2 className="h-6 w-6 text-[#111111]" />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-[#111111]">
              Authenticated Session
            </h1>
            <p className="text-xs text-[#626262] mt-1">
              You are currently signed in to the clinical management platform.
            </p>
          </div>

          <div className="rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] p-4 text-left space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-[#8e8e89]">User:</span>
              <span className="font-bold text-[#111111]">{user.display_name || user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8e8e89]">Email:</span>
              <span className="font-mono text-[#111111]">{user.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8e8e89]">Role:</span>
              <span className="font-bold uppercase tracking-wider text-[#315B43] bg-[#EEF5EF] px-2 py-0.5 rounded">
                {user.role}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#8e8e89]">Profile ID:</span>
              <span className="font-mono text-[#626262]">{user.profile_id}</span>
            </div>
          </div>

          <div className="space-y-3 pt-2">
            <Button
              variant="primary"
              className="w-full text-xs"
              onClick={() => router.push(`/${user.role}`)}
            >
              <span>Go to {user.role.charAt(0).toUpperCase() + user.role.slice(1)} Dashboard</span>
              <ArrowRight className="h-4 w-4" />
            </Button>

            <Button
              variant="outline"
              className="w-full text-xs text-[#b42318] hover:bg-[#F8ECE6]"
              onClick={async () => {
                await logout();
                toast.success("Signed out successfully.");
              }}
            >
              <LogOut className="h-4 w-4" />
              <span>Sign Out</span>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // 3. PRODUCTION MODE: Sign In / Registration Forms
  return (
    <div className="min-h-[calc(100vh-8rem)] flex items-center justify-center px-4 py-12 bg-grid-pattern">
      <div className="w-full max-w-md rounded-3xl border border-[#e7e7e2] bg-white p-8 shadow-2xl space-y-6">
        <div className="text-center space-y-2">
          <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111] mb-1">
            <Lock className="h-6 w-6" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-[#111111]">
            {authMode === "signin" ? "Sign In to CareSync" : "Create Patient Account"}
          </h1>
          <p className="text-xs text-[#626262]">
            {authMode === "signin"
              ? "Access your appointments, medical records, and clinical schedule."
              : "Register for verified clinical care and follow-up management."}
          </p>
        </div>

        {/* Tab Switcher */}
        <div className="flex rounded-xl border border-[#e7e7e2] bg-[#fbfbf8] p-1 text-xs">
          <button
            type="button"
            onClick={() => {
              setAuthMode("signin");
              setFormError(null);
            }}
            className={`flex-1 py-2 rounded-lg font-bold transition-colors ${
              authMode === "signin"
                ? "bg-[#111111] text-white shadow-xs"
                : "text-[#626262] hover:text-[#111111]"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => {
              setAuthMode("register");
              setFormError(null);
            }}
            className={`flex-1 py-2 rounded-lg font-bold transition-colors ${
              authMode === "register"
                ? "bg-[#111111] text-white shadow-xs"
                : "text-[#626262] hover:text-[#111111]"
            }`}
          >
            Register Account
          </button>
        </div>

        {/* Error Notice */}
        {formError && (
          <div className="flex items-start gap-2 rounded-xl border border-[#EBCFC2] bg-[#F8ECE6] p-3 text-xs text-[#7A4636]">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-[#b42318]" />
            <div>{formError}</div>
          </div>
        )}

        {/* Confirmation Notice */}
        {confirmationNotice && (
          <div className="flex items-start gap-2 rounded-xl border border-[#D8E7DB] bg-[#EEF5EF] p-3 text-xs text-[#315B43]">
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5 text-[#26734d]" />
            <div>{confirmationNotice}</div>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleAuthSubmit} className="space-y-4">
          {authMode === "register" && (
            <div className="space-y-1">
              <Input
                label="Full Display Name"
                placeholder="E.g., Aarav Sharma"
                value={displayName}
                required
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
          )}

          <div className="space-y-1">
            <Input
              label="Email Address"
              type="email"
              placeholder="user@example.com"
              value={email}
              required
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Input
              label="Password"
              type="password"
              placeholder="••••••••"
              value={password}
              required
              minLength={6}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full text-xs"
            isLoading={isSubmitting || isAuthLoading}
            disabled={isSubmitting || isAuthLoading}
          >
            <KeyRound className="h-4 w-4 text-[#efff72]" />
            <span>{authMode === "signin" ? "Authenticate Session" : "Create Account"}</span>
          </Button>
        </form>

        <div className="pt-2 text-center text-[11px] text-[#8e8e89]">
          Protected by Supabase Auth with server-enforced RBAC (AUTH-001..004).
        </div>
      </div>
    </div>
  );
}
