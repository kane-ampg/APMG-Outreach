import * as React from "react";
import { cn } from "@/lib/cn";

type Variant = "default" | "secondary" | "destructive" | "outline";

const VARIANT: Record<Variant, string> = {
  default: "border-transparent bg-primary text-primary-foreground",
  secondary: "border-transparent bg-secondary text-secondary-foreground",
  destructive: "border-transparent bg-destructive text-destructive-foreground",
  outline: "text-foreground",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: Variant;
}

/** shadcn <Badge>, ui-standards §8.1. */
export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-4xl border px-2 py-0.5 text-xs font-medium",
        VARIANT[variant],
        className,
      )}
      {...props}
    />
  );
}
