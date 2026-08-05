"use client";

import { motion, useReducedMotion } from "motion/react";
import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { SignalLed } from "../SignalLed";

const EASE = [0.16, 1, 0.3, 1] as const;

export type StepStatus = "idle" | "active" | "done" | "error";

export interface FlowStep {
  id: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  status: StepStatus;
}

/**
 * The n8n-style node rail: three connected, SELECTABLE "nodes" with connectors
 * that fill as data flows downstream. Clicking a node selects it so the panel
 * below shows that phase's content. Horizontal on md+, stacked on mobile.
 * Recolored to the SIGNAL/RAIL accent (signal red, no green), reduced-motion
 * aware (§14.5).
 */
export function StepRail({
  steps,
  selected,
  onSelect,
}: {
  steps: FlowStep[];
  selected: number;
  onSelect: (index: number) => void;
}) {
  const reduce = !!useReducedMotion();
  return (
    <ol
      className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-0"
      aria-label="Import phases"
    >
      {steps.map((step, i) => {
        const prevDone = step.status === "done";
        return (
          <li
            key={step.id}
            className="flex flex-col md:flex-1 md:flex-row md:items-center"
          >
            <StepNode
              step={step}
              index={i}
              reduce={reduce}
              selected={i === selected}
              onSelect={() => onSelect(i)}
            />
            {i < steps.length - 1 && (
              <Connector
                filled={prevDone}
                flowing={step.status === "active"}
                reduce={reduce}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StepNode({
  step,
  index,
  reduce,
  selected,
  onSelect,
}: {
  step: FlowStep;
  index: number;
  reduce: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  const { status, icon: Icon, label, detail } = step;
  const done = status === "done";
  const active = status === "active";
  const error = status === "error";

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "step" : undefined}
      data-track="pipeline_step"
      data-track-step={step.id}
      className={cn(
        "relative flex min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-xl border bg-card px-3.5 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected && "ring-1 ring-primary",
        active && "border-primary/50",
        done && "border-primary/30",
        error && "border-destructive/50",
        !active && !done && !error && "border-border",
        !selected && "hover:border-primary/40",
      )}
    >
      <div
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition-colors",
          done
            ? "border-transparent bg-primary-solid text-primary-foreground"
            : active
              ? "border-primary/40 bg-primary/10 text-primary"
              : error
                ? "border-destructive/40 bg-transparent text-destructive"
                : "border-border bg-background text-muted-foreground",
        )}
      >
        {done ? (
          <Check className="h-[18px] w-[18px]" aria-hidden />
        ) : (
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="tnum font-mono text-[9px] uppercase tracking-[0.16em] text-muted-foreground">
            {String(index + 1).padStart(2, "0")}
          </span>
          {active && <SignalLed className="h-1.5 w-1.5" />}
        </div>
        <div className="truncate text-[13px] font-semibold text-foreground">{label}</div>
        <div
          className={cn(
            "truncate font-mono text-[10.5px]",
            error
              ? "text-destructive"
              : active
                ? "text-primary"
                : "text-muted-foreground",
          )}
        >
          {detail}
        </div>
      </div>

      {/* indeterminate scan sweep along the node's bottom edge while running.
          linear (not a house cubic) is deliberate: an eased curve stutters at
          the seam of an infinite loop. Gated behind reduced motion (§14.5). */}
      {active && !reduce && (
        <div className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden bg-border/60">
          <motion.div
            className="h-full w-1/3 bg-primary"
            animate={{ x: ["-110%", "330%"] }}
            transition={{ repeat: Infinity, duration: 1.1, ease: "linear" }}
          />
        </div>
      )}
    </button>
  );
}

function Connector({
  filled,
  flowing,
  reduce,
}: {
  filled: boolean;
  flowing: boolean;
  reduce: boolean;
}) {
  return (
    <>
      {/* desktop: horizontal segment between nodes */}
      <div className="relative mx-1.5 hidden h-[2px] w-6 shrink-0 overflow-hidden rounded-full bg-border md:block lg:w-12">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full bg-primary"
          initial={false}
          animate={{ width: filled ? "100%" : "0%" }}
          transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
        />
        {flowing && !reduce && (
          <motion.span
            aria-hidden
            className="absolute top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-primary shadow-[0_0_6px_hsl(var(--primary))]"
            animate={{ left: ["-10%", "110%"], opacity: [0, 1, 0] }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
          />
        )}
      </div>

      {/* mobile: short vertical segment under the icon column */}
      <div className="relative my-0.5 ml-[26px] block h-3 w-[2px] overflow-hidden rounded-full bg-border md:hidden">
        <motion.div
          className="absolute inset-x-0 top-0 rounded-full bg-primary"
          initial={false}
          animate={{ height: filled ? "100%" : "0%" }}
          transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
        />
      </div>
    </>
  );
}
