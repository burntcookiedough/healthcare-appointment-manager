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
});
