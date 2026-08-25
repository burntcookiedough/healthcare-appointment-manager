import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminOverviewPage from "@/app/admin/page";
import PatientBookPage from "@/app/patient/book/page";
import { ScenarioSwitcher } from "@/components/dev/ScenarioSwitcher";
import { scenarioManager } from "@/mocks/scenarios";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import Link from "next/link";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });
}

describe("Frontend Acceptance Contracts & Regression Suite (UI_SPEC.md, ACCEPTANCE_TESTS.md)", () => {
  beforeEach(() => {
    apiClient.reset();
    scenarioManager.setScenario("normal");
  });

  describe("Admin KPI Error State Honesty (AT-UI-004)", () => {
    it("renders explicit error indicators (—) rather than hard-coded healthy operational values when data queries fail", async () => {
      // Mock apiClient methods to simulate a server/network outage
      const getDoctorsSpy = vi.spyOn(apiClient, "getDoctors").mockRejectedValue(new Error("API network failure"));
      const getAppointmentsSpy = vi.spyOn(apiClient, "getAppointments").mockRejectedValue(new Error("Database unavailable"));
      const getLeavesSpy = vi.spyOn(apiClient, "getDoctorLeaves").mockRejectedValue(new Error("Service timeout"));
      const getIntegrationsSpy = vi.spyOn(apiClient, "getAdminIntegrations").mockRejectedValue(new Error("Integration service offline"));

      const queryClient = createTestQueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <AdminOverviewPage />
        </QueryClientProvider>
      );

      // Wait for queries to reject and UI to render error states
      await waitFor(() => {
        const errorValues = screen.getAllByText("—");
        expect(errorValues.length).toBeGreaterThanOrEqual(4);
      });

      // Verify that dishonest hardcoded copy is NOT present
      expect(screen.queryByText("All systems operational")).toBeNull();
      expect(screen.queryByText("All channels synced")).toBeNull();
      expect(screen.queryByText("Active practitioners")).toBeNull();

      getDoctorsSpy.mockRestore();
      getAppointmentsSpy.mockRestore();
      getLeavesSpy.mockRestore();
      getIntegrationsSpy.mockRestore();
    });
  });

  describe("Scenario Switcher Data Refetch Governance (Requirement 3)", () => {
    it("executes exactly one invalidation path on scenario change without duplicate calls", async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();
      const invalidateQueriesSpy = vi.spyOn(queryClient, "invalidateQueries");

      render(
        <QueryClientProvider client={queryClient}>
          <ScenarioSwitcher />
        </QueryClientProvider>
      );

      // Open switcher dialog
      const toggleButton = screen.getByRole("button", { name: /Toggle menu/i });
      await user.click(toggleButton);

      // Select 'Loading Delay' scenario
      const scenarioOption = screen.getByRole("button", { name: /loading delay/i });
      await user.click(scenarioOption);

      // Verify queryClient.invalidateQueries was called exactly once
      expect(invalidateQueriesSpy).toHaveBeenCalledTimes(1);
      expect(scenarioManager.getScenario()).toBe("loading");

      invalidateQueriesSpy.mockRestore();
    });
  });

  describe("Doctor Selection Keyboard Accessibility (AT-UI-001, Requirement 4)", () => {
    it("selects doctor via keyboard {Enter} key with genuine userEvent", async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <PatientBookPage />
        </QueryClientProvider>
      );

      const doctorButton = await screen.findByRole("button", { name: /Select Dr\. Rajesh Verma/i });
      expect(doctorButton).toBeInTheDocument();
      expect(doctorButton.tagName.toLowerCase()).toBe("button");

      // Focus and press {Enter}
      doctorButton.focus();
      expect(doctorButton).toHaveFocus();
      await user.keyboard("{Enter}");

      // Step 2 should now be visible
      await waitFor(() => {
        expect(screen.getByText("Consultation Date")).toBeInTheDocument();
        expect(screen.getByText("Change Doctor")).toBeInTheDocument();
      });
    });

    it("selects doctor via keyboard {Space} key with genuine userEvent", async () => {
      const user = userEvent.setup();
      const queryClient = createTestQueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <PatientBookPage />
        </QueryClientProvider>
      );

      const doctorButton = await screen.findByRole("button", { name: /Select Dr\. Rajesh Verma/i });
      expect(doctorButton).toBeInTheDocument();

      // Focus and press {Space}
      doctorButton.focus();
      expect(doctorButton).toHaveFocus();
      await user.keyboard(" ");

      // Step 2 should now be visible
      await waitFor(() => {
        expect(screen.getByText("Consultation Date")).toBeInTheDocument();
        expect(screen.getByText("Change Doctor")).toBeInTheDocument();
      });
    });
  });

  describe("Single Semantic <h1> Page Headings", () => {
    it("renders a semantic <h1> element on the booking page", async () => {
      const queryClient = createTestQueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <PatientBookPage />
        </QueryClientProvider>
      );

      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toBeInTheDocument();
      expect(heading.textContent).toMatch(/Book a Clinical Consultation/i);
    });

    it("renders a semantic <h1> element on the admin overview page", async () => {
      const queryClient = createTestQueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <AdminOverviewPage />
        </QueryClientProvider>
      );

      const heading = screen.getByRole("heading", { level: 1 });
      expect(heading).toBeInTheDocument();
      expect(heading.textContent).toMatch(/Clinical Operations Overview/i);
    });
  });

  describe("Semantic Interactive Elements & Button asChild Slot (Requirement 1 & 6)", () => {
    it("renders navigation-styled Button with asChild as exactly one <a> element and NO descendant button", () => {
      const { container } = render(
        <Button asChild variant="primary">
          <Link href="/patient/book">
            <span>Book Appointment</span>
          </Link>
        </Button>
      );

      const links = container.querySelectorAll("a");
      const buttons = container.querySelectorAll("button");

      expect(links.length).toBe(1);
      expect(buttons.length).toBe(0);
      expect(links[0].getAttribute("href")).toBe("/patient/book");
      expect(links[0].textContent).toContain("Book Appointment");
      // Check that the link does not contain any button descendant
      expect(links[0].querySelector("button")).toBeNull();
    });

    it("renders ordinary action Button as exactly one <button> element and NO anchor element", () => {
      const { container } = render(
        <Button variant="primary" onClick={() => {}}>
          <span>Submit Action</span>
        </Button>
      );

      const buttons = container.querySelectorAll("button");
      const links = container.querySelectorAll("a");

      expect(buttons.length).toBe(1);
      expect(links.length).toBe(0);
      expect(buttons[0].querySelector("a")).toBeNull();
    });

    it("ensures landing page and quick action cards do not have nested interactive elements (no button in a, no a in button)", async () => {
      const LandingPage = (await import("@/app/page")).default;
      const { AuthProvider } = await import("@/features/auth/auth-context");
      const queryClient = createTestQueryClient();

      const { container } = render(
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <LandingPage />
          </AuthProvider>
        </QueryClientProvider>
      );

      // Verify no anchor contains a button
      const allAnchors = container.querySelectorAll("a");
      allAnchors.forEach((anchor) => {
        const nestedButton = anchor.querySelector("button");
        expect(nestedButton).toBeNull();
      });

      // Verify no button contains an anchor
      const allButtons = container.querySelectorAll("button");
      allButtons.forEach((button) => {
        const nestedAnchor = button.querySelector("a");
        expect(nestedAnchor).toBeNull();
      });
    });

    it("strictly requires the production LeaveApplyRequest version field when applying leave", async () => {
      const preview = await apiClient.previewDoctorLeave("doc-001-rajesh", {
        starts_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
        ends_at: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
        reason: "Strict API check",
      });

      // Valid call with explicit LeaveApplyRequest
      const result = await apiClient.applyDoctorLeave(
        preview.doctor_id,
        preview.starts_at,
        preview.ends_at,
        preview.reason,
        {
          preview_token: preview.preview_token,
          expected_version: preview.expected_schedule_version,
        }
      );

      expect(result).toBeDefined();
      expect(result.reason).toBe("Strict API check");
    });
  });
});
