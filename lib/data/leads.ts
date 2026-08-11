/**
 * Shared shapes for the Overview dashboard's KPI cards and bar charts.
 *
 * TYPES ONLY — deliberately. This module used to also export a preset dataset
 * (KPIS, LEADS_BY_MONTH, LEADS_BY_SOURCE, RECENT_LEADS: six invented people at
 * invented companies with invented deal values, plus headline figures like
 * "2,847 total leads" and "$42.18 cost per lead"). Nothing rendered it by the
 * end — every importer took `import type` — but it sat here reading as seed
 * data worth reaching for, and its header invited exactly that.
 *
 * Do not add sample values back. A console that cannot reach its database
 * shows an empty state and says so; it never shows plausible numbers. See
 * docs/superpowers/plans/2026-08-09-fabrication-removal.md.
 */

import type { KpiFormat } from "@/lib/format";

export interface Kpi {
  id: string;
  label: string;
  /** canonical display string (used for SSR + reduced motion + null readouts) */
  value: string;
  /** raw value for the odometer count-up */
  numeric: number;
  format: KpiFormat;
  /** signed percentage/point change vs the comparison window (optional — only
   *  rendered when we have a real comparison; pipeline cards usually omit it) */
  delta?: number;
  deltaUnit?: "%" | "pts";
  /** when true a downward delta is the good outcome (e.g. cost per lead) */
  goodWhenDown?: boolean;
  caption?: string;
  /** foot A — sparkline series, oldest → newest (needs ≥ 2 points to render) */
  spark?: number[];
  /** foot B — a labelled proportion bar, 0–1 (shown when there's no spark) */
  ratio?: { value: number; label: string };
  /** render a skeleton readout while the underlying data is still loading */
  loading?: boolean;
  /** show `value` verbatim instead of counting up (for "—" / N/A readouts) */
  noCountUp?: boolean;
}

export interface Bar {
  label: string;
  value: number;
  /** marks the current/most-recent bucket for accent treatment */
  current?: boolean;
}
