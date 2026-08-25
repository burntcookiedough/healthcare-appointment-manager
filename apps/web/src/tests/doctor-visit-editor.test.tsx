import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DoctorVisitEditorPage from "@/app/doctor/visits/[id]/page";
import { apiClient } from "@/lib/api/client";
import type { Visit } from "@/types/api";

const draftVisit: Visit = {
  id: "visit-001",
  appointment_id: "apt-001-upcoming",
  doctor_id: "doc-001",
  status: "draft",
  version: 1,
  notes: [],
  doctor_notes: "",
  diagnosis: "",
  follow_up_instructions: null,
  prescription: null,
  generated_artifacts: [],
  created_at: "2026-08-24T10:00:00Z",
  updated_at: "2026-08-24T10:00:00Z",
  completed_at: null,
};

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

describe("Doctor visit finalization recovery", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    vi.restoreAllMocks();
  });

  it("reconciles the appointment-keyed visit after completion fails after draft persistence", async () => {
    const getVisit = vi.spyOn(apiClient, "getVisit").mockResolvedValue(draftVisit);
    const completeVisit = vi
      .spyOn(apiClient, "completeVisit")
      .mockRejectedValue({ error: { message: "Completion service unavailable" } });
    const queryClient = createQueryClient();
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <DoctorVisitEditorPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Clinical Consultation Workspace")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Clinical Diagnosis/), {
      target: { value: "Essential hypertension" },
    });
    fireEvent.change(screen.getByLabelText(/Doctor Consultation Notes/), {
      target: { value: "Blood pressure remains above goal on current treatment." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Finalize & Complete Visit/ }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & Complete Visit/ }));

    await waitFor(() => expect(completeVisit).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["doctor-visit", "apt-001-upcoming"],
      })
    );
    expect(getVisit).toHaveBeenCalledTimes(2);
  });
});
