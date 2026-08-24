"use client";

import * as React from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { StatusBadge } from "@/components/common/StatusBadge";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";
import { PrescriptionItem } from "@/types/api";
import {
  FileText,
  Pill,
  Plus,
  Trash2,
  CheckCircle2,
  ArrowLeft,
  AlertCircle,
  Save,
} from "lucide-react";
import { toast } from "sonner";

const ROUTE_OPTIONS = [
  { value: "Oral", label: "Oral (Tablets/Capsules/Syrup)" },
  { value: "Topical", label: "Topical (Cream/Ointment/Lotion)" },
  { value: "Inhalation", label: "Inhalation (Inhaler/Nebulizer)" },
  { value: "Sublingual", label: "Sublingual (Under tongue)" },
  { value: "Ophthalmic", label: "Ophthalmic (Eye Drops)" },
];

const FREQUENCY_OPTIONS = [
  { value: "Once daily morning", label: "Once daily in morning (08:00 AM)" },
  { value: "Twice daily after meals", label: "Twice daily after meals (08:30 AM, 08:30 PM)" },
  { value: "Three times daily", label: "Three times daily (08:00 AM, 02:00 PM, 08:00 PM)" },
  { value: "Once daily at bedtime", label: "Once daily at bedtime (10:00 PM)" },
  { value: "As needed for pain", label: "As needed (SOS / PRN)" },
];

