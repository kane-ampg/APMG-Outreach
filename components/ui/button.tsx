"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

type Variant =
  | "default"
  | "outline"
  | "secondary"
  | "ghost"
  | "destructive"
  | "link";
type Size = "xs" | "sm" | "default" | "lg" | "icon" | "icon-sm";

const base =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 active:translate-y-px";

const VARIANT: Record<Variant, string> = {
  default:
    "bg-primary-solid text-primary-foreground shadow-sm shadow-signal-900/30 hover:bg-primary-solid/90",
  outline:
    "border border-border bg-background hover:bg-muted hover:text-foreground",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost: "hover:bg-muted hover:text-foreground",
  destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20",
  link: "text-primary underline-offset-4 hover:underline",
};

const SIZE: Record<Size, string> = {
  xs: "h-6 px-2 text-xs",
  sm: "h-7 px-2.5 text-xs",
  default: "h-8 px-3",
  lg: "h-9 px-4",
  icon: "h-8 w-8",
  "icon-sm": "h-7 w-7",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

/** Mirrors ui-standards §7. Defaults to type="button" (a11y §16). */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(base, VARIANT[variant], SIZE[size], className)}
      {...props}
    />
  ),
);
Button.displayName = "Button";
