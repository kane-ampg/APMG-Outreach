"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Inbox,
  LayoutGrid,
  MousePointerClick,
  RefreshCw,
  Send,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEMO_ACTIVITY_TOTALS,
  DEMO_ANONYMOUS,
  DEMO_LEAD_ACTIVITY,
  isHiddenEvent,
  serviceName,
  type ActivityTotals,
  type AnonymousActivity,
  type LeadActivity,
  type LeadActivityEvent,
} from "@/lib/data/leadActivity";
import { EventTrail, TimelineLine, fmtStamp } from "./LeadTrail";
import { leadScore, scoreTier } from "@/lib/data/leadScore";
import {
  ackAllLeadActivity,
  ackLeadActivity,
  forgetLeadActivity,
  ingestLeadActivity,
  useLeadActivityUnseenByLead,
  useLeadActivityUnseenTotal,
} from "@/lib/data/leadActivityNotifications";
import { formatInt } from "@/lib/format";
import { adminHeaders, saveAdminKey } from "@/lib/portal/adminKey";
import { useCountUp } from "@/lib/useCountUp";
import { Button } from "@/components/ui/button";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { TelemetryReportExport } from "./TelemetryReportExport";

/**
 * System → Telemetry tab — WHO clicked WHAT. Reads two endpoints on mount,
 * then keeps them live with a silent visible-tab poll (POLL_MS) + an instant
 * refetch on window focus; the Refresh button remains as the loud manual pull:
 *
 *   GET /api/portal/lead-activity → per-lead click trails + anonymous rollup
 *   GET /api/portal/summary       → funnel totals for the KPI row
 *
 * The heart of the page is the lead-activity list: one row per attributed
 * lead (someone who opened a tracked outreach email), with a compact
 * horizontal event trail (icon chips, chronological left → right) and an
 * expandable full timeline in plain English ("Clicked the email link" →
 * "Viewed Painting Services" → "Sent an enquiry — Painting Services").
 * Attribution exists because /t/[id] set the apmg_ref cookie; the API
 * allowlists the customer-journey event names on both streams, so internal
 * dashboard click noise (an operator test-clicking a tracked link carries the
 * cookie too) never pollutes a lead's trail or the anonymous block. On top of
 * that, browsers that have opened this dashboard carry the apmg_internal
 * cookie (middleware.ts) and the telemetry writers drop their traffic
 * entirely — so the operator's own portal browsing and link test-clicks never
 * enter these trails at all. Client clicks only.
 *
 * Live mode names leads (uuid + business + click trail), so the API requires
 * the shared PORTAL_ADMIN_KEY — same key as the Enquiries tab, entered once
 * on whichever tab asks first (lib/portal/adminKey → localStorage).
 *
 * Each row carries a per-row delete (trash → inline confirm strip, the
 * StoredLeads grammar) that erases that lead's portal_events rows via
 * DELETE /api/portal/lead-activity?leadId=… — activity only, never the lead.
 *
 * A secondary card aggregates portal visitors with NO attribution cookie —
 * real interest we can't pin to an outreach lead. `mode:"demo"` (no Supabase,
 * or the portal tables not migrated) swaps in the believable Melbourne
 * dataset from lib/data/leadActivity.ts behind an amber banner — the tab
 * never crashes.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Silent background refetch cadence — the page is "realtime" by short poll
 *  (the app's grammar everywhere else, e.g. useLeadStats; no websocket infra),
 *  paused while the tab is hidden and topped up on focus. */
const POLL_MS = 10000;

/** Lead-activity list page size — the panel paginates past this. */
const PAGE_SIZE = 25;

/* ───────────────────────────  interest filtering  ─────────────────────────── */

/**
 * How the Lead activity list is ordered — "where the most interest lies". The
 * default stays "recent" (the live API already sorts lastSeen-desc), but an
 * operator hunting the hottest leads can re-rank by raw engagement (event
 * count) or push the money events (enquiries, then service opens) to the top.
 */
type SortKey = "recent" | "engaged" | "enquired";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "recent", label: "Latest" },
  { id: "engaged", label: "Most active" },
  { id: "enquired", label: "Hottest" },
];

/** Visible (non-hidden) event count — the "how active" measure the list ranks
 *  and filters on, matching the number the row itself shows. */
function activeEventCount(lead: LeadActivity): number {
  return lead.events.reduce((n, e) => n + (isHiddenEvent(e.event) ? 0 : 1), 0);
}

/** Sentinel for the "all sectors" chip (no `category` filter applied). */
const ALL_SECTORS = "__all__";

/* ───────────────────────────  load state  ─────────────────────────── */

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string; unauthorized?: boolean }
  | {
      status: "ready";
      mode: "live" | "demo";
      needsMigration: boolean;
      leads: LeadActivity[];
      anonymous: AnonymousActivity;
      totals: ActivityTotals;
    };

/* ─────────────────────  defensive payload normalisers  ───────────────────── */

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Rebuild one lead field-by-field so a partial/odd payload can never leave an
 *  undefined array or non-string ts behind (the trail `.map`s would throw). */
