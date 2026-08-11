"use client";

/**
 * Live lead statistics derived from the SAME data the Pipeline tab writes:
 * Supabase `public.leads`. This is what makes the Overview KPIs reflect the exact
 * data imported via the pipeline rather than a hardcoded preset.
 *
 * ── Why this is a store and not a plain hook ─────────────────────────────────
 * It used to be a `useState` hook that fetched `/api/pipeline/leads` — the WHOLE
 * table, LIMIT 10000, ~5.7 MB of JSON at 8k rows — and folded the rows in the
 * browser. Three components mounted it (Sidebar, PipelinePage, OverviewPage) and
 * two of them polled every 15s, so every open console tab pulled ~1.4 GB/hour
 * through Vercel to render a badge and four KPI cards. That is what exhausted the
 * Fast Origin Transfer allowance.
 *
 * Two changes fix it, and both are load-bearing:
 *   1. the numbers are aggregated in Postgres and read from /api/pipeline/stats
 *      (~1 KB, ETag-revalidated — see supabase/lead-stats.sql), and
 *   2. this is now ONE module-level poll shared by every consumer, in the same
 *      grammar as hotLeads.ts and leadActivityNotifications.ts, instead of one
 *      independent interval per mount.
 *
 * The poll runs only while something subscribes, pauses when the tab is hidden,
 * and tops up on focus. A failed poll keeps the last good numbers on screen
 * ("slightly stale", never red) — it never fabricates zeros.
 *
 * Bucketing stays client-side. The API returns day-grain counts already cut at
 * local midnight in the viewer's zone (which it is told), and the week/month
 * rollup happens here — see the timezone note in lib/data/buckets.ts.
 */

import { useCallback, useSyncExternalStore } from "react";
import type { Bar } from "./leads";
import { volumeSeriesFromDayCounts, type DayCount } from "./buckets";
import type { LeadView } from "@/components/apmg/pipeline/LeadsTable";

const POLL_MS = 15000;

export interface LeadStatsData {
  mode: "live" | "demo";
  /** exact total in the DB */
  total: number;
  withEmail: number;
  withPhone: number;
  withWebsite: number;
  ratedCount: number;
  avgRating: number | null;
  folders: number;
  latestImport: string | null;
  /** leads created in the last rolling 24h */
  addedToday: number;
  /** leads-by-day, oldest → newest, last ≤ 14 active days */
  byDay: Bar[];
  /** leads-by-week (Mon-anchored), oldest → newest, last ≤ 12 active weeks */
  byWeek: Bar[];
  /** leads-by-month, oldest → newest, last ≤ 12 active months */
  byMonth: Bar[];
  /** most-recent rows, newest first */
  recent: LeadView[];
  /** supabase/lead-stats.sql hasn't been applied — avgRating, folders and the
   *  histogram are unavailable (shown as "—" / empty, never invented) */
  needsMigration: boolean;
}

export type LeadStatsState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: LeadStatsData };

interface StatsResponse {
  ok?: boolean;
  mode?: "live" | "demo";
  needsMigration?: boolean;
  total?: number;
  withEmail?: number;
  withPhone?: number;
  withWebsite?: number;
  ratedCount?: number;
  avgRating?: number | null;
  folders?: number;
  latestImport?: string | null;
  addedToday?: number;
  byDay?: DayCount[];
  recent?: LeadView[];
  error?: string;
}

const LOADING: LeadStatsState = { status: "loading" };

/* ── module state (one instance per tab, shared by every consumer) ─────────── */

let snapshot: LeadStatsState = LOADING;
/** Raw body of the last applied response. The payload is ~1 KB, so comparing it
 *  verbatim is cheaper than re-folding it, and an unchanged poll then leaves
 *  `snapshot` identical — which is what keeps useSyncExternalStore quiet and
 *  stops all three consumers re-rendering every 15s. */
let lastBody = "";
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let windowHooked = false;

function emit() {
  for (const l of listeners) l();
}

/** The viewer's own zone — the API cuts the daily buckets at local midnight
 *  there. Falls back to UTC on the rare browser without a resolved zone. */
function viewerZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

