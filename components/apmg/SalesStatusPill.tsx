"use client";

import { cn } from "@/lib/cn";
import { type SalesStatus } from "@/lib/data/sales";

/**
 * Where a lead sits in the sales cycle, as a pill. Shared so the Sales queue
 * and the Hot Leads tab (which reads the status of leads it handed over) can
 * never label or colour the same state differently.
 *
 * Tone follows the app's signal grammar: Closed is the money state and gets
 * the solid red; Contacted is in-flight (outlined red); New is quiet; Lost is
 * struck through so a dead lead reads as dead at a glance.
 */
export const SALES_STATUS_META: Record<SalesStatus, { label: string; className: string }> = {
  new: { label: "New", className: "border-border bg-muted text-muted-foreground" },
  contacted: { label: "Contacted", className: "border-primary/40 bg-transparent text-primary" },
  closed_won: {
    label: "Closed",
    className: "border-transparent bg-primary-solid text-primary-foreground",
  },
  closed_lost: {
    label: "Lost",
    className:
      "border-border bg-transparent text-muted-foreground line-through decoration-muted-foreground/40",
  },
};

export function SalesStatusPill({
  status,
  className,
}: {
  status: SalesStatus;
  className?: string;
}) {
  const s = SALES_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        s.className,
        className,
      )}
    >
      {s.label}
    </span>
  );
}