function toLead(v: unknown): LeadActivity | null {
  const o = (v ?? {}) as Partial<LeadActivity>;
  if (typeof o.leadId !== "string" || !o.leadId) return null;
  const events: LeadActivityEvent[] = (Array.isArray(o.events) ? o.events : [])
    .filter((e): e is LeadActivityEvent => {
      const ev = (e ?? {}) as Partial<LeadActivityEvent>;
      return typeof ev.event === "string" && typeof ev.ts === "string";
    })
    .map((e) => ({
      event: e.event,
      service: str(e.service),
      destination: str(e.destination),
      ts: e.ts,
    }));
  const c = (o.counts ?? {}) as Partial<LeadActivity["counts"]>;
  return {
    leadId: o.leadId,
    business: str(o.business),
    category: str(o.category),
    campaign: str(o.campaign),
    firstSeen: str(o.firstSeen) ?? events[0]?.ts ?? "",
    lastSeen: str(o.lastSeen) ?? events[events.length - 1]?.ts ?? "",
    events,
    counts: {
      emailClicks: num(c.emailClicks),
      portalViews: num(c.portalViews),
      serviceOpens: num(c.serviceOpens),
      chatPrompts: num(c.chatPrompts),
      inquiries: num(c.inquiries),
    },
  };
}

function toAnonymous(v: unknown): AnonymousActivity {
  const o = (v ?? {}) as Partial<AnonymousActivity>;
  return {
    visitors: num(o.visitors),
    events: num(o.events),
    topServices: (Array.isArray(o.topServices) ? o.topServices : [])
      .filter((s): s is { service: string; opens: number } => {
        const t = (s ?? {}) as { service?: unknown };
        return typeof t.service === "string" && !!t.service;
      })
      .map((s) => ({ service: s.service, opens: num(s.opens) })),
  };
}

/* ───────────────────────────  small display helpers  ─────────────────────────── */

/** Relative "when" (en-AU day-month once it's older than a week) — same
 *  grammar as the Enquiries tab so "last seen" reads identically app-wide. */
function fmtWhen(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(t).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

/** Row title when the lead row was deleted since the click (spec fallback). */
function leadDisplayName(lead: LeadActivity): string {
  return lead.business ?? `Lead ${lead.leadId.slice(0, 8)}…`;
}

const ratio = (count: number, total: number) => (total > 0 ? count / total : 0);

/* Event-kind visuals (KIND_META), the compact EventTrail and the expanded
   TimelineLine live in ./LeadTrail — shared with the Enquiries tab's activity
   modal so a trail reads the same on both surfaces. */

/* ───────────────────────────  KPI cards  ─────────────────────────── */

interface TelemetryStat {
  id: string;
  label: string;
  value: number;
  icon: LucideIcon;
  caption: string;
  /** proportion foot, 0–1 (stays in the red family, like KpiCard's RatioBar) */
  ratio: { value: number; label: string } | null;
}

/** Labelled proportion bar — same anatomy as KpiCard's (not exported there). */
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
 * KPI gauge following KpiCard's instrument anatomy (tiny-caps label, tnum
 * count-up hero readout, proportion foot on a shared baseline) but with a
 * lucide icon chip instead of the LED — the same local variant EnquiriesPage
 * uses, because KpiCard itself is shared by every dashboard surface.
 */
function StatCard({ stat }: { stat: TelemetryStat }) {
  const display = useCountUp(stat.value, "int", formatInt(stat.value));
  const Icon = stat.icon;
  return (
    <button
      type="button"
      data-track="telemetry_kpi"
      data-track-kpi={stat.id}
      aria-label={`${stat.label}: ${formatInt(stat.value)}`}
      className="group flex h-full flex-col bg-card p-5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))]"
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {stat.label}
        </span>
        <span
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary"
          aria-hidden
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
      </div>
      <div className="tnum mt-3 font-mono text-[34px] font-semibold leading-none tracking-tight text-foreground sm:text-[40px]">
        {display}
      </div>
      <div className="mt-2 truncate text-[11px] text-muted-foreground">{stat.caption}</div>
      {/* mt-auto pins the foot to a shared baseline across the panel (KpiCard) */}
      <div className="mt-auto pt-4">
        {stat.ratio ? <RatioBar value={stat.ratio.value} label={stat.ratio.label} /> : null}
      </div>
    </button>
  );
}

/** Skeleton mirroring the fused KPI panel while both endpoints are in flight. */
function KpiPanelSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-4">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="flex h-full flex-col bg-card p-5" aria-busy>
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-[34px] w-3/4 animate-pulse rounded bg-muted sm:h-[40px]" />
          <div className="mt-2 h-3 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-auto pt-4">
            <div className="h-7 w-full animate-pulse rounded bg-muted/60" />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────  shared panel chrome  ─────────────────────────── */

/** Hairline panel head, same grammar as RecentLeadsTable / EnquiriesPage. */
function PanelHead({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>
      {meta}
    </div>
  );
}

