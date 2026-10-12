"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe,
  Inbox,
  MailX,
  MessagesSquare,
  MousePointerClick,
  RefreshCw,
  Send,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  isHiddenEvent,
  LEAD_ACTIVITY_MAX_LEADS,
  serviceName,
  type ActivityTotals,
  type AnonymousActivity,
  type LeadActivity,
  type LeadActivityEvent,
  type SourcedVisitorActivity,
  type UnsubscribedPerson,
} from "@/lib/data/leadActivity";
import { sourceLabel } from "@/lib/data/enquiries";
import {
  chatDisplayName,
  LEAD_ORIGIN_NAME,
  toChatConversation,
  type ChatConversation,
} from "@/lib/data/chats";
import { handOffToSales, useHandedOffToSales } from "@/lib/data/hotLeads";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { toServiceClicks, type ServiceClickRow, type ServiceClicks } from "@/lib/data/serviceClicks";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { LEAD_SOURCES, type LeadSource } from "@/lib/pipeline/source";
import { DIRECT_SOURCE, isExternalSource, OUTREACH_SOURCE } from "@/lib/portal/source";
import { EventTrail, TimelineLine, fmtStamp } from "./LeadTrail";
import { BRAND_LOGO, FacebookLogo, GoogleLogo, isBrand, LinkedInLogo } from "./BrandLogos";
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
import {
  ChatDetailModal,
  ChatSourceMark,
  type ChatSalesState,
  type ChatTrail,
} from "./ChatDetailModal";

/**
 * System → Telemetry tab — WHO clicked WHAT. Reads two endpoints on mount,
 * then keeps them live with a silent visible-tab poll (POLL_MS) + an instant
 * refetch on window focus; the Refresh button remains as the loud manual pull:
 *
 *   GET /api/portal/lead-activity?view=telemetry → per-lead click trails +
 *                                    anonymous rollup, saved list settings applied
 *   GET /api/portal/summary       → funnel totals for the KPI row
 *
 * "Hide warm false positives" is the one saved list setting: a tickbox that
 * takes out Warm leads whose every click came from a forged browser agent
 * (lib/portal/scannerUa — mail-gateway sandboxes detonating the link). It is
 * stored in app_settings (POST /api/portal/telemetry-settings), so it holds
 * for everyone and on every machine. The route flags those leads and sends
 * the newest of them alongside the newest real leads, so the page does the
 * hiding itself: the tickbox is instant both ways, ticking it refills the
 * table rather than emptying it, and no sort, filter or background refresh
 * can bring the hidden rows back. The save runs behind the click.
 *
 * The main table is tabbed: the lead-activity list; Chats — what visitors
 * asked the portal's chat assistant, with who they are (the outreach lead's
 * school / business) and where they came from (Facebook, Google, LinkedIn,
 * Outreach email, Direct / unknown, …), read from GET /api/portal/chats and
 * polled only while that tab is open; and the opt-out list — everyone who has
 * unsubscribed, which is the one audience the send route will never mail
 * again. Activity and opt-outs ride the same lead-activity payload.
 *
 * The heart of the page is the lead-activity list: a real seven-column table
 * (Lead · Source · ID · Score · Sector · Events · Last seen) under a shared column
 * head, one row per attributed lead (someone who opened a tracked outreach
 * email) — plus one row per SOURCE-TAGGED anonymous visitor (someone who
 * arrived through the promoted ?utm_source= link: facebook, tiktok, …), which
 * is what the Channel filter slices between. The Events column carries the compact horizontal trail (icon chips,
 * chronological left → right) plus its count, and every row expands to a
 * full timeline in plain English ("Clicked the email link" →
 * "Viewed Painting Services" → "Sent an enquiry — Painting Services").
 * Attribution exists because /t/[id] set the apmg_ref cookie; the API
 * allowlists the customer-journey event names on both streams, so internal
 * dashboard click noise (an operator test-clicking a tracked link carries the
 * cookie too) never pollutes a lead's trail or the anonymous block. On top of
 * that, browsers that have opened this dashboard carry the apmg_internal
 * cookie (proxy.ts) and the telemetry writers drop their traffic
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
 * or the portal tables not migrated) renders this page's real, empty
 * structure — zeroed totals, no leads — behind a "Not connected" banner
 * rather than inventing data. The tab never crashes.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** The lead list re-framing — tickbox, sort, filter, page. The new rows fade
 *  up in a short cascade. Opacity and transform only, so every frame stays on
 *  the compositor: no layout work, however many rows swap. Background polls
 *  never re-key the list, so a refresh never replays it. */
const LIST_VARIANTS = { hidden: {}, show: { transition: { staggerChildren: 0.01 } } };
const ROW_VARIANTS = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: EASE } },
};
const ROW_VARIANTS_REDUCED = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.12 } },
};

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

/** Sentinel for the "all channels" chip (no channel filter applied). */
const ALL_CHANNELS = "__all__";

/** Channels always offered, even before their first row: outreach email is
 *  what every attributed lead came through, Facebook is the promoted social
 *  link, and LinkedIn is both a social link and a lead source (contact lists
 *  imported on the Pipeline tab). Any OTHER tagged source (tiktok, instagram,
 *  …) grows a chip the moment a visitor actually arrives through it. */
const BASE_CHANNELS = [OUTREACH_SOURCE, "facebook", "linkedin"];

/** One row of the activity table: an attributed outreach lead, or an
 *  anonymous visitor who arrived through a tagged social link. Visitor rows
 *  reuse the LeadActivity shape (the row renderer, score and sorts all read
 *  it) plus the channel they came from; they have no lead behind them, so the
 *  per-row delete is withheld (the Anonymous panel's Clear covers them). */
type ActivityRow = LeadActivity & { channel: string; deletable: boolean };

/**
 * Does this row belong under a channel chip? A row's channel is how it reached
 * the portal. LinkedIn is the one chip that ALSO means "where we got the
 * lead": a lead imported from a LinkedIn contact list who clicked our email
 * arrived by outreach, but is still a LinkedIn lead — so it shows under both
 * Outreach email and LinkedIn.
 */
function inChannel(row: ActivityRow, channel: string): boolean {
  if (row.channel === channel) return true;
  return channel === "linkedin" && row.leadSource === "linkedin";
}

/** Lead-source names in this table. "Google" / "Bing" alone would read as
 *  search traffic here (the Google gauge), so maps leads say Maps. */
const LEAD_SOURCE_NAME: Record<Exclude<LeadSource, "unknown">, string> = {
  google: "Google Maps",
  bing: "Bing Maps",
  linkedin: "LinkedIn",
};

/**
 * The Source column: where this row came from. A tagged visitor is its channel
 * (Facebook, LinkedIn, TikTok…); an outreach lead is where we got the lead —
 * a LinkedIn contact list, or the Google / Bing maps scrape. Null when that's
 * unknowable (a hand-added lead, or one deleted since it clicked).
 */
function rowSource(row: ActivityRow): { slug: string; label: string } | null {
  if (row.channel !== OUTREACH_SOURCE) return { slug: row.channel, label: sourceLabel(row.channel) };
  const src = row.leadSource;
  if (!src || src === "unknown") return null;
  return { slug: src, label: LEAD_SOURCE_NAME[src] };
}

/** Rebuild the API's leadSource, dropping anything that isn't one we know. */
function toLeadSource(v: unknown): LeadSource | null {
  return typeof v === "string" && (LEAD_SOURCES as readonly string[]).includes(v) ? (v as LeadSource) : null;
}

/* ───────────────────────────  main-table tabs  ─────────────────────────── */

/** What the main table shows: everyone who engaged, what visitors asked the
 *  portal's chat assistant, and everyone who asked us to stop. Activity and
 *  opt-outs ride the lead-activity payload; chats have their own endpoint
 *  (/api/portal/chats). All three share one pager and one panel. */
type TableTab = "activity" | "chats" | "unsubscribed";

const TABS: { id: TableTab; label: string }[] = [
  { id: "activity", label: "Lead activity" },
  { id: "chats", label: "Chats" },
  { id: "unsubscribed", label: "Unsubscribed" },
];

/** Chat channel chips always offered: the three gauged platforms, the
 *  outreach email, and Direct / unknown (typed or forwarded link). Any other
 *  source grows a chip once a chat actually comes through it. */
const CHAT_BASE_CHANNELS = ["facebook", "google", "linkedin", OUTREACH_SOURCE, DIRECT_SOURCE];

/** Chats change far less often than clicks — a slower poll, and only while
 *  the Chats tab is the one on screen. */
const CHATS_POLL_MS = 30000;

/** Same LinkedIn rule as the activity table's inChannel: a lead imported from
 *  a LinkedIn list who chatted after our email shows under both chips. */
function chatInChannel(chat: ChatConversation, channel: string): boolean {
  if (chat.channel === channel) return true;
  return channel === "linkedin" && chat.leadSource === "linkedin";
}

type ChatsLoad =
  | { status: "loading" }
  | { status: "error"; error: string }
  | {
      status: "ready";
      /** demo = no database, or portal_chats not created yet (needsMigration) */
      mode: "live" | "demo";
      needsMigration: boolean;
      conversations: ChatConversation[];
      /** the route's read window filled — older chats exist beyond it */
      windowFull: boolean;
    };

/* ───────────────────────────  load state  ─────────────────────────── */

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string; unauthorized?: boolean }
  | {
      status: "ready";
      mode: "live" | "demo";
      needsMigration: boolean;
      leads: LeadActivity[];
      /** source-tagged anonymous trails — the social-promotion loop's rows */
      visitors: SourcedVisitorActivity[];
      anonymous: AnonymousActivity;
      totals: ActivityTotals;
      unsubscribes: UnsubscribedPerson[];
      /** The facebook bucket of the summary's bySource breakdown — the KPI for
       *  the promoted portal link (?utm_source=facebook). All-zero until the
       *  first tagged visit. */
      facebook: SourceBucket;
      /** The google bucket — visitors from a google.* search Referer or a
       *  ?utm_source=google link. All-zero until the first one. */
      google: SourceBucket;
      /** The linkedin bucket — visitors from a linkedin.com / lnkd.in Referer
       *  or a ?utm_source=linkedin (or li) link. All-zero until the first one. */
      linkedin: SourceBucket;
      /** Every other tagged source summed — Instagram, TikTok, Bing, any site
       *  linking to the portal (isExternalSource). All-zero until the first. */
      external: SourceBucket;
      /** clicks per service, every visitor — the "Services clicked" card */
      services: ServiceClicks;
      /** exact count — the KPI never shows only what fitted in the page cap */
      unsubscribesTotal: number;
      /** false = the opt-out list couldn't be read at all (its migration is
       *  separate), so "0" would be a claim we can't make */
      unsubscribesAvailable: boolean;
      /** scanner-only Warm leads in the route's event window — more than
       *  the flagged rows in `leads`, which are only the newest of them */
      warmFalsePositives: number;
    };

/* ─────────────────────  defensive payload normalisers  ───────────────────── */

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Rebuild a trail event-by-event so a partial/odd payload can never leave an
 *  undefined array or non-string ts behind (the trail `.map`s would throw).
 *  Shared by the lead and visitor normalisers. */
function toEvents(v: unknown): LeadActivityEvent[] {
  return (Array.isArray(v) ? v : [])
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
}

