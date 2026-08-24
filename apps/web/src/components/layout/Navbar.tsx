"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/features/auth/auth-context";
import { UserRole } from "@/types/api";
import { cn } from "@/lib/utils";
import {
  Calendar,
  User,
  Stethoscope,
  ShieldCheck,
  ChevronDown,
  Clock,
  Menu,
  X,
  ArrowUpRight,
} from "lucide-react";

export function Navbar() {
  const { role, setRole } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [isRoleDropdownOpen, setIsRoleDropdownOpen] = React.useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = React.useState(false);

  const handleRoleChange = (newRole: UserRole) => {
    setRole(newRole);
    setIsRoleDropdownOpen(false);
    setIsMobileMenuOpen(false);

    if (newRole === "patient") router.push("/patient");
    else if (newRole === "doctor") router.push("/doctor");
    else if (newRole === "admin") router.push("/admin");
  };

  const navLinks = React.useMemo(() => {
    if (role === "patient") {
      return [
        { href: "/patient", label: "Dashboard" },
        { href: "/patient/doctors", label: "Find Doctors" },
        { href: "/patient/appointments", label: "My Appointments" },
        { href: "/patient/prescriptions", label: "Medication Reminders" },
      ];
    } else if (role === "doctor") {
      return [
        { href: "/doctor", label: "Today's Timeline" },
        { href: "/doctor/schedule", label: "Working Hours & Leave" },
      ];
    } else {
      return [
        { href: "/admin", label: "Overview" },
        { href: "/admin/doctors", label: "Doctor Roster" },
        { href: "/admin/leave", label: "Leave Management" },
        { href: "/admin/appointments", label: "Appointments" },
        { href: "/admin/integrations", label: "Integrations & Health" },
      ];
    }
  }, [role]);

  const isPublicPage = pathname === "/" || pathname === "/login";

  return (
    <header className="sticky top-0 z-40 w-full border-b border-[#E5E4DE] bg-[#FBFBF8]/95 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Brand Logo */}
        <div className="flex items-center gap-6">
          <Link
            href={isPublicPage ? "/" : `/${role}`}
            className="flex min-h-[44px] items-center gap-2.5 font-bold tracking-tight text-[#171815] transition-opacity hover:opacity-85"
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#171815] text-white">
              <Calendar className="h-4 w-4 text-[#EEF5EF]" aria-hidden="true" />
            </div>
            <span className="text-base sm:text-lg font-bold tracking-tight">CareSync</span>
          </Link>

          {/* Desktop Navigation Links */}
          {!isPublicPage && (
            <nav className="hidden md:flex items-center gap-1">
              {navLinks.map((link) => {
                const isActive = pathname === link.href;
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "inline-flex min-h-[44px] items-center rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150",
                      isActive
                        ? "bg-[#171815] text-white"
                        : "text-[#666861] hover:bg-[#F6F5F0] hover:text-[#171815]"
                    )}
                  >
                    {link.label}
                  </Link>
                );
              })}
            </nav>
          )}
        </div>

        {/* Right Side: Demo Role Switcher & User Profile */}
        <div className="flex items-center gap-3">
          {/* Active Timezone Badge */}
          <div className="hidden lg:flex items-center gap-1 rounded-lg border border-[#E5E4DE] bg-white px-2.5 py-1 text-[11px] font-medium text-[#666861]">
            <Clock className="h-3 w-3" aria-hidden="true" />
            <span>IST (UTC+5:30)</span>
          </div>

          {/* Role Switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setIsRoleDropdownOpen(!isRoleDropdownOpen)}
              className="flex min-h-[44px] items-center gap-2 rounded-lg border border-[#E5E4DE] bg-white px-3.5 py-2 text-xs font-semibold text-[#171815] shadow-xs transition-colors hover:bg-[#F6F5F0] focus-visible:ring-2 focus-visible:ring-[#171815]"
              aria-label="Switch User Role"
              aria-expanded={isRoleDropdownOpen}
            >
              {role === "patient" && <User className="h-3.5 w-3.5 text-[#315B43]" aria-hidden="true" />}
              {role === "doctor" && <Stethoscope className="h-3.5 w-3.5 text-[#38556B]" aria-hidden="true" />}
              {role === "admin" && <ShieldCheck className="h-3.5 w-3.5 text-[#655B36]" aria-hidden="true" />}
              <span className="capitalize">{role} View</span>
              <ChevronDown className="h-3 w-3 text-[#666861]" aria-hidden="true" />
            </button>

            {isRoleDropdownOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-xl border border-[#E5E4DE] bg-white p-2 shadow-lg z-50 animate-in fade-in zoom-in-95">
                <div className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-[#666861]">
                  Switch Demo Persona
                </div>
                <button
                  type="button"
                  onClick={() => handleRoleChange("patient")}
                  className={cn(
                    "flex w-full min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                    role === "patient" ? "bg-[#EEF5EF] text-[#315B43] font-semibold" : "hover:bg-[#F6F5F0]"
                  )}
                >
                  <User className="h-4 w-4 text-[#315B43]" />
                  <div>
                    <div>Patient Persona</div>
                    <div className="text-[10px] text-[#666861]">Aarav Sharma</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleChange("doctor")}
                  className={cn(
                    "flex w-full min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                    role === "doctor" ? "bg-[#EEF3F7] text-[#38556B] font-semibold" : "hover:bg-[#F6F5F0]"
                  )}
                >
                  <Stethoscope className="h-4 w-4 text-[#38556B]" />
                  <div>
                    <div>Doctor Persona</div>
                    <div className="text-[10px] text-[#666861]">Dr. Rajesh Verma (Cardiology)</div>
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => handleRoleChange("admin")}
                  className={cn(
                    "flex w-full min-h-[44px] items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors",
                    role === "admin" ? "bg-[#F7F2DF] text-[#655B36] font-semibold" : "hover:bg-[#F6F5F0]"
                  )}
                >
                  <ShieldCheck className="h-4 w-4 text-[#655B36]" />
                  <div>
                    <div>Administrator Persona</div>
                    <div className="text-[10px] text-[#666861]">Clinic Operations Admin</div>
                  </div>
                </button>
              </div>
            )}
          </div>

          {/* Quick Book / Action button */}
          {isPublicPage ? (
            <Link
              href="/patient/book"
              className="hidden sm:inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#171815] px-4 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-[#282924]"
            >
              <span>Book Appointment</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-[#EEF5EF]" />
            </Link>
          ) : role === "patient" ? (
            <Link
              href="/patient/book"
              className="hidden sm:inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[#171815] px-4 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-[#282924]"
            >
              <span>Book New Slot</span>
              <ArrowUpRight className="h-3.5 w-3.5 text-[#EEF5EF]" />
            </Link>
          ) : null}

          {/* Mobile menu toggle */}
          {!isPublicPage && (
            <button
              type="button"
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="md:hidden flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[#E5E4DE] bg-white text-[#171815] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#171815]"
              aria-label="Toggle navigation menu"
              aria-expanded={isMobileMenuOpen}
            >
              {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          )}
        </div>
      </div>

      {/* Mobile navigation drawer */}
      {!isPublicPage && isMobileMenuOpen && (
        <div className="border-t border-[#e7e7e2] bg-[#fbfbf8] p-4 md:hidden space-y-1">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setIsMobileMenuOpen(false)}
              className={cn(
                "flex min-h-[44px] items-center rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors duration-150",
                pathname === link.href
                  ? "bg-[#111111] text-white"
                  : "text-[#626262] hover:bg-[#f0f0eb] hover:text-[#111111]"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>
      )}
    </header>
  );
}