function toData(res: StatsResponse): LeadStatsData {
  const series = volumeSeriesFromDayCounts(Array.isArray(res.byDay) ? res.byDay : []);
  return {
    mode: res.mode === "demo" ? "demo" : "live",
    total: int(res.total),
    withEmail: int(res.withEmail),
    withPhone: int(res.withPhone),
    withWebsite: int(res.withWebsite),
    ratedCount: int(res.ratedCount),
    avgRating: typeof res.avgRating === "number" && Number.isFinite(res.avgRating) ? res.avgRating : null,
    folders: int(res.folders),
    latestImport: typeof res.latestImport === "string" ? res.latestImport : null,
    addedToday: int(res.addedToday),
    byDay: series.byDay,
    byWeek: series.byWeek,
    byMonth: series.byMonth,
    recent: Array.isArray(res.recent) ? res.recent : [],
    needsMigration: res.needsMigration === true,
  };
}

async function poll() {
  if (inflight || typeof window === "undefined") return;
  if (document.visibilityState === "hidden") return;
  inflight = true;
  const hadData = snapshot.status === "ready";
  try {
    // `no-cache`, NOT `no-store`: the browser must be allowed to keep the body
    // so it can send If-None-Match and take the route's 304 (empty) answer.
    // `no-store` would forbid the cached copy and force a full body every poll.
    const res = await fetch(`/api/pipeline/stats?tz=${encodeURIComponent(viewerZone())}`, {
      cache: "no-cache",
    });
    const body = await res.text().catch(() => "");
    if (!res.ok) {
      // A poll that fails once we have numbers leaves them on screen; only a
      // cold start surfaces the error.
      if (!hadData) {
        const parsed = (() => {
          try {
            return JSON.parse(body) as StatsResponse;
          } catch {
            return null;
          }
        })();
        snapshot = { status: "error", error: parsed?.error ?? `Couldn't load lead stats (${res.status}).` };
        emit();
      }
      return;
    }
    if (body === lastBody) return; // nothing changed — don't re-render anyone

    const parsed = (() => {
      try {
        return JSON.parse(body) as StatsResponse;
      } catch {
        return null;
      }
    })();
    if (!parsed?.ok) {
      if (!hadData) {
        snapshot = { status: "error", error: parsed?.error ?? "Couldn't load lead stats." };
        emit();
      }
      return;
    }
    lastBody = body;
    snapshot = { status: "ready", data: toData(parsed) };
    emit();
  } catch {
    if (!hadData) {
      snapshot = { status: "error", error: "Network error loading lead stats." };
      emit();
    }
  } finally {
    inflight = false;
  }
}

function onWindowActive() {
  void poll();
}

function startPolling() {
  if (pollTimer || typeof window === "undefined") return;
  pollTimer = setInterval(() => void poll(), POLL_MS);
  if (!windowHooked) {
    windowHooked = true;
    window.addEventListener("focus", onWindowActive);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onWindowActive();
    });
  }
  void poll();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  startPolling();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stopPolling();
  };
}

/* ── public surface ───────────────────────────────────────────────────────── */

/** Force an immediate refresh — the loud manual pull behind a Refresh button
 *  and the top-up after an import writes new rows. */
export function reloadLeadStats() {
  void poll();
}

/**
 * The shared lead-stats snapshot. Every consumer reads the same poll, so mounting
 * this in N places costs one request per interval, not N.
 *
 * `enabled` gates the subscription entirely: `/api/pipeline/stats` requires
 * `leads.view`, so a caller without it would 403 every 15s forever to feed a
 * readout it can never see. Pass `can("leads.view")` from a surface that isn't
 * already behind that permission; when false the hook never joins the listener
 * set (so it can't hold the poll timer open) and stays in `loading`.
 */
export function useLeadStats(enabled = true): {
  state: LeadStatsState;
  reload: () => void;
} {
  const sub = useCallback((cb: () => void) => (enabled ? subscribe(cb) : () => {}), [enabled]);
  const state = useSyncExternalStore(
    sub,
    () => (enabled ? snapshot : LOADING),
    () => LOADING,
  );
  return { state, reload: reloadLeadStats };
}

/** Test seam: drop all module state between cases. */
export function __resetLeadStatsStore() {
  stopPolling();
  listeners.clear();
  snapshot = LOADING;
  lastBody = "";
  inflight = false;
}
