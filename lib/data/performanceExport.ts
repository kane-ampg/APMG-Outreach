import { sourceLabel } from "./enquiries";
import { serviceName } from "./leadActivity";
import { INTERACTIONS, pctChange, RANGE_LABEL, sumSeries, type PerfSeries, type Performance } from "./performance";

/**
 * Performance → "Export CSV": the tab as a report someone can open in Excel
 * without having seen the console. It leads with the customer portal's
 * address, so whoever opens the file knows which page the numbers describe,
 * then the period and what it's compared with, then one block per panel, and
 * the day-by-day figures last for anyone who wants to chart them.
 *
 * Same file conventions as lib/clients/export.ts: RFC-4180 quoting, CRLF, a
 * UTF-8 BOM so Excel reads it as UTF-8.
 *
 * FORMULA INJECTION. Service slugs and referring-site names arrive from
 * visitors' browsers, so a crafted beacon could name a "service"
 * `=HYPERLINK(...)`, and Excel would run it. Any cell starting with = + - @ or
 * a tab/CR is prefixed with an apostrophe, which Excel shows as plain text.
 * Changes are therefore written "Up 12%", never "+12%".
 */

function field(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  let s = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (...cells: Array<string | number | null | undefined>) => cells.map(field).join(",");

/** "Up 12%", "Down 40%", "No change", "New" (nothing before), or blank. */
export function changeText(current: number, previous: number): string {
  const c = pctChange(current, previous);
  if (c === null) return current > 0 ? "New" : "";
  const pct = Math.round(Math.abs(c) * 100);
  if (pct === 0) return "No change";
  return `${c > 0 ? "Up" : "Down"} ${pct}%`;
}

/** "Outreach email 7; Facebook 2", most first. */
function cameFrom(series: PerfSeries): string {
  return Object.entries(series.bySource)
    .sort((a, b) => b[1] - a[1])
    .map(([source, n]) => `${sourceLabel(source)} ${n}`)
    .join("; ");
}

/** YYYY-MM-DD moved by `delta` calendar days. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** YYYY-MM-DD → "11 Sept 2026", read as the calendar day the server cut. */
export function longDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return day;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** "8 Oct 2026, 3:41 pm AEDT" in the zone the days were counted in. */
export function stamp(d: Date, tz: string | undefined): string {
  return d.toLocaleString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz || undefined,
    timeZoneName: "short",
  });
}