function PanelEmpty({ icon: Icon, hint }: { icon: LucideIcon; hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-[18rem] font-mono text-[10.5px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/* ───────────────────────────  lead row  ─────────────────────────── */

/** This row's delete flow: null = quiet, "confirm" = strip shown, "busy" =
 *  the DELETE request is in flight. */
type DeletePhase = "confirm" | "busy" | null;

/** Memoised (ui-standards §5.2): expanding one row must not re-render the
 *  other ninety-nine trails. */
const LeadRow = memo(function LeadRow({
  lead,
  open,
  unseen,
  onToggle,
  deletePhase,
  deleteError,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  lead: LeadActivity;
  open: boolean;
  /** New (unacknowledged) customer events on this lead — drives the blinking
   *  red dot. Cleared by toggling the row (that's the acknowledgement). */
  unseen: number;
  onToggle: (leadId: string) => void;
  deletePhase: DeletePhase;
  deleteError: string | null;
  onDeleteRequest: (leadId: string) => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: (leadId: string) => void;
}) {
  const reduce = useReducedMotion();
  // The client-dup enquiry event is hidden EVERYWHERE (trail, timeline, event
  // count) so the numbers a user can verify by counting chips always agree.
  const visible = useMemo(() => lead.events.filter((e) => !isHiddenEvent(e.event)), [lead.events]);
  const name = leadDisplayName(lead);
  const score = leadScore(lead);
  const tier = scoreTier(score);

  return (
    <li className="border-t border-border/70 first:border-t-0">
      {/* Row header: the expand toggle and the delete affordance are SIBLING
          buttons (a button can't nest a button), fused by the flex wrapper. */}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => {
            // Toggling the row IS the acknowledgement — the blinking dot (and
            // its share of the nav badge) falls away once the operator looks.
            ackLeadActivity(lead.leadId, lead.lastSeen);
            onToggle(lead.leadId);
          }}
          aria-expanded={open}
          data-track="telemetry_lead_toggle"
          data-track-lead={lead.leadId}
          aria-label={`${name}: intent score ${score} of 100, ${tier.label}. ${visible.length} ${visible.length === 1 ? "event" : "events"}${unseen > 0 ? ` (${unseen} new)` : ""}, last seen ${fmtWhen(lead.lastSeen)}. ${open ? "Collapse" : "Expand"} timeline`}
          className="flex min-w-0 flex-1 flex-col gap-2.5 px-4 py-3.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))] md:grid md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto] md:items-center md:gap-3"
        >
          {/* identity: business + sector/campaign chips */}
          <span className="block min-w-0">
            <span className="flex min-w-0 items-center gap-2">
              {/* new-activity dot: blinks until the row is toggled (acked) */}
              {unseen > 0 && (
                <span
                  aria-hidden
                  title={`${unseen} new ${unseen === 1 ? "event" : "events"}`}
                  className="h-2 w-2 shrink-0 rounded-full bg-primary-solid motion-safe:animate-notify-blink"
                />
              )}
              <span
                className={cn(
                  "truncate text-[13px] font-medium",
                  lead.business ? "text-foreground" : "font-mono text-muted-foreground",
                )}
              >
                {name}
              </span>
              {/* intent score — the hotter the lead the louder the chip; an
                  enquiry always lands in the top (Hottest) band. */}
              <span
                title={`Intent score ${score}/100 · ${tier.label}`}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em]",
                  tier.chip,
                )}
              >
                <span className="tnum">{score}</span>
                <span className={cn("font-medium normal-case tracking-normal", tier.ring)}>
                  {tier.label}
                </span>
              </span>
            </span>
            <span className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
              {lead.category && (
                <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {lead.category}
                </span>
              )}
              {lead.campaign && (
                <span className="inline-flex max-w-full items-center truncate rounded-full border border-primary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-primary">
                  {lead.campaign}
                </span>
              )}
            </span>
          </span>

          {/* the trail itself */}
          <EventTrail events={visible} />

          {/* meta: event count · last seen · expand cue */}
          <span className="flex shrink-0 items-center justify-between gap-3 md:justify-end">
            <span
              className="tnum font-mono text-[10.5px] text-muted-foreground"
              title={fmtStamp(lead.lastSeen)}
            >
              {formatInt(visible.length)} {visible.length === 1 ? "event" : "events"} ·{" "}
              {fmtWhen(lead.lastSeen)}
            </span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                open && "rotate-180",
              )}
              aria-hidden
            />
          </span>
        </button>

        {/* per-row delete: quiet trash that only turns destructive on hover;
            the actual delete sits behind the confirm strip below. */}
        <button
          type="button"
          onClick={() => (deletePhase ? onDeleteCancel() : onDeleteRequest(lead.leadId))}
          disabled={deletePhase === "busy"}
          aria-label={`Delete ${name}'s click activity`}
          data-track="telemetry_lead_delete"
          data-track-lead={lead.leadId}
          className="flex shrink-0 items-center border-l border-border/70 px-3 text-muted-foreground/70 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      </div>

      {/* inline destructive confirm (StoredLeads grammar) — a stray click on
          the trash can't wipe a trail; Delete here is the real action. */}
      {deletePhase && (
        <div className="flex flex-wrap items-center gap-2 border-t border-destructive/40 bg-destructive/[0.04] px-4 py-2">
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <span className="text-[12px] text-foreground">
            Permanently delete {name}&rsquo;s click activity?
          </span>
          {deleteError && (
            <span role="alert" className="font-mono text-[10.5px] text-destructive">
              {deleteError}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onDeleteCancel}
              disabled={deletePhase === "busy"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDeleteConfirm(lead.leadId)}
              disabled={deletePhase === "busy"}
              data-track="telemetry_lead_delete_confirm"
              data-track-lead={lead.leadId}
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {deletePhase === "busy" ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}

      {/* expanded full timeline */}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: reduce ? 0.1 : 0.26, ease: EASE }}
            className="overflow-hidden"
          >
            <ol className="border-t border-border/70 bg-background/40 px-4 pb-4 pt-3">
              {visible.map((ev, i) => (
                <TimelineLine key={`${ev.ts}-${i}`} ev={ev} last={i === visible.length - 1} />
              ))}
            </ol>
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  );
});

