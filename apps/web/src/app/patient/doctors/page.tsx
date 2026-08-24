"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmptyState } from "@/components/common/EmptyState";
import { CardSkeleton } from "@/components/common/Skeleton";
import { formatCurrencyINR } from "@/lib/utils";
import {
  Search,
  Stethoscope,
  Clock,
  ArrowRight,
  AlertCircle,
} from "lucide-react";

const SPECIALIZATIONS = [
  "All",
  "Cardiology",
  "Pediatrics",
  "Neurology",
  "Dermatology",
  "Orthopaedics",
];

export default function DoctorDiscoveryPage() {
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedSpecialty, setSelectedSpecialty] = React.useState("All");

  const { data: doctors, isLoading, error } = useQuery({
    queryKey: ["doctors-list", searchQuery, selectedSpecialty],
    queryFn: () => apiClient.getDoctors(searchQuery, selectedSpecialty),
  });

  if (error) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Could not load doctor directory"
        description="A network or server error occurred while retrieving our medical specialist roster."
        actionLabel="Retry Loading"
        onAction={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="space-y-8">
      {/* Header & Search */}
      <div className="rounded-3xl border border-[#e7e7e2] bg-white p-6 sm:p-8 shadow-sm space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-[#111111] sm:text-3xl">
            Find Specialists & Doctors
          </h1>
          <p className="mt-1 text-sm text-[#626262]">
            Book verified consultations with instant atomic slot holds.
          </p>
        </div>

        {/* Search Input */}
        <div className="relative max-w-xl">
          <Input
            placeholder="Search by doctor name, specialty, or hospital credentials…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12 text-base rounded-2xl"
          />
          <Search className="absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#8e8e89]" />
        </div>

        {/* Specialization Filter Pills */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {SPECIALIZATIONS.map((spec) => {
            const isSelected = selectedSpecialty === spec;
            return (
              <button
                key={spec}
                type="button"
                onClick={() => setSelectedSpecialty(spec)}
                aria-pressed={isSelected}
                className={`min-h-[44px] whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition-colors duration-150 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#171815] ${
                  isSelected
                    ? "bg-[#171815] text-white"
                    : "border border-[#E5E4DE] bg-[#FBFBF8] text-[#666861] hover:border-[#171815]"
                }`}
              >
                {spec}
              </button>
            );
          })}
        </div>
      </div>

      {/* Doctor Cards Grid */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : doctors && doctors.length > 0 ? (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doc) => (
            <div
              key={doc.id}
              className="flex flex-col justify-between rounded-3xl border border-[#e7e7e2] bg-white p-5 sm:p-6 shadow-sm transition-colors duration-150 hover:border-[#111111] hover:shadow-lg space-y-5"
            >
              <div className="space-y-4">
                {/* Doctor Avatar & Identity */}
                <div className="flex items-start gap-4">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#efff72] text-[#111111] font-bold text-lg border border-[#d6ea39]">
                    <Stethoscope className="h-7 w-7" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#111111]">{doc.name}</h3>
                    <p className="text-xs font-semibold text-[#26734d]">{doc.specialization}</p>
                    <p className="mt-0.5 text-xs text-[#626262] line-clamp-2 leading-relaxed">
                      {doc.credentials}
                    </p>
                  </div>
                </div>

                {/* Experience & Fee */}
                <div className="grid grid-cols-2 gap-2 rounded-2xl border border-[#f0f0eb] bg-[#fbfbf8] p-3 text-xs">
                  <div>
                    <span className="text-[#8e8e89] block text-[11px]">Experience</span>
                    <span className="font-bold text-[#111111]">{doc.experience_years ?? 5} Years</span>
                  </div>
                  <div>
                    <span className="text-[#8e8e89] block text-[11px]">Consultation Fee</span>
                    <span className="font-bold text-[#111111]">{formatCurrencyINR(doc.consultation_fee ?? 1000)}</span>
                  </div>
                </div>

                {/* Next Available Slot */}
                <div className="flex items-center gap-1.5 text-xs text-[#626262]">
                  <Clock className="h-3.5 w-3.5 text-[#26734d]" />
                  <span>Next available: <strong>Today</strong></span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-2 border-t border-[#f0f0eb]">
                <Button asChild variant="outline" className="flex-1 text-xs">
                  <Link href={`/patient/doctors/${doc.id}`}>
                    <span>View Profile</span>
                  </Link>
                </Button>
                <Button asChild variant="primary" className="flex-1 text-xs">
                  <Link href={`/patient/book?doctor_id=${doc.id}`}>
                    <span>Book Slot</span>
                    <ArrowRight className="h-3.5 w-3.5 text-[#efff72]" />
                  </Link>
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Search}
          title="No matching doctors found"
          description="We couldn't find any specialist matching your search query or specialty filter. Try clearing your filters."
          actionLabel="Clear Filters"
          onAction={() => {
            setSearchQuery("");
            setSelectedSpecialty("All");
          }}
        />
      )}
    </div>
  );
}
