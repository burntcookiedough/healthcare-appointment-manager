"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, label, error, helperText, id, required, ...props }, ref) => {
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
          <input
            id={inputId}
            type={type}
            ref={ref}
            required={required}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : helperText ? helperId : undefined}
            className={cn(
              "flex h-11 w-full rounded-xl border border-[#e7e7e2] bg-white px-3.5 py-2 text-sm text-[#111111] placeholder:text-[#8e8e89] transition-colors focus-visible:border-[#111111] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#111111] disabled:cursor-not-allowed disabled:bg-[#f6f6f2] disabled:opacity-60",
              error && "border-[#b42318] focus-visible:border-[#b42318] focus-visible:ring-[#b42318]",
              className
            )}
            {...props}
          />
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

Input.displayName = "Input";
