"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

import { Slot } from "@radix-ui/react-slot";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#171815] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        // Dark charcoal button (restrained aesthetic)
        primary:
          "bg-[#171815] text-white hover:bg-[#282924] active:scale-[0.98] rounded-xl shadow-xs",
        // Soft pastel sage accent button
        accent:
          "bg-[#EEF5EF] text-[#315B43] hover:bg-[#E0EDE2] font-semibold active:scale-[0.98] rounded-xl border border-[#D8E7DB] shadow-xs",
        // Subtle outline
        outline:
          "border border-[#E5E4DE] bg-white text-[#171815] hover:bg-[#F6F5F0] active:bg-[#ECEBE4] rounded-xl",
        // Neutral secondary
        secondary:
          "bg-[#F6F5F0] text-[#171815] hover:bg-[#ECEBE4] active:bg-[#E2E1D8] rounded-xl",
        // Ghost / text
        ghost:
          "text-[#171815] hover:bg-[#F6F5F0] active:bg-[#ECEBE4] rounded-xl",
        // Danger action
        destructive:
          "bg-[#B42318] text-white hover:bg-[#911D13] active:scale-[0.98] rounded-xl shadow-xs",
        // Subtle danger outline
        destructiveOutline:
          "border border-[#EBCFC2] bg-[#F8ECE6] text-[#7A4636] hover:bg-[#F2DCD1] rounded-xl",
      },
      size: {
        sm: "h-9 px-3.5 text-xs min-h-[44px]",
        default: "h-10 px-5 text-sm min-h-[44px]",
        lg: "h-12 px-6 text-base min-h-[48px]",
        icon: "h-11 w-11 min-h-[44px] min-w-[44px] p-0 rounded-full",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, isLoading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, className }))}
        disabled={asChild ? undefined : (disabled || isLoading)}
        {...props}
      >
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-current" aria-hidden="true" />
            <span>Loading…</span>
          </>
        ) : (
          children
        )}
      </Comp>
    );
  }
);

Button.displayName = "Button";

export { buttonVariants };
