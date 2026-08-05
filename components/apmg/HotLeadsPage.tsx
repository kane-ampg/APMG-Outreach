"use client";

import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Flame,
  CornerDownLeft,
  Inbox,
  MousePointerClick,
  RefreshCw,
  Send,
  Undo2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { eventLabel, isHiddenEvent, type LeadActivity } from "@/lib/data/leadActivity";
import {
  HOT_LEAD_MIN_SCORE,
  isHotLead,
  leadScore,
  scoreBand,
  scoreTier,
  SCORE_BANDS,
  type ScoreBand,
} from "@/lib/data/leadScore";
import {
  archiveLeads,
  clearReturn,
  handOffToSales,
  pullBackFromSales,
  refreshHotLeads,
  unarchiveLead,
  useHotLeads,
} from "@/lib/data/hotLeads";
import { type SalesStatus } from "@/lib/data/sales";
import { formatInt } from "@/lib/format";
import { saveAdminKey } from "@/lib/portal/adminKey";
import { Button } from "@/components/ui/button";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { useSales } from "./SalesProvider";
import { SalesStatusPill } from "./SalesStatusPill";

/**
 * Monitor → Hot Leads — the admin staging surface between Telemetry and Sales.
 *
 * Nothing is added here by hand. A lead appears the moment its portal
 * behaviour pushes its intent score above HOT_LEAD_MIN_SCORE (lib/data/
 * leadScore — the same 0–100 number the Telemetry row badge shows), and it
 * stays until an operator hands it to Sales. So the page is three lists:
 *
 *   Awaiting  — hot, not yet passed on. This is the work.
 *   In Sales  — already handed over, showing each lead's LIVE sales status, so
 *               a hand-off can be watched from here. Retractable, in case it
 *               went early. There is no Send affordance in this lane (and the
 *               store filters handed ids anyway), so nothing goes twice.
 *   Returned  — Sales sent it back, with their reason ("we already work with
 *               them"). Returning clears the hand-off, so it has already left
 *               the rep queue; this lane is the feedback landing on admin's
 *               desk. Archive it so it never goes out again, or mark it dealt
 *               with to return it to Awaiting.
 *   Archived  — reviewed and put away. Held apart by the store, so archived
 *               leads never enter the ranking, counts, paging or rendering the
 *               tab does on every poll. Nothing is deleted and Sales is
 *               untouched; Restore puts one straight back.
 *
 * Both the rows and the sidebar's count come from one shared poll
 * (lib/data/hotLeads), so opening this tab costs no extra request and the
 * badge can never disagree with what's on screen. The hand-off itself is a
 * `sales_handoff` row in portal_events via /api/sales/handoff — durable and
 * shared across operators, not a per-browser flag.
 *
 * Live data names leads, so — exactly like Telemetry and Enquiries — the read
 * sits behind the shared PORTAL_ADMIN_KEY; 401 raises the unlock form instead
 * of a dead end. Demo mode scores the same Melbourne preset Telemetry uses.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** Rows per page. The lane counts and bulk actions always cover the WHOLE
 *  filtered lane, not just the page on screen. */
const PAGE_SIZE = 15;

type Lane = "awaiting" | "sent" | "returned" | "archived";

/* ───────────────────────────  ranking + banding  ─────────────────────────── */

/**
 * How the list is ranked — the same segmented control Telemetry carries, plus
 * "Coolest" so the spectrum can be read from the bottom up when the band
 * filter is opened past the hot cut-off.
 */
type SortKey = "hottest" | "coolest" | "engaged" | "recent";

const SORTS: { id: SortKey; label: string }[] = [
  { id: "hottest", label: "Hottest" },
  { id: "coolest", label: "Coolest" },
  { id: "engaged", label: "Most active" },
  { id: "recent", label: "Latest" },
];

/**
 * Which slice of the 0–100 range is on screen. "above-cutoff" is the tab's
 * premise (past the hot cut-off) and stays the default; "all" opens it up to
 * every scored lead, cool → hottest; the rest isolate one band. The premise
 * filter can't be named "hot" — SCORE_BANDS already owns that id for 60–89.
 */
type BandFilter = "above-cutoff" | "all" | ScoreBand;

