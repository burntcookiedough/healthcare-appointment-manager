"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

import { Slot } from "@radix-ui/react-slot";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#111111] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-45 select-none",
  {
    variants: {
      variant: {
        // Dark charcoal pill button (Assemble aesthetic)
        primary:
          "bg-[#111111] text-white hover:bg-[#262626] active:scale-[0.98] rounded-full shadow-sm",
        // Pale acid-lime emphasis pill
        accent:
          "bg-[#efff72] text-[#111111] hover:bg-[#dff34d] font-semibold active:scale-[0.98] rounded-full border border-[#d6ea39] shadow-sm",
        // Subtle outline
        outline:
          "border border-[#e7e7e2] bg-white text-[#111111] hover:bg-[#f6f6f2] active:bg-[#eeeeea] rounded-full",
        // Neutral secondary
        secondary:
          "bg-[#f0f0eb] text-[#111111] hover:bg-[#e4e4dd] active:bg-[#dadad2] rounded-full",
        // Ghost / text
        ghost:
          "text-[#111111] hover:bg-[#f0f0eb] active:bg-[#e4e4dd] rounded-full",
        // Danger action
        destructive:
          "bg-[#b42318] text-white hover:bg-[#911d13] active:scale-[0.98] rounded-full shadow-sm",
        // Subtle danger outline
        destructiveOutline:
          "border border-[#fda29b] bg-[#fffbfa] text-[#b42318] hover:bg-[#fee4e2] rounded-full",
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
