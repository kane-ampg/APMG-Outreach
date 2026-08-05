"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  EMPTY_SERIES,
  countLast24h,
  parseStamps,
  volumeSeries,
  type VolumeSeries,
} from "@/lib/data/buckets";
import { SALES_LEADS, type SalesLead, type SalesStatus } from "@/lib/data/sales";
import { adminHeaders } from "@/lib/portal/adminKey";
import type { SalesHandoffResponse } from "@/lib/sales/handoff";
import type { SalesHandoffStamp, SalesQueueResponse, SalesQueueRow } from "@/lib/sales/queue";
import { isSelfHandoff } from "@/lib/sales/selfHandoff";

export interface CloseDealInput {
  note: string;
  value: number;
}

/** How often the desk re-checks for leads admin has sent over. Paused while
 *  the tab is hidden, and topped up the moment it regains focus — the same
 *  realtime-by-short-poll grammar the rest of the app uses. */
const POLL_MS = 20000;

/**
 * How long a freshly-arrived lead stays visually marked in the queue.
 *
 * This is deliberately NOT tied to the notification. Acknowledging (opening the
 * modal's "Open Sales", or dismissing the banner) stops the *announcement* —
 * but the rep still has to FIND those leads in the list, so the rows keep their
 * highlight until they've had a fair chance to work them. It clears on its own
 * afterwards, so the queue never stays permanently painted.
 */
const HIGHLIGHT_MS = 10 * 60 * 1000;

/** Funnel tallies shared by the Sales tab and the Overview KPI cards. */
export interface SalesStats {
  open: number;
  engaged: number;
  won: number;
  wonValue: number;
  queueTotal: number;
}

interface SalesContextValue {
  /** the CURRENT PAGE of the queue, status overrides applied */
  leads: SalesLead[];
  /** closed-won deals, most recently closed first */
  closedDeals: SalesLead[];
  stats: SalesStats;
  /** unique emailed leads across all pages */
  total: number;
  /**
   * The newest hand-offs regardless of which page the rep is paged to — the
   * Sales overview's "latest" panel. (`leads` follows the page; this must not.)
   */
  recent: SalesLead[];
  /** hand-off volume over time, for the Sales overview's histogram */
  series: VolumeSeries;
  /** leads admin handed over in the last 24h */
  handedToday: number;
  /**
   * Every lead id admin has handed to Sales (all pages). Surfaces outside the
   * queue use it to keep to the desk's own leads — the Enquiries tab scopes its
   * list with it, so a rep never sees enquiries from the raw outreach list.
   */
  queuedIds: ReadonlySet<string>;
  /** newest hand-off stamp anywhere in the queue, ISO ("" when empty) */
  latestHandoffAt: string;
  /** 1-based current page */
  page: number;
  pageCount: number;
  pageSize: number;
  loading: boolean;
  mode: "live" | "demo";
  error: string | null;
  /** portal_events doesn't exist yet — run supabase/portal-telemetry.sql */
  needsMigration: boolean;
  /** New leads admin has sent over since the rep last looked. Drives the
   *  arrivals banner and the live indicator's pulse. 0 = nothing new. */
  arrivals: number;
  /** Ids on the CURRENT page that are part of that unseen batch, so the rows
   *  themselves can announce their arrival. */
  freshIds: ReadonlySet<string>;
  /** Rep has seen the new leads — clears the banner, pulse and row highlights. */
  acknowledgeArrivals: () => void;
  setPage: (page: number) => void;
  reload: () => void;
  /** What a lead is showing right now, by lead id — its status override if the
   *  rep has marked it, else the loaded row's, else "new".
   *
   *  Correct across pages in live mode: /api/sales/queue hands every row back
   *  as "new", so any other status can only have come from an override, and
   *  overrides are held for the whole session regardless of which page the
   *  lead was on. That makes this safe for surfaces OUTSIDE the queue (the Hot
   *  Leads tab reads it to show what happened to a lead it handed over). */
  statusOf: (id: string) => SalesStatus;
  markContacted: (id: string) => void;
  markLost: (id: string) => void;
  closeDeal: (id: string, input: CloseDealInput) => void;
  /**
   * Hand leads BACK to admin, with an optional reason ("we already work with
   * them"). This clears the hand-off server-side, so they leave this queue and
   * reappear on the admin Hot Leads tab carrying the note.
   *
   * Takes a list because returning a whole batch under one reason is the common
   * case — a rep recognising a group they already service. One request, one
   * note on each.
   *
   * Resolves to null on success, else a message to show the rep.
   */
  returnLeads: (ids: string[], note: string) => Promise<string | null>;
  /** retract the last status change on a lead — undoes mark-contacted, a close,
   *  or a lost mark, stepping back one mark at a time */
  revertStatus: (id: string) => void;
}