/** Rebuild the funnel tallies field-by-field (absent/odd values → 0). */
function toCounts(v: unknown): LeadActivity["counts"] {
  const c = (v ?? {}) as Partial<LeadActivity["counts"]>;
  return {
    emailClicks: num(c.emailClicks),
    portalViews: num(c.portalViews),
    serviceOpens: num(c.serviceOpens),
    chatPrompts: num(c.chatPrompts),
    inquiries: num(c.inquiries),
  };
}

/** Rebuild one lead field-by-field — same defensive contract as toEvents. */
function toLead(v: unknown): LeadActivity | null {
  const o = (v ?? {}) as Partial<LeadActivity>;
  if (typeof o.leadId !== "string" || !o.leadId) return null;
  const events = toEvents(o.events);
  return {
    leadId: o.leadId,
    business: str(o.business),
    category: str(o.category),
    campaign: str(o.campaign),
    leadSource: toLeadSource(o.leadSource),
    contactName: str(o.contactName),
    contactTitle: str(o.contactTitle),
    firstSeen: str(o.firstSeen) ?? events[0]?.ts ?? "",
    lastSeen: str(o.lastSeen) ?? events[events.length - 1]?.ts ?? "",
    events,
    counts: toCounts(o.counts),
    ...(o.warmFalsePositive === true ? { warmFalsePositive: true } : {}),
  };
}

/** Save the "Hide warm false positives" tickbox to app_settings. Resolves
 *  null once saved, or the reason it wasn't. */
