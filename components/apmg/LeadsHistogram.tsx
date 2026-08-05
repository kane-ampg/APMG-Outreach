"use client";

import { useEffect, useRef, useState } from "react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Bar } from "@/lib/data/leads";
import { formatInt } from "@/lib/format";

export interface HistogramMode {
  id: string;
  label: string;
  data: Bar[];
  unit: string;
}

/**
 * Lead-volume histogram. Generic over a set of `modes` (e.g. by-week, by-day,
 * by-month) passed in by the caller — so the same instrument renders real
 * pipeline data for any role. Modes with no data are hidden; if nothing has
 * data it shows an empty state. The docked readout tracks the hovered/selected
 * bar.
 *
 * When `autoCycle` is on, the view advances to the next mode every
 * `autoCycleMs` (default 20s), looping in the order modes are passed. The cycle
 * pauses while the user is hovering/focused inside the panel, and a manual mode
 * click restarts the 20s timer from that mode.
 */
export function LeadsHistogram({
  modes,
  title = "Lead volume",
  emptyHint = "No data to chart yet.",
  autoCycle = false,
  autoCycleMs = 20000,
}: {
  modes: HistogramMode[];
  title?: string;
  emptyHint?: string;
  autoCycle?: boolean;
  autoCycleMs?: number;
}) {
  const available = modes.filter((m) => m.data.length > 0);
  const [modeId, setModeId] = useState<string | null>(available[0]?.id ?? null);
  const config = available.find((m) => m.id === modeId) ?? available[0] ?? null;
  const [paused, setPaused] = useState(false);

  // Auto-advance through the available modes. Re-arms on every mode change (so
  // each mode gets a full interval whether it changed by timer or by click) and
  // while paused it simply doesn't arm.
  const availableIds = available.map((m) => m.id).join("|");
  const idsRef = useRef(availableIds);
  idsRef.current = availableIds;
  useEffect(() => {
    if (!autoCycle || paused || available.length <= 1) return;
    const t = setTimeout(() => {
      setModeId((curr) => {
        const ids = idsRef.current.split("|");
        const idx = ids.indexOf(curr ?? ids[0]);
        return ids[(idx + 1) % ids.length];
      });
    }, autoCycleMs);
    return () => clearTimeout(t);
  }, [autoCycle, autoCycleMs, paused, modeId, availableIds, available.length]);

  return (
    <section
      className="flex h-full min-w-0 flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      aria-label={`${title} histogram`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {/* panel head: title + (when data) docked readout + mode toggle */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>

        {available.length > 1 && (
          <div
            className="flex items-center gap-0.5 rounded-md border border-border bg-background/50 p-0.5"
            role="group"
            aria-label="Histogram view"
          >
            {available.map((m) => (
              <button
                key={m.id}
                type="button"
                data-track="histogram_mode"
                data-track-mode={m.id}
                onClick={() => setModeId(m.id)}
                aria-pressed={config?.id === m.id}
                className={cn(
                  "rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
                  config?.id === m.id
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {config ? (
        <Chart key={config.id} data={config.data} unit={config.unit} />
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <p className="font-mono text-[10.5px] text-muted-foreground">{emptyHint}</p>
        </div>
      )}
    </section>
  );
}

/** The bars + axis. Keyed by mode id so its hover/selected state resets cleanly
 *  when the caller switches modes. Assumes `data.length > 0`. */
function Chart({ data, unit }: { data: Bar[]; unit: string }) {
  const max = Math.max(...data.map((d) => d.value)) || 1;
  const currentIndex = Math.max(
    data.findIndex((d) => d.current),
    0,
  );
  const [selected, setSelected] = useState(currentIndex);
  const [hovered, setHovered] = useState<number | null>(null);
  const active = hovered ?? selected;
  const reading = data[active] ?? data[currentIndex];

  // Cap the chart width when there are only a few buckets so a single day's
  // import doesn't stretch one bar across the whole panel. Bars + labels share
  // this wrapper width, so they stay aligned. Full sets (≥ 6) fill the panel.
  const capped = data.length < 6;
  const wrapStyle = capped ? { maxWidth: `${data.length * 104}px` } : undefined;

  return (
    <>
      <div className="mt-2 flex items-baseline gap-2.5">
        <span className="tnum font-mono text-[11px] text-muted-foreground">
          <span className="text-foreground">{reading.label}</span>
          {" · "}
          <span className="text-primary">{formatInt(reading.value)}</span> {unit}
        </span>
      </div>

      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col" style={wrapStyle}>
        {/* bars */}
        <div className="relative mt-4 min-h-[180px] flex-1">
          {/* faint datum gridlines */}
          {[0.25, 0.5, 0.75].map((g) => (
            <span
              key={g}
              aria-hidden
              className="absolute inset-x-0 h-px"
              style={{ bottom: `${g * 100}%`, background: "var(--grid)" }}
            />
          ))}

          <div className="relative flex h-full items-end justify-center gap-1.5 sm:gap-2">
            {data.map((bar, i) => {
              const pct = (bar.value / max) * 100;
              const isActive = i === active;
              return (
                <button
                  key={`${bar.label}-${i}`}
                  type="button"
                  data-track="histogram_bar"
                  data-track-bucket={bar.label}
                  data-track-value={bar.value}
                  onClick={() => setSelected(i)}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  aria-label={`${bar.label}: ${formatInt(bar.value)} ${unit}`}
                  aria-pressed={i === selected}
                  className="group relative flex h-full min-w-0 max-w-[88px] flex-1 flex-col justify-end rounded-t-sm"
                >
                  <span
                    className="w-full rounded-t-[2px] transition-opacity motion-safe:animate-bar-rise"
                    style={{
                      height: `${pct}%`,
                      background: isActive ? "var(--bar-strong)" : "var(--bar)",
                      opacity: isActive ? 1 : 0.62,
                      transformOrigin: "bottom",
                      animationDelay: `${Math.min(i * 0.04, 0.4)}s`,
                    }}
                  />
                </button>
              );
            })}
          </div>
        </div>

        {/* baseline datum + x labels */}
        <div className="mt-1 h-px w-full" style={{ background: "hsl(var(--primary) / 0.5)" }} aria-hidden />
        <div className="mt-1.5 flex justify-center gap-1.5 sm:gap-2">
          {data.map((bar, i) => (
            <span
              key={`${bar.label}-${i}`}
              className={cn(
                "tnum min-w-0 max-w-[88px] flex-1 truncate text-center font-mono text-[9px] uppercase tracking-[0.04em]",
                i === active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {bar.label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}