const SalesContext = createContext<SalesContextValue | null>(null);

/** Leads per queue page — pairs with the card grid (1/2/3 columns). */
const PAGE_SIZE = 12;

function shortDate(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** "Jul 15, 09:12" from an ISO stamp; undefined when absent/garbled. */
function fmtStamp(iso: string | null | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  const day = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day}, ${time}`;
}

const EMPTY_IDS: ReadonlySet<string> = new Set();

/** True when the set already holds exactly these ids — lets the poll skip a
 *  state write (and the re-render) when nothing has actually changed. */
function sameIds(set: ReadonlySet<string>, ids: string[]): boolean {
  return set.size === ids.length && ids.every((id) => set.has(id));
}

/** Hand-offs newer than the watermark, excluding this browser's own — the
 *  arrival count. Shared by the poll and the fresh-row highlight so the number
 *  and the highlighted rows can never disagree. */
function arrivalIds(handoffs: SalesHandoffStamp[], seen: string): string[] {
  return handoffs
    .filter((h) => h.at > seen && !isSelfHandoff(h.leadId))
    .map((h) => h.leadId);
}

function countArrivals(handoffs: SalesHandoffStamp[], seen: string): number {
  return arrivalIds(handoffs, seen).length;
}

/** Map one /api/sales/queue row into the card shape. Everything the scraper
 *  didn't capture (score, AI brief, deal estimate) stays undefined and the
 *  card simply omits it.
 *
 *  `receivedAt` is when ADMIN handed the lead over — that's what put it in the
 *  queue — while `emailSentAt` stays the outreach history. They're usually
 *  different moments now, so they're read from different stamps. */
function toSalesLead(r: SalesQueueRow): SalesLead {
  return {
    id: r.id,
    business: r.business,
    category: r.category ?? "Uncategorised",
    location: r.location ?? undefined,
    website: r.website ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    rating: r.rating ?? undefined,
    emailSent: r.emailsSent > 0,
    emailSentAt: fmtStamp(r.lastSentAt) ?? "—",
    emailsSent: r.emailsSent,
    engaged: r.engaged,
    engagedAt: fmtStamp(r.engagedAt),
    status: "new",
    receivedAt: fmtStamp(r.handedOffAt) ?? "recently",
  };
}

/**
 * Sales state shared by the Sales queue, Closed-deals tab, Overview KPIs and
 * the sidebar badge. The queue itself is REAL data: every lead ADMIN has handed
 * over from Hot Leads (the portal_events sales_handoff ledger — being emailed
 * is not enough), fetched one server-paginated page at a time from
 * /api/sales/queue. Demo mode (no Supabase configured) falls back to the preset
 * so the tab stays exercisable.
 *
 * The queue is live: a short poll (paused when hidden, topped up on focus)
 * re-reads it, and a hand-off stamp newer than the one the rep acknowledged
 * raises `arrivals` — that's what makes the desk announce incoming work
 * instead of waiting for a manual refresh.
 *
 * Status changes (contacted / lost / closed) are kept in-memory per lead id —
 * they survive paging back and forth, but not a reload; persisting them is a
 * separate migration. Every mark is retractable: the status it replaced is
 * pushed onto a per-lead stack, so revertStatus steps back one mark at a time.
 * Closing a deal snapshots the full lead into closedDeals so the Closed tab
 * keeps it even after the queue pages away (a retraction removes it again).
 */
export function SalesProvider({ children }: { children: ReactNode }) {
  const [rows, setRows] = useState<SalesLead[]>([]);
  // Page-independent head of the queue + the full hand-off roll. Both exist so
  // the rep's surfaces can describe the desk's own work (latest arrivals, volume
  // over time, which enquiries are theirs) without touching admin-wide data.
  const [recentRows, setRecentRows] = useState<SalesLead[]>([]);
  const [handoffs, setHandoffs] = useState<SalesHandoffStamp[]>([]);
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [page, setPageState] = useState(1);
  const [total, setTotal] = useState(0);
  const [engagedTotal, setEngagedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Partial<SalesLead>>>({});
  // per-lead stack of the statuses each mark replaced — powers revertStatus
  const [statusHistory, setStatusHistory] = useState<Record<string, SalesStatus[]>>({});
  const [closedDeals, setClosedDeals] = useState<SalesLead[]>([]);
  // increment to refetch the current page; also guards stale responses
  const [reloadTick, setReloadTick] = useState(0);
  const requestSeq = useRef(0);
  const demoSeeded = useRef(false);
  /** Last page of RAW queue rows — `leads` is the display shape, which loses
   *  the ISO hand-off stamp that arrival detection compares against. */
  const rawRows = useRef<SalesQueueRow[]>([]);
  // Arrival detection. `seenAt` is the newest hand-off the rep has acknowledged;
  // anything stamped after it is new. It is seeded from the FIRST successful
  // response so a queue that was already full doesn't announce itself as new —
  // only what lands from then on counts.
  const [seenAt, setSeenAt] = useState<string | null>(null);
  const [latestAt, setLatestAt] = useState("");
  const [arrivals, setArrivals] = useState(0);
  /** The most recent batch of arrivals, still marked in the list. Survives
   *  acknowledgement (see HIGHLIGHT_MS) — that's what makes the rows visible
   *  when the rep opens Sales FROM the modal. */
  const [freshIds, setFreshIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  /** When that batch landed, for the expiry. A ref so the poll closure always
   *  reads the current value rather than the one from its render. */
  const freshAtRef = useRef(0);
  const seenRef = useRef<string | null>(null);
  const totalRef = useRef(0);

  useEffect(() => {
    const seq = ++requestSeq.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    void load(seq, () => cancelled);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, reloadTick]);

  /** One queue read. `silent` marks the background poll: it must never flip a
   *  populated desk into a spinner or an error screen over a transient blip. */
  async function load(seq: number, cancelled: () => boolean, silent = false) {
    {
      let data: SalesQueueResponse;
      try {
        const res = await fetch(`/api/sales/queue?page=${page}&pageSize=${PAGE_SIZE}`, {
          cache: "no-store",
        });
        data = (await res.json()) as SalesQueueResponse;
        if (!res.ok || !data.ok) {
          throw new Error(data?.error || "Couldn't load the sales queue.");
        }
      } catch (e) {
        if (cancelled() || seq !== requestSeq.current) return;
        if (!silent) {
          setError(e instanceof Error ? e.message : "Couldn't load the sales queue.");
          setLoading(false);
        }
        return;
      }
      if (cancelled() || seq !== requestSeq.current) return;

      if (data.mode === "demo") {
        // No database configured — preset queue, one page.
        setMode("demo");
        setRows(SALES_LEADS);
        setRecentRows(SALES_LEADS.slice(0, 6));
        // The preset carries formatted labels, not ISO stamps — nothing to
        // bucket, so the demo overview shows the histogram's empty state.
        setHandoffs([]);
        setTotal(SALES_LEADS.length);
        setEngagedTotal(SALES_LEADS.filter((l) => l.engaged).length);
        setNeedsMigration(false);
        if (!demoSeeded.current) {
          demoSeeded.current = true;
          setClosedDeals(SALES_LEADS.filter((l) => l.status === "closed_won"));
        }
      } else {
        setMode("live");
        rawRows.current = data.rows;
        setRows(data.rows.map(toSalesLead));
        setRecentRows((data.recent ?? []).map(toSalesLead));
        setHandoffs(data.handoffs ?? []);
        setTotal(data.total);
        setEngagedTotal(data.engagedTotal);
        setNeedsMigration(!!data.needsMigration);
        setLatestAt(data.latestHandoffAt ?? "");

        // Arrivals. The first response of the session only sets the
        // watermark — a queue that was already full is not "new". After that,
        // anything stamped later than the watermark is an arrival.
        //
        // Counted off the hand-off ROLL rather than the growth in `total`, so
        // it stays exact when a return removes one lead in the same window that
        // another arrives (which would otherwise cancel out), and so it sees
        // arrivals regardless of which page the rep is paged to.
        const seen = seenRef.current;
        const latest = data.latestHandoffAt ?? "";
        if (seen === null) {
          seenRef.current = latest;
          setSeenAt(latest);
          setArrivals(0);
        } else if (latest && latest > seen) {
          const ids = arrivalIds(data.handoffs ?? [], seen);
          setArrivals(ids.length);
          // Arm the highlight from the same list the count came from. Guarded
          // so a poll that finds the same batch doesn't re-render the queue.
          if (ids.length > 0 && !sameIds(freshIdsRef.current, ids)) {
            setFreshIds(new Set(ids));
            freshAtRef.current = Date.now();
          }
        }

        // Retire a highlight that has had its run. Checked on every poll, so it
        // clears itself without needing a timer of its own.
        if (freshAtRef.current > 0 && Date.now() - freshAtRef.current > HIGHLIGHT_MS) {
          freshAtRef.current = 0;
          setFreshIds(EMPTY_IDS);
        }
        totalRef.current = data.total;

        // queue shrank under us (returns, deletes) — snap back to a real page
        const pageCount = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
        if (page > pageCount) setPageState(pageCount);
      }
      if (!silent) setLoading(false);
    }
  }

  // Realtime: silent background poll while the tab is visible, plus an instant
  // pull on focus. This is how the desk hears admin without a manual refresh.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      void load(requestSeq.current, () => false, true);
    };
    const id = setInterval(tick, POLL_MS);
    window.addEventListener("focus", tick);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", tick);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const setPage = useCallback(
    (p: number) => setPageState(Math.min(Math.max(1, p), Math.max(1, Math.ceil(total / PAGE_SIZE)))),
    [total],
  );

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  /**
   * The rep has looked — advance the watermark so the modal and banner stand
   * down. The row highlights deliberately STAY: acknowledging means "I know
   * they arrived", not "I've found them in the list". They expire on their own
   * (HIGHLIGHT_MS) or as each lead gets worked.
   */
  const acknowledgeArrivals = useCallback(() => {
    seenRef.current = latestAt;
    setSeenAt(latestAt);
    setArrivals(0);
  }, [latestAt]);

  /**
   * Send a lead back to admin. The server records the return (with the note)
   * and clears the hand-off, which is what removes it from this queue — so we
   * just reload afterwards rather than guessing at the new state.
   */
  const returnLeads = useCallback(
    async (ids: string[], note: string): Promise<string | null> => {
      const leadIds = [...new Set(ids.filter(Boolean))];
      if (leadIds.length === 0) return null;
      const many = leadIds.length > 1;

      if (mode === "demo") {
        // No ledger to write to — drop them from the preset so the flow still
        // demonstrates end to end.
        const gone = new Set(leadIds);
        setRows((prev) => prev.filter((l) => !gone.has(l.id)));
        setTotal((t) => Math.max(0, t - leadIds.length));
        return null;
      }
      try {
        const res = await fetch("/api/sales/handoff", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...adminHeaders() },
          body: JSON.stringify({ kind: "returned", leadIds, note: note.trim() || undefined }),
        });
        const data = (await res.json().catch(() => null)) as SalesHandoffResponse | null;
        if (!res.ok || !data?.ok) {
          return data?.error ?? `Couldn't return ${many ? "those leads" : "that lead"} (${res.status}).`;
        }
        reload();
        return null;
      } catch {
        return `Network error returning ${many ? "the leads" : "the lead"}.`;
      }
    },
    [mode, reload],
  );

  const leads = useMemo(
    () => rows.map((l) => (overrides[l.id] ? { ...l, ...overrides[l.id] } : l)),
    [rows, overrides],
  );

  const recent = useMemo(
    () => recentRows.map((l) => (overrides[l.id] ? { ...l, ...overrides[l.id] } : l)),
    [recentRows, overrides],
  );

  // Hand-off volume + the last-24h tally, bucketed locally (see lib/data/buckets)
  // so the desk's bars line up with the rep's own days.
  const handoffDates = useMemo(() => parseStamps(handoffs.map((h) => h.at)), [handoffs]);
  const series = useMemo(
    () => (handoffDates.length > 0 ? volumeSeries(handoffDates) : EMPTY_SERIES),
    [handoffDates],
  );
  const handedToday = useMemo(() => countLast24h(handoffDates), [handoffDates]);
  const queuedIds = useMemo(
    () => new Set(handoffs.map((h) => h.leadId)) as ReadonlySet<string>,
    [handoffs],
  );

  // Mirror of freshIds for the poll closure (which is re-created each render
  // and must not compare against a stale set).
  const freshIdsRef = useRef<ReadonlySet<string>>(EMPTY_IDS);
  freshIdsRef.current = freshIds;

  /** Acting on a lead is the clearest possible "I've seen this one" — drop its
   *  highlight rather than leaving it marked as new after it's been worked. */
  const clearHighlight = useCallback((id: string) => {
    setFreshIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }, []);

  /** what a lead is showing right now: its override, else the server/preset row */
  const statusOf = useCallback(
    (id: string): SalesStatus =>
      overrides[id]?.status ?? rows.find((l) => l.id === id)?.status ?? "new",
    [overrides, rows],
  );

  /** remember the status a mark replaced, so revertStatus can put it back */
  const pushStatus = useCallback((id: string, from: SalesStatus) => {
    setStatusHistory((prev) => ({ ...prev, [id]: [...(prev[id] ?? []), from] }));
  }, []);

  const markContacted = useCallback(
    (id: string) => {
      pushStatus(id, statusOf(id));
      clearHighlight(id);
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], status: "contacted" } }));
    },
    [pushStatus, statusOf, clearHighlight],
  );

  const markLost = useCallback(
    (id: string) => {
      pushStatus(id, statusOf(id));
      clearHighlight(id);
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], status: "closed_lost" } }));
    },
    [pushStatus, statusOf, clearHighlight],
  );

  const closeDeal = useCallback(
    (id: string, input: CloseDealInput) => {
      const patch: Partial<SalesLead> = {
        status: "closed_won",
        closedNote: input.note.trim(),
        closedValue: input.value,
        closedAt: shortDate(),
      };
      pushStatus(id, statusOf(id));
      clearHighlight(id);
      setOverrides((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
      // snapshot for the Closed-deals tab so it survives paging away
      const lead = rows.find((l) => l.id === id);
      if (lead) {
        setClosedDeals((prev) => [{ ...lead, ...patch }, ...prev.filter((l) => l.id !== id)]);
      }
    },
    [rows, pushStatus, statusOf, clearHighlight],
  );

  const revertStatus = useCallback(
    (id: string) => {
      const stack = statusHistory[id] ?? [];
      // nothing recorded (e.g. a preset that arrived already closed) → back to new
      const back: SalesStatus = stack.length ? stack[stack.length - 1] : "new";
      setStatusHistory((prev) => {
        const rest = (prev[id] ?? []).slice(0, -1);
        const next = { ...prev };
        if (rest.length) next[id] = rest;
        else delete next[id];
        return next;
      });
      setOverrides((prev) => ({
        ...prev,
        [id]: {
          ...prev[id],
          status: back,
          // reopening a deal drops the close snapshot with it
          closedNote: undefined,
          closedValue: undefined,
          closedAt: undefined,
        },
      }));
      // no longer won — pull it back out of the Closed-deals tab
      setClosedDeals((prev) => prev.filter((l) => l.id !== id));
    },
    [statusHistory],
  );

  const stats = useMemo<SalesStats>(() => {
    if (mode === "demo") {
      const open = leads.filter((l) => l.status === "new" || l.status === "contacted").length;
      const engaged = leads.filter((l) => l.engaged && l.status !== "closed_lost").length;
      const wonValue = closedDeals.reduce((sum, l) => sum + (l.closedValue ?? l.dealValue ?? 0), 0);
      return { open, engaged, won: closedDeals.length, wonValue, queueTotal: total };
    }
    // live: totals come from the server; won/lost are session-local overlays
    const lost = Object.values(overrides).filter((o) => o.status === "closed_lost").length;
    const wonValue = closedDeals.reduce((sum, l) => sum + (l.closedValue ?? l.dealValue ?? 0), 0);
    return {
      open: Math.max(0, total - closedDeals.length - lost),
      engaged: engagedTotal,
      won: closedDeals.length,
      wonValue,
      queueTotal: total,
    };
  }, [mode, leads, overrides, closedDeals, total, engagedTotal]);

  const value = useMemo<SalesContextValue>(
    () => ({
      leads,
      closedDeals,
      stats,
      total,
      recent,
      series,
      handedToday,
      queuedIds,
      latestHandoffAt: latestAt,
      page,
      pageCount,
      pageSize: PAGE_SIZE,
      loading,
      mode,
      error,
      needsMigration,
      arrivals,
      freshIds,
      acknowledgeArrivals,
      setPage,
      reload,
      statusOf,
      markContacted,
      markLost,
      closeDeal,
      returnLeads,
      revertStatus,
    }),
    [
      leads,
      closedDeals,
      stats,
      total,
      recent,
      series,
      handedToday,
      queuedIds,
      latestAt,
      page,
      pageCount,
      loading,
      mode,
      error,
      needsMigration,
      arrivals,
      freshIds,
      acknowledgeArrivals,
      setPage,
      reload,
      statusOf,
      markContacted,
      markLost,
      closeDeal,
      returnLeads,
      revertStatus,
    ],
  );

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>;
}

export function useSales(): SalesContextValue {
  const ctx = useContext(SalesContext);
  if (!ctx) throw new Error("useSales must be used within <SalesProvider>");
  return ctx;
}
