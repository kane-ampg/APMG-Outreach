export type KpiFormat = "int" | "pct" | "usd" | "usd0" | "rating";

/** Format a KPI numeric into its display string. */
export function formatKpi(n: number, format: KpiFormat): string {
  if (format === "pct") return `${n.toFixed(1)}%`;
  if (format === "usd") return `$${n.toFixed(2)}`;
  if (format === "usd0") return `$${Math.round(n).toLocaleString("en-US")}`;
  if (format === "rating") return n.toFixed(1);
  return Math.round(n).toLocaleString("en-US");
}

/** Compact integer formatter for axis/tooltip readouts. */
export function formatInt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

/** USD with no decimals, e.g. pipeline value cells. */
export function formatUsd(n: number): string {
  return n === 0 ? "—" : `$${Math.round(n).toLocaleString("en-US")}`;
}

/** HH:MM, 24h, for the signal ticker sync clock. */
export function formatClock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
