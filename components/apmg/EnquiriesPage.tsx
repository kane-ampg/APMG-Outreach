"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock,
  Copy,
  Eye,
  Inbox,
  LayoutGrid,
  MousePointerClick,
  PhoneCall,
  RefreshCw,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  DEMO_INQUIRIES,
  DEMO_SUMMARY,
  DIRECT_CATEGORY,
  INQUIRY_STATUSES,
  isInquiryStatus,
  salesCanSeeEnquiry,
  serviceLabel,
  sourceLabel,
  type InquiryStatus,
  type PortalInquiry,
  type PortalSummary,
} from "@/lib/data/enquiries";
import {
  DEMO_LEAD_ACTIVITY,
  type LeadActivity,
  type LeadActivityEvent,
} from "@/lib/data/leadActivity";
import { DIRECT_SOURCE } from "@/lib/portal/source";
import { formatInt } from "@/lib/format";
import { adminHeaders, saveAdminKey } from "@/lib/portal/adminKey";
import { track } from "@/lib/telemetry";
import { useCountUp } from "@/lib/useCountUp";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EnquiryActivityModal } from "./EnquiryActivityModal";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { useSales } from "./SalesProvider";

/**
 * Admin Enquiries tab — the analysis surface for the client-facing services
 * portal. Reads three portal-telemetry endpoints on mount:
 *
 *   GET /api/portal/summary       → funnel totals + per-service / per-sector rollups
 *   GET /api/portal/inquiries     → the enquiry list (email = the qualifying field)
 *   GET /api/portal/lead-activity → each enquirer's click trail, for the modal
 *
 * The funnel it renders: outreach email click (`attribution_click`) → portal
 * visit (`portal_view`) → service card open (`portal_service_open`) → enquiry
 * submitted. Every enquiry that arrived via a tracked link carries the outreach
 * lead's business + CSV category, so admin can see WHICH sectors respond and
 * WHAT services they actually want — the whole point of the portal experiment.
 *
 * EVERY ROW HAS A "VIEW". It opens EnquiryActivityModal — the tallies of what
 * that enquirer did before enquiring (email clicks, info-pack downloads, portal
 * visits, service cards, chat questions), the fact-only talking points a rep can
 * open the call with, the enquiry itself, the full chronological trail, and an
 * on-demand AI summary (POST /api/portal/lead-summary). The trail read is
 * deliberately secondary: if it fails, the modal says so and the enquiry list is
 * untouched.
 *
 * Status changes (new → contacted → closed) PATCH /api/portal/inquiries
 * optimistically and are gated on `enquiries.manage` (sales + admin), as is
 * the per-row delete (DELETE /api/portal/inquiries?id= — for clearing operator
 * test submissions and spam, behind an inline destructive confirm).
 * `mode:"demo"` (no Supabase) swaps in the believable Melbourne dataset from
 * lib/data/enquiries.ts behind an amber banner — the tab never crashes.
 *
 * SALES REPS SEE A NARROWER TAB. The funnel gauges and the three analysis
 * panels are admin instruments — they measure the whole portal experiment, not
 * a rep's desk — so a rep gets neither. Their enquiry list is scoped to the
 * leads admin handed them, plus the genuine inbound enquirers
 * (`salesCanSeeEnquiry`), and their gauges are counted off that scoped list.
 * Same endpoints, same rows, just the desk's share of them.
 */

/* ───────────────────────────  load state  ─────────────────────────── */

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string; unauthorized?: boolean }
  | { status: "ready"; mode: "live" | "demo"; summary: PortalSummary; inquiries: PortalInquiry[] };

/* ─────────────────────  admin access key (PII endpoints)  ───────────────────── */

/* The enquiry listing/status API holds visitor PII on the same origin the
   public portal invites strangers to, so it's gated by a shared secret
   (PORTAL_ADMIN_KEY server-side). The key is entered once — here or on the
   Telemetry tab — and parked in localStorage via lib/portal/adminKey, never
   baked into the client bundle. */

interface InquiriesResponse {
  mode?: string;
  inquiries?: PortalInquiry[];
  error?: string;
}

/* ─────────────────  per-enquirer click trails (the View modal)  ───────────────── */

/**
 * The third read this tab makes: GET /api/portal/lead-activity, keyed by
 * lead_id, so a row's "View" can show what that enquirer actually did before
 * they enquired (email click → info pack → portal visits → service cards →
 * chat → enquiry). Same shared secret as the enquiry listing.
 *
 * SECONDARY BY DESIGN: a trail is context, not the record. If this read fails
 * (or the key only covers the listing) the tab is unaffected and the modal says
 * the trail is unavailable — it never blocks or errors the enquiry list.
 */
type ActivityState = {
  status: "loading" | "ready" | "unavailable";
  byLead: ReadonlyMap<string, LeadActivity>;
};

const NO_ACTIVITY: ActivityState = { status: "loading", byLead: new Map() };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Rebuild one trail field-by-field so a partial payload can never leave an
 *  undefined array behind (the modal maps over `events`). Mirrors the
 *  normalisers in TelemetryPage / lib/data/hotLeads. */
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
      version: str(e.version),
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
      inquiries: num(c.inquiries),
      chatPrompts: num(c.chatPrompts),
    },
  };
}

function indexTrails(leads: LeadActivity[]): Map<string, LeadActivity> {
  return new Map(leads.map((l) => [l.leadId, l]));
}