export function performanceCsv(data: Performance, opts: { portalUrl: string; generatedAt: Date }): string {
  const { days, dates } = data;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const all = sumSeries(Object.values(data.interactions), days);
  const range = RANGE_LABEL[days];
  const tz = data.tz || undefined;
  const lines: string[] = [];

  // ── what this is ────────────────────────────────────────────────────────
  lines.push(row("APMG Services: customer portal performance"));
  lines.push(row("Customer portal", opts.portalUrl));
  if (first && last) {
    lines.push(row("Period", `Last ${range}: ${longDay(first)} to ${longDay(last)}`));
    lines.push(
      row("Compared with", `Previous ${range}: ${longDay(shiftDay(first, -days))} to ${longDay(shiftDay(first, -1))}`),
    );
  }
  if (data.tz) lines.push(row("Days counted in", data.tz));
  const asOf = data.computedAt ? new Date(data.computedAt) : opts.generatedAt;
  lines.push(row("Figures as of", stamp(asOf, tz)));
  lines.push(row("Exported", stamp(opts.generatedAt, tz)));
  lines.push(
    row(
      "Note",
      "Clicks and visits only. The portal can't count impressions (people who saw it in search results without clicking through).",
    ),
  );
  if (data.scannerEventsExcluded > 0) {
    lines.push(
      row(
        "Note",
        `${data.scannerEventsExcluded} events from email scanners (automated link checkers, not people) are left out of every figure.`,
      ),
    );
  }
  if (data.mode === "demo") {
    lines.push(row("Note", "The console wasn't connected to its database, so every figure is zero."));
  }

  // ── summary ─────────────────────────────────────────────────────────────
  lines.push("", row("Summary"), row("Measure", "This period", "Previous period", "Change"));
  lines.push(row("Portal interactions", all.total, all.previous, changeText(all.total, all.previous)));
  lines.push(row("Visits", data.visits.total, data.visits.previous, changeText(data.visits.total, data.visits.previous)));
  const enquiries = data.interactions.enquiries;
  lines.push(row("Enquiries", enquiries.total, enquiries.previous, changeText(enquiries.total, enquiries.previous)));
  lines.push(row("Unique visitors", data.visitors, "", ""));

  // ── clicks by service ───────────────────────────────────────────────────
  const serviceTotal = data.interactions.services.total;
  lines.push(
    "",
    row("Clicks by service"),
    row("Service", "Clicks", "Previous period", "Change", "Share of service clicks", "Enquiries", "Came from"),
  );
  for (const s of data.services) {
    lines.push(
      row(
        serviceName(s.service),
        s.total,
        s.previous,
        changeText(s.total, s.previous),
        serviceTotal > 0 ? `${Math.round((s.total / serviceTotal) * 100)}%` : "",
        s.enquiries,
        cameFrom(s),
      ),
    );
  }
  const g = data.general;
  lines.push(
    row(
      "Enquiry form (opened with no trade picked)",
      g.total,
      g.previous,
      changeText(g.total, g.previous),
      "",
      g.enquiries,
      cameFrom(g),
    ),
  );

  // ── interactions ────────────────────────────────────────────────────────
  lines.push(
    "",
    row("Interactions"),
    row("Interaction", "What it counts", "This period", "Previous period", "Change", "Came from"),
  );
  for (const m of INTERACTIONS) {
    const s = data.interactions[m.id];
    lines.push(row(m.label, m.hint, s.total, s.previous, changeText(s.total, s.previous), cameFrom(s)));
  }

  // ── where they came from ────────────────────────────────────────────────
  const sources = [...new Set([...Object.keys(data.visits.bySource), ...Object.keys(all.bySource)])].sort(
    (a, b) =>
      (data.visits.bySource[b] ?? 0) + (all.bySource[b] ?? 0) - ((data.visits.bySource[a] ?? 0) + (all.bySource[a] ?? 0)),
  );
  lines.push("", row("Where they came from"), row("Source", "Visits", "Interactions", "Service clicks", "Enquiries"));
  for (const source of sources) {
    lines.push(
      row(
        sourceLabel(source),
        data.visits.bySource[source] ?? 0,
        all.bySource[source] ?? 0,
        data.interactions.services.bySource[source] ?? 0,
        enquiries.bySource[source] ?? 0,
      ),
    );
  }

  // ── day by day ──────────────────────────────────────────────────────────
  lines.push(
    "",
    row("Day by day"),
    row(
      "Date",
      "Visits",
      "All interactions",
      ...INTERACTIONS.map((m) => m.label),
      ...data.services.map((s) => `${serviceName(s.service)} clicks`),
      "Enquiry form opened",
    ),
  );
  dates.forEach((day, i) => {
    lines.push(
      row(
        day,
        data.visits.daily[i],
        all.daily[i],
        ...INTERACTIONS.map((m) => data.interactions[m.id].daily[i]),
        ...data.services.map((s) => s.daily[i]),
        g.daily[i],
      ),
    );
  });

  return lines.join("\r\n");
}

export function performanceCsvFilename(data: Performance, now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `apmg-portal-performance-${data.days}-days-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}.csv`;
}

/** Build the report and hand it to the browser as a download. */
export function downloadPerformanceCsv(data: Performance, portalUrl: string): void {
  const now = new Date();
  // U+FEFF byte-order mark, written from its code point so no invisible
  // character sits in this file. Excel needs it to read the file as UTF-8.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + performanceCsv(data, { portalUrl, generatedAt: now })], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = performanceCsvFilename(data, now);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
