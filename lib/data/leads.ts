/**
 * Preset lead-generation data for the APMG Services Overview.
 * Realistic seed values so the dashboard reads as a populated instrument,
 * not an empty shell. Swap this module for a data layer when wiring a backend.
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

export type LeadStatus = "new" | "contacted" | "qualified" | "won" | "lost";

export interface LeadRow {
  id: string;
  name: string;
  company: string;
  source: string;
  /** lead quality score 0–100 */
  score: number;
  status: LeadStatus;
  /** pipeline value in USD */
  value: number;
  /** relative time label */
  when: string;
}

export const KPIS: Kpi[] = [
  {
    id: "total-leads",
    label: "Total leads",
    value: "2,847",
    numeric: 2847,
    format: "int",
    delta: 12.4,
    deltaUnit: "%",
    caption: "vs. previous 30 days",
    spark: [38, 41, 39, 46, 52, 49, 58, 61, 57, 66, 72, 81],
  },
  {
    id: "conversion-rate",
    label: "Conversion rate",
    value: "18.6%",
    numeric: 18.6,
    format: "pct",
    delta: 2.1,
    deltaUnit: "pts",
    caption: "lead → qualified, 30-day",
    spark: [12, 13, 12, 14, 15, 14, 16, 15, 17, 17, 18, 19],
  },
  {
    id: "cost-per-lead",
    label: "Cost per lead",
    value: "$42.18",
    numeric: 42.18,
    format: "usd",
    delta: -8.3,
    deltaUnit: "%",
    goodWhenDown: true,
    caption: "blended across channels",
    spark: [58, 55, 56, 52, 50, 51, 48, 47, 46, 44, 43, 42],
  },
];

export const LEADS_BY_MONTH: Bar[] = [
  { label: "Jul", value: 168 },
  { label: "Aug", value: 192 },
  { label: "Sep", value: 181 },
  { label: "Oct", value: 224 },
  { label: "Nov", value: 248 },
  { label: "Dec", value: 205 },
  { label: "Jan", value: 263 },
  { label: "Feb", value: 281 },
  { label: "Mar", value: 272 },
  { label: "Apr", value: 309 },
  { label: "May", value: 334 },
  { label: "Jun", value: 297, current: true },
];

export const LEADS_BY_SOURCE: Bar[] = [
  { label: "Organic", value: 742 },
  { label: "Paid search", value: 631 },
  { label: "LinkedIn", value: 524 },
  { label: "Referral", value: 398 },
  { label: "Email", value: 312, current: true },
  { label: "Events", value: 240 },
];

export const RECENT_LEADS: LeadRow[] = [
  { id: "L-4821", name: "Priya Nadar", company: "Helix Robotics", source: "LinkedIn", score: 92, status: "qualified", value: 48000, when: "12m ago" },
  { id: "L-4820", name: "Marcus Hale", company: "Northwind Freight", source: "Referral", score: 88, status: "won", value: 72000, when: "1h ago" },
  { id: "L-4819", name: "Sofia Ramos", company: "Brightline Health", source: "Paid search", score: 64, status: "contacted", value: 19500, when: "2h ago" },
  { id: "L-4818", name: "Tobias Frank", company: "Meridian Capital", source: "Organic", score: 77, status: "qualified", value: 31000, when: "3h ago" },
  { id: "L-4817", name: "Aiko Tanaka", company: "Cedar & Co.", source: "Email", score: 41, status: "new", value: 8200, when: "5h ago" },
  { id: "L-4816", name: "Devon Clarke", company: "Atlas Manufacturing", source: "Events", score: 33, status: "lost", value: 0, when: "Yesterday" },
];

export const CURRENT_YEAR = 2026;
