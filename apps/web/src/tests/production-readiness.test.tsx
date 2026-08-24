import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  formatDate,
  formatTime,
  formatDateOnly,
  formatRelative,
  parseLocalISTToUTCISO,
  isTodayInTimezone,
} from "@/lib/dates";
import { apiClient } from "@/lib/api/client";
import { RoleGuard } from "@/components/auth/RoleGuard";
import { AuthProvider } from "@/features/auth/auth-context";
import { StatusBadge } from "@/components/common/StatusBadge";
import { AiBadge } from "@/components/common/AiBadge";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
    },
  });
}

describe("Production Readiness & Contract Compliance Suite", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    apiClient.reset();
    localStorage.clear();
  });

  describe("1. Timezone Correctness (Asia/Kolkata, TIME-001..003)", () => {
    it("formats UTC instant to Asia/Kolkata time (9:00 AM for 03:30Z)", () => {
      const utcInstant = "2026-08-25T03:30:00.000Z";
      expect(formatTime(utcInstant)).toBe("9:00 AM");
      expect(formatDate(utcInstant, "MMM d, yyyy")).toBe("Aug 25, 2026");
      expect(formatDateOnly(utcInstant)).toBe("2026-08-25");
    });

    it("resolves datetime-local IST string to UTC ISO instant without timezone drift", () => {
      const istInput = "2026-08-25T09:00";
      const utcIso = parseLocalISTToUTCISO(istInput);
      expect(utcIso).toBe("2026-08-25T03:30:00.000Z");
    });

    it("evaluates isTodayInTimezone against Asia/Kolkata date", () => {
      const now = new Date();
      expect(isTodayInTimezone(now.toISOString())).toBe(true);

      const yesterday = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      expect(isTodayInTimezone(yesterday)).toBe(false);
    });

    it("keeps an invalid relative date human-readable instead of returning NaN", () => {
      expect(formatRelative("not-a-date")).toBe("not-a-date");
    });

    it("generates doctor availability slots in Asia/Kolkata working hours without appending .000Z", async () => {
      const targetDate = new Date("2026-08-25T12:00:00+05:30"); // Tuesday
      const slots = await apiClient.getDoctorAvailability("doc-001-rajesh", targetDate, 30);
      expect(slots.length).toBeGreaterThan(0);

      // 09:00 IST is 03:30 UTC
      const firstSlot = slots[0];
      expect(formatTime(firstSlot.starts_at)).toBe("9:00 AM");
      expect(firstSlot.starts_at).toContain("03:30:00");
    });
  });

  describe("2. Active Identity & RBAC Context (AUTH-001..004)", () => {
    it("updates active role and UserContext profile ID dynamically", () => {
      const patientUser = apiClient.setUserRole("patient");
      expect(patientUser.role).toBe("patient");
      expect(patientUser.profile_id).toBe("pat-001-aarav");

      const docUser = apiClient.setUserRole("doctor");
      expect(docUser.role).toBe("doctor");
      expect(docUser.profile_id).toBe("doc-001-rajesh");

      const adminUser = apiClient.setUserRole("admin");
      expect(adminUser.role).toBe("admin");
      expect(adminUser.profile_id).toBe("adm-001-ops");
    });

    it("RoleGuard displays access barrier when user persona does not match allowed role", () => {
      const qc = createTestQueryClient();
      render(
        <QueryClientProvider client={qc}>
          <AuthProvider>
            <RoleGuard allowedRoles={["doctor"]}>
              <div>Doctor Protected Content</div>
            </RoleGuard>
          </AuthProvider>
        </QueryClientProvider>
      );

      // Default role is patient -> should show Role Mismatch Barrier
      expect(screen.getByText(/Access Denied: Role Restricted/i)).toBeInTheDocument();
      expect(screen.queryByText("Doctor Protected Content")).not.toBeInTheDocument();
    });
  });

  describe("3. Admin Doctor Provisioning Mutation", () => {
    it("creates a new doctor and updates the doctor roster", async () => {
      const initialDocs = await apiClient.getDoctors();
      const initialCount = initialDocs.length;

      const newDoc = await apiClient.createDoctor({
        subject_id: "usr-sub-doc-ananya-sen",
        name: "Dr. Ananya Sen",
        specialization: "Endocrinology",
        credentials: "MBBS, MD (Endocrinology) — AIIMS",
        timezone: "Asia/Kolkata",
        appointment_durations_minutes: [30],
        consultation_fee: 1500,
        experience_years: 8,
      });

      expect(newDoc.id).toBeDefined();
      expect(newDoc.name).toBe("Dr. Ananya Sen");
      expect(newDoc.specialization).toBe("Endocrinology");
      expect(newDoc.time_zone).toBe("Asia/Kolkata");

      const updatedDocs = await apiClient.getDoctors();
      expect(updatedDocs.length).toBe(initialCount + 1);
      expect(updatedDocs.some((d) => d.id === newDoc.id)).toBe(true);
    });
  });

  describe("4. Integration Channel Health & Dynamic Convergence", () => {
    it("allows retrying failed integration items and transitions to succeeded state", async () => {
      const initialIntegrations = await apiClient.getAdminIntegrations();
      const failedItem = initialIntegrations.find((i) => i.state === "failed");
      expect(failedItem).toBeDefined();

      if (failedItem) {
        const retried = await apiClient.retryIntegration(failedItem.id, {
          expectedVersion: failedItem.version,
        });
        expect(retried.state).toBe("succeeded");
        expect(retried.error_message).toBeUndefined();

        const updatedList = await apiClient.getAdminIntegrations();
        const updatedItem = updatedList.find((i) => i.id === failedItem.id);
        expect(updatedItem?.state).toBe("succeeded");
      }
    });
  });

  describe("5. Clinical Truthfulness & Accessibility Semantics", () => {
    it("renders StatusBadge with motion-reduce compatibility on spinning icons", () => {
      render(<StatusBadge status="retrying" />);
      const icon = document.querySelector("svg");
      expect(icon).toBeInTheDocument();
      expect(icon?.classList.contains("motion-reduce:animate-none")).toBe(true);
    });

    it("renders AiBadge with motion-reduce compatibility when pending", () => {
      render(<AiBadge status="pending" label="Intake Brief" />);
      expect(screen.getByText(/Synthesizing/i)).toBeInTheDocument();
      const icon = document.querySelector("svg");
      expect(icon?.classList.contains("motion-reduce:animate-none")).toBe(true);
    });
  });
});