function LeadListSkeleton() {
  return (
    <div className="space-y-0" aria-busy>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="border-t border-border/70 px-4 py-3.5 first:border-t-0">
          <div className="flex items-center justify-between gap-3">
            <div className="h-3.5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted/70" />
          </div>
          <div className="mt-2.5 flex gap-1.5">
            {Array.from({ length: 5 }).map((_, j) => (
              <div key={j} className="h-6 w-6 animate-pulse rounded-full bg-muted/60" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ───────────────────────────  anonymous visitors card  ─────────────────────────── */

function AnonymousPanel({ anonymous }: { anonymous: AnonymousActivity }) {
  const max = Math.max(1, ...anonymous.topServices.map((s) => s.opens));
  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead
        title="Anonymous portal visitors"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            untracked
          </span>
        }
      />
      <div className="flex flex-1 flex-col px-4 py-4">
        {/* twin readouts, fused like the KPI panel */}
        <div className="grid grid-cols-2 divide-x divide-border overflow-hidden rounded-lg border border-border bg-background">
          <div className="p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Visitors
            </div>
            <div className="tnum mt-1.5 font-mono text-2xl font-semibold leading-none tracking-tight text-foreground">
              {formatInt(anonymous.visitors)}
            </div>
          </div>
          <div className="p-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Events
            </div>
            <div className="tnum mt-1.5 font-mono text-2xl font-semibold leading-none tracking-tight text-foreground">
              {formatInt(anonymous.events)}
            </div>
          </div>
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Portal visitors who didn&rsquo;t arrive via a tracked outreach email — real interest,
          but with no lead identity to pin the clicks to.
        </p>

        {anonymous.topServices.length > 0 ? (
          <div className="mt-4">
            <div
              className="flex items-center justify-between border-b border-border/70 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              aria-hidden
            >
              <span>Top services</span>
              <span>opens</span>
            </div>
            <ul className="mt-2 space-y-2.5">
              {anonymous.topServices.map((s) => (
                <li key={s.service}>
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-foreground">
                      {serviceName(s.service)}
                    </span>
                    <span className="tnum shrink-0 font-mono text-[11px] text-foreground">
                      {formatInt(s.opens)}
                    </span>
                  </div>
                  <div
                    className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border"
                    role="img"
                    aria-label={`${serviceName(s.service)}: ${s.opens} opens`}
                  >
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${(s.opens / max) * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="mt-4 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            No anonymous browsing yet — service opens land here once untracked visitors start
            exploring the portal.
          </p>
        )}
      </div>
    </section>
  );
}

function AnonymousSkeleton() {
  return (
    <section
      className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10"
      aria-busy
    >
      <PanelHead title="Anonymous portal visitors" />
      <div className="space-y-3 px-4 py-4">
        <div className="h-16 w-full animate-pulse rounded-lg bg-muted/60" />
        <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="mt-1.5 h-1 w-full animate-pulse rounded-full bg-muted/70" />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────  page  ─────────────────────────── */

/** Loose response shapes — both payloads are re-validated field-by-field. */
interface ActivityPayload {
  ok?: boolean;
  mode?: string;
  needsMigration?: boolean;
  leads?: unknown;
  anonymous?: unknown;
  error?: string;
}
interface SummaryPayload {
  mode?: string;
  needsMigration?: boolean;
  totals?: Record<string, unknown>;
  error?: string;
}

export function TelemetryPage() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Lead-activity list page (0-based). Never trusted directly — the render
   *  clamps it, so a shrinking list (deletes, refetch) can't strand the view
   *  on a page that no longer exists. */
  const [page, setPage] = useState(0);
  /** How the list is ranked — the "where's the interest" control. */
  const [sort, setSort] = useState<SortKey>("recent");
  /** Sector narrowing (a lead `category`, or ALL_SECTORS for no filter). */
  const [sector, setSector] = useState<string>(ALL_SECTORS);
  /** Per-lead NEW (unacknowledged) event counts — the blinking row dots. */
  const unseenByLead = useLeadActivityUnseenByLead();
  /** Total unseen customer events — drives the nav badge; here it gates (and
   *  labels) the "Clear notifications" button. */
  const unseenTotal = useLeadActivityUnseenTotal();
  /** True while a MANUAL refresh is in flight — the page stays "ready" during
   *  one, so the button needs its own flag to spin (feedback that the click
   *  landed even when the data comes back unchanged). */
  const [refreshing, setRefreshing] = useState(false);
  /** Access-key field shown when the lead-activity API answers 401. */
  const [keyInput, setKeyInput] = useState("");
  /** At most ONE row's delete flow is open at a time. */
  const [deleteFlow, setDeleteFlow] = useState<{
    id: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const mountedRef = useRef(true);
  /** Mirror of `mode` for the delete callback (kept stable with [] deps). */
  const demoRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Refetch both endpoints. `silent` marks the background/realtime polls:
   *  a ready page must never flip to a skeleton or an error screen over one
   *  transient blip — realtime degrades to "slightly stale", not to red. */
  const fetchAll = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    setLoad((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    /** Error/skeleton states only land when the page isn't already showing data
     *  (or the operator explicitly asked via Refresh/Retry — non-silent). */
    const fail = (next: LoadState) =>
      setLoad((prev) => (silent && prev.status === "ready" ? prev : next));
    /** Ready states swap in only when the payload actually changed — polling
     *  every few seconds must not re-render ~100 memoised rows for nothing. */
    const settle = (next: LoadState) =>
      setLoad((prev) =>
        prev.status === "ready" && JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    try {
      const [actRes, sumRes] = await Promise.all([
        fetch("/api/portal/lead-activity", { cache: "no-store", headers: adminHeaders() }),
        fetch("/api/portal/summary", { cache: "no-store" }),
      ]);
      const act = (await actRes.json().catch(() => null)) as ActivityPayload | null;
      const sum = (await sumRes.json().catch(() => null)) as SummaryPayload | null;
      if (!mountedRef.current) return;

      // Demo (no Supabase / tables missing) → the believable Melbourne preset.
      // Either endpoint answering "demo" flips the whole page: they read the
      // same Supabase target, so a split verdict means misconfiguration, and
      // half-live numbers over demo trails would lie. needsMigration is OR-ed
      // across BOTH payloads so a partially-run migration (portal_events
      // present, portal_inquiries missing → summary demo, activity live) still
      // gets the truthful "run the SQL" banner, not "connect Supabase".
      if (act?.mode === "demo" || sum?.mode === "demo") {
        settle({
          status: "ready",
          mode: "demo",
          needsMigration: act?.needsMigration === true || sum?.needsMigration === true,
          leads: DEMO_LEAD_ACTIVITY,
          anonymous: DEMO_ANONYMOUS,
          totals: DEMO_ACTIVITY_TOTALS,
        });
        return;
      }
      // 401 = the shared-secret gate on the per-lead read — surface the access
      // key prompt instead of a dead-end error.
      if (actRes.status === 401) {
        fail({
          status: "error",
          unauthorized: true,
          error: act?.error ?? "An access key is required to view lead activity.",
        });
        return;
      }
      if (!actRes.ok || !act) {
        fail({
          status: "error",
          error: act?.error ?? `Couldn't load lead activity (${actRes.status}).`,
        });
        return;
      }
      if (!sumRes.ok || !sum?.totals) {
        fail({
          status: "error",
          error: sum?.error ?? `Couldn't load the portal summary (${sumRes.status}).`,
        });
        return;
      }
      const leads = (Array.isArray(act.leads) ? act.leads : [])
        .map(toLead)
        .filter((l): l is LeadActivity => l !== null);
      // Feed the notification store the same data this page renders so the
      // row dots / nav badge never lag behind what's on screen.
      ingestLeadActivity(leads);
      settle({
        status: "ready",
        mode: "live",
        needsMigration: false,
        leads,
        anonymous: toAnonymous(act.anonymous),
        totals: {
          attributionClicks: num(sum.totals.attributionClicks),
          portalViews: num(sum.totals.portalViews),
          serviceOpens: num(sum.totals.serviceOpens),
          inquiries: num(sum.totals.inquiries),
        },
      });
    } catch {
      if (mountedRef.current) {
        fail({ status: "error", error: "Network error loading click activity." });
      }
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** The Refresh button's loud pull — spins the icon for the whole round trip. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fetchAll();
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [fetchAll]);

  // Realtime: silent background poll while the tab is visible, plus an
  // immediate pull the moment the window regains focus/visibility. Silent so
  // mid-session blips never flash skeletons or error screens — the Refresh
  // button stays as the loud on-demand pull.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") fetchAll({ silent: true });
    };
    const id = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [fetchAll]);

  const toggleLead = useCallback((leadId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }, []);

  /* ── per-row delete flow ─────────────────────────────────────────────── */

  const requestDelete = useCallback((leadId: string) => {
    setDeleteFlow({ id: leadId, busy: false, error: null });
  }, []);

  const cancelDelete = useCallback(() => {
    setDeleteFlow((prev) => (prev?.busy ? prev : null));
  }, []);

  /** Drop one lead's rows client-side (shared by the live and demo paths). */
  const removeLeadLocally = useCallback((leadId: string) => {
    // Deleted activity can't stay "new" — clear its dot/badge share too.
    forgetLeadActivity(leadId);
    setDeleteFlow(null);
    setExpanded((prev) => {
      if (!prev.has(leadId)) return prev;
      const next = new Set(prev);
      next.delete(leadId);
      return next;
    });
    setLoad((prev) =>
      prev.status === "ready"
        ? { ...prev, leads: prev.leads.filter((l) => l.leadId !== leadId) }
        : prev,
    );
  }, []);

  const confirmDelete = useCallback(
    async (leadId: string) => {
      // Demo rows are a client constant (ids aren't uuids, and a refetch would
      // resurrect them) — just drop the row locally so the control still works.
      if (demoRef.current) {
        removeLeadLocally(leadId);
        return;
      }
      setDeleteFlow({ id: leadId, busy: true, error: null });
      try {
        const res = await fetch(`/api/portal/lead-activity?leadId=${encodeURIComponent(leadId)}`, {
          method: "DELETE",
          headers: adminHeaders(),
        });
        const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
        if (!mountedRef.current) return;
        if (!res.ok || !data?.ok) {
          setDeleteFlow({
            id: leadId,
            busy: false,
            error: data?.error ?? `Delete failed (${res.status}).`,
          });
          return;
        }
        removeLeadLocally(leadId);
        // The rows are gone server-side too, so a silent refetch can only
        // agree — it's here to pull the KPI totals back in line.
        fetchAll({ silent: true });
      } catch {
        if (mountedRef.current) {
          setDeleteFlow({ id: leadId, busy: false, error: "Network error during delete." });
        }
      }
    },
    [fetchAll, removeLeadLocally],
  );

  const ready = load.status === "ready" ? load : null;
  const leads = ready?.leads ?? [];
  demoRef.current = ready?.mode === "demo";

  // Funnel gauges: engaged leads → clicks → browsing → conversions.
  const stats = useMemo<TelemetryStat[]>(() => {
    if (!ready) return [];
    const t = ready.totals;
    const enquiredLeads = leads.filter((l) => l.counts.inquiries > 0).length;
    const attributedInquiries = leads.reduce((sum, l) => sum + l.counts.inquiries, 0);
    return [
      {
        id: "engaged",
        label: "Leads engaged",
        value: leads.length,
        icon: Users,
        caption: "clicked through from outreach",
        ratio: { value: ratio(enquiredLeads, leads.length), label: "went on to enquire" },
      },
      {
        id: "clicks",
        label: "Email clicks",
        value: t.attributionClicks,
        icon: MousePointerClick,
        caption: "tracked outreach links opened",
        ratio: { value: ratio(t.portalViews, t.attributionClicks), label: "reached the portal" },
      },
      {
        id: "opens",
        label: "Services viewed",
        value: t.serviceOpens,
        icon: LayoutGrid,
        caption: "service cards opened",
        ratio: { value: ratio(t.inquiries, t.serviceOpens), label: "became enquiries" },
      },
      {
        id: "enquiries",
        label: "Enquiries",
        value: t.inquiries,
        icon: Inbox,
        caption: "qualified — email captured",
        ratio: {
          value: ratio(attributedInquiries, t.inquiries),
          label: "from tracked leads",
        },
      },
    ];
  }, [ready, leads]);

  const totalEvents = useMemo(
    () =>
      leads.reduce((sum, l) => sum + l.events.filter((e) => !isHiddenEvent(e.event)).length, 0),
    [leads],
  );

  // The sectors present in the current data — the sector-filter chips are
  // built from what's actually here (never a fixed list that offers empty
  // filters), most-active sector first so the busiest bucket leads.
  const sectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of leads) {
      if (l.category) counts.set(l.category, (counts.get(l.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name);
  }, [leads]);

  // A sector that stops existing after a refetch/delete must not strand the
  // list on an empty filter — fall back to "all" when the pick disappears.
  const activeSector = sector !== ALL_SECTORS && sectors.includes(sector) ? sector : ALL_SECTORS;

  // Filter (by sector) then rank (by the interest control). Time order is the
  // stable tie-breaker under every sort — uniform ISO-8601 UTC stamps make the
  // string compare a correct time order, and the live API already sorts
  // lastSeen-desc, but the demo preset (and payload drift) shouldn't be trusted
  // to, so "recent" re-sorts explicitly too.
  const sortedLeads = useMemo(() => {
    const byRecency = (a: LeadActivity, b: LeadActivity) =>
      a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0;
    const filtered =
      activeSector === ALL_SECTORS ? leads : leads.filter((l) => l.category === activeSector);
    const ranked = [...filtered];
    if (sort === "engaged") {
      ranked.sort((a, b) => activeEventCount(b) - activeEventCount(a) || byRecency(a, b));
    } else if (sort === "enquired") {
      // Straight by intent score — same number the row badge shows, so the top
      // of "Hottest" is exactly the highest-scoring lead (enquirers first,
      // since an enquiry always lands in the top band). Recency breaks ties.
      ranked.sort((a, b) => leadScore(b) - leadScore(a) || byRecency(a, b));
    } else {
      ranked.sort(byRecency);
    }
    return ranked;
  }, [leads, activeSector, sort]);
  const pageCount = Math.max(1, Math.ceil(sortedLeads.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedLeads = useMemo(
    () => sortedLeads.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [sortedLeads, safePage],
  );

  // Changing the sort or sector re-frames the list — jump back to its first
  // page so the top of the new ranking is what's on screen.
  useEffect(() => {
    setPage(0);
  }, [sort, activeSector]);

  // "Last signal" is the freshest lead overall, independent of the current
  // ranking/filter, so it stays a true clock even under "Hottest" or a sector.
  const lastSignal = useMemo(
    () => leads.reduce<string | null>((max, l) => (!max || l.lastSeen > max ? l.lastSeen : max), null),
    [leads],
  );

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      {/* ── header row ─────────────────────────────────────────────────── */}
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              System — who clicked what
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Telemetry
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Every attributed lead&rsquo;s click trail, from the outreach email to the enquiry.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <div>Last signal</div>
              <div className="tnum text-foreground/80">
                {lastSignal ? fmtWhen(lastSignal) : "—"}
              </div>
            </div>
            {/* Clear notifications — acknowledges EVERY lead at once, so the nav
                badge and all row dots fall away together (the bulk equivalent of
                expanding each row). Only present when there's something unseen;
                carries the signal-red accent that means "new activity" app-wide. */}
            {unseenTotal > 0 && (
              <button
                type="button"
                onClick={() => ackAllLeadActivity()}
                data-track="telemetry_clear_notifications"
                aria-label={`Clear ${formatInt(unseenTotal)} new-activity ${unseenTotal === 1 ? "notification" : "notifications"}`}
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden />
                Clear <span className="tnum">{formatInt(unseenTotal)}</span>
              </button>
            )}
            <TelemetryReportExport demo={ready?.mode === "demo"} />
            <button
              type="button"
              onClick={() => refresh()}
              data-track="telemetry_refresh"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  (refreshing || load.status === "loading") && "animate-spin",
                )}
                aria-hidden
              />
              Refresh
            </button>
          </div>
        </div>
      </Reveal>

      {/* ── demo banner (the app's amber demo-banner grammar) ──────────── */}
      {ready?.mode === "demo" && (
        <Reveal className="mb-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <p className="font-mono text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
              {ready.needsMigration
                ? "Demo data — the portal telemetry tables are missing. Run supabase/portal-telemetry.sql in the Supabase SQL editor to go live."
                : "Demo data — connect Supabase and run supabase/portal-telemetry.sql to see live click activity."}
            </p>
          </div>
        </Reveal>
      )}

      {load.status === "error" ? (
        <Reveal>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden />
            </span>
            <h2 className="text-base font-semibold text-foreground">
              {load.unauthorized ? "Access key required" : "Couldn’t load click activity"}
            </h2>
            <p
              role="alert"
              className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {load.error}
            </p>
            {load.unauthorized && (
              /* Shared-secret unlock: live lead activity names leads (uuid +
                 business + click trail), so the API requires the same
                 PORTAL_ADMIN_KEY as the Enquiries tab. Entered once here,
                 kept in localStorage, sent as a header on every GET. */
              <form
                className="flex w-full max-w-xs items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveAdminKey(keyInput.trim());
                  setKeyInput("");
                  fetchAll();
                }}
              >
                <label htmlFor="telemetry-access-key" className="sr-only">
                  Access key
                </label>
                <input
                  id="telemetry-access-key"
                  type="password"
                  autoComplete="off"
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Access key"
                  className="h-8 w-full rounded-lg border border-input bg-background px-3 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring"
                />
                <Button
                  type="submit"
                  size="sm"
                  disabled={!keyInput.trim()}
                  data-track="telemetry_unlock"
                  className="shrink-0 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                >
                  Unlock
                </Button>
              </form>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchAll()}
              data-track="telemetry_retry"
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        </Reveal>
      ) : (
        <>
          {/* ── KPI row, fused instrument panel (OverviewPage grammar) ──── */}
          <Reveal delay={0.04}>
            {ready ? (
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-4">
                {stats.map((stat) => (
                  <StatCard key={stat.id} stat={stat} />
                ))}
              </div>
            ) : (
              <KpiPanelSkeleton />
            )}
          </Reveal>

          {/* ── lead trails + anonymous rollup ──────────────────────────── */}
          <div className="mt-3 grid grid-cols-1 items-start gap-3 lg:grid-cols-[1.7fr_1fr]">
            <Reveal delay={0.1} className="min-w-0">
              <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
                <PanelHead
                  title="Lead activity"
                  meta={
                    <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {ready
                        ? activeSector === ALL_SECTORS
                          ? `${formatInt(leads.length)} ${leads.length === 1 ? "lead" : "leads"} · ${formatInt(totalEvents)} events`
                          : `${formatInt(sortedLeads.length)} of ${formatInt(leads.length)} ${leads.length === 1 ? "lead" : "leads"}`
                        : "loading"}
                    </span>
                  }
                />
                {/* interest controls: rank by engagement + narrow by sector, so
                    the operator can steer the list to where the interest is.
                    Sort is a segmented control (few, fixed options); Sector is a
                    dropdown (open-ended — grows with the sectors in the data). */}
                {ready && leads.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-border px-4 py-2.5">
                    <div
                      className="flex flex-wrap items-center gap-1.5"
                      role="group"
                      aria-label="Sort lead activity"
                    >
                      <span className="mr-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                        Sort
                      </span>
                      {SORTS.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          data-track="telemetry_sort"
                          data-track-sort={s.id}
                          onClick={() => setSort(s.id)}
                          aria-pressed={sort === s.id}
                          className={cn(
                            "rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
                            sort === s.id
                              ? "border-primary/40 bg-primary/10 text-foreground"
                              : "border-border bg-background text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                    {sectors.length > 1 && (
                      <div className="flex items-center gap-1.5">
                        <label
                          htmlFor="telemetry-sector"
                          className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground"
                        >
                          Sector
                        </label>
                        {/* Native <select> — a real dropdown that stays tidy no
                            matter how many sectors the data grows to; the caret
                            is the app's own ChevronDown behind the control. */}
                        <div className="relative">
                          <select
                            id="telemetry-sector"
                            value={activeSector}
                            onChange={(e) => setSector(e.target.value)}
                            data-track="telemetry_sector"
                            aria-label="Filter lead activity by sector"
                            className="h-7 max-w-[13rem] cursor-pointer appearance-none truncate rounded-md border border-border bg-background py-0 pl-2.5 pr-7 text-[11px] font-medium text-foreground outline-none transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <option value={ALL_SECTORS}>All sectors</option>
                            {sectors.map((s) => (
                              <option key={s} value={s}>
                                {s}
                              </option>
                            ))}
                          </select>
                          <ChevronDown
                            className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                          />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {!ready ? (
                  <LeadListSkeleton />
                ) : leads.length === 0 ? (
                  <PanelEmpty
                    icon={MousePointerClick}
                    hint="No attributed clicks yet — trails appear the moment a lead opens a tracked outreach email."
                  />
                ) : sortedLeads.length === 0 ? (
                  <PanelEmpty
                    icon={MousePointerClick}
                    hint="No leads in this sector — clear the filter to see every attributed trail."
                  />
                ) : (
                  <>
                    <ul>
                      {pagedLeads.map((lead) => (
                        <LeadRow
                          key={lead.leadId}
                          lead={lead}
                          open={expanded.has(lead.leadId)}
                          unseen={unseenByLead.get(lead.leadId) ?? 0}
                          onToggle={toggleLead}
                          deletePhase={
                            deleteFlow?.id === lead.leadId
                              ? deleteFlow.busy
                                ? "busy"
                                : "confirm"
                              : null
                          }
                          deleteError={deleteFlow?.id === lead.leadId ? deleteFlow.error : null}
                          onDeleteRequest={requestDelete}
                          onDeleteCancel={cancelDelete}
                          onDeleteConfirm={confirmDelete}
                        />
                      ))}
                    </ul>
                    {/* pager foot — only exists once the list outgrows a page */}
                    {sortedLeads.length > PAGE_SIZE && (
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                        <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          {formatInt(safePage * PAGE_SIZE + 1)}–
                          {formatInt(Math.min((safePage + 1) * PAGE_SIZE, sortedLeads.length))} of{" "}
                          {formatInt(sortedLeads.length)}
                        </span>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={safePage === 0}
                            onClick={() => setPage(safePage - 1)}
                            data-track="telemetry_page_prev"
                            className="gap-1"
                          >
                            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                            Prev
                          </Button>
                          <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Page {formatInt(safePage + 1)} / {formatInt(pageCount)}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={safePage >= pageCount - 1}
                            onClick={() => setPage(safePage + 1)}
                            data-track="telemetry_page_next"
                            className="gap-1"
                          >
                            Next
                            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </section>
            </Reveal>

            <Reveal delay={0.14} className="min-w-0">
              {ready ? <AnonymousPanel anonymous={ready.anonymous} /> : <AnonymousSkeleton />}
            </Reveal>
          </div>

          {/* pointer to the raw stream — this page is curated, that one isn't */}
          <Reveal delay={0.18}>
            <p className="mt-4 px-1 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Looking for the raw in-browser event stream (dashboard clicks included)? It still
              lives in the Telemetry drawer on the command bar.
            </p>
          </Reveal>
        </>
      )}

      <Footer />
    </div>
  );
}
