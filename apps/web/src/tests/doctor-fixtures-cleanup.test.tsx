import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import AdminLeavePage from "@/app/admin/leave/page";
import DoctorDetailPage from "@/app/patient/doctors/[id]/page";
import * as navigation from "next/navigation";

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

describe("Doctor Fixture Fallback Removal Suite (Admin Leave & Doctor Detail)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    apiClient.reset();
  });

  describe("1. Admin Leave Doctor Selection Behavior", () => {
    it("selects the first returned real doctor when doctors are fetched and does not use hardcoded doc-001-rajesh", async () => {
      // Mock getDoctors returning custom doctors
      vi.spyOn(apiClient, "getDoctors").mockResolvedValueOnce([
        {
          id: "doc-custom-ananya",
          name: "Dr. Ananya Sen",
          specialization: "Endocrinology",
          credentials: "MD",
          consultation_fee: 1200,
          experience_years: 9,
          next_available_at: "2026-08-25T09:00:00.000Z",
          is_active: true,
          schedule_version: 1,
        },
        {
          id: "doc-custom-karan",
          name: "Dr. Karan Mehra",
          specialization: "Dermatology",
          credentials: "MD",
          consultation_fee: 1400,
          experience_years: 11,
          next_available_at: "2026-08-25T09:00:00.000Z",
          is_active: true,
          schedule_version: 1,
        },
      ]);

      const previewSpy = vi.spyOn(apiClient, "previewDoctorLeave").mockResolvedValueOnce({
        doctor_id: "doc-custom-ananya",
        starts_at: "2026-08-26T03:30:00.000Z",
        ends_at: "2026-08-28T12:30:00.000Z",
        reason: "Attending Medical Conference",
        expected_schedule_version: 1,
        preview_token: "mock-preview-token-123",
        affected_appointment_ids: [],
        affected_appointment_count: 0,
        affected_hold_ids: [],
        affected_hold_count: 0,
        expires_at: "2026-08-26T12:30:00.000Z",
      });

      const user = userEvent.setup();
      const qc = createTestQueryClient();
      render(
        <QueryClientProvider client={qc}>
          <AdminLeavePage />
        </QueryClientProvider>
      );

      // Open schedule leave dialog
      const scheduleBtn = await screen.findByRole("button", { name: /Schedule Doctor Leave/i });
      await user.click(scheduleBtn);

      // Verify the first doctor Dr. Ananya Sen is selected in the select dropdown
      const selectElement = screen.getByLabelText(/Select Doctor/i) as HTMLSelectElement;
      await waitFor(() => {
        expect(selectElement.value).toBe("doc-custom-ananya");
      });

      // Submit leave preview
      const previewBtn = screen.getByRole("button", { name: /Generate Impact Preview/i });
      await user.click(previewBtn);

      // Verify preview request used doc-custom-ananya, NOT doc-001-rajesh
      expect(previewSpy).toHaveBeenCalledWith(
        "doc-custom-ananya",
        expect.objectContaining({
          reason: "Attending Medical Conference",
        })
      );
      expect(previewSpy).not.toHaveBeenCalledWith("doc-001-rajesh", expect.anything());
    });

    it("preserves a user's selection across refetches when the selected doctor still exists", async () => {
      const mockDocs = [
        {
          id: "doc-101",
          name: "Dr. One",
          specialization: "General",
          credentials: "MD",
          consultation_fee: 1000,
          experience_years: 5,
          next_available_at: "2026-08-25T09:00:00.000Z",
          is_active: true,
          schedule_version: 1,
        },
        {
          id: "doc-102",
          name: "Dr. Two",
          specialization: "Pediatrics",
          credentials: "MD",
          consultation_fee: 1100,
          experience_years: 7,
          next_available_at: "2026-08-25T09:00:00.000Z",
          is_active: true,
          schedule_version: 1,
        },
      ];

      const getDoctorsSpy = vi.spyOn(apiClient, "getDoctors").mockResolvedValue(mockDocs);

      const user = userEvent.setup();
      const qc = createTestQueryClient();
      render(
        <QueryClientProvider client={qc}>
          <AdminLeavePage />
        </QueryClientProvider>
      );

      const scheduleBtn = await screen.findByRole("button", { name: /Schedule Doctor Leave/i });
      await user.click(scheduleBtn);

      const selectElement = screen.getByLabelText(/Select Doctor/i) as HTMLSelectElement;
      await waitFor(() => {
        expect(selectElement.value).toBe("doc-101");
      });

      // User chooses Dr. Two (doc-102)
      await user.selectOptions(selectElement, "doc-102");
      expect(selectElement.value).toBe("doc-102");

      // Invalidate queries to simulate refetch
      await qc.invalidateQueries({ queryKey: ["admin-leave-doctors"] });
      expect(getDoctorsSpy).toHaveBeenCalledTimes(2);

      // Selection must remain doc-102
      await waitFor(() => {
        expect(selectElement.value).toBe("doc-102");
      });
    });

    it("prevents preview submission and disables button when no doctors exist in roster", async () => {
      vi.spyOn(apiClient, "getDoctors").mockResolvedValueOnce([]);
      const previewSpy = vi.spyOn(apiClient, "previewDoctorLeave");

      const user = userEvent.setup();
      const qc = createTestQueryClient();
      render(
        <QueryClientProvider client={qc}>
          <AdminLeavePage />
        </QueryClientProvider>
      );

      const scheduleBtn = await screen.findByRole("button", { name: /Schedule Doctor Leave/i });
      await user.click(scheduleBtn);

      // Verify empty notice is rendered
      expect(
        screen.getByText(/No active doctors available in roster/i)
      ).toBeInTheDocument();

      // Submit button should be disabled
      const previewBtn = screen.getByRole("button", { name: /Generate Impact Preview/i });
      expect(previewBtn).toBeDisabled();

      // Attempting to click does not dispatch preview request
      await user.click(previewBtn);
      expect(previewSpy).not.toHaveBeenCalled();
    });

    it("renders 'Doctor name unavailable' or 'Doctor (id)' for missing leave doctor names instead of fabricated person", async () => {
      vi.spyOn(apiClient, "getDoctorLeaves").mockResolvedValueOnce([
        {
          id: "leave-999",
          doctor_id: "doc-unknown-999",
          doctor_name: undefined,
          starts_at: "2026-08-25T03:30:00.000Z",
          ends_at: "2026-08-27T12:30:00.000Z",
          reason: "Emergency Surgical Roster",
          created_at: "2026-08-24T00:00:00.000Z",
        },
      ]);

      const qc = createTestQueryClient();
      render(
        <QueryClientProvider client={qc}>
          <AdminLeavePage />
        </QueryClientProvider>
      );

      expect(await screen.findByText(/Doctor \(doc-unknown-999\)/i)).toBeInTheDocument();
      expect(screen.queryByText("Dr. Rajesh Verma")).not.toBeInTheDocument();
    });
  });

  describe("2. Patient Doctor Detail Missing Route ID Behavior", () => {
    it("renders invalid doctor state and does not make an API request when route ID is empty or invalid", async () => {
      // Mock useParams returning empty id
      vi.spyOn(navigation, "useParams").mockReturnValue({ id: "" });
      const getDocSpy = vi.spyOn(apiClient, "getDoctorDetail");
      const getSlotsSpy = vi.spyOn(apiClient, "getDoctorAvailability");

      const qc = createTestQueryClient();
      render(
        <QueryClientProvider client={qc}>
          <DoctorDetailPage />
        </QueryClientProvider>
      );

      // Renders truthful invalid state
      expect(await screen.findByText(/Invalid doctor identifier/i)).toBeInTheDocument();
      expect(
        screen.getByText(/The requested doctor identifier is missing or invalid/i)
      ).toBeInTheDocument();

      // Zero API requests issued
      expect(getDocSpy).not.toHaveBeenCalled();
      expect(getSlotsSpy).not.toHaveBeenCalled();
    });
  });
});
