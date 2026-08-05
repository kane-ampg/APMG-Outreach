"use client";

import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";

/**
 * The calibrated Signal-Red indicator. Pulses when live; goes steady under
 * reduced motion. Decorative (aria-hidden) — pair with textual status (§16).
 */
export function SignalLed({
  live = true,
  className,
}: {
  live?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <span className={cn("relative inline-flex h-2 w-2 shrink-0", className)} aria-hidden>
      {live && !reduce && (
        <span className="absolute inset-0 rounded-full bg-primary animate-signal-ping" />
      )}
      <span
        className={cn(
          "relative inline-flex h-2 w-2 rounded-full",
          live ? "bg-primary shadow-[0_0_6px_hsl(var(--primary)/0.8)]" : "bg-muted-foreground/40",
        )}
      />
    </span>
  );
}
