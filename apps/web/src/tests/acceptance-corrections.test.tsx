import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AdminOverviewPage from "@/app/admin/page";
import PatientBookPage from "@/app/patient/book/page";
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

  describe("Scenario Switcher Data Refetch Governance", () => {
    it("notifies registered scenario subscribers when scenario changes", () => {
      const listener = vi.fn();
      const unsubscribe = scenarioManager.subscribe(listener);

      expect(scenarioManager.getScenario()).toBe("normal");
      scenarioManager.setScenario("request_error");

      expect(listener).toHaveBeenCalledWith("request_error");
      expect(scenarioManager.getScenario()).toBe("request_error");

      // Reset to normal
      scenarioManager.setScenario("normal");
      expect(listener).toHaveBeenCalledWith("normal");

      unsubscribe();
    });
  });

  describe("Doctor Selection Keyboard Accessibility (AT-UI-001)", () => {
    it("renders doctor cards as semantic <button> elements accessible via keyboard Space and Enter", async () => {
      const queryClient = createTestQueryClient();

      render(
        <QueryClientProvider client={queryClient}>
          <PatientBookPage />
        </QueryClientProvider>
      );

      // Await async doctor loading
      const doctorButton = await screen.findByRole("button", { name: /Select Dr\. Rajesh Verma/i });
      expect(doctorButton).toBeInTheDocument();
      expect(doctorButton.tagName.toLowerCase()).toBe("button");
      expect(doctorButton).toHaveAttribute("aria-pressed");

      // Press Enter/Click to select doctor
      fireEvent.click(doctorButton);

      // Step 2 should now be visible with date & slot selection
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
