"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  helperText?: string;
  options?: Array<{ value: string | number; label: string }>;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, label, error, helperText, id, required, options, children, ...props }, ref) => {
    const generatedId = React.useId();
    const inputId = id || generatedId;
    const errorId = `${inputId}-error`;
    const helperId = `${inputId}-helper`;

    return (
      <div className="w-full space-y-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-semibold uppercase tracking-wider text-[#626262]"
          >
            {label}
            {required && <span className="ml-1 text-[#b42318]">*</span>}
          </label>
        )}
        <div className="relative">
          <select
            id={inputId}
            ref={ref}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={cn(
              "flex h-11 w-full appearance-none rounded-xl border border-[#e7e7e2] bg-white px-3.5 py-2 pr-10 text-sm text-[#111111] transition-colors focus-visible:border-[#111111] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#111111] disabled:cursor-not-allowed disabled:bg-[#f6f6f2] disabled:opacity-60",
              error && "border-[#b42318] focus-visible:border-[#b42318] focus-visible:ring-[#b42318]",
              className
            )}
            {...props}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8e8e89]" />
        </div>
        {error && (
          <p id={errorId} className="text-xs font-medium text-[#b42318]" role="alert">
            {error}
          </p>
        )}
        {!error && helperText && (
          <p id={helperId} className="text-xs text-[#626262]">
            {helperText}
          </p>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
