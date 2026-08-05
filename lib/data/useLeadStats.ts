"use client";

/**
 * Live lead statistics derived from the SAME data the Pipeline tab writes:
 * Supabase `public.leads`, read back via /api/pipeline/leads (+ /batches for
 * folder counts). This is what makes the Overview KPIs reflect the exact data
 * imported via the pipeline rather than a hardcoded preset.
 *
 * `total` is the exact DB count (PostgREST content-range). The derived ratios
 * (with email/phone, avg rating, by-day) are computed over the fetched sample,
 * which the API caps at 2000 rows — equal to `total` until you cross that mark.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Bar } from "./leads";
import { parseStamps, volumeSeries } from "./buckets";
import type { LeadView } from "@/components/apmg/pipeline/LeadsTable";

// keep in sync with UNGROUPED in lib/pipeline/server.ts
const UNGROUPED = "__ungrouped__";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface LeadStatsData {
  mode: "live" | "demo";
  /** exact total in the DB (authoritative even beyond the 2000-row fetch cap) */
  total: number;
  /** rows actually fetched — derived ratios are computed over these */
  sampled: number;
  withEmail: number;
  withPhone: number;
  withWebsite: number;
  ratedCount: number;
  avgRating: number | null;
  folders: number;
  latestImport: string | null;
  /** leads created in the last 24h (within the sample) */
  addedToday: number;
  /** leads-by-day, oldest → newest, last ≤ 14 active days */
  byDay: Bar[];
  /** leads-by-week (Mon-anchored), oldest → newest, last ≤ 12 active weeks */
  byWeek: Bar[];
  /** leads-by-month, oldest → newest, last ≤ 12 active months */
  byMonth: Bar[];
  /** most-recent rows (the API returns created_at desc) */
  recent: LeadView[];
}

export type LeadStatsState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: LeadStatsData };

interface LeadsResponse {
  ok?: boolean;
  mode?: "live" | "demo";
  rows?: LeadView[];
  total?: number;
  error?: string;
}
interface BatchSummary {
  batch: string;
  count: number;
  created: string | null;
}
interface BatchesResponse {
  ok?: boolean;
  batches?: BatchSummary[];
  needsMigration?: boolean;
}

function ratingOf(r: LeadView): number {
  return typeof r.rating === "number"
    ? r.rating
    : typeof r.rating === "string"
      ? Number.parseFloat(r.rating)
      : Number.NaN;
}

/**
 * @param pollMs  when set, silently refetches on this interval (and on window
 *   focus) so a view can show realtime numbers. Background refreshes don't flash
 *   the loading skeleton, and a failed poll keeps the last good numbers.
 */
export function useLeadStats({ pollMs }: { pollMs?: number } = {}): {
  state: LeadStatsState;
  reload: () => void;
} {
  const [state, setState] = useState<LeadStatsState>({ status: "loading" });
  const stateRef = useRef(state);
  stateRef.current = state;
  const aliveRef = useRef(true);

  const run = useCallback(async () => {
    // Once we have data, refreshes are silent: no skeleton flash, and a failed
    // refresh leaves the existing numbers in place rather than erroring out.
    const hadData = stateRef.current.status === "ready";
    if (!hadData) setState({ status: "loading" });

    try {
      const [leadsRes, batchesRes] = await Promise.all([
        fetch("/api/pipeline/leads", { cache: "no-store" }),
        fetch("/api/pipeline/batches", { cache: "no-store" }).catch(() => null),
      ]);

      const leads = (await leadsRes.json().catch(() => null)) as LeadsResponse | null;
      if (!aliveRef.current) return;
      if (!leadsRes.ok || !leads?.ok) {
        if (!hadData) {
          setState({
            status: "error",
            error: leads?.error ?? `Couldn't load leads (${leadsRes.status}).`,
          });
        }
        return;
      }

      const rows = Array.isArray(leads.rows) ? leads.rows : [];
      const total = leads.total ?? rows.length;
      const mode: "live" | "demo" = leads.mode === "demo" ? "demo" : "live";

      let batches: BatchSummary[] = [];
      if (batchesRes) {
        const bd = (await batchesRes.json().catch(() => null)) as BatchesResponse | null;
        if (bd?.ok && Array.isArray(bd.batches)) batches = bd.batches;
      }
      if (!aliveRef.current) return;

      const now = Date.now();
      let withEmail = 0;
      let withPhone = 0;
      let withWebsite = 0;
      let ratedCount = 0;
      let ratingSum = 0;
      let addedToday = 0;
      let latest: number | null = null;

      for (const r of rows) {
        if (r.emails && r.emails.length > 0) withEmail += 1;
        if (r.phone) withPhone += 1;
        if (r.website) withWebsite += 1;
        const rating = ratingOf(r);
        if (Number.isFinite(rating)) {
          ratedCount += 1;
          ratingSum += rating;
        }
        if (r.created_at) {
          const t = new Date(r.created_at).getTime();
          if (Number.isFinite(t)) {
            if (latest === null || t > latest) latest = t;
            if (now - t <= DAY_MS) addedToday += 1;
          }
        }
      }

      const folders =
        batches.length > 0
          ? batches.length
          : total > 0
            ? new Set(rows.map((r) => r.batch ?? UNGROUPED)).size
            : 0;

      const series = volumeSeries(parseStamps(rows.map((r) => r.created_at)));

      setState({
        status: "ready",
        data: {
          mode,
          total,
          sampled: rows.length,
          withEmail,
          withPhone,
          withWebsite,
          ratedCount,
          avgRating: ratedCount > 0 ? ratingSum / ratedCount : null,
          folders,
          latestImport: latest != null ? new Date(latest).toISOString() : null,
          addedToday,
          byDay: series.byDay,
          byWeek: series.byWeek,
          byMonth: series.byMonth,
          recent: rows.slice(0, 6),
        },
      });
    } catch {
      if (aliveRef.current && !hadData) {
        setState({ status: "error", error: "Network error loading lead stats." });
      }
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    run();
    return () => {
      aliveRef.current = false;
    };
  }, [run]);

  // Realtime: poll on an interval + whenever the tab regains focus.
  useEffect(() => {
    if (!pollMs) return;
    const id = setInterval(() => {
      run();
    }, pollMs);
    const onFocus = () => run();
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [pollMs, run]);

  return { state, reload: run };
}
