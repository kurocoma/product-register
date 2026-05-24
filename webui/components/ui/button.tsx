import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "outline" | "ghost" | "destructive";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-blue-600 text-white hover:bg-blue-700",
  outline: "border border-slate-300 hover:bg-slate-100",
  ghost: "hover:bg-slate-100",
  destructive: "bg-red-600 text-white hover:bg-red-700",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }
>(({ className, variant = "primary", ...props }, ref) => (
  <button
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center rounded px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none",
      VARIANTS[variant],
      className,
    )}
    {...props}
  />
));
Button.displayName = "Button";
