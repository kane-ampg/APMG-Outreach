"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BarChart3, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { SOURCE_LABEL, type LeadSource } from "@/lib/pipeline/source";
import { Button } from "@/components/ui/button";

interface SourceStat {
  source: LeadSource;
  total: number;
  withEmail: number;
  withWebsite: number;
  withPhone: number;
  engaged: number;
}

type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sources: SourceStat[]; engagedAvailable: boolean };

/** Share of a source's leads that cleared a bar, as a whole percent. */
function rate(part: number, whole: number): string {
  if (whole <= 0) return "—";
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * Google vs Bing, on the only comparison that decides which scraper is worth
 * running: how many of each one's leads are actually contactable.
 *
 * Loads on demand rather than with the page. /api/pipeline/source-stats costs
 * 15 count probes, and this panel answers a question you ask occasionally, not
 * one you watch — so it stays off the polling path.
 */
export function SourceComparison({ refreshSignal = 0 }: { refreshSignal?: number }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch("/api/pipeline/source-stats", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; sources?: SourceStat[]; engagedAvailable?: boolean; error?: string }
        | null;
      if (!res.ok || !data?.ok) {
        setState({ status: "error", message: data?.error ?? "Couldn't read the source split." });
        return;
      }
      loadedRef.current = true;
      setState({
        status: "ready",
        sources: data.sources ?? [],
        engagedAvailable: data.engagedAvailable !== false,
      });
    } catch {
      setState({ status: "error", message: "Couldn't reach the database." });
    }
  }, []);

  // Once the operator has opened this, keep it honest after each import.
  useEffect(() => {
    if (refreshSignal > 0 && loadedRef.current) void load();
  }, [refreshSignal, load]);

  const rows = state.status === "ready" ? state.sources.filter((s) => s.total > 0) : [];

  return (
    <section
      className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10"
      aria-label="Lead counts by scraper source"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Sources · Google vs Bing
          </span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={state.status === "loading"}
          data-track="pipeline_source_split"
          className="h-7 gap-1.5 px-2 font-mono text-[10px] uppercase tracking-[0.12em]"
        >
          <RefreshCw
            className={cn("h-3 w-3", state.status === "loading" && "animate-spin motion-reduce:animate-none")}
            aria-hidden
          />
          {state.status === "ready" ? "Refresh" : "Compare"}
        </Button>
      </div>

      <div className="px-4 py-3">
        {state.status === "idle" && (
          <p className="font-mono text-[11px] text-muted-foreground">
            Counts every stored lead by the scraper it came from. Runs on demand — it is not part of
            the live poll.
          </p>
        )}

        {state.status === "loading" && (
          <p className="font-mono text-[11px] text-muted-foreground">Counting…</p>
        )}

        {state.status === "error" && (
          <p className="font-mono text-[11px] text-destructive">{state.message}</p>
        )}

        {state.status === "ready" && rows.length === 0 && (
          <p className="font-mono text-[11px] text-muted-foreground">No leads stored yet.</p>
        )}

        {state.status === "ready" && rows.length > 0 && (
          <div className="flex flex-col gap-3">
            <div className="-mx-1 overflow-x-auto">
              <table className="w-full min-w-[520px] border-separate border-spacing-x-1 border-spacing-y-0">
                <thead>
                  <tr className="text-left">
                    <th className="pb-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                      Source
                    </th>
                    {["Leads", "With email", "Emailable", "Website", "Phone", "Engaged"].map((h) => (
                      <th
                        key={h}
                        className="pb-1.5 text-right font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.source} className="border-t border-border">
                      <td className="py-1.5 text-[13px] font-semibold text-foreground">
                        {SOURCE_LABEL[s.source]}
                      </td>
                      <td className="tnum py-1.5 text-right font-mono text-[13px] text-foreground">
                        {formatInt(s.total)}
                      </td>
                      <td className="tnum py-1.5 text-right font-mono text-[13px] text-foreground">
                        {formatInt(s.withEmail)}
                      </td>
                      {/* the rate that decides whether a source is worth scraping */}
                      <td
                        className={cn(
                          "tnum py-1.5 text-right font-mono text-[13px] font-semibold",
                          s.withEmail > 0 ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {rate(s.withEmail, s.total)}
                      </td>
                      <td className="tnum py-1.5 text-right font-mono text-[13px] text-muted-foreground">
                        {rate(s.withWebsite, s.total)}
                      </td>
                      <td className="tnum py-1.5 text-right font-mono text-[13px] text-muted-foreground">
                        {rate(s.withPhone, s.total)}
                      </td>
                      <td className="tnum py-1.5 text-right font-mono text-[13px] text-muted-foreground">
                        {state.engagedAvailable ? formatInt(s.engaged) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              Source is read from each lead&apos;s maps URL, so these cover every row ever imported.
              Send outcomes per source (sent / clicked / replied) are not here — that needs a join to
              portal_events, which has no key back to leads.
              {!state.engagedAvailable && " Engaged is unavailable until the portal telemetry migration runs."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
