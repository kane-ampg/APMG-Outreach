import { SERVICE_NAME } from "./leadActivity";

/**
 * The Telemetry tab's "Services clicked" panel: how many times each trade's
 * card was opened, by every visitor (outreach, Facebook, Google, anonymous),
 * built from /api/portal/summary's `byService`.
 *
 * Two rules the raw rollup doesn't follow, and why:
 *  - EVERY trade is listed, zero-click ones included — "nobody has opened
 *    Carpentry" is an answer, and a list that only shows what was clicked
 *    can't give it.
 *  - `general` is NOT a trade. It is the quote buttons ("Get a quote", "Tell
 *    us what needs doing"), which outnumber every trade put together, so it is
 *    counted in the total but kept out of the ranking.
 */

export const GENERAL_SERVICE_SLUG = "general";

/** The portal's trades in their authored order — the tie-breaker. */
const TRADE_ORDER = Object.keys(SERVICE_NAME).filter((s) => s !== GENERAL_SERVICE_SLUG);

export interface ServiceClickRow {
  service: string;
  opens: number;
  inquiries: number;
  /** clicks per channel (outreach / direct / facebook / …), most first */
  bySource: Array<{ source: string; opens: number }>;
}

export interface ServiceClicks {
  /** every trade, zero-click ones included, most-clicked first */
  trades: ServiceClickRow[];
  /** the quote buttons — counted, but not a trade */
  general: ServiceClickRow;
  /** every click, quote buttons included */
  total: number;
}

const count = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

function toRow(service: string, raw: Record<string, unknown> | undefined): ServiceClickRow {
  const split = raw?.opensBySource;
  const bySource =
    split && typeof split === "object" && !Array.isArray(split)
      ? Object.entries(split as Record<string, unknown>)
          .map(([source, opens]) => ({ source, opens: count(opens) }))
          .filter((s) => s.source && s.opens > 0)
          .sort((a, b) => b.opens - a.opens)
      : [];
  return { service, opens: count(raw?.opens), inquiries: count(raw?.inquiries), bySource };
}

/** Normalise the summary payload's `byService` (re-validated field by field,
 *  like every other payload this tab reads) into the panel's rows. */
export function toServiceClicks(byService: unknown): ServiceClicks {
  const raw = new Map<string, Record<string, unknown>>();
  for (const r of Array.isArray(byService) ? byService : []) {
    if (!r || typeof r !== "object") continue;
    const service = (r as { service?: unknown }).service;
    if (typeof service === "string" && service) raw.set(service, r as Record<string, unknown>);
  }

  // Known trades first in portal order, then anything the portal has added
  // since this list was written — its clicks still count.
  const slugs = [...TRADE_ORDER, ...[...raw.keys()].filter((s) => s !== GENERAL_SERVICE_SLUG && !TRADE_ORDER.includes(s))];
  const trades = slugs
    .map((s, i) => ({ row: toRow(s, raw.get(s)), i }))
    .sort((a, b) => b.row.opens - a.row.opens || a.i - b.i)
    .map(({ row }) => row);
  const general = toRow(GENERAL_SERVICE_SLUG, raw.get(GENERAL_SERVICE_SLUG));

  return { trades, general, total: trades.reduce((n, t) => n + t.opens, general.opens) };
}