const BAND_OPTIONS: { id: BandFilter; label: string }[] = [
  { id: "above-cutoff", label: `Hot only (above ${HOT_LEAD_MIN_SCORE})` },
  { id: "all", label: "All scores (cool → hottest)" },
  ...SCORE_BANDS.map((b) => ({ id: b.id as BandFilter, label: `${b.label} (${b.min}–${b.max})` })),
];

/** Visible (non-hidden) event count — the "how active" measure, same as
 *  Telemetry's, so "Most active" means the same thing on both tabs. */
function activeEventCount(lead: LeadActivity): number {
  return lead.events.reduce((n, e) => n + (isHiddenEvent(e.event) ? 0 : 1), 0);
}

function inBand(lead: LeadActivity, band: BandFilter): boolean {
  if (band === "all") return true;
  if (band === "above-cutoff") return isHotLead(lead);
  return scoreBand(leadScore(lead)) === band;
}

/** Order a (already band-filtered) list. Recency is the stable tie-breaker
 *  under every sort — uniform ISO-8601 UTC stamps make the string compare a
 *  correct time order — so equal scores never shuffle between polls. */
function rank(leads: LeadActivity[], sort: SortKey): LeadActivity[] {
  const byRecency = (a: LeadActivity, b: LeadActivity) =>
    a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0;
  const out = [...leads];
  if (sort === "coolest") out.sort((a, b) => leadScore(a) - leadScore(b) || byRecency(a, b));
  else if (sort === "engaged") out.sort((a, b) => activeEventCount(b) - activeEventCount(a) || byRecency(a, b));
  else if (sort === "recent") out.sort(byRecency);
  else out.sort((a, b) => leadScore(b) - leadScore(a) || byRecency(a, b));
  return out;
}

/** Relative "when" — same grammar as Telemetry/Enquiries. */
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

function leadDisplayName(lead: LeadActivity): string {
  return lead.business ?? `Lead ${lead.leadId.slice(0, 8)}…`;
}

/** The single line that says why this lead is hot — its most recent real step. */
function latestStep(lead: LeadActivity): string | null {
  for (let i = lead.events.length - 1; i >= 0; i--) {
    const ev = lead.events[i];
    if (!isHiddenEvent(ev.event)) return eventLabel(ev);
  }
  return null;
}

/* ───────────────────────────  lane tabs (§11.1)  ─────────────────────────── */

function LanePill({
  layoutId,
  active,
  reduce,
  icon: Icon,
  label,
  count,
  track,
  onSelect,
}: {
  layoutId: string;
  active: boolean;
  reduce: boolean;
  icon: typeof Flame;
  label: string;
  count: number;
  track: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      data-track={track}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "text-white" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId={layoutId}
          className="absolute inset-0 rounded-md bg-gradient-to-r from-primary to-primary-solid shadow-sm shadow-primary/25"
          transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
        />
      )}
      <Icon className="relative z-10 h-3.5 w-3.5" aria-hidden />
      <span className="relative z-10">{label}</span>
      <span
        className={cn(
          "tnum relative z-10 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold",
          active ? "bg-white/20 text-white" : "bg-muted text-muted-foreground",
        )}
      >
        {formatInt(count)}
      </span>
    </button>
  );
}

/* ───────────────────────────  one hot lead  ─────────────────────────── */

/** Quiet archive affordance. Archiving is not a delete — it only takes the
 *  lead out of the working lists (and out of everything the tab has to rank,
 *  page and render), so it stays a small icon rather than a loud button. */
function ArchiveButton({
  name,
  leadId,
  busy,
  onArchive,
}: {
  name: string;
  leadId: string;
  busy: boolean;
  onArchive: (leadId: string) => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => onArchive(leadId)}
      aria-label={`Archive ${name} off the hot leads list`}
      title="Archive — hides it here, changes nothing in Sales"
      data-track="hot_lead_archive"
      data-track-lead={leadId}
      className="inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
    >
      <Archive className="h-3.5 w-3.5" aria-hidden />
    </button>
  );
}