async function postHideWarmSetting(hide: boolean): Promise<string | null> {
  try {
    const res = await fetch("/api/portal/telemetry-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hideWarmFalsePositives: hide }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    return res.ok && data?.ok ? null : (data?.error ?? `Couldn't save the setting (${res.status}).`);
  } catch {
    return "Network error — the setting wasn't saved.";
  }
}

/** Rebuild one source-tagged visitor. The id and source are the row's whole
 *  point (the channel filter keys off the source), so a row missing either is
 *  dropped rather than rendered as an unattributable blank. */
function toVisitor(v: unknown): SourcedVisitorActivity | null {
  const o = (v ?? {}) as Partial<SourcedVisitorActivity>;
  if (typeof o.visitorId !== "string" || !o.visitorId) return null;
  if (typeof o.source !== "string" || !o.source) return null;
  const events = toEvents(o.events);
  return {
    visitorId: o.visitorId,
    source: o.source,
    firstSeen: str(o.firstSeen) ?? events[0]?.ts ?? "",
    lastSeen: str(o.lastSeen) ?? events[events.length - 1]?.ts ?? "",
    events,
    counts: toCounts(o.counts),
  };
}

/** Rebuild one opt-out row. The address is the row's entire point, so a row
 *  without one is dropped rather than rendered as a nameless person. */
function toUnsubscribed(v: unknown): UnsubscribedPerson | null {
  const o = (v ?? {}) as Partial<UnsubscribedPerson>;
  if (typeof o.email !== "string" || !o.email) return null;
  if (typeof o.createdAt !== "string" || !o.createdAt) return null;
  return {
    email: o.email,
    business: str(o.business),
    category: str(o.category),
    leadId: str(o.leadId),
    campaign: str(o.campaign),
    reason: str(o.reason) ?? "unsubscribe",
    createdAt: o.createdAt,
  };
}

/** One traffic channel's slice of the summary's bySource breakdown. */
interface SourceBucket {
  visitors: number;
  views: number;
  inquiries: number;
}

const EMPTY_SOURCE: SourceBucket = { visitors: 0, views: 0, inquiries: 0 };

/** Pull one channel's bucket out of the summary payload's bySource array —
 *  zeros (not an error) when that channel hasn't sent anyone yet. */
function toSourceBucket(v: unknown, source: string): SourceBucket {
  for (const row of Array.isArray(v) ? v : []) {
    const o = (row ?? {}) as { source?: unknown } & Partial<SourceBucket>;
    if (o.source === source) {
      return { visitors: num(o.visitors), views: num(o.views), inquiries: num(o.inquiries) };
    }
  }
  return EMPTY_SOURCE;
}

/** The External gauge's bucket: every bySource row without a gauge of its own,
 *  summed. Visitors add across sources, so a browser that came back through a
 *  second site counts once per site. */
function toExternalBucket(v: unknown): SourceBucket {
  const out = { ...EMPTY_SOURCE };
  for (const row of Array.isArray(v) ? v : []) {
    const o = (row ?? {}) as { source?: unknown } & Partial<SourceBucket>;
    if (typeof o.source !== "string" || !isExternalSource(o.source)) continue;
    out.visitors += num(o.visitors);
    out.views += num(o.views);
    out.inquiries += num(o.inquiries);
  }
  return out;
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

/** Row title. When the lead row was deleted/reimported since the click there
 *  is no business name — and the uuid now has a column of its own, so this says
 *  so in words rather than repeating the id back at the operator. */
function leadDisplayName(lead: LeadActivity): string {
  return lead.business ?? "Unattributed lead";
}

const ratio = (count: number, total: number) => (total > 0 ? count / total : 0);

/* Event-kind visuals (KIND_META), the compact EventTrail and the expanded
   TimelineLine live in ./LeadTrail — shared with the Enquiries tab's activity
   modal so a trail reads the same on both surfaces. */

/** A traffic source's brand mark at chip / row size, with its name for
 *  screen readers (the logo SVGs themselves are aria-hidden). */
function ChannelMark({ brand }: { brand: "facebook" | "google" | "linkedin" }) {
  const Logo = BRAND_LOGO[brand];
  return (
    <span className="inline-flex shrink-0" title={sourceLabel(brand)}>
      <Logo className="h-3.5 w-3.5" />
      <span className="sr-only">{sourceLabel(brand)}</span>
    </span>
  );
}

/* ───────────────────────────  KPI cards  ─────────────────────────── */

interface TelemetryStat {
  id: string;
  label: string;
  value: number;
  /** a lucide icon, or a full-colour brand mark (BrandLogos) for a channel */
  icon: ComponentType<{ className?: string }>;
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

/** The fused KPI panel's grid — one definition, shared by the live row and its
 *  skeleton so they can't drift apart. Six gauges: two columns on a phone,
 *  3×2 once the sidebar is beside them, and six across from `wide` (1700px),
 *  still room for a 40px count-up readout. No step ever leaves the fused
 *  panel an empty cell. */
const KPI_COUNT = 6;
const KPI_GRID =
  "grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-3 wide:grid-cols-6";

/** Skeleton mirroring the fused KPI panel while both endpoints are in flight. */
function KpiPanelSkeleton() {
  return (
    <div className={KPI_GRID}>
      {Array.from({ length: KPI_COUNT }).map((_, i) => (
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

/** Tabbed panel head — the main table's two audiences (who engaged, who asked
 *  us to stop) with the same title weight PanelHead gives a single-panel
 *  heading, so switching tabs reads as changing the table, not the page. */
function PanelTabs({
  tab,
  counts,
  onTab,
  meta,
}: {
  tab: TableTab;
  /** count chip per tab — null while that number isn't known yet */
  counts: Record<TableTab, number | null>;
  onTab: (tab: TableTab) => void;
  meta?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-3 border-b border-border px-4">
      <div role="tablist" aria-label="Telemetry table" className="flex items-center gap-4 pt-3">
        {TABS.map((t) => {
          const active = t.id === tab;
          const count = counts[t.id];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`telemetry-tab-${t.id}`}
              aria-selected={active}
              aria-controls={TABPANEL_ID}
              onClick={() => onTab(t.id)}
              data-track="telemetry_table_tab"
              data-track-tab={t.id}
              className={cn(
                // -mb-px drops the active underline onto the head's own
                // hairline instead of stacking a second rule beneath it.
                "-mb-px flex items-center gap-1.5 whitespace-nowrap border-b-2 pb-3 font-heading text-sm font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
              {count !== null && (
                <span
                  className={cn(
                    "tnum rounded-full px-1.5 py-px font-mono text-[10px] font-medium",
                    active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  {formatInt(count)}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {meta ? <div className="pb-3">{meta}</div> : null}
    </div>
  );
}

/** One id for the single rendered tabpanel — only the active tab's body is in
 *  the DOM, so it re-labels itself rather than there being one panel per tab. */
const TABPANEL_ID = "telemetry-tabpanel";

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

const SECTOR_LABEL_ID = "telemetry-sector-label";
const SECTOR_LIST_ID = "telemetry-sector-list";
const sectorOptionId = (i: number) => `telemetry-sector-opt-${i}`;
const sectorLabel = (s: string) => (s === ALL_SECTORS ? "All sectors" : s);

/** The Sector filter — a themed listbox, not a native <select>. The OS draws a
 *  select's open list itself (a stark system menu under the dark chassis, with
 *  no room for counts), so this rebuilds it as the APG select-only combobox:
 *  the `.apmg-menu` panel the folder picker and Export menus use, the tiny-caps
 *  label fused into the trigger as a prefix cell, and the full keyboard model
 *  of the native control — ↑/↓ Home/End move, Enter/Space pick, Esc/Tab close,
 *  type a letter to jump. Focus never leaves the trigger (the cursor rides on
 *  aria-activedescendant), so nothing waits on the panel's fade-in to focus. */
function SectorSelect({
  sectors,
  counts,
  total,
  value,
  onChange,
}: {
  /** sectors present in the data, busiest first */
  sectors: string[];
  /** trails per sector under the active channel */
  counts: Map<string, number>;
  /** trails under the active channel, every sector */
  total: number;
  /** a sector, or ALL_SECTORS */
  value: string;
  onChange: (sector: string) => void;
}) {
  const [open, setOpen] = useState(false);
  /** the keyboard/hover cursor — an index into `options` */
  const [active, setActive] = useState(0);
  const comboRef = useRef<HTMLDivElement | null>(null);
  const optionRefs = useRef<(HTMLDivElement | null)[]>([]);
  const typeahead = useRef({ text: "", at: 0 });

  const options = [ALL_SECTORS, ...sectors];
  const selectedIndex = Math.max(0, options.indexOf(value));
  const filtered = value !== ALL_SECTORS;

  // keep the cursor in view as it walks a long list
  useEffect(() => {
    if (open) optionRefs.current[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openAt(index: number) {
    setActive(index);
    setOpen(true);
  }

  function pick(index: number) {
    onChange(options[index]);
    setOpen(false);
  }

  function toggle() {
    if (open) setOpen(false);
    else openAt(selectedIndex);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const last = options.length - 1;
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openAt(selectedIndex);
        return;
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        openAt(e.key === "Home" ? 0 : last);
        return;
      }
    } else {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setActive((i) => Math.min(last, i + 1));
          return;
        case "ArrowUp":
          e.preventDefault();
          setActive((i) => Math.max(0, i - 1));
          return;
        case "Home":
        case "PageUp":
          e.preventDefault();
          setActive(0);
          return;
        case "End":
        case "PageDown":
          e.preventDefault();
          setActive(last);
          return;
        case "Enter":
        case " ":
          e.preventDefault();
          pick(active);
          return;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          return;
        case "Tab":
          setOpen(false);
          return;
      }
    }
    // Typeahead, as the native control does it: a letter (or the same letter
    // again) cycles through the sectors starting with it; different letters
    // typed in quick succession spell out a prefix.
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const t = typeahead.current;
      t.text = now - t.at > 600 ? e.key.toLowerCase() : t.text + e.key.toLowerCase();
      t.at = now;
      const query = /^(.)\1*$/.test(t.text) ? t.text[0] : t.text;
      const from = open ? active : selectedIndex;
      const start = query.length > 1 ? from : from + 1;
      for (let k = 0; k < options.length; k++) {
        const i = (start + k) % options.length;
        if (sectorLabel(options[i]).toLowerCase().startsWith(query)) {
          openAt(i);
          break;
        }
      }
    }
  }

  return (
    <div className="relative">
      {/* The fused instrument: border, hover and the keyboard ring sit on this
          shell so the label cell and the value read as ONE control. A filter
          in force borrows the pressed-chip accent from Channel/Sort. */}
      <div
        className={cn(
          "flex h-7 items-stretch overflow-hidden rounded-md border bg-background transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
          filtered || open ? "border-primary/40" : "border-border hover:border-primary/40",
        )}
      >
        <span
          id={SECTOR_LABEL_ID}
          // Behaves like a <label>: a click focuses and opens the control.
          // Mousedown is swallowed so the click doesn't blur it shut first.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            comboRef.current?.focus();
            toggle();
          }}
          className={cn(
            "flex cursor-pointer select-none items-center border-r border-inherit px-2 font-mono text-[9.5px] uppercase tracking-[0.14em] transition-colors",
            filtered ? "bg-primary/10 text-foreground" : "bg-muted/40 text-muted-foreground",
          )}
        >
          Sector
        </span>
        <div
          ref={comboRef}
          id="telemetry-sector"
          role="combobox"
          tabIndex={0}
          aria-labelledby={SECTOR_LABEL_ID}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={SECTOR_LIST_ID}
          aria-activedescendant={open ? sectorOptionId(active) : undefined}
          onClick={toggle}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
          data-track="telemetry_sector_menu"
          className="flex min-w-0 cursor-pointer select-none items-center gap-2 pl-2.5 pr-2 text-[11px] font-medium text-foreground outline-none focus-visible:outline-none"
        >
          <span className="max-w-[13rem] truncate">{sectorLabel(value)}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out motion-reduce:transition-none",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </div>
      </div>

      {/* Kept mounted so the list animates shut as well as open — see
          `.apmg-menu` in globals.css. Mousedown is swallowed across the whole
          panel so picking (or missing an option) never blurs the trigger. */}
      <div
        id={SECTOR_LIST_ID}
        role="listbox"
        aria-labelledby={SECTOR_LABEL_ID}
        aria-hidden={!open}
        data-open={open}
        onMouseDown={(e) => e.preventDefault()}
        className="apmg-menu absolute left-0 top-full z-30 mt-1.5 w-max min-w-full max-w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-border bg-card shadow-lg ring-1 ring-foreground/5"
      >
        <div className="max-h-72 overflow-y-auto py-1">
          {options.map((s, i) => {
            const selected = i === selectedIndex;
            const count = s === ALL_SECTORS ? total : (counts.get(s) ?? 0);
            return (
              <div key={s}>
                <div
                  ref={(el) => {
                    optionRefs.current[i] = el;
                  }}
                  id={sectorOptionId(i)}
                  role="option"
                  aria-selected={selected}
                  onClick={() => pick(i)}
                  onMouseMove={() => {
                    if (active !== i) setActive(i);
                  }}
                  data-track="telemetry_sector"
                  data-track-sector={s}
                  className={cn(
                    "flex cursor-pointer items-start gap-2 px-3 py-1.5 text-xs transition-colors",
                    i === active ? "bg-foreground/[0.06]" : "",
                    selected || i === active ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  <Check
                    className={cn("mt-px h-3.5 w-3.5 shrink-0 text-primary", selected ? "opacity-100" : "opacity-0")}
                    aria-hidden
                  />
                  {/* sector names come from the lead data and can run long —
                      wrap rather than truncate the thing being chosen */}
                  <span className="min-w-0 flex-1 break-words font-medium leading-snug">
                    {sectorLabel(s)}
                  </span>
                  <span
                    className={cn(
                      "tnum mt-px shrink-0 pl-3 font-mono text-[10px]",
                      count === 0 ? "text-muted-foreground/50" : "text-muted-foreground",
                    )}
                  >
                    {formatInt(count)}
                  </span>
                </div>
                {s === ALL_SECTORS && <div role="none" className="mx-3 my-1 h-px bg-border/70" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────  lead row  ─────────────────────────── */

/** The activity list's column template — Lead · Source · ID · Score · Sector ·
 *  Events · Last seen. ONE definition, read by both the column head and every row, so
 *  the headings can't drift off the cells they sit over. Deliberately left
 *  unprefixed: below lg the row is flex-col, where a grid template is inert,
 *  so the stacked layout needs no second definition.
 *
 *  The five named tracks are deliberately mean, because everything they don't
 *  take goes to Events — and the trail is the one cell whose content can be
 *  400px wide. Below that width it wraps and the row doubles in height, which
 *  is what the tighter sub-xl set is for. */
const LEAD_COLS =
  "grid-cols-[minmax(0,8.5rem)_minmax(0,6rem)_4.5rem_5.5rem_minmax(0,6rem)_minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,13rem)_7.5rem_6rem_5.5rem_minmax(0,9rem)_minmax(0,1fr)_auto]";

/** Width of the per-row trash column, mirrored by a spacer in the head so the
 *  headings stay over their own columns instead of sliding one gap right. */
const ROW_ACTION_W = "w-10";

/** Below lg the row stacks and the column head is hidden, so a bare uuid or a
 *  bare number has nothing above it saying what it is. This is that label. */
function CellLabel({ children }: { children: ReactNode }) {
  return (
    <span className="mr-1.5 shrink-0 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground/70 lg:hidden">
      {children}
    </span>
  );
}

/** First segment of the lead uuid — enough to tell two rows apart at a glance
 *  and to match a row against Supabase; the cell carries the full value in
 *  its title. */
function shortLeadId(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id;
}

/** Column head for the activity list. Hidden below lg, where the rows stack
 *  and name their own cells instead. */
function LeadTableHead() {
  return (
    <div className="hidden items-stretch border-b border-border bg-muted/25 lg:flex">
      <div
        className={cn(
          "grid min-w-0 flex-1 items-center gap-3 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground",
          LEAD_COLS,
        )}
      >
        <span>Lead</span>
        <span>Source</span>
        <span>ID</span>
        <span>Score</span>
        <span>Sector</span>
        <span>Events</span>
        {/* pr-7 clears the row's chevron (1rem, plus the 0.75rem grid gap) so
            the heading sits over the timestamp, not over the expand cue. */}
        <span className="pr-7 text-right">Last seen</span>
      </div>
      <div className={cn("shrink-0 border-l border-border/70", ROW_ACTION_W)} aria-hidden />
    </div>
  );
}

/** This row's delete flow: null = quiet, "confirm" = strip shown, "busy" =
 *  the DELETE request is in flight. */
type DeletePhase = "confirm" | "busy" | null;

/** Memoised (ui-standards §5.2): expanding one row must not re-render the
 *  other ninety-nine trails. */
const LeadRow = memo(function LeadRow({
  lead,
  open,
  unseen,
  deletable,
  onToggle,
  deletePhase,
  deleteError,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  lead: ActivityRow;
  open: boolean;
  /** New (unacknowledged) customer events on this lead — drives the blinking
   *  red dot. Cleared by toggling the row (that's the acknowledgement). */
  unseen: number;
  /** False for source-tagged visitor rows — there is no lead behind them to
   *  DELETE by id (the Anonymous panel's Clear is what removes them), so the
   *  trash gives way to an inert spacer that keeps the columns aligned. */
  deletable: boolean;
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
  const source = rowSource(lead);

  return (
    <motion.li
      variants={reduce ? ROW_VARIANTS_REDUCED : ROW_VARIANTS}
      className="border-t border-border/70 first:border-t-0"
    >
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
          className={cn(
            "flex min-w-0 flex-1 flex-col gap-2 px-4 py-3.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))] lg:grid lg:items-center lg:gap-3",
            LEAD_COLS,
          )}
        >
          {/* ── Lead: who it is, plus the campaign that reached them ───── */}
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
            </span>
            {lead.contactName && (
              <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                {lead.contactTitle ? `${lead.contactName} · ${lead.contactTitle}` : lead.contactName}
              </span>
            )}
            {lead.campaign && (
              <span className="mt-1 flex min-w-0">
                <span
                  title={lead.campaign}
                  className="inline-flex max-w-full items-center rounded-full border border-primary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-primary"
                >
                  <span className="truncate">{lead.campaign}</span>
                </span>
              </span>
            )}
          </span>

          {/* ── Source: where the row came from, with the brand mark ──── */}
          <span className="flex min-w-0 items-center">
            <CellLabel>Source</CellLabel>
            {source ? (
              <span title={source.label} className="inline-flex min-w-0 items-center gap-1.5">
                {isBrand(source.slug) && <ChannelMark brand={source.slug} />}
                <span className="truncate text-[11.5px] text-foreground">{source.label}</span>
              </span>
            ) : (
              <span className="font-mono text-[10px] text-muted-foreground/60">—</span>
            )}
          </span>

          {/* ── ID: the lead uuid, truncated; hover carries the full value ── */}
          <span className="flex min-w-0 items-center">
            <CellLabel>ID</CellLabel>
            <span
              title={lead.leadId}
              className="truncate font-mono text-[10px] text-muted-foreground"
            >
              {shortLeadId(lead.leadId)}
            </span>
          </span>

          {/* ── Score: the number and the band it lands in. The hotter the
                 lead the louder the chip; an enquiry is always Hottest. ──── */}
          <span className="flex min-w-0 items-center">
            <CellLabel>Score</CellLabel>
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

          {/* ── Sector: its own column, so the operator can read it down the
                 page and see what the sector filter above is acting on. ─── */}
          <span className="flex min-w-0 items-center">
            <CellLabel>Sector</CellLabel>
            {lead.category ? (
              <span
                title={lead.category}
                className="inline-flex max-w-full items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
              >
                <span className="truncate">{lead.category}</span>
              </span>
            ) : (
              <span className="font-mono text-[10px] text-muted-foreground/60">—</span>
            )}
          </span>

          {/* ── Events: the trail, with the count it adds up to ──────── */}
          <span className="flex min-w-0 items-center gap-2">
            <CellLabel>Events</CellLabel>
            <EventTrail events={visible} />
            <span
              className="tnum shrink-0 font-mono text-[10px] text-muted-foreground"
              title={`${formatInt(visible.length)} ${visible.length === 1 ? "event" : "events"}`}
            >
              {formatInt(visible.length)}
            </span>
          </span>

          {/* ── Last seen, and the expand cue ─────────────────── */}
          <span className="flex shrink-0 items-center justify-between gap-3 lg:justify-end">
            <span
              className="tnum font-mono text-[10.5px] text-muted-foreground"
              title={fmtStamp(lead.lastSeen)}
            >
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
        {deletable ? (
          <button
            type="button"
            onClick={() => (deletePhase ? onDeleteCancel() : onDeleteRequest(lead.leadId))}
            disabled={deletePhase === "busy"}
            aria-label={`Delete ${name}'s click activity`}
            data-track="telemetry_lead_delete"
            data-track-lead={lead.leadId}
            className={cn(
              "flex shrink-0 items-center justify-center border-l border-border/70 text-muted-foreground/70 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50",
              ROW_ACTION_W,
            )}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : (
          <div className={cn("shrink-0 border-l border-border/70", ROW_ACTION_W)} aria-hidden />
        )}
      </div>

      {/* inline destructive confirm (StoredLeads grammar) — a stray click on
          the trash can't wipe a trail; Delete here is the real action. */}
      {deletePhase && (
        <div className="flex flex-wrap items-center gap-2 border-t border-destructive/40 bg-destructive/[0.04] px-4 py-2">
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <span className="text-[12px] text-foreground">
            Permanently delete {name}&rsquo;s click activity and enquiries?
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
    </motion.li>
  );
});

/* ───────────────────────────  unsubscribed row  ─────────────────────────── */

/** One recorded opt-out. Read-only by design: a suppression row is the record
 *  of someone asking us to stop, so there is no delete affordance here — the
 *  only way back onto the list is the person themselves getting back in touch
 *  (see the unsubscribe confirmation page). */
const UnsubscribedRow = memo(function UnsubscribedRow({ person }: { person: UnsubscribedPerson }) {
  // A bare-address opt-out (no lead id on the link, or the lead has since been
  // reimported) still names a real person — the address leads the row instead.
  const named = person.business !== null;
  return (
    <li className="border-t border-border/70 first:border-t-0">
      <div className="flex flex-col gap-1.5 px-4 py-3.5 md:grid md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-3">
        <div className="min-w-0">
          <div
            className={cn(
              "truncate text-[13px] font-medium",
              named ? "text-foreground" : "font-mono text-muted-foreground",
            )}
          >
            {person.business ?? person.email}
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            {named && (
              <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                {person.email}
              </span>
            )}
            {person.category && (
              <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                {person.category}
              </span>
            )}
            {person.campaign && (
              <span className="inline-flex max-w-full items-center truncate rounded-full border border-primary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-primary">
                {person.campaign}
              </span>
            )}
            {/* Every self-service opt-out reads "unsubscribe"; anything else was
                recorded by hand and is worth saying out loud. */}
            {person.reason !== "unsubscribe" && (
              <span className="inline-flex max-w-full items-center truncate rounded-full border border-border px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                {person.reason}
              </span>
            )}
          </div>
        </div>
        <span
          className="tnum shrink-0 font-mono text-[10.5px] text-muted-foreground"
          title={fmtStamp(person.createdAt)}
        >
          {fmtWhen(person.createdAt)}
        </span>
      </div>
    </li>
  );
});

/* ───────────────────────────  chat rows  ─────────────────────────── */

/** Chat table tracks: Who · Source · Sector · Conversation · Last message ·
 *  Actions. Conversation takes the slack — it carries the opening question. */
const CHAT_COLS =
  "grid-cols-[minmax(0,10rem)_minmax(0,8rem)_minmax(0,6rem)_minmax(0,1fr)_5rem_auto] xl:grid-cols-[minmax(0,13rem)_minmax(0,9.5rem)_minmax(0,8rem)_minmax(0,1fr)_5.5rem_auto]";

function ChatTableHead() {
  return (
    <div
      className={cn(
        "hidden items-center gap-3 border-b border-border bg-muted/25 px-4 py-2 font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground lg:grid",
        CHAT_COLS,
      )}
    >
      <span>Who</span>
      <span>Source</span>
      <span>Sector</span>
      <span>Conversation</span>
      <span className="text-right">Last message</span>
      <span className="text-right">Actions</span>
    </div>
  );
}

/** One chat as a line item. Memoised like LeadRow: a poll that changes one
 *  chat must not re-render the rest. View opens the full-detail modal. */
const ChatRow = memo(function ChatRow({
  chat,
  sales,
  sending,
  onView,
  onSend,
  deletePhase,
  deleteError,
  onDeleteRequest,
  onDeleteCancel,
  onDeleteConfirm,
}: {
  chat: ChatConversation;
  /** where this person stands with Sales — see ChatSalesState */
  sales: ChatSalesState;
  /** this row's hand-off is in flight */
  sending: boolean;
  onView: (conversationId: string) => void;
  onSend: (leadId: string) => void;
  deletePhase: DeletePhase;
  deleteError: string | null;
  onDeleteRequest: (conversationId: string) => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: (conversationId: string) => void;
}) {
  const reduce = useReducedMotion();
  const name = chatDisplayName(chat);
  const questions = chat.exchanges.length;
  const unanswered = chat.exchanges.filter((e) => e.outcome === "fallback").length;
  const hitLimit = chat.exchanges.some((e) => e.outcome === "limit");
  const opening = chat.exchanges[0]?.question ?? "";
  const leadFrom = chat.leadSource ? LEAD_ORIGIN_NAME[chat.leadSource] : null;

  return (
    <motion.li
      variants={reduce ? ROW_VARIANTS_REDUCED : ROW_VARIANTS}
      className="border-t border-border/70 first:border-t-0"
    >
      <div
        className={cn(
          "flex min-w-0 flex-col gap-2 px-4 py-3 lg:grid lg:items-center lg:gap-3",
          CHAT_COLS,
        )}
      >
        {/* ── Who: the school / business, or the visitor's channel ──── */}
        <span className="block min-w-0">
          <span
            className={cn(
              "block truncate text-[13px] font-medium",
              chat.business ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {name}
          </span>
          {chat.contact?.contactName && (
            <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
              {chat.contact.contactName}
            </span>
          )}
          {chat.campaign && (
            <span className="mt-1 flex min-w-0">
              <span
                title={chat.campaign}
                className="inline-flex max-w-full items-center rounded-full border border-primary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-primary"
              >
                <span className="truncate">{chat.campaign}</span>
              </span>
            </span>
          )}
        </span>

        {/* ── Source: how they reached the portal, and for an outreach
               lead, where we got the lead from ──────────────────── */}
        <span className="flex min-w-0 items-center">
          <CellLabel>Source</CellLabel>
          <span className="block min-w-0">
            <span title={sourceLabel(chat.channel)} className="flex min-w-0 items-center gap-1.5">
              <ChatSourceMark channel={chat.channel} />
              <span className="truncate text-[11.5px] text-foreground">{sourceLabel(chat.channel)}</span>
            </span>
            {leadFrom && (
              <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
                lead from {leadFrom}
              </span>
            )}
          </span>
        </span>

        {/* ── Sector ─────────────────────────────────────────── */}
        <span className="flex min-w-0 items-center">
          <CellLabel>Sector</CellLabel>
          {chat.category ? (
            <span
              title={chat.category}
              className="inline-flex max-w-full items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
            >
              <span className="truncate">{chat.category}</span>
            </span>
          ) : (
            <span className="font-mono text-[10px] text-muted-foreground/60">—</span>
          )}
        </span>

        {/* ── Conversation: what they opened with, and how it went ── */}
        <span className="block min-w-0">
          <span title={opening} className="block truncate text-[12px] text-foreground">
            &ldquo;{opening}&rdquo;
          </span>
          <span className="mt-1 flex flex-wrap items-center gap-1.5">
            <span className="tnum font-mono text-[10px] text-muted-foreground">
              {formatInt(questions)} {questions === 1 ? "question" : "questions"}
            </span>
            {unanswered > 0 && (
              <span
                title="The assistant couldn't answer and pointed them to the enquiry form instead"
                className="inline-flex items-center rounded-full border border-amber-500/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-amber-600 dark:text-amber-400"
              >
                {formatInt(unanswered)} unanswered
              </span>
            )}
            {hitLimit && (
              <span
                title="They used every question the chat allows"
                className="inline-flex items-center rounded-full border border-primary/40 px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-primary"
              >
                Hit the limit
              </span>
            )}
          </span>
        </span>

        {/* ── Last message ───────────────────────────────────── */}
        <span className="flex min-w-0 items-center lg:justify-end">
          <CellLabel>Last message</CellLabel>
          <span className="tnum font-mono text-[10.5px] text-muted-foreground" title={fmtStamp(chat.lastAt)}>
            {fmtWhen(chat.lastAt)}
          </span>
        </span>

        {/* ── Actions: view everything, hand to Sales, delete ────── */}
        <span className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap lg:justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onView(chat.conversationId)}
            aria-label={`View the chat with ${name}`}
            data-track="telemetry_chat_view"
            className="gap-1.5"
          >
            <Eye className="h-3.5 w-3.5" aria-hidden />
            View
          </Button>
          {sales.state === "sent" ? (
            <span
              title={`Handed to Sales ${fmtStamp(sales.at)}`}
              className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-md border border-border px-2.5 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"
            >
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
              In Sales
            </span>
          ) : (
            <Button
              size="sm"
              disabled={sales.state === "blocked" || sending || !chat.leadId}
              title={sales.state === "blocked" ? sales.reason : "Add them to the Sales queue and email the sales desk"}
              onClick={() => chat.leadId && onSend(chat.leadId)}
              aria-label={`Send ${name} to Sales`}
              data-track="telemetry_chat_send_to_sales"
              className="gap-1.5 whitespace-nowrap bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              {sending ? "Sending…" : "Send to Sales"}
            </Button>
          )}
          <button
            type="button"
            onClick={() => (deletePhase ? onDeleteCancel() : onDeleteRequest(chat.conversationId))}
            disabled={deletePhase === "busy"}
            aria-label={`Delete the chat with ${name}`}
            title="Delete this chat"
            data-track="telemetry_chat_delete"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground/70 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        </span>
      </div>

      {deletePhase && (
        <div className="flex flex-wrap items-center gap-2 border-t border-destructive/40 bg-destructive/[0.04] px-4 py-2">
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <span className="text-[12px] text-foreground">Permanently delete this chat with {name}?</span>
          {deleteError && (
            <span role="alert" className="font-mono text-[10.5px] text-destructive">
              {deleteError}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onDeleteCancel} disabled={deletePhase === "busy"}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => onDeleteConfirm(chat.conversationId)}
              disabled={deletePhase === "busy"}
              data-track="telemetry_chat_delete_confirm"
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {deletePhase === "busy" ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </div>
      )}
    </motion.li>
  );
});

/* ───────────────────────────  shared list foot  ─────────────────────────── */

/** The pager under either tab — it only exists once a list outgrows a page. */
function Pager({
  page,
  pageCount,
  total,
  onPage,
}: {
  /** clamped 0-based page */
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
      <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {formatInt(page * PAGE_SIZE + 1)}–{formatInt(Math.min((page + 1) * PAGE_SIZE, total))} of{" "}
        {formatInt(total)}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => onPage(page - 1)}
          data-track="telemetry_page_prev"
          className="gap-1"
        >
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          Prev
        </Button>
        <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          Page {formatInt(page + 1)} / {formatInt(pageCount)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPage(page + 1)}
          data-track="telemetry_page_next"
          className="gap-1"
        >
          Next
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

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

/* ───────────────────────────  services clicked card  ─────────────────────────── */

/** Short channel names for the per-service split line — the card is 20rem wide. */
function channelShort(source: string): string {
  if (source === OUTREACH_SOURCE) return "email";
  if (source === DIRECT_SOURCE) return "anonymous";
  return sourceLabel(source);
}

/** "7 email · 1 anonymous · 1 enquiry" — where one service's clicks came from. */
function ClickSplit({ row }: { row: ServiceClickRow }) {
  const parts = row.bySource.map((s) => `${formatInt(s.opens)} ${channelShort(s.source)}`);
  if (row.inquiries > 0) {
    parts.push(`${formatInt(row.inquiries)} ${row.inquiries === 1 ? "enquiry" : "enquiries"}`);
  }
  if (parts.length === 0) return null;
  return <p className="mt-1 font-mono text-[10px] text-muted-foreground">{parts.join(" · ")}</p>;
}

/**
 * Which trades people click — every visitor, every trade. Zero-click trades
 * stay listed (that's an answer too), and the quote buttons sit apart: they
 * aren't a trade, and at several times every trade combined a bar for them
 * would flatten the rest of the list.
 */
function ServicesClickedPanel({ services }: { services: ServiceClicks }) {
  const max = Math.max(1, ...services.trades.map((t) => t.opens));
  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead
        title="Services clicked"
        meta={
          <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            {formatInt(services.total)} {services.total === 1 ? "click" : "clicks"}
          </span>
        }
      />
      <div className="px-4 py-4">
        <div
          className="flex items-center justify-between border-b border-border/70 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
          aria-hidden
        >
          <span>Service</span>
          <span>clicks</span>
        </div>
        <ul className="mt-2 space-y-2.5">
          {services.trades.map((t) => (
            <li key={t.service}>
              <div className="flex items-baseline justify-between gap-2">
                <span
                  className={cn(
                    "truncate text-[12px] font-medium",
                    t.opens > 0 ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {serviceName(t.service)}
                </span>
                <span className="tnum shrink-0 font-mono text-[11px] text-foreground">
                  {formatInt(t.opens)}
                </span>
              </div>
              <div
                className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border"
                role="img"
                aria-label={`${serviceName(t.service)}: ${t.opens} clicks`}
              >
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${(t.opens / max) * 100}%` }}
                />
              </div>
              <ClickSplit row={t} />
            </li>
          ))}
        </ul>

        <div className="mt-3 border-t border-border pt-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px] font-medium text-foreground">
              Quote buttons <span className="text-muted-foreground">· general enquiry</span>
            </span>
            <span className="tnum shrink-0 font-mono text-[11px] text-foreground">
              {formatInt(services.general.opens)}
            </span>
          </div>
          <ClickSplit row={services.general} />
        </div>

        <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
          Every visitor, all time. Email clicks include mail scanners that open links on their
          own, so those numbers run high.
        </p>
      </div>
    </section>
  );
}

function ServicesClickedSkeleton() {
  return (
    <section
      className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10"
      aria-busy
    >
      <PanelHead title="Services clicked" />
      <div className="space-y-3 px-4 py-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}>
            <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
            <div className="mt-1.5 h-1 w-full animate-pulse rounded-full bg-muted/70" />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ───────────────────────────  anonymous visitors card  ─────────────────────────── */

function AnonymousPanel({
  anonymous,
  canClear,
  onClear,
}: {
  anonymous: AnonymousActivity;
  /** Live mode with something to clear — demo zeros get no destructive control. */
  canClear: boolean;
  /** Resolves an error message to keep the strip up, or null on success. */
  onClear: () => Promise<string | null>;
}) {
  const max = Math.max(1, ...anonymous.topServices.map((s) => s.opens));
  /** Same grammar as a lead row's delete: quiet trash → confirm strip → busy. */
  const [clearPhase, setClearPhase] = useState<null | "confirm" | "busy">(null);
  const [clearError, setClearError] = useState<string | null>(null);
  const confirmClear = async () => {
    setClearPhase("busy");
    setClearError(null);
    const err = await onClear();
    if (err) {
      setClearPhase("confirm");
      setClearError(err);
    } else {
      setClearPhase(null);
    }
  };
  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead
        title="Anonymous portal visitors"
        meta={
          <span className="flex items-center gap-1">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              untracked
            </span>
            {canClear && (
              <button
                type="button"
                onClick={() => {
                  setClearError(null);
                  setClearPhase((p) => (p ? null : "confirm"));
                }}
                disabled={clearPhase === "busy"}
                aria-label="Clear anonymous portal activity"
                data-track="telemetry_anon_clear"
                className="rounded p-1 text-muted-foreground/70 outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))] disabled:pointer-events-none disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            )}
          </span>
        }
      />
      {/* inline destructive confirm (same grammar as the lead rows) — clearing
          wipes every unattributed portal event, so it sits behind a strip. */}
      {clearPhase && (
        <div className="flex flex-wrap items-center gap-2 border-t border-destructive/40 bg-destructive/[0.04] px-4 py-2">
          <Trash2 className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
          <span className="text-[12px] text-foreground">
            Permanently delete all anonymous portal activity, tagged social visitors included?
            Enquiries are kept.
          </span>
          {clearError && (
            <span role="alert" className="font-mono text-[10.5px] text-destructive">
              {clearError}
            </span>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setClearPhase(null)}
              disabled={clearPhase === "busy"}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={confirmClear}
              disabled={clearPhase === "busy"}
              data-track="telemetry_anon_clear_confirm"
              className="gap-1.5"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {clearPhase === "busy" ? "Clearing…" : "Clear"}
            </Button>
          </div>
        </div>
      )}
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
          Portal visitors who didn&rsquo;t arrive via a tracked outreach email or a tagged social
          link — real interest, but with no identity to pin the clicks to. Team visits count
          here until each browser is{" "}
          {/* The admin host's internal mark can't reach the customer host
              (cookies are per host) — /api/portal/staff sets it there. */}
          <a
            href={`${PORTAL_ORIGIN}/api/portal/staff`}
            target="_blank"
            rel="noopener"
            data-track="telemetry_mark_staff"
            className="font-medium text-foreground underline decoration-primary/60 underline-offset-2 outline-none hover:decoration-primary focus-visible:shadow-[0_0_0_2px_hsl(var(--ring))]"
          >
            marked as staff
          </a>
          .
        </p>

        {anonymous.topServices.length > 0 ? (
          <div className="mt-4">
            <div
              className="flex items-center justify-between border-b border-border/70 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              aria-hidden
            >
              <span>Services</span>
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
  visitors?: unknown;
  anonymous?: unknown;
  unsubscribes?: unknown;
  unsubscribesTotal?: unknown;
  unsubscribesAvailable?: unknown;
  hideWarmFalsePositives?: unknown;
  warmFalsePositives?: unknown;
  error?: string;
}
interface SummaryPayload {
  mode?: string;
  needsMigration?: boolean;
  totals?: Record<string, unknown>;
  bySource?: unknown;
  byService?: unknown;
  error?: string;
}

export function TelemetryPage() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** Lead-activity list page (0-based). Never trusted directly — the render
   *  clamps it, so a shrinking list (deletes, refetch) can't strand the view
   *  on a page that no longer exists. */
  const [page, setPage] = useState(0);
  /** Which audience the main table is showing (engaged leads / opt-outs). */
  const [tab, setTab] = useState<TableTab>("activity");
  /** How the list is ranked — the "where's the interest" control. */
  const [sort, setSort] = useState<SortKey>("recent");
  /** Sector narrowing (a lead `category`, or ALL_SECTORS for no filter). */
  const [sector, setSector] = useState<string>(ALL_SECTORS);
  /** Channel narrowing — which door the visitor came through (outreach email
   *  / facebook / …, or ALL_CHANNELS for no filter). */
  const [channel, setChannel] = useState<string>(ALL_CHANNELS);
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
  /** The "Hide warm false positives" tickbox as this page shows it — null
   *  until the route first reports the saved app_settings value. The page
   *  applies it to the rows it already holds, so it never waits on a fetch.
   *  The ref is fetchAll's copy (fetchAll is stable, with [] deps). */
  const [hideWarm, setHideWarm] = useState<boolean | null>(null);
  const hideWarmRef = useRef<boolean | null>(null);
  const [hideError, setHideError] = useState<string | null>(null);
  /** The value app_settings last confirmed — where a failed save goes back to. */
  const savedHideRef = useRef<boolean | null>(null);
  /** A tickbox value still to be saved, and whether a save is running. */
  const queuedHideRef = useRef<boolean | null>(null);
  const savingHideRef = useRef(false);
  /** At most ONE row's delete flow is open at a time. */
  const [deleteFlow, setDeleteFlow] = useState<{
    id: string;
    busy: boolean;
    error: string | null;
  } | null>(null);
  const mountedRef = useRef(true);
  /** Mirror of `mode` for the delete callback (kept stable with [] deps). */
  const demoRef = useRef(false);
  /** The Chats tab: its own payload (/api/portal/chats), channel filter,
   *  open transcripts and delete flow — none of it shared with the trails. */
  const [chats, setChats] = useState<ChatsLoad>({ status: "loading" });
  const [chatChannelFilter, setChatChannelFilter] = useState<string>(ALL_CHANNELS);
  /** The chat whose View modal is open (null = closed). */
  const [viewChatId, setViewChatId] = useState<string | null>(null);
  /** The one hand-off in flight, and the last one that failed. */
  const [chatSend, setChatSend] = useState<{ leadId: string; busy: boolean; error: string | null } | null>(
    null,
  );
  /** Send to Sales is the Hot Leads hand-off, so it needs that permission;
   *  without it the Sales state isn't read at all (the route would 403). */
  const { can } = useRbac();
  const canHandOff = can("hotleads.handoff");
  const handedOff = useHandedOffToSales(canHandOff);
  const [chatDeleteFlow, setChatDeleteFlow] = useState<{
    id: string;
    busy: boolean;
    error: string | null;
  } | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  /** Load the chat transcripts. Same silent contract as fetchAll: a poll
   *  never knocks a ready list back to a skeleton or an error. */
  const fetchChats = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent === true;
    const fail = (error: string) =>
      setChats((prev) => (silent && prev.status === "ready" ? prev : { status: "error", error }));
    try {
      const res = await fetch("/api/portal/chats", { cache: "no-store", headers: adminHeaders() });
      const data = (await res.json().catch(() => null)) as {
        mode?: string;
        needsMigration?: boolean;
        conversations?: unknown;
        windowFull?: unknown;
        error?: string;
      } | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data) {
        fail(data?.error ?? `Couldn't load chats (${res.status}).`);
        return;
      }
      const next: ChatsLoad = {
        status: "ready",
        mode: data.mode === "demo" ? "demo" : "live",
        needsMigration: data.needsMigration === true,
        conversations: (Array.isArray(data.conversations) ? data.conversations : [])
          .map(toChatConversation)
          .filter((c): c is ChatConversation => c !== null),
        windowFull: data.windowFull === true,
      };
      setChats((prev) =>
        prev.status === "ready" && JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
      );
    } catch {
      if (mountedRef.current) fail("Network error loading chats.");
    }
  }, []);

  // One read on arrival, so the Chats tab's count chip is there before anyone
  // opens it; after that it only polls while it's the tab on screen.
  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    if (tab !== "chats") return;
    const tick = () => {
      if (document.visibilityState === "visible") fetchChats({ silent: true });
    };
    tick();
    const id = setInterval(tick, CHATS_POLL_MS);
    window.addEventListener("focus", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
    };
  }, [tab, fetchChats]);

  const openChat = useCallback((conversationId: string) => {
    setViewChatId(conversationId);
    setChatSend((prev) => (prev?.busy ? prev : null));
  }, []);
  const closeChat = useCallback(() => setViewChatId(null), []);

  /** Hand the lead behind a chat to Sales — the same one-way step as Hot
   *  Leads' button (queue + desk email), idempotent server-side, so a stale
   *  tab or double-click can't send anyone twice. */
  const sendChatToSales = useCallback(async (leadId: string) => {
    setChatSend({ leadId, busy: true, error: null });
    const error = await handOffToSales([leadId]);
    if (!mountedRef.current) return;
    setChatSend(error ? { leadId, busy: false, error } : null);
  }, []);

  const requestChatDelete = useCallback((conversationId: string) => {
    setChatDeleteFlow({ id: conversationId, busy: false, error: null });
  }, []);

  const cancelChatDelete = useCallback(() => {
    setChatDeleteFlow((prev) => (prev?.busy ? prev : null));
  }, []);

  const confirmChatDelete = useCallback(async (conversationId: string) => {
    setChatDeleteFlow({ id: conversationId, busy: true, error: null });
    try {
      const res = await fetch(`/api/portal/chats?conversationId=${encodeURIComponent(conversationId)}`, {
        method: "DELETE",
        headers: adminHeaders(),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data?.ok) {
        setChatDeleteFlow({
          id: conversationId,
          busy: false,
          error: data?.error ?? `Delete failed (${res.status}).`,
        });
        return;
      }
      setChatDeleteFlow(null);
      setChats((prev) =>
        prev.status === "ready"
          ? { ...prev, conversations: prev.conversations.filter((c) => c.conversationId !== conversationId) }
          : prev,
      );
    } catch {
      if (mountedRef.current) {
        setChatDeleteFlow({ id: conversationId, busy: false, error: "Network error during delete." });
      }
    }
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
    // The saved tickbox rides along only until this page knows it — one
    // settings read on the first load, none on every poll after.
    const activityUrl = `/api/portal/lead-activity?view=telemetry${
      hideWarmRef.current === null ? "&settings=1" : ""
    }`;
    try {
      const [actRes, sumRes] = await Promise.all([
        fetch(activityUrl, { cache: "no-store", headers: adminHeaders() }),
        fetch("/api/portal/summary", { cache: "no-store" }),
      ]);
      const act = (await actRes.json().catch(() => null)) as ActivityPayload | null;
      const sum = (await sumRes.json().catch(() => null)) as SummaryPayload | null;
      if (!mountedRef.current) return;

      // Not connected: show nothing and say why. Previously this swapped in a
      // believable preset, which is indistinguishable from real telemetry in a
      // screenshot — the reason this page had to stop doing it.
      if (act?.mode === "demo" || sum?.mode === "demo") {
        settle({
          status: "ready",
          mode: "demo",
          needsMigration: act?.needsMigration === true || sum?.needsMigration === true,
          leads: [],
          visitors: [],
          anonymous: { visitors: 0, events: 0, topServices: [] },
          totals: {
            engagedLeads: 0,
            enquiredLeads: 0,
            attributedInquiries: 0,
            attributionClicks: 0,
            portalViews: 0,
            serviceOpens: 0,
            inquiries: 0,
          },
          unsubscribes: [],
          facebook: EMPTY_SOURCE,
          google: EMPTY_SOURCE,
          linkedin: EMPTY_SOURCE,
          external: EMPTY_SOURCE,
          services: toServiceClicks([]),
          unsubscribesTotal: 0,
          // No database, so the opt-out list is unknown rather than empty.
          unsubscribesAvailable: false,
          warmFalsePositives: 0,
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
      const visitors = (Array.isArray(act.visitors) ? act.visitors : [])
        .map(toVisitor)
        .filter((v): v is SourcedVisitorActivity => v !== null);
      const unsubscribes = (Array.isArray(act.unsubscribes) ? act.unsubscribes : [])
        .map(toUnsubscribed)
        .filter((u): u is UnsubscribedPerson => u !== null);
      // First read: adopt the saved tickbox, in the same render as the data,
      // so a ticked box never flashes the hidden rows. An unreadable setting
      // stays unknown rather than becoming "off", and the next poll asks again.
      if (hideWarmRef.current === null && typeof act.hideWarmFalsePositives === "boolean") {
        hideWarmRef.current = act.hideWarmFalsePositives;
        savedHideRef.current = act.hideWarmFalsePositives;
        setHideWarm(act.hideWarmFalsePositives);
      }
      // Feed the notification store the same data this page renders so the
      // row dots / nav badge never lag behind what's on screen. The route's
      // newest-N slice is exactly what the store's own poll reads, so the two
      // never disagree about which leads exist.
      ingestLeadActivity(leads.slice(0, LEAD_ACTIVITY_MAX_LEADS));
      settle({
        status: "ready",
        mode: "live",
        needsMigration: false,
        leads,
        visitors,
        anonymous: toAnonymous(act.anonymous),
        totals: {
          engagedLeads: num(sum.totals.engagedLeads),
          enquiredLeads: num(sum.totals.enquiredLeads),
          attributedInquiries: num(sum.totals.attributedInquiries),
          attributionClicks: num(sum.totals.attributionClicks),
          portalViews: num(sum.totals.portalViews),
          serviceOpens: num(sum.totals.serviceOpens),
          inquiries: num(sum.totals.inquiries),
        },
        unsubscribes,
        facebook: toSourceBucket(sum.bySource, "facebook"),
        google: toSourceBucket(sum.bySource, "google"),
        linkedin: toSourceBucket(sum.bySource, "linkedin"),
        external: toExternalBucket(sum.bySource),
        services: toServiceClicks(sum.byService),
        // The exact total can exceed what the route sends; never let the KPI
        // read lower than the rows the table is actually showing either.
        unsubscribesTotal: Math.max(num(act.unsubscribesTotal), unsubscribes.length),
        unsubscribesAvailable: act.unsubscribesAvailable === true,
        warmFalsePositives: num(act.warmFalsePositives),
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

  /** The Refresh button's loud pull — spins the icon for the whole round trip.
   *  Chats come along too, so the tab chip never lags a manual refresh. */
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([fetchAll(), fetchChats()]);
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [fetchAll, fetchChats]);

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

  /** Flip the tickbox. The table changes in the same frame — the flagged rows
   *  are already on the page — and the save to app_settings runs behind it.
   *  Saves go one at a time and always send the latest click, so fast
   *  toggling ends on the value the box shows; if that last save fails, the
   *  box goes back to what is actually saved and says why. */
  const saveHideWarmFalsePositives = useCallback((hide: boolean) => {
    hideWarmRef.current = hide;
    setHideWarm(hide);
    setPage(0);
    setHideError(null);
    queuedHideRef.current = hide;
    if (savingHideRef.current) return; // the running save picks this value up
    savingHideRef.current = true;
    void (async () => {
      try {
        while (queuedHideRef.current !== null) {
          const value = queuedHideRef.current;
          queuedHideRef.current = null;
          const error = await postHideWarmSetting(value);
          if (!mountedRef.current) return;
          if (error === null) {
            savedHideRef.current = value;
          } else if (queuedHideRef.current === null) {
            const saved = savedHideRef.current ?? !value;
            hideWarmRef.current = saved;
            setHideWarm(saved);
            setPage(0);
            setHideError(error);
          }
        }
      } finally {
        savingHideRef.current = false;
      }
    })();
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

  /** Clear the anonymous block server-side; zero it locally on success and
   *  silently refetch so the KPI totals drop in the same breath. Resolves an
   *  error message (the panel keeps its strip up) or null on success. */
  const clearAnonymous = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch("/api/portal/lead-activity?anonymous=1", {
        method: "DELETE",
        headers: adminHeaders(),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) return data?.error ?? `Clear failed (${res.status}).`;
      // The server purge covers every lead_id-null portal row, so the tagged
      // visitor trails fall with the aggregate block — drop both locally.
      setLoad((prev) =>
        prev.status === "ready"
          ? { ...prev, anonymous: { visitors: 0, events: 0, topServices: [] }, visitors: [] }
          : prev,
      );
      fetchAll({ silent: true });
      return null;
    } catch {
      return "Network error while clearing anonymous activity.";
    }
  }, [fetchAll]);

  const ready = load.status === "ready" ? load : null;
  const allLeads = ready?.leads;
  /** The leads the table shows. Ticked: every real lead the route sent.
   *  Unticked: the route's newest-N list, which is the first N of the merge.
   *  Both come from rows already on the page, so the tickbox costs no fetch. */
  const leads = useMemo(() => {
    const all = allLeads ?? [];
    return hideWarm ? all.filter((l) => !l.warmFalsePositive) : all.slice(0, LEAD_ACTIVITY_MAX_LEADS);
  }, [allLeads, hideWarm]);
  const visitors = ready?.visitors ?? [];
  /** Newest-first already (the route orders it) — the opt-out tab shows the
   *  list as recorded, with no re-ranking to choose between. */
  const unsubscribes = ready?.unsubscribes ?? [];
  demoRef.current = ready?.mode === "demo";
  /** Rows the tickbox takes out — only ever non-zero while it is on. */
  const hiddenWarm = hideWarm && ready ? ready.warmFalsePositives : 0;

  // The table's row set: every attributed lead (they all arrived through the
  // outreach email channel) plus every source-tagged visitor trail. Visitor
  // rows borrow the LeadActivity shape — the display name says the channel,
  // and the localStorage visitorId stands in where the lead uuid would be.
  const rows = useMemo<ActivityRow[]>(
    () => [
      ...leads.map((l) => ({ ...l, channel: OUTREACH_SOURCE, deletable: true })),
      ...visitors.map((v) => ({
        leadId: v.visitorId,
        business: `${sourceLabel(v.source)} visitor`,
        category: null,
        campaign: null,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        events: v.events,
        counts: v.counts,
        channel: v.source,
        deletable: false,
      })),
    ],
    [leads, visitors],
  );

  // Channel chips: the two promoted channels always show (a filter the
  // operator was promised shouldn't appear only after its first click), and
  // any other tagged source present in the data grows its own chip.
  const channels = useMemo(() => {
    const set = new Set<string>(BASE_CHANNELS);
    for (const v of visitors) set.add(v.source);
    return [...set];
  }, [visitors]);

  const activeChannel =
    channel !== ALL_CHANNELS && channels.includes(channel) ? channel : ALL_CHANNELS;

  // Gauges: conversions, then the channel dials (Facebook, Google, LinkedIn,
  // everything External) and opt-outs. Leads engaged, Email clicks and
  // Services viewed were taken off the row on Kane's call (2026-10-11).
  const stats = useMemo<TelemetryStat[]>(() => {
    if (!ready) return [];
    const t = ready.totals;
    // Opt-outs whose link carried a lead id — the rest arrived as a bare
    // address we can't tie to anyone, which is worth seeing as a proportion
    // (a run of unmatched rows is the signature of a gateway detonating the
    // link rather than of people leaving).
    const matchedOptOuts = ready.unsubscribes.filter((u) => u.leadId !== null).length;
    return [
      {
        id: "enquiries",
        label: "Enquiries",
        value: t.inquiries,
        icon: Inbox,
        caption: "qualified — email captured",
        ratio: {
          value: ratio(t.attributedInquiries, t.inquiries),
          label: "from tracked leads",
        },
      },
      {
        id: "facebook",
        label: "Facebook",
        // Engagements through the promoted link: portal visits stamped
        // source=facebook (?utm_source= on the post's URL, or a facebook.com
        // Referer). Views, not uniques.
        value: ready.facebook.views,
        icon: FacebookLogo,
        caption:
          ready.facebook.visitors === 1
            ? "portal visits · 1 visitor"
            : `portal visits · ${formatInt(ready.facebook.visitors)} visitors`,
        ratio: {
          value: ratio(ready.facebook.inquiries, ready.facebook.views),
          label: "became enquiries",
        },
      },
      {
        id: "google",
        label: "Google",
        // Portal visits stamped source=google — a google.* search Referer
        // (lib/portal/source.ts) or ?utm_source=google. Same unit as Facebook.
        value: ready.google.views,
        icon: GoogleLogo,
        caption:
          ready.google.visitors === 1
            ? "portal visits · 1 visitor"
            : `portal visits · ${formatInt(ready.google.visitors)} visitors`,
        ratio: {
          value: ratio(ready.google.inquiries, ready.google.views),
          label: "became enquiries",
        },
      },
      {
        id: "linkedin",
        label: "LinkedIn",
        // Portal visits stamped source=linkedin — a linkedin.com / lnkd.in
        // Referer or ?utm_source=linkedin. Same unit as Facebook and Google.
        // (LinkedIn-sourced LEADS who click an email are outreach clicks, not these.)
        value: ready.linkedin.views,
        icon: LinkedInLogo,
        caption:
          ready.linkedin.visitors === 1
            ? "portal visits · 1 visitor"
            : `portal visits · ${formatInt(ready.linkedin.visitors)} visitors`,
        ratio: {
          value: ratio(ready.linkedin.inquiries, ready.linkedin.views),
          label: "became enquiries",
        },
      },
      {
        id: "external",
        label: "External",
        // Every other tagged source summed: Instagram, TikTok, Bing, ChatGPT,
        // or any website linking to the portal (named by its host). Same unit
        // as the channel gauges; the channel chips break it down by source.
        value: ready.external.views,
        icon: Globe,
        caption:
          ready.external.visitors === 1
            ? "portal visits · 1 visitor"
            : `portal visits · ${formatInt(ready.external.visitors)} visitors`,
        ratio: {
          value: ratio(ready.external.inquiries, ready.external.views),
          label: "became enquiries",
        },
      },
      {
        id: "unsubscribed",
        label: "Unsubscribed",
        // Zero and "we couldn't read the list" must not look the same on a
        // gauge, so an unreadable list says so in the caption instead of
        // quietly reading as nobody having opted out.
        value: ready.unsubscribesAvailable ? ready.unsubscribesTotal : 0,
        icon: MailX,
        caption: ready.unsubscribesAvailable
          ? "opted out — never emailed again"
          : "opt-out list unavailable",
        ratio: ready.unsubscribesAvailable
          ? {
              value: ratio(matchedOptOuts, ready.unsubscribes.length),
              label: "matched to a lead",
            }
          : null,
      },
    ];
  }, [ready]);

  const totalEvents = useMemo(
    () => rows.reduce((sum, r) => sum + r.events.filter((e) => !isHiddenEvent(e.event)).length, 0),
    [rows],
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

  const channelRows = useMemo(
    () => (activeChannel === ALL_CHANNELS ? rows : rows.filter((r) => inChannel(r, activeChannel))),
    [rows, activeChannel],
  );
  // Trails per sector under the active channel — the same rows the list
  // narrows, so a count in the sector menu is exactly what picking it shows.
  const sectorCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of channelRows) {
      if (r.category) counts.set(r.category, (counts.get(r.category) ?? 0) + 1);
    }
    return counts;
  }, [channelRows]);

  // Filter (by channel, then sector) then rank (by the interest control).
  // Time order is the stable tie-breaker under every sort — uniform ISO-8601
  // UTC stamps make the string compare a correct time order, and the live API
  // already sorts lastSeen-desc, but the demo preset (and payload drift)
  // shouldn't be trusted to, so "recent" re-sorts explicitly too.
  const sortedRows = useMemo(() => {
    const byRecency = (a: ActivityRow, b: ActivityRow) =>
      a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0;
    const ranked =
      activeSector === ALL_SECTORS
        ? [...channelRows]
        : channelRows.filter((r) => r.category === activeSector);
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
  }, [channelRows, activeSector, sort]);
  // Chats: newest-active first (the route orders them), narrowed by channel.
  const chatsReady = chats.status === "ready" ? chats : null;
  const allChats = useMemo(() => chatsReady?.conversations ?? [], [chatsReady]);
  const chatChannels = useMemo(() => {
    const set = new Set<string>(CHAT_BASE_CHANNELS);
    for (const c of allChats) set.add(c.channel);
    return [...set];
  }, [allChats]);
  const activeChatChannel =
    chatChannelFilter !== ALL_CHANNELS && chatChannels.includes(chatChannelFilter)
      ? chatChannelFilter
      : ALL_CHANNELS;
  const filteredChats = useMemo(
    () =>
      activeChatChannel === ALL_CHANNELS
        ? allChats
        : allChats.filter((c) => chatInChannel(c, activeChatChannel)),
    [allChats, activeChatChannel],
  );
  const chatQuestions = useMemo(
    () => filteredChats.reduce((n, c) => n + c.exchanges.length, 0),
    [filteredChats],
  );

  // One pager serves every tab, so the row count it works off is the ACTIVE
  // tab's — and `page` is re-clamped against it, which is what stops a switch
  // from page 3 of the trails to a two-page opt-out list showing nothing.
  const rowCount =
    tab === "activity" ? sortedRows.length : tab === "chats" ? filteredChats.length : unsubscribes.length;
  const pageCount = Math.max(1, Math.ceil(rowCount / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = useMemo(
    () => sortedRows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [sortedRows, safePage],
  );
  const pagedUnsubscribes = useMemo(
    () => unsubscribes.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [unsubscribes, safePage],
  );
  const pagedChats = useMemo(
    () => filteredChats.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE),
    [filteredChats, safePage],
  );

  /** Where a chat's person stands with Sales. Only a chat with a lead behind
   *  it can be handed over — an anonymous visitor has no record to call. */
  const chatSalesState = useCallback(
    (chat: ChatConversation): ChatSalesState => {
      if (!chat.leadId) {
        return {
          state: "blocked",
          reason:
            "No lead behind this chat — they didn't come through an outreach email, so Sales has nobody to call. Copy the transcript from View instead.",
        };
      }
      const at = handedOff.get(chat.leadId);
      if (at) return { state: "sent", at };
      if (!canHandOff) return { state: "blocked", reason: "Your role can't hand leads to Sales." };
      return { state: "ready" };
    },
    [handedOff, canHandOff],
  );

  // The View modal: the chat, every other chat by the same person (same lead,
  // else same browser), and the click trail the page already holds for them.
  const viewChat = useMemo(
    () => (viewChatId ? allChats.find((c) => c.conversationId === viewChatId) ?? null : null),
    [allChats, viewChatId],
  );
  const viewRelated = useMemo(() => {
    if (!viewChat) return [];
    return allChats.filter(
      (c) =>
        c.conversationId === viewChat.conversationId ||
        (viewChat.leadId
          ? c.leadId === viewChat.leadId
          : viewChat.visitorId !== null && c.leadId === null && c.visitorId === viewChat.visitorId),
    );
  }, [allChats, viewChat]);
  const viewTrail = useMemo<ChatTrail | null>(() => {
    if (!viewChat || !ready) return null;
    const found = viewChat.leadId
      ? ready.leads.find((l) => l.leadId === viewChat.leadId)
      : viewChat.visitorId
        ? ready.visitors.find((v) => v.visitorId === viewChat.visitorId)
        : undefined;
    return found
      ? { events: found.events, counts: found.counts, firstSeen: found.firstSeen, lastSeen: found.lastSeen }
      : null;
  }, [viewChat, ready]);

  // Changing the tab, sort, channel or sector re-frames the list — jump back
  // to its first page so the top of the new ranking is what's on screen. The
  // controls reset it in the same click (one render, one animation); this
  // catches the data-driven changes, like a picked sector disappearing.
  useEffect(() => {
    setPage(0);
  }, [tab, sort, activeChannel, activeSector, activeChatChannel]);

  /** The list's identity: a new key means a new view, and plays the fade-up.
   *  The first view the page settles on shows without it (the panel's own
   *  Reveal already brought it in). */
  const listKey = `${hideWarm === true}|${sort}|${activeChannel}|${activeSector}|${safePage}`;
  const firstListKeyRef = useRef<string | null>(null);
  if (ready && firstListKeyRef.current === null) firstListKeyRef.current = listKey;

  // "Last signal" is the freshest trail overall, independent of the current
  // ranking/filter, so it stays a true clock even under "Hottest" or a sector.
  const lastSignal = useMemo(
    () => rows.reduce<string | null>((max, r) => (!max || r.lastSeen > max ? r.lastSeen : max), null),
    [rows],
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
              Every click trail — from the outreach email or a tagged social link to the enquiry.
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
            <TelemetryReportExport
              demo={ready?.mode === "demo"}
              needsMigration={!!ready?.needsMigration}
            />
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
                ? "Not connected — the portal telemetry tables are missing. Run supabase/portal-telemetry.sql in the Supabase SQL editor to see real click activity."
                : "Not connected — configure Supabase and run supabase/portal-telemetry.sql to see real click activity."}
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
                  fetchChats();
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
              <div className={KPI_GRID}>
                {stats.map((stat) => (
                  <StatCard key={stat.id} stat={stat} />
                ))}
              </div>
            ) : (
              <KpiPanelSkeleton />
            )}
          </Reveal>

          {/* ── lead trails + anonymous rollup ──────────────────────────── */}
          {/* The table is six columns wide now, and the widest of them (the
              trail) is the one that suffers first — so the rollup card only
              keeps its place beside the table where there is genuinely room
              for both. Under ~1700px it drops below, and the table takes the
              full width rather than wrapping every trail onto three lines. */}
          <div className="mt-3 grid grid-cols-1 items-start gap-3 wide:grid-cols-[minmax(0,1fr)_20rem]">
            <Reveal delay={0.1} className="min-w-0">
              <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
                <PanelTabs
                  tab={tab}
                  onTab={(t) => {
                    setTab(t);
                    setPage(0);
                  }}
                  counts={{
                    activity: ready ? rows.length : null,
                    // No chip until chats are actually being recorded.
                    chats: chatsReady && !chatsReady.needsMigration ? allChats.length : null,
                    // The exact total, not the page cap — and nothing at all
                    // when the opt-out list couldn't be read.
                    unsubscribed: ready?.unsubscribesAvailable ? ready.unsubscribesTotal : null,
                  }}
                  meta={
                    <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      {tab === "chats"
                        ? !chatsReady
                          ? chats.status === "error"
                            ? "unavailable"
                            : "loading"
                          : chatsReady.needsMigration
                            ? "not recording yet"
                            : `${chatsReady.windowFull ? "newest " : ""}${formatInt(filteredChats.length)} ${filteredChats.length === 1 ? "chat" : "chats"} · ${formatInt(chatQuestions)} ${chatQuestions === 1 ? "question" : "questions"}`
                        : !ready
                        ? "loading"
                        : tab === "unsubscribed"
                          ? ready.unsubscribesAvailable
                            ? `${formatInt(ready.unsubscribesTotal)} opted out`
                            : "list unavailable"
                          : activeSector === ALL_SECTORS && activeChannel === ALL_CHANNELS
                            ? // The route sends only the newest leads, so say so
                              // against the total that clicked.
                              (leads.length < ready.totals.engagedLeads
                                ? `newest ${formatInt(leads.length)} of ${formatInt(ready.totals.engagedLeads)} leads · ${formatInt(visitors.length)} ${visitors.length === 1 ? "visitor" : "visitors"}`
                                : `${formatInt(rows.length)} ${rows.length === 1 ? "trail" : "trails"} · ${formatInt(totalEvents)} events`) +
                              (hiddenWarm > 0 ? ` · ${formatInt(hiddenWarm)} hidden` : "")
                            : `${formatInt(sortedRows.length)} of ${formatInt(rows.length)} ${rows.length === 1 ? "trail" : "trails"}`}
                    </span>
                  }
                />
                <div
                  role="tabpanel"
                  id={TABPANEL_ID}
                  aria-labelledby={`telemetry-tab-${tab}`}
                  className="flex min-w-0 flex-1 flex-col"
                >
                  {tab === "activity" ? (
                    <>
                      {/* interest controls: narrow by channel (which door they
                          came through), rank by engagement, narrow by sector.
                          Channel and Sort are segmented controls (few, fixed
                          options); Sector is a dropdown (open-ended — grows
                          with the sectors in the data). */}
                      {ready && (rows.length > 0 || hiddenWarm > 0) && (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-border px-4 py-2.5">
                          <div
                            className="flex flex-wrap items-center gap-1.5"
                            role="group"
                            aria-label="Filter activity by channel"
                          >
                            <span className="mr-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                              Channel
                            </span>
                            {[ALL_CHANNELS, ...channels].map((c) => (
                              <button
                                key={c}
                                type="button"
                                data-track="telemetry_channel"
                                data-track-channel={c}
                                onClick={() => {
                                  setChannel(c);
                                  setPage(0);
                                }}
                                aria-pressed={activeChannel === c}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
                                  activeChannel === c
                                    ? "border-primary/40 bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {c !== ALL_CHANNELS && isBrand(c) && (
                                  <ChannelMark brand={c} />
                                )}
                                {c === ALL_CHANNELS ? "All" : sourceLabel(c)}
                              </button>
                            ))}
                          </div>
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
                                onClick={() => {
                                  setSort(s.id);
                                  setPage(0);
                                }}
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
                            <SectorSelect
                              sectors={sectors}
                              counts={sectorCounts}
                              total={channelRows.length}
                              value={activeSector}
                              onChange={(s) => {
                                setSector(s);
                                setPage(0);
                              }}
                            />
                          )}
                          {/* Saved to app_settings, not the browser — so it
                              holds for every operator on every machine. The
                              count is what it takes out (or would). */}
                          <div className="flex flex-wrap items-center gap-2">
                            <label
                              className="inline-flex cursor-pointer items-center gap-1.5"
                              title="Warm leads where every click came from a browser signature no real browser sends — mail-gateway scanners opening the link before anyone reads the email. Saved for everyone."
                            >
                              <input
                                type="checkbox"
                                checked={hideWarm === true}
                                disabled={ready.mode === "demo"}
                                onChange={(e) => saveHideWarmFalsePositives(e.target.checked)}
                                data-track="telemetry_hide_warm_false_positives"
                                className="h-3.5 w-3.5 cursor-pointer accent-primary"
                              />
                              <span className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                                Hide warm false positives
                              </span>
                              {ready.warmFalsePositives > 0 && (
                                <span className="tnum font-mono text-[10px] text-foreground/80">
                                  {formatInt(ready.warmFalsePositives)}
                                </span>
                              )}
                            </label>
                            {hideError && (
                              <span role="alert" className="font-mono text-[10px] text-destructive">
                                {hideError}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                      {!ready ? (
                        <LeadListSkeleton />
                      ) : rows.length === 0 ? (
                        <PanelEmpty
                          icon={MousePointerClick}
                          hint={
                            hiddenWarm > 0
                              ? "Every recent trail is a warm false positive — untick Hide warm false positives to see them."
                              : "No activity yet — trails appear the moment a lead opens a tracked outreach email or a visitor arrives through a tagged social link."
                          }
                        />
                      ) : sortedRows.length === 0 ? (
                        <PanelEmpty
                          icon={MousePointerClick}
                          hint={
                            activeChannel === ALL_CHANNELS
                              ? "No trails in this sector — clear the filter to see every trail."
                              : `No ${sourceLabel(activeChannel)} activity yet — trails land here the moment someone real comes through that channel.`
                          }
                        />
                      ) : (
                        <>
                          <LeadTableHead />
                          <motion.ul
                            key={listKey}
                            variants={LIST_VARIANTS}
                            initial={listKey === firstListKeyRef.current ? false : "hidden"}
                            animate="show"
                          >
                            {pagedRows.map((lead) => (
                              <LeadRow
                                key={lead.leadId}
                                lead={lead}
                                open={expanded.has(lead.leadId)}
                                unseen={unseenByLead.get(lead.leadId) ?? 0}
                                deletable={lead.deletable}
                                onToggle={toggleLead}
                                deletePhase={
                                  deleteFlow?.id === lead.leadId
                                    ? deleteFlow.busy
                                      ? "busy"
                                      : "confirm"
                                    : null
                                }
                                deleteError={
                                  deleteFlow?.id === lead.leadId ? deleteFlow.error : null
                                }
                                onDeleteRequest={requestDelete}
                                onDeleteCancel={cancelDelete}
                                onDeleteConfirm={confirmDelete}
                              />
                            ))}
                          </motion.ul>
                        </>
                      )}
                    </>
                  ) : tab === "chats" ? (
                    chats.status === "loading" ? (
                      <LeadListSkeleton />
                    ) : chats.status === "error" ? (
                      <PanelEmpty icon={AlertTriangle} hint={chats.error} />
                    ) : chats.needsMigration ? (
                      /* The table doesn't exist yet, so nothing is being saved —
                         say that, rather than "nobody has chatted". */
                      <PanelEmpty
                        icon={MessagesSquare}
                        hint="Chats aren’t being recorded yet. Run supabase/portal-chats.sql in the Supabase SQL editor — every chat from then on lands here."
                      />
                    ) : chats.mode === "demo" ? (
                      <PanelEmpty
                        icon={MessagesSquare}
                        hint="Not connected — configure Supabase to see what visitors ask the chat assistant."
                      />
                    ) : (
                      <>
                        {allChats.length > 0 && (
                          <div
                            className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5"
                            role="group"
                            aria-label="Filter chats by source"
                          >
                            <span className="mr-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                              Source
                            </span>
                            {[ALL_CHANNELS, ...chatChannels].map((c) => (
                              <button
                                key={c}
                                type="button"
                                data-track="telemetry_chat_channel"
                                data-track-channel={c}
                                onClick={() => {
                                  setChatChannelFilter(c);
                                  setPage(0);
                                }}
                                aria-pressed={activeChatChannel === c}
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
                                  activeChatChannel === c
                                    ? "border-primary/40 bg-primary/10 text-foreground"
                                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                                )}
                              >
                                {c !== ALL_CHANNELS && <ChatSourceMark channel={c} />}
                                {c === ALL_CHANNELS ? "All" : sourceLabel(c)}
                              </button>
                            ))}
                          </div>
                        )}
                        {allChats.length === 0 ? (
                          <PanelEmpty
                            icon={MessagesSquare}
                            hint="No chats yet — conversations land here the moment a visitor asks the portal’s chat assistant a question. Staff browsers aren’t recorded; test from a private window."
                          />
                        ) : filteredChats.length === 0 ? (
                          <PanelEmpty
                            icon={MessagesSquare}
                            hint={`No chats from ${sourceLabel(activeChatChannel)} yet.`}
                          />
                        ) : (
                          <>
                            <ChatTableHead />
                            <motion.ul
                              key={`chats|${activeChatChannel}|${safePage}`}
                              variants={LIST_VARIANTS}
                              initial="hidden"
                              animate="show"
                            >
                              {pagedChats.map((chat) => (
                                <ChatRow
                                  key={chat.conversationId}
                                  chat={chat}
                                  sales={chatSalesState(chat)}
                                  sending={chatSend?.busy === true && chatSend.leadId === chat.leadId}
                                  onView={openChat}
                                  onSend={sendChatToSales}
                                  deletePhase={
                                    chatDeleteFlow?.id === chat.conversationId
                                      ? chatDeleteFlow.busy
                                        ? "busy"
                                        : "confirm"
                                      : null
                                  }
                                  deleteError={
                                    chatDeleteFlow?.id === chat.conversationId ? chatDeleteFlow.error : null
                                  }
                                  onDeleteRequest={requestChatDelete}
                                  onDeleteCancel={cancelChatDelete}
                                  onDeleteConfirm={confirmChatDelete}
                                />
                              ))}
                            </motion.ul>
                          </>
                        )}
                      </>
                    )
                  ) : !ready ? (
                    <LeadListSkeleton />
                  ) : !ready.unsubscribesAvailable ? (
                    /* "We couldn't read the list" — never dressed up as "nobody
                       has opted out". email_suppression has its own migration. */
                    <PanelEmpty
                      icon={MailX}
                      hint="Couldn’t read the opt-out list. If supabase/unsubscribe.sql hasn’t been run in the Supabase SQL editor yet, run it — until then, unsubscribes aren’t being recorded either."
                    />
                  ) : unsubscribes.length === 0 ? (
                    <PanelEmpty
                      icon={MailX}
                      hint="Nobody has unsubscribed — opt-outs land here the moment someone clicks the unsubscribe link in an outreach email."
                    />
                  ) : (
                    <>
                      <ul>
                        {pagedUnsubscribes.map((person) => (
                          <UnsubscribedRow
                            key={`${person.email}-${person.createdAt}`}
                            person={person}
                          />
                        ))}
                      </ul>
                      <p className="border-t border-border px-4 py-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                        Permanent. Every send drops these addresses — and any other address at the
                        same business domain, so a colleague&rsquo;s opt-out covers the branch.
                      </p>
                    </>
                  )}
                  {/* one pager, whichever list is on screen */}
                  {rowCount > PAGE_SIZE && (
                    <Pager
                      page={safePage}
                      pageCount={pageCount}
                      total={rowCount}
                      onPage={setPage}
                    />
                  )}
                </div>
              </section>
            </Reveal>

            {/* the rollup column: which services, then who was anonymous */}
            <div className="flex min-w-0 flex-col gap-3">
              <Reveal delay={0.12} className="min-w-0">
                {ready ? (
                  <ServicesClickedPanel services={ready.services} />
                ) : (
                  <ServicesClickedSkeleton />
                )}
              </Reveal>
              <Reveal delay={0.14} className="min-w-0">
                {ready ? (
                  <AnonymousPanel
                    anonymous={ready.anonymous}
                    canClear={
                      ready.mode === "live" &&
                      (ready.anonymous.visitors > 0 ||
                        ready.anonymous.events > 0 ||
                        ready.visitors.length > 0)
                    }
                    onClear={clearAnonymous}
                  />
                ) : (
                  <AnonymousSkeleton />
                )}
              </Reveal>
            </div>
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

      <ChatDetailModal
        chat={viewChat}
        related={viewRelated}
        trail={viewTrail}
        sales={viewChat ? chatSalesState(viewChat) : { state: "ready" }}
        sending={chatSend?.busy === true && chatSend.leadId === viewChat?.leadId}
        sendError={chatSend && !chatSend.busy && chatSend.leadId === viewChat?.leadId ? chatSend.error : null}
        onSend={sendChatToSales}
        onClose={closeChat}
      />

      <Footer />
    </div>
  );
}
