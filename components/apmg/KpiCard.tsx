"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Kpi } from "@/lib/data/leads";
import { useCountUp } from "@/lib/useCountUp";
import { SignalLed } from "./SignalLed";

/** A small SVG trend line. Graphical (red fill ok), decorative. */
function Sparkline({ data }: { data: number[] }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 100;
  const h = 28;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      className="h-7 w-full opacity-80"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--bar)"
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Labelled proportion bar — the alternative foot for "X of total" KPIs. Stays
 *  inside the signal-red family (fill is --primary), no green. */
function RatioBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
        <span className="truncate">{label}</span>
        <span className="tnum text-foreground/70">{pct}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={`${label}: ${pct} percent`}
      >
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/**
 * KPI as an instrument gauge: stamped tiny-caps label, a Signal LED, a hero
 * monospace readout that ticks up on load, an optional delta whose colour
 * encodes good/bad WITHIN the red family (no green — §design), and a foot that
 * is either a trend spark or a proportion bar. Rendered as a real <button> so
 * it is keyboard-activatable and tracked. Shows a skeleton while loading.
 */
export function KpiCard({ kpi }: { kpi: Kpi }) {
  const counted = useCountUp(kpi.numeric, kpi.format, kpi.value);
  const display = kpi.noCountUp ? kpi.value : counted;

  const hasDelta = typeof kpi.delta === "number";
  const delta = kpi.delta ?? 0;
  const up = delta > 0;
  const good = kpi.goodWhenDown ? delta < 0 : delta > 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;

  const showSpark = !kpi.loading && !!kpi.spark && kpi.spark.length >= 2;
  const showRatio = !kpi.loading && !showSpark && kpi.ratio != null;

  return (
    <button
      type="button"
      disabled={kpi.loading}
      aria-busy={kpi.loading || undefined}
      data-track="kpi_card_click"
      data-track-kpi={kpi.id}
      aria-label={
        kpi.loading
          ? `${kpi.label}: loading`
          : `${kpi.label}: ${kpi.value}${hasDelta ? `, ${good ? "favourable" : "unfavourable"} trend` : ""}`
      }
      className="group flex h-full flex-col bg-card p-5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))] disabled:cursor-default disabled:hover:bg-card"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {kpi.label}
        </span>
        <SignalLed />
      </div>

      {kpi.loading ? (
        <div className="mt-3 h-[34px] w-3/4 animate-pulse rounded bg-muted sm:h-[40px]" />
      ) : (
        <div className="tnum mt-3 font-mono text-[34px] font-semibold leading-none tracking-tight text-foreground sm:text-[40px]">
          {display}
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {kpi.loading ? (
          <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
        ) : (
          <>
            {hasDelta && (
              <span
                className={cn(
                  "tnum inline-flex items-center gap-0.5 font-mono text-xs font-semibold",
                  good ? "text-primary" : "text-muted-foreground",
                )}
              >
                <Arrow className="h-3.5 w-3.5" aria-hidden />
                {Math.abs(delta)}
                {kpi.deltaUnit}
              </span>
            )}
            {kpi.caption && (
              <span className="truncate text-[11px] text-muted-foreground">{kpi.caption}</span>
            )}
          </>
        )}
      </div>

      {/* mt-auto pins the foot to a shared baseline across all cells in the panel */}
      <div className="mt-auto pt-4">
        {kpi.loading ? (
          <div className="h-7 w-full animate-pulse rounded bg-muted/60" />
        ) : showSpark ? (
          <Sparkline data={kpi.spark!} />
        ) : showRatio ? (
          <RatioBar value={kpi.ratio!.value} label={kpi.ratio!.label} />
        ) : null}
      </div>
    </button>
  );
}