function HotLeadRow({
  lead,
  lane,
  handedAt,
  returnedInfo,
  salesStatus,
  checked,
  busy,
  onToggle,
  onSend,
  onPullBack,
  onArchive,
  onRestore,
  onClearReturn,
}: {
  lead: LeadActivity;
  lane: Lane;
  handedAt: string | null;
  /** set on the "returned" lane: when Sales sent it back, and why */
  returnedInfo: { at: string; note: string | null } | null;
  /** where the rep has taken it since — only meaningful in the "sent" lane */
  salesStatus: SalesStatus;
  checked: boolean;
  busy: boolean;
  onToggle: (leadId: string) => void;
  onSend: (leadId: string) => void;
  onPullBack: (leadId: string) => void;
  onArchive: (leadId: string) => void;
  onRestore: (leadId: string) => void;
  onClearReturn: (leadId: string) => void;
}) {
  const score = leadScore(lead);
  const tier = scoreTier(score);
  const name = leadDisplayName(lead);
  const step = latestStep(lead);
  const { emailClicks, portalViews, serviceOpens, inquiries } = lead.counts;

  return (
    <li
      className={cn(
        "flex flex-col gap-3 border-t border-border/70 px-4 py-3.5 transition-colors first:border-t-0 md:flex-row md:items-center md:gap-4",
        checked && "bg-primary/[0.05]",
      )}
    >
      {lane !== "archived" && (
        <input
          type="checkbox"
          checked={checked}
          onChange={() => onToggle(lead.leadId)}
          aria-label={`Select ${name}`}
          className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
        />
      )}

      {/* identity + why it's hot */}
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              lead.business ? "text-foreground" : "font-mono text-muted-foreground",
            )}
          >
            {name}
          </span>
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
        </div>
        {step && (
          <div className="mt-1 truncate text-[12px] text-muted-foreground">
            {step} · <span className="tnum">{fmtWhen(lead.lastSeen)}</span>
          </div>
        )}
        {/* Sales sent this one back — their reason is the whole point of the
            lane, so it reads in full rather than being truncated away. */}
        {returnedInfo && (
          <div className="mt-1.5 flex items-start gap-1.5 rounded-md border border-border bg-background/60 px-2 py-1.5">
            <CornerDownLeft className="mt-px h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 text-[12px] leading-snug text-foreground/90">
              {returnedInfo.note ?? (
                <span className="italic text-muted-foreground">
                  Returned by Sales with no reason given.
                </span>
              )}
              <span className="ml-1.5 font-mono text-[10.5px] text-muted-foreground">
                {fmtWhen(returnedInfo.at)}
              </span>
            </span>
          </div>
        )}
      </div>

      {/* funnel tallies — the evidence behind the score, countable by eye */}
      <div className="flex shrink-0 items-center gap-3 font-mono text-[10.5px] text-muted-foreground">
        <span className="tnum" title="Tracked email links opened">
          {formatInt(emailClicks)} click{emailClicks === 1 ? "" : "s"}
        </span>
        <span className="tnum" title="Portal visits">
          {formatInt(portalViews)} view{portalViews === 1 ? "" : "s"}
        </span>
        <span className="tnum" title="Service cards opened">
          {formatInt(serviceOpens)} service{serviceOpens === 1 ? "" : "s"}
        </span>
        {inquiries > 0 && (
          <span
            className="tnum inline-flex items-center gap-1 rounded-full bg-primary-solid px-1.5 py-px font-semibold text-primary-foreground"
            title="Enquiries sent"
          >
            <Send className="h-2.5 w-2.5" aria-hidden />
            {formatInt(inquiries)}
          </span>
        )}
      </div>

      {/* the hand-off */}
      <div className="flex shrink-0 items-center gap-2 md:w-[13.5rem] md:justify-end">
        {lane === "returned" ? (
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onClearReturn(lead.leadId)}
              aria-label={`Clear the return on ${name}`}
              title="Dealt with — put it back in the awaiting list"
              data-track="hot_lead_clear_return"
              data-track-lead={lead.leadId}
              className="gap-1.5"
            >
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Dealt with
            </Button>
            <ArchiveButton name={name} busy={busy} leadId={lead.leadId} onArchive={onArchive} />
          </>
        ) : lane === "archived" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => onRestore(lead.leadId)}
            aria-label={`Restore ${name} to the working list`}
            data-track="hot_lead_restore"
            data-track-lead={lead.leadId}
            className="gap-1.5"
          >
            <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
            Restore
          </Button>
        ) : lane === "awaiting" ? (
          <>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => onSend(lead.leadId)}
              data-track="hot_lead_send_to_sales"
              data-track-lead={lead.leadId}
              className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
            >
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              {busy ? "Sending…" : "Send to Sales"}
            </Button>
            <ArchiveButton name={name} busy={busy} leadId={lead.leadId} onArchive={onArchive} />
          </>
        ) : (
          <>
            {/* what the rep has done with it since — read live off the Sales
                desk, so this tab is the one place to watch a hand-off land. */}
            <span
              className="flex flex-col items-end gap-1"
              title={handedAt ? `Handed to Sales ${fmtWhen(handedAt)}` : "Handed to Sales"}
            >
              <SalesStatusPill status={salesStatus} />
              <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-muted-foreground">
                <CheckCircle2 className="h-3 w-3 text-primary" aria-hidden />
                {handedAt ? fmtWhen(handedAt) : "in Sales"}
              </span>
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onPullBack(lead.leadId)}
              aria-label={`Pull ${name} back out of Sales`}
              title="Pull back out of Sales"
              data-track="hot_lead_pull_back"
              data-track-lead={lead.leadId}
              className="gap-1.5"
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Undo
            </Button>
            <ArchiveButton name={name} busy={busy} leadId={lead.leadId} onArchive={onArchive} />
          </>
        )}
      </div>
    </li>
  );
}