export default function DoctorVisitEditorPage() {
  const params = useParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const visitId = (params?.id as string) || "vis-001-completed";

  const { data: visit, isLoading, error } = useQuery({
    queryKey: ["doctor-visit", visitId],
    queryFn: () => apiClient.getVisit(visitId),
  });

  const [notes, setNotes] = React.useState("");
  const [diagnosis, setDiagnosis] = React.useState("");
  const [followUp, setFollowUp] = React.useState("");
  const [prescriptionItems, setPrescriptionItems] = React.useState<PrescriptionItem[]>([]);
  const [isFinalizeDialogOpen, setIsFinalizeDialogOpen] = React.useState(false);

  const initializedVisitIdRef = React.useRef<string | null>(null);

  // Sync state when visit data loads (only on first load or visit ID change to protect unsaved edits)
  React.useEffect(() => {
    if (visit && initializedVisitIdRef.current !== visit.id) {
      initializedVisitIdRef.current = visit.id;
      setNotes(visit.doctor_notes || "");
      setDiagnosis(visit.diagnosis || "");
      setFollowUp(visit.follow_up_instructions || "");
      setPrescriptionItems(visit.prescription?.items || []);
    }
  }, [visit]);

  // Add new prescription item row
  const handleAddItem = () => {
    const newItem: PrescriptionItem = {
      id: `rx-item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      medication_name: "",
      dosage: "500mg",
      route: "Oral",
      frequency: "Twice daily after meals",
      start_date: new Date().toISOString().split("T")[0],
      duration_days: 7,
      instructions: "Take with full glass of water after food",
    };
    setPrescriptionItems([...prescriptionItems, newItem]);
  };

  const handleRemoveItem = (id: string) => {
    setPrescriptionItems(prescriptionItems.filter((item) => item.id !== id));
  };

  const handleItemChange = (id: string, field: keyof PrescriptionItem, val: string | number) => {
    setPrescriptionItems(
      prescriptionItems.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  const handleOpenFinalize = () => {
    if (!diagnosis || diagnosis.trim().length === 0) {
      toast.error("Please enter a clinical diagnosis before finalizing.");
      return;
    }
    if (!notes || notes.trim().length === 0) {
      toast.error("Please enter consultation notes before finalizing.");
      return;
    }
    for (let i = 0; i < prescriptionItems.length; i++) {
      const item = prescriptionItems[i];
      if (!item.medication_name || item.medication_name.trim().length === 0) {
        toast.error(`Medication #${i + 1}: Name is required.`);
        return;
      }
      if (!item.dosage || item.dosage.trim().length === 0) {
        toast.error(`Medication #${i + 1}: Dosage is required.`);
        return;
      }
      if (item.duration_days === undefined || item.duration_days === null || item.duration_days <= 0) {
        toast.error(`Medication #${i + 1}: Duration must be a positive number of days.`);
        return;
      }
    }
    setIsFinalizeDialogOpen(true);
  };

  // Draft Save Mutation
  const draftMutation = useMutation({
    mutationFn: async () => {
      return apiClient.saveVisitDraft(visitId, notes, diagnosis, prescriptionItems, {
        expectedVersion: visit?.version ?? 1,
      });
    },
    onSuccess: () => {
      toast.success("Visit draft saved.");
      queryClient.invalidateQueries({ queryKey: ["doctor-visit", visitId] });
    },
    onError: (err: { error?: { message?: string } }) => {
      toast.error(err?.error?.message || "Failed to save draft.");
    },
  });

  // Finalize Mutation (VISIT-002)
  const finalizeMutation = useMutation({
    mutationFn: async () => {
      return apiClient.completeVisit(visitId, notes, diagnosis, prescriptionItems, followUp, {
        expectedVersion: visit?.version ?? 1,
      });
    },
    onSuccess: () => {
      toast.success("Consultation completed and prescription finalized.");
      setIsFinalizeDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ["doctor-visit", visitId] });
      queryClient.invalidateQueries({ queryKey: ["doctor-appointments"] });
      router.push("/doctor");
    },
    onError: (err: { error?: { message?: string } }) => {
      toast.error(err?.error?.message || "Failed to finalize consultation.");
    },
  });

  if (isLoading) return <CardSkeleton />;

  if (error || !visit) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Clinical visit not found"
        description="We could not find the consultation workspace for this visit."
        actionLabel="Back to Timeline"
        onAction={() => router.push("/doctor")}
      />
    );
  }

  const isCompleted = visit.status === "completed";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* Top Breadcrumb & Action Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <Link
          href={`/doctor/appointments/${visit.appointment_id}`}
          className="inline-flex min-h-[44px] items-center gap-1.5 text-xs font-semibold text-[#626262] hover:text-[#111111]"
        >
          <ArrowLeft className="h-4 w-4" />
          <span>Back to Intake Brief</span>
        </Link>

        {!isCompleted && (
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="default"
              onClick={() => draftMutation.mutate()}
              isLoading={draftMutation.isPending}
            >
              <Save className="h-4 w-4" />
              <span>Save Draft</span>
            </Button>

            <Button
              variant="primary"
              size="default"
              onClick={handleOpenFinalize}
            >
              <CheckCircle2 className="h-4 w-4 text-[#efff72]" />
              <span>Finalize & Complete Visit</span>
            </Button>
          </div>
        )}
      </div>

      {/* Main Consultation Editor Card */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-[#f0f0eb] pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111]">
              <FileText className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-[#111111]">Clinical Consultation Workspace</h1>
                <StatusBadge status={visit.status} size="sm" />
              </div>
              <p className="text-xs text-[#626262]">Visit Reference: {visit.id}</p>
            </div>
          </div>
        </div>

        {/* Clinical Form Fields */}
        <div className="space-y-5">
          {/* Formal Diagnosis */}
          <Input
            label="Clinical Diagnosis (ICD-10 / Disease Name)"
            placeholder="E.g., Essential Primary Hypertension (I10) / Subacute Eczema..."
            value={diagnosis}
            disabled={isCompleted}
            onChange={(e) => setDiagnosis(e.target.value)}
          />

          {/* Doctor Clinical Notes (Direct Authoring) */}
          <Textarea
            label="Doctor Consultation Notes & Clinical Findings"
            placeholder="Record history of present illness, examination findings, vitals (BP, HR), and clinical rationale..."
            rows={6}
            value={notes}
            disabled={isCompleted}
            onChange={(e) => setNotes(e.target.value)}
            helperText="Authored clinical notes are versioned and stored immutably."
          />

          {/* Follow-up review instructions */}
          <Input
            label="Follow-up Review Schedule & Patient Instructions"
            placeholder="E.g., Review in OPD after 3 weeks with fasting lipid profile..."
            value={followUp}
            disabled={isCompleted}
            onChange={(e) => setFollowUp(e.target.value)}
          />
        </div>
      </div>

      {/* STRUCTURED PRESCRIPTION EDITOR (RX-001) */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#f0f0eb] pb-4">
          <div>
            <div className="flex items-center gap-2">
              <Pill className="h-5 w-5 text-[#26734d]" />
              <h3 className="text-lg font-bold text-[#111111]">
                Structured Prescription (RX-001)
              </h3>
            </div>
            <p className="text-xs text-[#626262] mt-0.5">
              Structured dosage, route, and frequency fields drive deterministic patient reminders (RX-002).
            </p>
          </div>

          {!isCompleted && (
            <Button variant="outline" size="sm" onClick={handleAddItem}>
              <Plus className="h-4 w-4" />
              <span>Add Medication</span>
            </Button>
          )}
        </div>

        {/* Prescription Items Rows */}
        {prescriptionItems.length > 0 ? (
          <div className="space-y-4">
            {prescriptionItems.map((item, index) => (
              <div
                key={item.id}
                className="rounded-2xl border border-[#e7e7e2] bg-[#fbfbf8] p-5 space-y-4 shadow-xs"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-lg bg-white border border-[#E5E4DE] px-2.5 py-0.5 text-xs font-bold text-[#171815]">
                    Medication #{index + 1}
                  </span>
                  {!isCompleted && (
                    <button
                      type="button"
                      onClick={() => handleRemoveItem(item.id)}
                      className="text-xs font-semibold text-[#b42318] hover:text-[#911d13] flex items-center gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Input
                    label="Medication Name"
                    placeholder="E.g., Amlodipine, Metformin, Mometasone"
                    value={item.medication_name}
                    disabled={isCompleted}
                    onChange={(e) => handleItemChange(item.id, "medication_name", e.target.value)}
                  />

                  <Input
                    label="Dosage / Strength"
                    placeholder="E.g., 5mg, 500mg, 10ml"
                    value={item.dosage}
                    disabled={isCompleted}
                    onChange={(e) => handleItemChange(item.id, "dosage", e.target.value)}
                  />

                  <Select
                    label="Route of Administration"
                    value={item.route || "Oral"}
                    disabled={isCompleted}
                    onChange={(e) => handleItemChange(item.id, "route", e.target.value)}
                    options={ROUTE_OPTIONS}
                  />
                </div>

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <Select
                    label="Dosing Frequency"
                    value={item.frequency}
                    disabled={isCompleted}
                    onChange={(e) => handleItemChange(item.id, "frequency", e.target.value)}
                    options={FREQUENCY_OPTIONS}
                  />

                  <Input
                    label="Duration (Days)"
                    type="number"
                    min={1}
                    value={item.duration_days !== undefined && item.duration_days !== null ? item.duration_days : ""}
                    disabled={isCompleted}
                    onChange={(e) => {
                      const val = e.target.value === "" ? 0 : Number(e.target.value);
                      handleItemChange(item.id, "duration_days", val);
                    }}
                  />

                  <Input
                    label="Patient Instructions"
                    placeholder="E.g., Take with food, Avoid sunlight"
                    value={item.instructions}
                    disabled={isCompleted}
                    onChange={(e) => handleItemChange(item.id, "instructions", e.target.value)}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-2xl border border-dashed border-[#e7e7e2] p-8 text-center text-xs text-[#626262] space-y-3">
            <Pill className="h-8 w-8 text-[#8e8e89] mx-auto" />
            <p>No medications prescribed yet. Click &quot;Add Medication&quot; above to prescribe structured drugs.</p>
          </div>
        )}
      </div>

      {/* CONSEQUENTIAL FINALIZE VISIT DIALOG (VISIT-002) */}
      <Dialog open={isFinalizeDialogOpen} onOpenChange={setIsFinalizeDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Finalize & Complete Consultation</DialogTitle>
            <DialogDescription>
              Completing this visit will finalize your clinical notes, commit the structured prescription for <strong>{prescriptionItems.length} medication(s)</strong>, and notify the patient.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2 text-xs">
            <div className="rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-4 space-y-2">
              <div>
                <span className="text-[#8e8e89] block">Diagnosis:</span>
                <span className="font-bold text-[#111111]">{diagnosis || "Not specified"}</span>
              </div>
              <div>
                <span className="text-[#8e8e89] block">Prescriptions:</span>
                <span className="font-bold text-[#111111]">
                  {prescriptionItems.length > 0
                    ? prescriptionItems.map((i) => i.medication_name || "Untitled").join(", ")
                    : "No medications prescribed"}
                </span>
              </div>
            </div>

            <p className="text-[#626262]">
              Per Domain Rule <strong>VISIT-002</strong>, a completed visit is immutable. Any subsequent modifications will require append-only clinical amendments.
            </p>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setIsFinalizeDialogOpen(false)}
              disabled={finalizeMutation.isPending}
            >
              Continue Editing
            </Button>
            <Button
              variant="primary"
              onClick={() => finalizeMutation.mutate()}
              isLoading={finalizeMutation.isPending}
            >
              Confirm & Complete Visit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