/** Immutable single-row status patch, shared by optimistic apply AND revert. */
function patchStatus(id: string, status: InquiryStatus) {
  return (prev: LoadState): LoadState =>
    prev.status === "ready"
      ? { ...prev, inquiries: prev.inquiries.map((q) => (q.id === id ? { ...q, status } : q)) }
      : prev;
}

/* ───────────────────────────  small display helpers  ─────────────────────────── */

function Dash() {
  return <span className="text-muted-foreground/50">—</span>;
}

/** Relative "when" for the table (en-AU day-month once it's older than a week). */
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

function fmtFull(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString("en-AU");
}

const ratio = (count: number, total: number) => (total > 0 ? count / total : 0);

/* ───────────────────────────  KPI cards (§ spec item 2)  ─────────────────────────── */

interface EnquiryStat {
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
 * Funnel gauge, following KpiCard's instrument anatomy (tiny-caps label, tnum
 * count-up hero readout, proportion foot on a shared baseline) but with a
 * lucide icon chip instead of the LED — each stage of the portal funnel gets
 * its own mark. Local rather than a KpiCard change because that component is
 * shared by every dashboard surface.
 */
function StatCard({ stat }: { stat: EnquiryStat }) {
  const display = useCountUp(stat.value, "int", formatInt(stat.value));
  const Icon = stat.icon;
  return (
    <button
      type="button"
      data-track="enquiries_kpi"
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

/* ───────────────────────────  analysis panels (§ spec item 3)  ─────────────────────────── */

/** Shared hairline panel head, same grammar as RecentLeadsTable. */
function PanelHead({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>
      {meta}
    </div>
  );
}

function PanelEmpty({ hint }: { hint: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
        <Inbox className="h-5 w-5" aria-hidden />
      </span>
      <p className="max-w-[16rem] font-mono text-[10.5px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

/**
 * "Services they want" — layered bar list. The soft fill is card OPENS, the
 * solid fill is ENQUIRIES, both scaled to the busiest service so the relative
 * shape reads at a glance. Fills stay inside the signal-red family (no second
 * data colour — ui-standards §15).
 */
function ServiceBars({ rows }: { rows: PortalSummary["byService"] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.opens + b.inquiries - (a.opens + a.inquiries)),
    [rows],
  );
  const max = Math.max(1, ...sorted.map((r) => Math.max(r.opens, r.inquiries)));

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead
        title="Services they want"
        meta={
          <span className="flex items-center gap-3 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full bg-primary/35" aria-hidden />
              opens
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-3 rounded-full bg-primary" aria-hidden />
              enquiries
            </span>
          </span>
        }
      />
      {sorted.length === 0 ? (
        <PanelEmpty hint="No service opens yet — interest lands here once portal visitors start browsing." />
      ) : (
        <ul className="flex flex-1 flex-col justify-center gap-3 px-4 py-4">
          {sorted.map((r) => (
            <li key={r.service}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-[12.5px] font-medium text-foreground">
                  {serviceLabel(r.service)}
                </span>
                <span className="tnum shrink-0 font-mono text-[11px] text-muted-foreground">
                  <span className="text-foreground">{formatInt(r.opens)}</span> opens ·{" "}
                  <span className="text-foreground">{formatInt(r.inquiries)}</span> enq
                </span>
              </div>
              <div
                className="relative mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-border"
                role="img"
                aria-label={`${serviceLabel(r.service)}: ${r.opens} opens, ${r.inquiries} enquiries`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary/35"
                  style={{ width: `${(r.opens / max) * 100}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-primary"
                  style={{ width: `${(r.inquiries / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * "Sectors they came from" — the attribution readout. Category is the CSV
 * sector the lead was scraped under, so this answers "which outreach sectors
 * actually engage". A null category is the summary route's "Direct / unknown"
 * bucket (visitors with no tracked-link cookie).
 */
function SectorList({ rows }: { rows: PortalSummary["byCategory"] }) {
  const sorted = useMemo(
    () =>
      [...rows].sort(
        (a, b) => b.clicks + b.views + b.inquiries - (a.clicks + a.views + a.inquiries),
      ),
    [rows],
  );

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead
        title="Sectors they came from"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            via outreach
          </span>
        }
      />
      {sorted.length === 0 ? (
        <PanelEmpty hint="No attributed traffic yet — sectors appear once tracked outreach links get clicked." />
      ) : (
        <div className="flex-1 px-4 py-3">
          <div
            className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] gap-x-2 pb-2 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            aria-hidden
          >
            <span className="text-left">Sector</span>
            <span>Clicks</span>
            <span>Views</span>
            <span>Enq</span>
          </div>
          <ul>
            {sorted.map((r) => {
              const name = r.category?.trim() ? r.category : DIRECT_CATEGORY;
              const direct = name === DIRECT_CATEGORY;
              return (
                <li
                  key={name}
                  className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.25rem)] items-center gap-x-2 border-t border-border/70 py-2.5"
                >
                  <span
                    className={cn(
                      "truncate text-[12.5px] font-medium",
                      direct ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {name}
                  </span>
                  <span className="tnum text-right font-mono text-[12px] text-foreground">
                    {direct && r.clicks === 0 ? <Dash /> : formatInt(r.clicks)}
                  </span>
                  <span className="tnum text-right font-mono text-[12px] text-foreground">
                    {formatInt(r.views)}
                  </span>
                  <span className="tnum text-right font-mono text-[12px] text-primary">
                    {formatInt(r.inquiries)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

/**
 * "Where they came from" — the traffic-channel readout for the promoted portal
 * link. Social rows come from `?utm_source=` tags on posted links (plus the
 * social-Referer fallback for untagged bio links); "Outreach email" is the
 * tracked-link cohort and "Direct / unknown" everyone else. Answers "is the
 * TikTok / Facebook / Instagram push actually sending people — and do those
 * visits turn into enquiries?".
 */
function SourceList({ rows }: { rows: PortalSummary["bySource"] }) {
  const sorted = useMemo(
    () => [...rows].sort((a, b) => b.views + b.inquiries - (a.views + a.inquiries)),
    [rows],
  );

  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead
        title="Where they came from"
        meta={
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            traffic source
          </span>
        }
      />
      {sorted.length === 0 ? (
        <PanelEmpty hint="No traffic recorded yet — sources appear once visitors land on the portal (social posts tagged ?utm_source=tiktok / facebook / instagram show up by platform)." />
      ) : (
        <div className="flex-1 px-4 py-3">
          <div
            className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.6rem)] gap-x-2 pb-2 text-right text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            aria-hidden
          >
            <span className="text-left">Source</span>
            <span>Visitors</span>
            <span>Views</span>
            <span>Enq</span>
          </div>
          <ul>
            {sorted.map((r) => {
              const direct = r.source === DIRECT_SOURCE;
              return (
                <li
                  key={r.source}
                  className="grid grid-cols-[minmax(0,1fr)_repeat(3,3.6rem)] items-center gap-x-2 border-t border-border/70 py-2.5"
                >
                  <span
                    className={cn(
                      "truncate text-[12.5px] font-medium",
                      direct ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {sourceLabel(r.source)}
                  </span>
                  <span className="tnum text-right font-mono text-[12px] text-foreground">
                    {formatInt(r.visitors)}
                  </span>
                  <span className="tnum text-right font-mono text-[12px] text-foreground">
                    {formatInt(r.views)}
                  </span>
                  <span className="tnum text-right font-mono text-[12px] text-primary">
                    {formatInt(r.inquiries)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}

function AnalysisSkeleton({ title }: { title: string }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10" aria-busy>
      <PanelHead title={title} />
      <div className="flex-1 space-y-4 px-4 py-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i}>
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-1.5 w-full animate-pulse rounded-full bg-muted/70" />
          </div>
        ))}
      </div>
      <p className="px-4 pb-4 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        Reading portal signal…
      </p>
    </section>
  );
}

/* ───────────────────────────  enquiry list pieces (§ spec item 4)  ─────────────────────────── */

/** Triage tones follow the SalesPage status grammar (closed = solid red chip). */
const STATUS_META: Record<InquiryStatus, { label: string; pill: string; select: string }> = {
  new: {
    label: "New",
    pill: "border-border bg-muted text-muted-foreground",
    select: "border-border text-foreground",
  },
  contacted: {
    label: "Contacted",
    pill: "border-primary/40 bg-transparent text-primary",
    select: "border-primary/40 text-primary",
  },
  closed: {
    label: "Closed",
    pill: "border-transparent bg-primary-solid text-primary-foreground",
    select: "border-border text-muted-foreground",
  },
};

function StatusPill({ status }: { status: InquiryStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        STATUS_META[status].pill,
      )}
    >
      {STATUS_META[status].label}
    </span>
  );
}

/** Status select — the only mutating control on the page, so it alone is gated
 *  on `enquiries.manage`; read-only roles see the plain pill instead. */
function StatusControl({
  inquiry,
  canManage,
  onChange,
}: {
  inquiry: PortalInquiry;
  canManage: boolean;
  onChange: (next: InquiryStatus) => void;
}) {
  if (!canManage) return <StatusPill status={inquiry.status} />;
  return (
    /* The status colour lives on the wrapper so the caret can inherit it with
       `text-current` — the pill reads as one object in every state. Border
       classes on a border-less span are inert, so the same token string can
       dress both halves. */
    <span className={cn("relative inline-flex items-center", STATUS_META[inquiry.status].select)}>
      <select
        value={inquiry.status}
        onChange={(e) => {
          if (isInquiryStatus(e.target.value)) onChange(e.target.value);
        }}
        /* NO data-track here: the delegated listener fires on CLICKS, which
           would count dropdown opens as "changes" and miss keyboard changes.
           The real event is tracked inside changeStatus, next to the PATCH. */
        aria-label={`Status of enquiry from ${inquiry.name ?? inquiry.email}`}
        className={cn(
          "h-7 cursor-pointer appearance-none rounded-md border bg-background pl-2 pr-6 font-mono text-[10.5px] font-semibold uppercase tracking-[0.08em] text-current transition-colors duration-200 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          STATUS_META[inquiry.status].select,
        )}
      >
        {INQUIRY_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_META[s].label}
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-1.5 h-3 w-3 text-current opacity-60"
        aria-hidden
      />
    </span>
  );
}

/** Opens the activity modal for one enquiry — what they did before enquiring,
 *  the talking points, and the on-demand AI summary. Every role gets this: it's
 *  a read, and it's the whole point of the tab for a rep about to ring them. */
function ViewButton({ inquiry, onClick }: { inquiry: PortalInquiry; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-track="enquiries_view"
      data-track-service={inquiry.serviceSlug}
      aria-label={`View portal activity for ${inquiry.business ?? inquiry.name ?? inquiry.email}`}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground outline-none transition-colors hover:border-primary/40 hover:text-foreground focus-visible:border-primary/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))]"
    >
      <Eye className="h-3.5 w-3.5" aria-hidden />
      View
    </button>
  );
}

/** Quiet per-row trash that only turns destructive on hover (TelemetryPage
 *  grammar). The real delete sits behind the DeleteConfirm strip below —
 *  a stray click here can never destroy a row. */
function DeleteButton({
  inquiry,
  onClick,
  disabled,
}: {
  inquiry: PortalInquiry;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-track="enquiries_delete"
      data-track-service={inquiry.serviceSlug}
      aria-label={`Delete enquiry from ${inquiry.name ?? inquiry.email}`}
      className="shrink-0 rounded-md p-1.5 text-muted-foreground/70 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50"
    >
      <Trash2 className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

/** Inline destructive confirm (StoredLeads grammar) — Delete here is the real,
 *  irreversible action; a failed DELETE surfaces its error right in the strip. */
function DeleteConfirm({
  inquiry,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  inquiry: PortalInquiry;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-t border-destructive/40 bg-destructive/[0.04] px-4 py-2">
      <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
      <span className="text-[12px] text-foreground">
        Permanently delete the enquiry from {inquiry.name ?? inquiry.email}?
      </span>
      {error && (
        <span role="alert" className="font-mono text-[10.5px] text-destructive">
          {error}
        </span>
      )}
      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={onConfirm}
          disabled={busy}
          data-track="enquiries_delete_confirm"
          data-track-service={inquiry.serviceSlug}
          className="gap-1.5"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {busy ? "Deleting…" : "Delete"}
        </Button>
      </div>
    </div>
  );
}

function ServicePill({ slug }: { slug: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
      {serviceLabel(slug)}
    </span>
  );
}

/** Email is the lead-qualifying field — rendered prominent, as a mailto link
 *  plus a one-tap copy (clipboard failures fall back to the link itself). */
function EmailLink({ inquiry }: { inquiry: PortalInquiry }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(inquiry.email);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the mailto link still works */
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-1">
      <a
        /* encodeURIComponent keeps a crafted stored "email" from smuggling
           ?subject=/&body= mailto params into the admin's mail compose —
           encoded `?`/`&` stay part of the address (defence in depth on top
           of the server-side EMAIL_RE rejecting those characters). */
        href={`mailto:${encodeURIComponent(inquiry.email)}`}
        data-track="enquiries_email"
        data-track-service={inquiry.serviceSlug}
        className="truncate font-mono text-[11.5px] font-medium text-primary hover:underline"
      >
        {inquiry.email}
      </a>
      <button
        type="button"
        onClick={copy}
        data-track="enquiries_copy_email"
        aria-label={`Copy ${inquiry.email}`}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:text-foreground"
      >
        {copied ? (
          <Check className="h-3 w-3 text-primary" aria-hidden />
        ) : (
          <Copy className="h-3 w-3" aria-hidden />
        )}
      </button>
    </div>
  );
}

/** "via TikTok" / "via Facebook" chip — the enquirer's traffic source (the
 *  apmg_src cookie from a tagged social link or social Referer). */
function SourceChip({ source }: { source: string }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-primary/40 bg-primary/5 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-primary">
      via {sourceLabel(source)}
    </span>
  );
}

/** Sector + attributed outreach lead + traffic source. Direct visitors (no
 *  apmg_ref cookie at submit time) get a quiet "Direct" pill instead of a
 *  business line — unless a source tag says which platform sent them. */
function Attribution({ inquiry }: { inquiry: PortalInquiry }) {
  if (!inquiry.business && !inquiry.category) {
    return inquiry.source ? (
      <SourceChip source={inquiry.source} />
    ) : (
      <span className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
        Direct
      </span>
    );
  }
  return (
    <div className="min-w-0">
      <div className="truncate text-[12px] text-foreground">
        {inquiry.category ?? DIRECT_CATEGORY}
      </div>
      {(inquiry.business || inquiry.source) && (
        <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
          {inquiry.business && (
            <span className="truncate font-mono text-[10.5px] text-muted-foreground">
              {inquiry.business}
            </span>
          )}
          {inquiry.business && inquiry.campaign && (
            <span className="shrink-0 rounded-full border border-primary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-primary">
              {inquiry.campaign}
            </span>
          )}
          {inquiry.source && <SourceChip source={inquiry.source} />}
        </div>
      )}
    </div>
  );
}

/** Message, clamped to two lines with an expand toggle for the long ones. */
function Message({
  inquiry,
  expanded,
  onToggle,
}: {
  inquiry: PortalInquiry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const msg = inquiry.message?.trim();
  if (!msg) return <Dash />;
  // Roughly two lines at this column width — below that the toggle is noise.
  const long = msg.length > 90;
  return (
    <div>
      <p
        className={cn(
          "whitespace-normal text-[12px] leading-relaxed text-foreground/90",
          !expanded && "line-clamp-2",
        )}
      >
        {msg}
      </p>
      {long && (
        <button
          type="button"
          onClick={onToggle}
          data-track="enquiries_message_toggle"
          aria-expanded={expanded}
          className="mt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-primary hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}

/**
 * The rep's four gauges: how much inbound is on their desk and how far through
 * triage it is. Counted off the SCOPED list, so every number here describes
 * enquiries from the leads admin handed them (plus genuine direct enquirers) —
 * never portal-wide traffic.
 */
function salesTriageStats(rows: PortalInquiry[]): EnquiryStat[] {
  const total = rows.length;
  const by = (s: InquiryStatus) => rows.filter((q) => q.status === s).length;
  const isNew = by("new");
  const contacted = by("contacted");
  const closed = by("closed");
  const ofYours = "of your enquiries";
  return [
    {
      id: "yours",
      label: "Your enquiries",
      value: total,
      icon: Inbox,
      caption: "from your leads + direct",
      ratio: { value: ratio(isNew, total), label: "awaiting first contact" },
    },
    {
      id: "awaiting",
      label: "Awaiting contact",
      value: isNew,
      icon: Clock,
      caption: "not actioned yet",
      ratio: { value: ratio(isNew, total), label: ofYours },
    },
    {
      id: "contacted",
      label: "Contacted",
      value: contacted,
      icon: PhoneCall,
      caption: "reply sent",
      ratio: { value: ratio(contacted, total), label: ofYours },
    },
    {
      id: "closed",
      label: "Closed",
      value: closed,
      icon: CheckCircle2,
      caption: "wrapped up",
      ratio: { value: ratio(closed, total), label: ofYours },
    },
  ];
}

/* ───────────────────────────  page  ─────────────────────────── */

export function EnquiriesPage() {
  const { can, role } = useRbac();
  const canManage = can("enquiries.manage");
  // A rep's tab is scoped to what admin sent them (see the file header).
  const isSales = role === "sales";
  const { queuedIds } = useSales();
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [activity, setActivity] = useState<ActivityState>(NO_ACTIVITY);
  /** id of the enquiry whose activity modal is open (null = closed). */
  const [viewing, setViewing] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Access-key field shown when the enquiries API answers 401. */
  const [keyInput, setKeyInput] = useState("");
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /**
   * The click trails behind each row's "View". Read alongside the enquiries but
   * kept in its OWN state on purpose: it's context, so a failure here must
   * degrade the modal, never the tab. Resolves to "unavailable" rather than
   * throwing, and the enquiry list never waits on it.
   */
  const fetchActivity = useCallback(async () => {
    try {
      const res = await fetch("/api/portal/lead-activity", {
        cache: "no-store",
        headers: adminHeaders(),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; mode?: string; leads?: unknown }
        | null;
      if (!mountedRef.current) return;
      // Demo mode scores the same Melbourne preset the Telemetry tab shows, so
      // the demo enquiries have believable trails behind them too.
      if (data?.mode === "demo") {
        setActivity({ status: "ready", byLead: indexTrails(DEMO_LEAD_ACTIVITY) });
        return;
      }
      if (!res.ok || !data?.ok) {
        setActivity({ status: "unavailable", byLead: new Map() });
        return;
      }
      const leads = (Array.isArray(data.leads) ? data.leads : [])
        .map(toLead)
        .filter((l): l is LeadActivity => l !== null);
      setActivity({ status: "ready", byLead: indexTrails(leads) });
    } catch {
      if (mountedRef.current) setActivity({ status: "unavailable", byLead: new Map() });
    }
  }, []);

  const fetchAll = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoad((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    void fetchActivity();
    try {
      const [sumRes, inqRes] = await Promise.all([
        fetch("/api/portal/summary", { cache: "no-store" }),
        fetch("/api/portal/inquiries", { cache: "no-store", headers: adminHeaders() }),
      ]);
      const sum = (await sumRes.json().catch(() => null)) as
        | (Partial<PortalSummary> & { error?: string })
        | null;
      const inq = (await inqRes.json().catch(() => null)) as InquiriesResponse | null;
      if (!mountedRef.current) return;

      if (!sumRes.ok || !sum) {
        setLoad({
          status: "error",
          error: sum?.error ?? `Couldn't load the portal summary (${sumRes.status}).`,
        });
        return;
      }
      // Demo (no Supabase) → render the believable preset behind the banner.
      if (sum.mode === "demo" || inq?.mode === "demo") {
        setLoad({ status: "ready", mode: "demo", summary: DEMO_SUMMARY, inquiries: DEMO_INQUIRIES });
        return;
      }
      // 401 = the shared-secret gate on the PII listing — surface the access
      // key prompt instead of a dead-end error.
      if (inqRes.status === 401) {
        setLoad({
          status: "error",
          unauthorized: true,
          error: inq?.error ?? "An access key is required to view enquiries.",
        });
        return;
      }
      if (!inqRes.ok || !inq || !sum.totals) {
        setLoad({
          status: "error",
          error: inq?.error ?? `Couldn't load enquiries (${inqRes.status}).`,
        });
        return;
      }
      // Rebuild the summary field-by-field so a partial payload can never
      // leave an undefined array behind (`.map` on the panels would throw).
      setLoad({
        status: "ready",
        mode: "live",
        summary: {
          mode: "live",
          totals: sum.totals,
          byService: Array.isArray(sum.byService) ? sum.byService : [],
          byCategory: Array.isArray(sum.byCategory) ? sum.byCategory : [],
          bySource: Array.isArray(sum.bySource) ? sum.bySource : [],
          recentEvents: Array.isArray(sum.recentEvents) ? sum.recentEvents : [],
        },
        inquiries: Array.isArray(inq.inquiries) ? inq.inquiries : [],
      });
    } catch {
      if (mountedRef.current) {
        setLoad({ status: "error", error: "Network error loading portal enquiries." });
      }
    }
  }, [fetchActivity]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  /** Monotonic per-row request tokens: a PATCH's failure handler may only
   *  revert if no NEWER change for that row has been issued since — otherwise
   *  a slow 502 from request A would clobber request B's landed status. */
  const statusReqSeq = useRef<Map<string, number>>(new Map());

  /** Optimistic triage: apply immediately, PATCH in the background, revert on
   *  failure (unless a newer change for the same row superseded this one).
   *  Demo mode updates locally only (there's no row to PATCH). */
  async function changeStatus(inquiry: PortalInquiry, next: InquiryStatus) {
    if (load.status !== "ready" || next === inquiry.status) return;
    const prev = inquiry.status;
    const token = (statusReqSeq.current.get(inquiry.id) ?? 0) + 1;
    statusReqSeq.current.set(inquiry.id, token);
    setStatusError(null);
    setLoad(patchStatus(inquiry.id, next));
    // Tracked HERE — on the actual state change — rather than via data-track
    // on the <select>: the delegated listener fires on clicks (counting mere
    // dropdown opens) and misses keyboard-driven changes entirely.
    track(
      "enquiries_status_change",
      { service: inquiry.serviceSlug, status: next },
      { view: "enquiries" },
    );
    if (load.mode === "demo") return;
    try {
      const res = await fetch("/api/portal/inquiries", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ id: inquiry.id, status: next }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        if (!mountedRef.current) return;
        // Stale failure: a newer change for this row is (or was) in flight —
        // reverting now would overwrite that newer state with old data.
        if (statusReqSeq.current.get(inquiry.id) !== token) return;
        setLoad(patchStatus(inquiry.id, prev));
        setStatusError(data?.error ?? `Couldn't update the enquiry (${res.status}).`);
      }
    } catch {
      if (!mountedRef.current) return;
      if (statusReqSeq.current.get(inquiry.id) !== token) return;
      setLoad(patchStatus(inquiry.id, prev));
      setStatusError("Network error updating the enquiry — status reverted.");
    }
  }

  /** Two-step delete: the trash arms a row ("confirm"), the strip's Delete
   *  fires the DELETE ("busy"). One row at a time — arming another disarms
   *  the first. Rows only leave local state AFTER the server confirms (no
   *  optimistic remove: a PII delete that silently failed would look done). */
  const [deleting, setDeleting] = useState<{ id: string; phase: "confirm" | "busy" } | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function requestDelete(id: string) {
    setDeleteError(null);
    // Clicking the trash of the already-armed row toggles it back off.
    setDeleting((prev) => (prev?.id === id && prev.phase === "confirm" ? null : { id, phase: "confirm" }));
  }

  function cancelDelete() {
    setDeleting(null);
    setDeleteError(null);
  }

  async function confirmDelete(inquiry: PortalInquiry) {
    if (load.status !== "ready") return;
    setDeleting({ id: inquiry.id, phase: "busy" });
    setDeleteError(null);
    const drop = () => {
      setLoad((prev) =>
        prev.status === "ready"
          ? { ...prev, inquiries: prev.inquiries.filter((q) => q.id !== inquiry.id) }
          : prev,
      );
      setDeleting(null);
    };
    // Demo rows are a client-side constant (ids aren't uuids) — drop locally.
    if (load.mode === "demo") {
      drop();
      return;
    }
    try {
      const res = await fetch(`/api/portal/inquiries?id=${encodeURIComponent(inquiry.id)}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data?.ok) {
        setDeleting({ id: inquiry.id, phase: "confirm" });
        setDeleteError(data?.error ?? `Couldn't delete the enquiry (${res.status}).`);
        return;
      }
      drop();
    } catch {
      if (!mountedRef.current) return;
      setDeleting({ id: inquiry.id, phase: "confirm" });
      setDeleteError("Network error deleting the enquiry.");
    }
  }

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const ready = load.status === "ready" ? load : null;
  const summary = ready?.summary ?? null;
  const allInquiries = ready?.inquiries ?? [];
  // A rep sees their share; admin sees the list whole. The demo preset is left
  // alone either way — its lead ids are fabricated, so scoping it against a real
  // hand-off roll would just empty the tab out.
  const inquiries = useMemo(
    () =>
      isSales && ready?.mode === "live"
        ? allInquiries.filter((q) => salesCanSeeEnquiry(q, queuedIds))
        : allInquiries,
    [isSales, ready?.mode, allInquiries, queuedIds],
  );
  const awaiting = inquiries.filter((q) => q.status === "new").length;

  // The open modal's row, resolved from the SCOPED list — a rep can only open
  // what they can see, and a row that vanished under them (deleted, or scoped
  // away by a hand-off change) closes the modal instead of stranding it.
  const viewed = useMemo(
    () => (viewing ? inquiries.find((q) => q.id === viewing) ?? null : null),
    [viewing, inquiries],
  );
  useEffect(() => {
    if (viewing && !viewed) setViewing(null);
  }, [viewing, viewed]);
  // Trails are keyed by lead_id, so a direct/social enquirer resolves to null —
  // which the modal renders as "no tracked trail", not as an error.
  const viewedActivity =
    viewed?.leadId ? activity.byLead.get(viewed.leadId) ?? null : null;

  // Funnel gauges, one per stage: click → visit → browse → enquire. Reps get
  // triage tallies off their own scoped list instead — the funnel measures the
  // whole portal experiment, which isn't their surface.
  const stats = useMemo<EnquiryStat[]>(() => {
    if (isSales) return salesTriageStats(inquiries);
    if (!summary) return [];
    const t = summary.totals;
    return [
      {
        id: "clicks",
        label: "Email clicks",
        value: t.attributionClicks,
        icon: MousePointerClick,
        caption: "tracked outreach links opened",
        ratio: { value: ratio(t.portalViews, t.attributionClicks), label: "reached the portal" },
      },
      {
        id: "visits",
        label: "Portal visits",
        value: t.portalViews,
        icon: Users,
        caption: `${formatInt(t.uniqueVisitors)} unique visitors`,
        ratio: { value: ratio(t.uniqueVisitors, t.portalViews), label: "unique visitors" },
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
        label: "Enquiries received",
        value: t.inquiries,
        icon: Inbox,
        caption: "qualified — email captured",
        ratio: { value: ratio(awaiting, inquiries.length), label: "awaiting first contact" },
      },
    ];
  }, [isSales, summary, awaiting, inquiries]);

  // Reps track their own list, not portal-wide event traffic.
  const lastActivity = isSales
    ? inquiries[0]?.createdAt ?? null
    : summary?.recentEvents[0]?.createdAt ?? inquiries[0]?.createdAt ?? null;
  // Sales gauges only need the scoped list; admin's need the summary rollup.
  const gaugesReady = isSales ? !!ready : !!summary;

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      {/* ── 1 · header row ─────────────────────────────────────────────── */}
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              {isSales ? "Your desk — inbound" : "Client portal — what they want"}
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              Enquiries
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSales
                ? "Portal enquiries from the leads admin handed you, plus anyone who enquired directly."
                : "Every portal enquiry, matched back to the outreach lead that clicked."}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <div>Last activity</div>
              <div className="tnum text-foreground/80">
                {lastActivity ? fmtWhen(lastActivity) : "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchAll()}
              data-track="enquiries_refresh"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", load.status === "loading" && "animate-spin")}
                aria-hidden
              />
              Refresh
            </button>
          </div>
        </div>
      </Reveal>

      {/* ── 5 · demo banner (matches the app's amber demo-banner grammar) ─ */}
      {ready?.mode === "demo" && (
        <Reveal className="mb-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <p className="font-mono text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
              Demo data — connect Supabase and run supabase/portal-telemetry.sql to see live
              portal enquiries.
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
              {load.unauthorized ? "Access key required" : "Couldn’t load portal enquiries"}
            </h2>
            <p
              role="alert"
              className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {load.error}
            </p>
            {load.unauthorized && (
              /* Shared-secret unlock: the enquiry listing carries visitor PII,
                 so the API requires the PORTAL_ADMIN_KEY. Entered once here,
                 kept in localStorage, sent as a header on every GET/PATCH. */
              <form
                className="flex w-full max-w-xs items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveAdminKey(keyInput.trim());
                  setKeyInput("");
                  fetchAll();
                }}
              >
                <label htmlFor="enquiries-access-key" className="sr-only">
                  Access key
                </label>
                <input
                  id="enquiries-access-key"
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
                  data-track="enquiries_unlock"
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
              data-track="enquiries_retry"
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        </Reveal>
      ) : (
        <>
          {/* ── 2 · gauges, fused instrument panel (OverviewPage) ────────── */}
          <Reveal delay={0.04}>
            {gaugesReady ? (
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-4">
                {stats.map((stat) => (
                  <StatCard key={stat.id} stat={stat} />
                ))}
              </div>
            ) : (
              <KpiPanelSkeleton />
            )}
          </Reveal>

          {/* ── 3 · two-column analysis (admin only — portal-wide rollups) ── */}
          {!isSales && (
            <>
              <div className="mt-3 grid grid-cols-1 items-stretch gap-3 lg:grid-cols-2">
                <Reveal delay={0.1} className="h-full">
                  {summary ? (
                    <ServiceBars rows={summary.byService} />
                  ) : (
                    <AnalysisSkeleton title="Services they want" />
                  )}
                </Reveal>
                <Reveal delay={0.14} className="h-full">
                  {summary ? (
                    <SectorList rows={summary.byCategory} />
                  ) : (
                    <AnalysisSkeleton title="Sectors they came from" />
                  )}
                </Reveal>
              </div>

              {/* ── 3b · traffic sources (the social-promotion readout) ──── */}
              <Reveal delay={0.16} className="mt-3">
                {summary ? (
                  <SourceList rows={summary.bySource} />
                ) : (
                  <AnalysisSkeleton title="Where they came from" />
                )}
              </Reveal>
            </>
          )}

          {/* ── 4 · the enquiries themselves ────────────────────────────── */}
          <Reveal delay={0.18} className="mt-3">
            <section className="min-w-0 rounded-xl bg-card ring-1 ring-foreground/10">
              <PanelHead
                title={isSales ? "Your enquiries" : "Enquiries"}
                meta={
                  <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    {ready ? `${inquiries.length} total · ${awaiting} new` : "loading"}
                  </span>
                }
              />

              {statusError && (
                <p
                  role="alert"
                  className="border-b border-border bg-destructive/5 px-4 py-2 font-mono text-[10.5px] text-destructive"
                >
                  {statusError}
                </p>
              )}

              {!ready ? (
                <div className="space-y-2 p-4" aria-busy>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="h-14 animate-pulse rounded-lg bg-muted/60" />
                  ))}
                </div>
              ) : inquiries.length === 0 ? (
                <PanelEmpty
                  hint={
                    isSales
                      ? "Nothing inbound yet — enquiries land here when one of the leads admin handed you submits the portal form."
                      : "No enquiries yet — they'll appear the moment a portal visitor submits the enquiry form."
                  }
                />
              ) : (
                <>
                  {/* desktop table (LeadsTable grammar) */}
                  <div className="hidden min-w-0 px-2 pb-1 md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>When</TableHead>
                          <TableHead>From</TableHead>
                          <TableHead>Service</TableHead>
                          <TableHead>Sector / attribution</TableHead>
                          <TableHead>Message</TableHead>
                          <TableHead className="text-right">Status</TableHead>
                          <TableHead className="w-16 text-right">
                            <span className="sr-only">Activity</span>
                          </TableHead>
                          {canManage && (
                            <TableHead className="w-9">
                              <span className="sr-only">Delete</span>
                            </TableHead>
                          )}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {inquiries.map((q) => (
                          <Fragment key={q.id}>
                          <TableRow className="align-top hover:bg-muted/40">
                            <TableCell
                              className="tnum py-3 align-top font-mono text-[11px] text-muted-foreground"
                              title={fmtFull(q.createdAt)}
                            >
                              {fmtWhen(q.createdAt)}
                            </TableCell>
                            <TableCell className="max-w-[240px] py-3 align-top">
                              <div className="truncate text-[13px] font-medium text-foreground">
                                {q.name ?? <Dash />}
                              </div>
                              <div className="mt-0.5">
                                <EmailLink inquiry={q} />
                              </div>
                            </TableCell>
                            <TableCell className="py-3 align-top">
                              <ServicePill slug={q.serviceSlug} />
                            </TableCell>
                            <TableCell className="max-w-[220px] py-3 align-top">
                              <Attribution inquiry={q} />
                            </TableCell>
                            <TableCell className="max-w-[320px] py-3 align-top">
                              <Message
                                inquiry={q}
                                expanded={expanded.has(q.id)}
                                onToggle={() => toggleExpanded(q.id)}
                              />
                            </TableCell>
                            <TableCell className="py-3 text-right align-top">
                              <StatusControl
                                inquiry={q}
                                canManage={canManage}
                                onChange={(next) => changeStatus(q, next)}
                              />
                            </TableCell>
                            <TableCell className="py-3 text-right align-top">
                              <ViewButton inquiry={q} onClick={() => setViewing(q.id)} />
                            </TableCell>
                            {canManage && (
                              <TableCell className="py-3 text-right align-top">
                                <DeleteButton
                                  inquiry={q}
                                  onClick={() => requestDelete(q.id)}
                                  disabled={deleting?.phase === "busy"}
                                />
                              </TableCell>
                            )}
                          </TableRow>
                          {deleting?.id === q.id && (
                            <TableRow className="hover:bg-transparent">
                              {/* spans every column, so the confirm strip reads
                                  as one bar under the row it belongs to */}
                              <TableCell colSpan={canManage ? 8 : 7} className="p-0">
                                <DeleteConfirm
                                  inquiry={q}
                                  busy={deleting.phase === "busy"}
                                  error={deleteError}
                                  onCancel={cancelDelete}
                                  onConfirm={() => confirmDelete(q)}
                                />
                              </TableCell>
                            </TableRow>
                          )}
                          </Fragment>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* mobile stacked cards (ui-standards §5.2) */}
                  <ul className="space-y-2.5 p-3 md:hidden">
                    {inquiries.map((q) => (
                      <li key={q.id} className="rounded-lg border border-border bg-background/40 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-medium text-foreground">
                              {q.name ?? <Dash />}
                            </div>
                            <div className="mt-0.5">
                              <EmailLink inquiry={q} />
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <StatusControl
                              inquiry={q}
                              canManage={canManage}
                              onChange={(next) => changeStatus(q, next)}
                            />
                            {canManage && (
                              <DeleteButton
                                inquiry={q}
                                onClick={() => requestDelete(q.id)}
                                disabled={deleting?.phase === "busy"}
                              />
                            )}
                          </div>
                        </div>

                        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                          <ServicePill slug={q.serviceSlug} />
                          <span
                            className="tnum font-mono text-[10.5px] text-muted-foreground"
                            title={fmtFull(q.createdAt)}
                          >
                            {fmtWhen(q.createdAt)}
                          </span>
                          <span className="ml-auto">
                            <ViewButton inquiry={q} onClick={() => setViewing(q.id)} />
                          </span>
                        </div>

                        <div className="mt-2">
                          <Attribution inquiry={q} />
                        </div>

                        <div className="mt-2 border-t border-border pt-2">
                          <Message
                            inquiry={q}
                            expanded={expanded.has(q.id)}
                            onToggle={() => toggleExpanded(q.id)}
                          />
                        </div>

                        {deleting?.id === q.id && (
                          <div className="-mx-3 -mb-3 mt-2">
                            <DeleteConfirm
                              inquiry={q}
                              busy={deleting.phase === "busy"}
                              error={deleteError}
                              onCancel={cancelDelete}
                              onConfirm={() => confirmDelete(q)}
                            />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </section>
          </Reveal>
        </>
      )}

      {/* ── 6 · one enquirer's activity, on demand ─────────────────────── */}
      <EnquiryActivityModal
        inquiry={viewed}
        activity={viewedActivity}
        activityState={activity.status}
        demo={ready?.mode === "demo"}
        onClose={() => setViewing(null)}
      />

      <Footer />
    </div>
  );
}
