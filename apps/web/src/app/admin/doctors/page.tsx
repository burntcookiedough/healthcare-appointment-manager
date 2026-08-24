"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
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
import { formatCurrencyINR } from "@/lib/utils";
import {
  Users,
  Search,
  Plus,
  Stethoscope,
  Clock,
  ShieldCheck,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";

export default function AdminDoctorsPage() {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [isAddDoctorOpen, setIsAddDoctorOpen] = React.useState(false);

  // Form states
  const [docName, setDocName] = React.useState("");
  const [docSpec, setDocSpec] = React.useState("");
  const [docCreds, setDocCreds] = React.useState("");
  const [docFee, setDocFee] = React.useState("1000");

  const { data: doctors, isLoading } = useQuery({
    queryKey: ["admin-doctors-list", searchQuery],
    queryFn: () => apiClient.getDoctors(searchQuery),
  });

  const handleAddDoctor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!docName || !docSpec) {
      toast.error("Please fill in doctor name and specialization.");
      return;
    }
    toast.success(`Doctor profile provisioned: ${docName}`);
    setIsAddDoctorOpen(false);
    setDocName("");
    setDocSpec("");
    setDocCreds("");
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            Doctor Roster & Credentials
          </h2>
          <p className="text-sm text-[#626262] mt-1">
            Manage practicing clinicians, credentials, accepted durations, and consultation fees.
          </p>
        </div>

        <Button variant="primary" size="default" onClick={() => setIsAddDoctorOpen(true)}>
          <Plus className="h-4 w-4 text-[#efff72]" />
          <span>Provision New Doctor</span>
        </Button>
      </div>

      {/* Search Input */}
      <div className="relative max-w-md">
        <Input
          placeholder="Filter doctors by name, specialty, or hospital credentials…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
        <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e89]" />
      </div>

      {/* Doctors Table */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-6">
            <CardSkeleton />
          </div>
        ) : doctors && doctors.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[#e7e7e2] bg-[#fbfbf8] font-bold text-[#626262]">
                <tr>
                  <th className="py-4 px-6">Doctor Details</th>
                  <th className="py-4 px-6">Specialization</th>
                  <th className="py-4 px-6">Experience</th>
                  <th className="py-4 px-6">Consultation Fee</th>
                  <th className="py-4 px-6">Status</th>
                  <th className="py-4 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0eb]">
                {doctors.map((doc) => (
                  <tr key={doc.id} className="hover:bg-[#fbfbf8]/80 transition-colors">
                    <td className="py-4 px-6">
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#efff72] text-[#111111] font-bold">
                          <Stethoscope className="h-5 w-5" />
                        </div>
                        <div>
                          <div className="font-bold text-sm text-[#111111]">{doc.name}</div>
                          <div className="text-[11px] text-[#626262] max-w-xs truncate">
                            {doc.credentials}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6 font-semibold text-[#111111]">{doc.specialization}</td>
                    <td className="py-4 px-6 text-[#626262]">{doc.experience_years} Years</td>
                    <td className="py-4 px-6 font-bold text-[#111111]">
                      {formatCurrencyINR(doc.consultation_fee)}
                    </td>
                    <td className="py-4 px-6">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#edfdf4] px-2.5 py-0.5 text-xs font-semibold text-[#1e613f]">
                        <CheckCircle2 className="h-3 w-3" />
                        <span>Active</span>
                      </span>
                    </td>
                    <td className="py-4 px-6 text-right">
                      <Link href={`/patient/doctors/${doc.id}`}>
                        <Button variant="outline" size="sm" className="text-xs">
                          <span>View Public Profile</span>
                        </Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={Users}
            title="No doctors found"
            description="No doctor records matched your search query."
          />
        )}
      </div>

      {/* Add Doctor Dialog */}
      <Dialog open={isAddDoctorOpen} onOpenChange={setIsAddDoctorOpen}>
        <DialogContent>
          <form onSubmit={handleAddDoctor} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Provision Application Doctor Profile</DialogTitle>
              <DialogDescription>
                Add a new verified clinician to the scheduling directory.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-3 py-2">
              <Input
                label="Full Name with Title"
                placeholder="E.g., Dr. Priya Nair"
                value={docName}
                required
                onChange={(e) => setDocName(e.target.value)}
              />

              <Input
                label="Primary Specialization"
                placeholder="E.g., Endocrinology / Oncology"
                value={docSpec}
                required
                onChange={(e) => setDocSpec(e.target.value)}
              />

              <Input
                label="Medical Credentials & Institutions"
                placeholder="E.g., MBBS, MD (General Medicine) — CMC Vellore"
                value={docCreds}
                onChange={(e) => setDocCreds(e.target.value)}
              />

              <Input
                label="Consultation Fee (INR ₹)"
                type="number"
                value={docFee}
                required
                onChange={(e) => setDocFee(e.target.value)}
              />
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddDoctorOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary">
                Provision Doctor
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
