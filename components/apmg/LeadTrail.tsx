"use client";

import {
  Activity,
  ChevronRight,
  Eye,
  FileDown,
  Globe,
  LayoutGrid,
  Mail,
  MessageCircle,
  Send,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { eventKind, eventLabel, type LeadActivityEvent, type LeadEventKind } from "@/lib/data/leadActivity";

/**
 * The shared visual grammar for a lead's click trail — one icon + tone per event
 * kind, the compact horizontal chip trail, and the expanded textual timeline.
 *
 * Lifted out of TelemetryPage so every surface that shows a trail (the Telemetry
 * activity list and the Enquiries tab's per-enquiry modal) reads identically: an
 * enquiry is the loudest mark on the page wherever it appears, a download always
 * looks like a download. Same reason lib/data/leadScore.ts was lifted out — two
 * surfaces disagreeing about what an event means is a bug, not a style choice.
 */

/** Absolute stamp for timeline lines, e.g. "4 Jul, 2:38 pm" (en-AU). */
export function fmtStamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Icon + chip tone per event kind. The enquiry chip is the loudest thing on
 *  the page (solid signal red) — it's the money event; downloads get a red
 *  outline (strong intent); everything else stays quiet neutral so the trail
 *  reads as texture with the conversions popping out of it. */
export const KIND_META: Record<LeadEventKind, { icon: LucideIcon; chip: string }> = {
  email: { icon: Mail, chip: "border-border bg-background text-muted-foreground" },
  download: { icon: FileDown, chip: "border-primary/40 bg-background text-primary" },
  view: { icon: Eye, chip: "border-border bg-background text-muted-foreground" },
  service: { icon: LayoutGrid, chip: "border-border bg-muted text-foreground" },
  chat: { icon: MessageCircle, chip: "border-border bg-muted text-foreground" },
  enquiry: { icon: Send, chip: "border-transparent bg-primary-solid text-primary-foreground" },
  website: { icon: Globe, chip: "border-border bg-background text-muted-foreground" },
  consent: { icon: ShieldCheck, chip: "border-border bg-background text-muted-foreground" },
  other: { icon: Activity, chip: "border-dashed border-border bg-background text-muted-foreground" },
};

/** How many chips the compact trail shows before folding the OLDEST clicks
 *  into a "+N" stub — recency matters most, and the expanded timeline always
 *  has the full story. */
export const TRAIL_MAX = 10;

/**
 * Compact horizontal trail: one icon chip per event, chronological left →
 * right with tiny arrows between. Marked aria-hidden as a whole — it's a
 * visual summary; screen readers get the counts in the row's aria-label and
 * the full textual timeline behind the expand toggle.
 */
export function EventTrail({ events }: { events: LeadActivityEvent[] }) {
  const shown = events.length > TRAIL_MAX ? events.slice(events.length - TRAIL_MAX) : events;
  const folded = events.length - shown.length;
  return (
    // <span>, not <div>: this renders inside the row's <button>, which only
    // permits phrasing content — a div would be invalid HTML there.
    <span className="flex min-w-0 flex-wrap items-center gap-y-1.5" aria-hidden>
      {folded > 0 && (
        <span className="tnum mr-1 inline-flex h-6 shrink-0 items-center rounded-full border border-border bg-background px-2 font-mono text-[9.5px] text-muted-foreground">
          +{folded}
        </span>
      )}
      {shown.map((ev, i) => {
        const kind = eventKind(ev);
        const Icon = KIND_META[kind].icon;
        return (
          <span key={`${ev.ts}-${i}`} className="flex items-center">
            {(i > 0 || folded > 0) && (
              <ChevronRight className="mx-0.5 h-3 w-3 shrink-0 text-muted-foreground/40" />
            )}
            <span
              title={`${eventLabel(ev)} · ${fmtStamp(ev.ts)}`}
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
                KIND_META[kind].chip,
              )}
            >
              <Icon className="h-3 w-3" />
            </span>
          </span>
        );
      })}
    </span>
  );
}

/** One line of the expanded timeline: stamp · icon dot (with connector rail)
 *  · plain-English label. Enquiries render emphasised in signal red. */
export function TimelineLine({ ev, last }: { ev: LeadActivityEvent; last: boolean }) {
  const kind = eventKind(ev);
  const Icon = KIND_META[kind].icon;
  return (
    <li className="flex gap-3">
      <span className="tnum w-24 shrink-0 pt-1 text-right font-mono text-[10px] leading-4 text-muted-foreground">
        {fmtStamp(ev.ts)}
      </span>
      <span className="flex flex-col items-center" aria-hidden>
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full border",
            KIND_META[kind].chip,
          )}
        >
          <Icon className="h-3 w-3" />
        </span>
        {!last && <span className="w-px flex-1 bg-border/70" />}
      </span>
      <span
        className={cn(
          "min-w-0 pt-1 text-[12.5px] leading-4",
          last ? "pb-1" : "pb-4",
          kind === "enquiry" ? "font-semibold text-primary" : "text-foreground/90",
        )}
      >
        {eventLabel(ev)}
      </span>
    </li>
  );
}