/* ───────────────────────────  the page  ─────────────────────────── */

export function HotLeadsPage() {
  const state = useHotLeads();
  // Sales-desk statuses, so a handed-over lead's progress (contacted, closed,
  // lost) is visible from here without switching tabs.
  const { statusOf } = useSales();
  const reduce = !!useReducedMotion();
  const laneLayoutId = useId();

  const [lane, setLane] = useState<Lane>("awaiting");
  const [sort, setSort] = useState<SortKey>("hottest");
  const [band, setBand] = useState<BandFilter>("above-cutoff");
  /** 0-based page of the current lane; clamped at render (see below). */
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [keyInput, setKeyInput] = useState("");

  // Narrow to the chosen band, then rank.
  const visible = useMemo(
    () => rank(state.leads.filter((l) => inBand(l, band)), sort),
    [state.leads, band, sort],
  );

  // A return clears the hand-off server-side, so a returned lead would
  // otherwise fall straight back into "awaiting" as if nothing happened. It
  // gets its own lane instead, so the rep's feedback is seen before the lead is
  // ever considered fresh work again.
  const { awaiting, sent, returned } = useMemo(() => {
    const a: LeadActivity[] = [];
    const s: LeadActivity[] = [];
    const r: LeadActivity[] = [];
    for (const l of visible) {
      if (state.returned.has(l.leadId)) r.push(l);
      else if (state.handedOff.has(l.leadId)) s.push(l);
      else a.push(l);
    }
    return { awaiting: a, sent: s, returned: r };
  }, [visible, state.handedOff, state.returned]);

  // Archived leads are held apart by the store (they never enter `leads`), so
  // they cost nothing until this lane is actually opened.
  const archived = useMemo(
    () => rank(state.archivedLeads.filter((l) => inBand(l, band)), sort),
    [state.archivedLeads, band, sort],
  );

  // The header readout stays the standing work number — HOT leads not yet
  // handed over — so it matches the sidebar badge no matter which band the
  // list is currently showing.
  const hotWaiting = useMemo(
    () =>
      state.leads.filter(
        (l) => isHotLead(l) && !state.handedOff.has(l.leadId) && !state.returned.has(l.leadId),
      ).length,
    [state.leads, state.handedOff, state.returned],
  );

  // Selection is per lane, and only ever over rows that are still THERE — a
  // lead that got handed off, archived or cooled out from under the operator
  // (or a lane switch) drops out, so a bulk action can't act on ghosts.
  const laneRows =
    lane === "awaiting" ? awaiting : lane === "sent" ? sent : lane === "returned" ? returned : archived;
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const live = new Set(laneRows.map((l) => l.leadId));
      const next = new Set([...prev].filter((id) => live.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [laneRows]);
  useEffect(() => {
    setSelected(new Set());
  }, [lane]);

  const setBusy = useCallback((ids: string[], on: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) (on ? next.add(id) : next.delete(id));
      return next;
    });
  }, []);

  /** Run one bulk/row action, clearing the ids from the selection on success. */
  const run = useCallback(
    async (ids: string[], op: (ids: string[]) => Promise<string | null>) => {
      if (ids.length === 0) return;
      setActionError(null);
      setBusy(ids, true);
      const err = await op(ids);
      setBusy(ids, false);
      if (err) {
        setActionError(err);
        return;
      }
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
    },
    [setBusy],
  );

  // Already-handed leads are filtered out before the request — a lead can only
  // ever be sent to Sales once (the server skips repeats too).
  const send = useCallback(
    (ids: string[]) => run(ids.filter((id) => !state.handedOff.has(id)), handOffToSales),
    [run, state.handedOff],
  );
  const archive = useCallback((ids: string[]) => run(ids, archiveLeads), [run]);

  const single = useCallback(
    async (leadId: string, op: (id: string) => Promise<string | null>) => {
      setActionError(null);
      setBusy([leadId], true);
      const err = await op(leadId);
      setBusy([leadId], false);
      if (err) setActionError(err);
    },
    [setBusy],
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refreshHotLeads();
    } finally {
      setRefreshing(false);
    }
  }, []);

  const rows = laneRows;
  const selectable = lane !== "archived";
  // "Send to Sales" is only ever offered on the awaiting lane.
  const allSelected = rows.length > 0 && rows.every((l) => selected.has(l.leadId));

  // Paging. `page` is never trusted directly — it's clamped at render, so a
  // list that shrinks under the view (a hand-off, a band change, a poll) can't
  // strand the operator on a page that no longer exists.
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pagedRows = rows.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  // Re-framing the list (new lane, ranking or band) puts the top of the new
  // order on screen rather than leaving the view deep in the old one.
  useEffect(() => {
    setPage(0);
  }, [lane, sort, band]);

  function toggle(leadId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(leadId)) next.delete(leadId);
      else next.add(leadId);
      return next;
    });
  }

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      {/* ── header ─────────────────────────────────────────────────────── */}
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Admin — review before Sales
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Hot Leads
            </h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Any lead scoring above <span className="tnum">{HOT_LEAD_MIN_SCORE}</span> lands here
              automatically. Review it, then hand it over to Sales — or widen{" "}
              <span className="font-medium text-foreground/80">Show</span> to read every score, cool
              through hottest.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* the standing work number: HOT and not yet handed over. Matches
                the sidebar badge, so it doesn't move when the band changes. */}
            <div className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              <div>Hot · awaiting</div>
              <div className="tnum text-foreground/80">{formatInt(hotWaiting)}</div>
            </div>
            <button
              type="button"
              onClick={() => void refresh()}
              data-track="hot_leads_refresh"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <RefreshCw
                className={cn(
                  "h-3.5 w-3.5",
                  (refreshing || state.status === "loading") && "animate-spin",
                )}
                aria-hidden
              />
              Refresh
            </button>
          </div>
        </div>
      </Reveal>

      {/* ── demo banner ────────────────────────────────────────────────── */}
      {state.mode === "demo" && state.status === "ready" && (
        <Reveal className="mb-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <p className="font-mono text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
              {state.needsMigration
                ? "Demo data — the portal telemetry tables are missing. Run supabase/portal-telemetry.sql in the Supabase SQL editor to score real leads. Hand-offs made here last for this session only."
                : "Demo data — connect Supabase and run supabase/portal-telemetry.sql to score real leads. Hand-offs made here last for this session only."}
            </p>
          </div>
        </Reveal>
      )}

      {state.status === "error" ? (
        <Reveal>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden />
            </span>
            <h2 className="text-base font-semibold text-foreground">
              {state.unauthorized ? "Access key required" : "Couldn’t load hot leads"}
            </h2>
            <p
              role="alert"
              className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground"
            >
              {state.error}
            </p>
            {state.unauthorized && (
              /* Same shared secret as Telemetry / Enquiries — live rows name
                 leads, so the read is key-gated. Entered once, kept in
                 localStorage, sent as a header on every request. */
              <form
                className="flex w-full max-w-xs items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  saveAdminKey(keyInput.trim());
                  setKeyInput("");
                  void refreshHotLeads();
                }}
              >
                <label htmlFor="hot-leads-access-key" className="sr-only">
                  Access key
                </label>
                <input
                  id="hot-leads-access-key"
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
                  data-track="hot_leads_unlock"
                  className="shrink-0 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                >
                  Unlock
                </Button>
              </form>
            )}
            <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        </Reveal>
      ) : (
        <Reveal delay={0.04}>
          <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
            {/* lane tabs + bulk action */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div
                role="tablist"
                aria-label="Hot leads by hand-off state"
                className="inline-flex gap-1 rounded-lg bg-background/60 p-1 ring-1 ring-foreground/10"
              >
                <LanePill
                  layoutId={laneLayoutId}
                  active={lane === "awaiting"}
                  reduce={reduce}
                  icon={Flame}
                  label="Awaiting"
                  count={awaiting.length}
                  track="hot_leads_tab_awaiting"
                  onSelect={() => setLane("awaiting")}
                />
                <LanePill
                  layoutId={laneLayoutId}
                  active={lane === "sent"}
                  reduce={reduce}
                  icon={CheckCircle2}
                  label="In Sales"
                  count={sent.length}
                  track="hot_leads_tab_sent"
                  onSelect={() => setLane("sent")}
                />
                <LanePill
                  layoutId={laneLayoutId}
                  active={lane === "returned"}
                  reduce={reduce}
                  icon={CornerDownLeft}
                  label="Returned"
                  count={returned.length}
                  track="hot_leads_tab_returned"
                  onSelect={() => setLane("returned")}
                />
                <LanePill
                  layoutId={laneLayoutId}
                  active={lane === "archived"}
                  reduce={reduce}
                  icon={Archive}
                  label="Archived"
                  count={archived.length}
                  track="hot_leads_tab_archived"
                  onSelect={() => setLane("archived")}
                />
              </div>

              {selectable && rows.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected(allSelected ? new Set() : new Set(rows.map((l) => l.leadId)))
                    }
                    data-track="hot_leads_select_all"
                    className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    {/* spans the whole lane, not just this page */}
                    {allSelected ? "Clear selection" : `Select all ${formatInt(rows.length)}`}
                  </button>
                  {/* Only the awaiting lane can hand over — a lead already in
                      Sales has no Send affordance anywhere, so it can't go twice. */}
                  {lane === "awaiting" && (
                    <Button
                      size="sm"
                      disabled={selected.size === 0 || busyIds.size > 0}
                      onClick={() => void send([...selected])}
                      data-track="hot_leads_send_selected"
                      className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                    >
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                      Send {selected.size > 0 ? formatInt(selected.size) : ""} to Sales
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selected.size === 0 || busyIds.size > 0}
                    onClick={() => void archive([...selected])}
                    data-track="hot_leads_archive_selected"
                    className="gap-1.5"
                  >
                    <Archive className="h-3.5 w-3.5" aria-hidden />
                    Archive {selected.size > 0 ? formatInt(selected.size) : ""}
                  </Button>
                </div>
              )}
            </div>

            {/* ranking + band controls — the same steering Telemetry gives the
                activity list. Sort is a segmented control (few, fixed options);
                Show is a dropdown, because the bands read as a range and the
                labels carry their score cuts. Together they open the tab past
                its hot cut-off: pick "All scores" + "Coolest" to read the whole
                spectrum from the bottom up. */}
            {state.status === "ready" && state.leads.length > 0 && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 border-b border-border px-4 py-2.5">
                <div
                  className="flex flex-wrap items-center gap-1.5"
                  role="group"
                  aria-label="Sort hot leads"
                >
                  <span className="mr-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground">
                    Sort
                  </span>
                  {SORTS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      data-track="hot_leads_sort"
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

                <div className="flex items-center gap-1.5">
                  <label
                    htmlFor="hot-leads-band"
                    className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    Show
                  </label>
                  <div className="relative">
                    <select
                      id="hot-leads-band"
                      value={band}
                      onChange={(e) => setBand(e.target.value as BandFilter)}
                      data-track="hot_leads_band"
                      className={cn(
                        "h-7 max-w-[13rem] cursor-pointer appearance-none truncate rounded-md border bg-background pl-2.5 pr-7 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors duration-200 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        band === "above-cutoff"
                          ? "border-border text-muted-foreground hover:text-foreground"
                          : "border-primary/40 bg-primary/10 text-foreground",
                      )}
                    >
                      {BAND_OPTIONS.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
                      aria-hidden
                    />
                  </div>
                </div>

                <span className="tnum ml-auto font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {formatInt(visible.length)} of {formatInt(state.leads.length)} scored
                </span>
              </div>
            )}

            {actionError && (
              <p
                role="alert"
                className="border-b border-destructive/40 bg-destructive/[0.04] px-4 py-2 font-mono text-[11px] text-destructive"
              >
                {actionError}
              </p>
            )}

            {state.status === "loading" ? (
              <ul>
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 border-t border-border/70 px-4 py-4 first:border-t-0" aria-busy>
                    <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                    <div className="ml-auto h-3 w-24 animate-pulse rounded bg-muted" />
                  </li>
                ))}
              </ul>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
                  {lane === "awaiting" ? (
                    <MousePointerClick className="h-5 w-5" aria-hidden />
                  ) : lane === "archived" ? (
                    <Archive className="h-5 w-5" aria-hidden />
                  ) : lane === "returned" ? (
                    <CornerDownLeft className="h-5 w-5" aria-hidden />
                  ) : (
                    <Inbox className="h-5 w-5" aria-hidden />
                  )}
                </span>
                <p className="text-[13px] font-medium text-foreground">
                  {lane === "archived"
                    ? "Nothing archived"
                    : lane === "returned"
                      ? "Nothing sent back"
                      : lane === "sent"
                        ? "Nothing handed over yet"
                        : band === "above-cutoff"
                          ? "Nothing hot right now"
                          : "No leads in this band"}
                </p>
                <p className="max-w-sm font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                  {lane === "archived"
                    ? "Archive leads you're done reviewing and they'll wait here instead of loading with the working lists. Nothing is deleted, and archiving never touches Sales — Restore brings one straight back."
                    : lane === "returned"
                      ? "When Sales sends a lead back — usually because they already work with that business — it lands here with their note, and drops out of their queue. Archive it so it never goes out again, or mark it dealt with to put it back in the awaiting list."
                      : lane === "sent"
                        ? "Leads you send to Sales are listed here with their live sales status, so you can watch a hand-off land (and pull one back if it went early)."
                        : band === "above-cutoff"
                          ? `Leads arrive here on their own once their intent score passes ${HOT_LEAD_MIN_SCORE} — opening a service card or sending an enquiry does it. Widen Show to read the cooler bands, or send a campaign from the Pipeline tab to start the clock.`
                          : "Nobody's scoring in that band at the moment — try Show → All scores."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-clip">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.ul
                    key={lane}
                    role="tabpanel"
                    initial={reduce ? { opacity: 0 } : { opacity: 0, x: lane === "awaiting" ? -28 : 28 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={reduce ? { opacity: 0 } : { opacity: 0, x: lane === "awaiting" ? 28 : -28 }}
                    transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
                  >
                    {pagedRows.map((lead) => (
                      <HotLeadRow
                        key={lead.leadId}
                        lead={lead}
                        lane={lane}
                        handedAt={state.handedOff.get(lead.leadId) || null}
                        returnedInfo={lane === "returned" ? state.returned.get(lead.leadId) ?? null : null}
                        salesStatus={statusOf(lead.leadId)}
                        checked={selected.has(lead.leadId)}
                        busy={busyIds.has(lead.leadId)}
                        onToggle={toggle}
                        onSend={(id) => void send([id])}
                        onPullBack={(id) => void single(id, pullBackFromSales)}
                        onArchive={(id) => void archive([id])}
                        onRestore={(id) => void single(id, unarchiveLead)}
                        onClearReturn={(id) => void single(id, clearReturn)}
                      />
                    ))}
                  </motion.ul>
                </AnimatePresence>
              </div>
            )}

            {/* pager foot — only exists once the lane outgrows a page */}
            {state.status === "ready" && rows.length > PAGE_SIZE && (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2.5">
                <span className="tnum font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {formatInt(safePage * PAGE_SIZE + 1)}–
                  {formatInt(Math.min((safePage + 1) * PAGE_SIZE, rows.length))} of{" "}
                  {formatInt(rows.length)}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage === 0}
                    onClick={() => setPage(safePage - 1)}
                    data-track="hot_leads_page_prev"
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
                    data-track="hot_leads_page_next"
                    className="gap-1"
                  >
                    Next
                    <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Reveal>
      )}

      <Footer />
    </div>
  );
}
