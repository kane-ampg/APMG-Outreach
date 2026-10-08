import { brandLogoSvg, isBrand } from "@/components/apmg/BrandLogos";
import { formatInt } from "@/lib/format";
import { sourceLabel } from "./enquiries";
import { serviceName } from "./leadActivity";
import {
  chartBuckets,
  DAILY_BAR_LIMIT,
  INTERACTIONS,
  pctChange,
  RANGE_LABEL,
  sumSeries,
  type ChartBucket,
  type PerfSeries,
  type Performance,
} from "./performance";
import { changeText, longDay, shiftDay, stamp } from "./performanceExport";

/**
 * Performance → "Export PDF": the tab as a one- or two-page A4 report for
 * someone who has never opened the console. It names the customer portal
 * first, so the reader knows which page it is about, then the headline
 * figures, the chart, clicks per service, and where people came from.
 *
 * Same machinery and look as the Telemetry tab's PDF (TelemetryReportExport):
 * one self-contained HTML document, inline CSS only, written into a new
 * window that opens the browser's print dialog, where "Save as PDF" is the
 * export. No PDF library. The chart is inline SVG, so it prints sharp.
 *
 * Every dynamic string goes through esc(): service slugs and referring-site
 * names arrive from visitors' browsers.
 */

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as const)[
      c as "&" | "<" | ">" | '"' | "'"
    ],
  );
}

/** "Up 12%" in signal red, "Down 40%" muted: direction stays in the red
 *  family, as on the page (no green). */
function changeCell(current: number, previous: number): string {
  const text = changeText(current, previous);
  if (!text) return `<span class="mut">—</span>`;
  const c = pctChange(current, previous);
  const up = c === null ? current > 0 : c > 0;
  return `<span class="${up ? "up" : "mut chg"}">${esc(text)}</span>`;
}

/** YYYY-MM-DD → "11 Sept". */
function shortDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return day;
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

function sourceCell(source: string): string {
  const logo = isBrand(source) ? brandLogoSvg(source, 12) : "";
  return `<span class="ch">${logo}${esc(sourceLabel(source))}</span>`;
}

/** The bar chart as inline SVG: same bars as the page (a day each up to a
 *  month, a week each past that), about seven date labels counted back from
 *  the newest, and the peak marked. */
export function chartSvg(buckets: readonly ChartBucket[], label: string): string {
  const W = 700;
  const H = 168;
  const top = 16;
  const bottom = 20;
  const plot = H - top - bottom;
  const count = Math.max(1, buckets.length);
  const slot = W / count;
  const gap = Math.min(4, slot * 0.25);
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const peak = buckets.reduce((m, b) => Math.max(m, b.value), 0);
  const last = buckets.length - 1;
  const step = Math.max(1, Math.ceil(buckets.length / 7));

  const grid = [0.25, 0.5, 0.75]
    .map((g) => `<line x1="0" x2="${W}" y1="${top + plot * (1 - g)}" y2="${top + plot * (1 - g)}" class="g"/>`)
    .join("");
  const bars = buckets
    .map((b, i) => {
      const x = (i * slot + gap / 2).toFixed(1);
      const w = (slot - gap).toFixed(1);
      if (b.value <= 0) return `<rect x="${x}" y="${top + plot - 1}" width="${w}" height="1" class="z"/>`;
      const h = Math.max(1.5, (b.value / max) * plot);
      return `<rect x="${x}" y="${(top + plot - h).toFixed(1)}" width="${w}" height="${h.toFixed(1)}" rx="1.5" class="b"/>`;
    })
    .join("");
  const ticks = buckets
    .map((b, i) => ({ b, i }))
    .filter(({ i }) => (last - i) % step === 0)
    .map(({ b, i }) => {
      const anchor = i === last ? "end" : i === 0 ? "start" : "middle";
      const x = i === last ? W : i === 0 ? 0 : (i + 0.5) * slot;
      return `<text x="${x.toFixed(1)}" y="${H - 5}" text-anchor="${anchor}">${esc(shortDay(b.start))}</text>`;
    })
    .join("");

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}">${grid}${bars}<line x1="0" x2="${W}" y1="${top + plot}" y2="${top + plot}" class="base"/><text x="${W}" y="10" text-anchor="end">peak ${esc(formatInt(peak))}</text>${ticks}</svg>`;
}

export function performanceReportTitle(data: Performance): string {
  const last = data.dates[data.dates.length - 1];
  return `APMG customer portal performance - last ${RANGE_LABEL[data.days]}${last ? ` to ${longDay(last)}` : ""}`;
}

export function performanceReportHtml(
  data: Performance,
  opts: {
    /** the portal page, as shown to the reader */
    portalUrl: string;
    /** where the link actually goes (the staff marker, so a click isn't counted) */
    portalHref: string;
    generatedAt: Date;
  },
): string {
  const { days, dates } = data;
  const first = dates[0];
  const last = dates[dates.length - 1];
  const range = RANGE_LABEL[days];
  const tz = data.tz || undefined;
  const all = sumSeries(Object.values(data.interactions), days);
  const enquiries = data.interactions.enquiries;
  const byWeek = days > DAILY_BAR_LIMIT;
  const buckets = chartBuckets(dates, all.daily);
  const portalText = opts.portalUrl.replace(/^https?:\/\//, "");

  const kpis: Array<{ label: string; series?: PerfSeries; value: number; note?: string }> = [
    { label: "Portal interactions", series: all, value: all.total },
    { label: "Visits", series: data.visits, value: data.visits.total },
    { label: "Enquiries", series: enquiries, value: enquiries.total },
    { label: "Unique visitors", value: data.visitors, note: "distinct browsers this period" },
  ];

  const serviceTotal = data.interactions.services.total;
  const serviceMax = Math.max(1, ...data.services.map((s) => s.total));
  const serviceRow = (name: string, s: (typeof data.services)[number], share: boolean) => `<tr>
      <td>${name}</td>
      <td class="r num">${formatInt(s.total)}</td>
      <td class="r num mut">${formatInt(s.previous)}</td>
      <td class="r">${changeCell(s.total, s.previous)}</td>
      <td class="barcell">${share ? `<div class="bar"><i style="width:${Math.round((s.total / serviceMax) * 100)}%"></i></div>` : ""}</td>
      <td class="r num">${share && serviceTotal > 0 ? `${Math.round((s.total / serviceTotal) * 100)}%` : ""}</td>
      <td class="r num">${s.enquiries > 0 ? formatInt(s.enquiries) : `<span class="mut">—</span>`}</td>
    </tr>`;

  const sources = [...new Set([...Object.keys(data.visits.bySource), ...Object.keys(all.bySource)])].sort(
    (a, b) =>
      (data.visits.bySource[b] ?? 0) + (all.bySource[b] ?? 0) - ((data.visits.bySource[a] ?? 0) + (all.bySource[a] ?? 0)),
  );

  const notes = [
    "Clicks and visits only. The portal can't count impressions (people who saw it in search results without clicking through).",
    data.scannerEventsExcluded > 0
      ? `${formatInt(data.scannerEventsExcluded)} events from email scanners (automated link checkers, not people) are left out of every figure.`
      : "",
    data.tz ? `Days are counted in ${data.tz} time.` : "",
  ].filter(Boolean);

  const banner =
    data.mode === "demo"
      ? `<div class="banner">The console wasn't connected to its database when this was exported, so every figure is zero.</div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${esc(performanceReportTitle(data))}</title>
<style>
  :root { --ink: #17171a; --mut: #6b6b73; --line: #e4e4e8; --red: #c8102e; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink); font-size: 12px; line-height: 1.5; padding: 32px 36px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  @page { size: A4; margin: 13mm; }
  @media print { body { padding: 0; } }
  .num { font-variant-numeric: tabular-nums; }
  .mut { color: var(--mut); }
  .up { color: var(--red); font-weight: 600; }
  .up, .mut.chg { white-space: nowrap; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    border-bottom: 3px solid var(--red); padding-bottom: 14px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { min-width: 34px; height: 34px; padding: 0 5px; border-radius: 8px; background: var(--red); color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 11px; letter-spacing: .04em; }
  .brand b { font-size: 14px; letter-spacing: -0.01em; }
  .brand span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .14em; color: var(--mut); }
  .meta { text-align: right; font-size: 10px; color: var(--mut); }
  .meta .period { font-size: 13px; font-weight: 700; color: var(--ink); }
  h1 { font-size: 19px; letter-spacing: -0.02em; margin: 18px 0 6px; }
  .portal { display: flex; align-items: baseline; gap: 8px; border: 1px solid var(--line); border-left: 3px solid var(--red);
    border-radius: 8px; padding: 8px 12px; font-size: 12px; }
  .portal .k { font-size: 9px; text-transform: uppercase; letter-spacing: .14em; color: var(--mut); white-space: nowrap; }
  .portal a { color: var(--red); font-weight: 600; text-decoration: none; word-break: break-all; }
  .sub { color: var(--mut); font-size: 11px; margin-top: 8px; }
  .banner { margin-top: 12px; border: 1px solid #eab30866; background: #eab3081a; color: #92660a;
    border-radius: 8px; padding: 8px 12px; font-size: 11px; }
  section { margin-top: 22px; break-inside: avoid; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .16em; color: var(--red);
    border-bottom: 1px solid var(--line); padding-bottom: 5px; margin-bottom: 10px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .kpi .l { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: var(--mut); }
  .kpi .v { font-size: 24px; font-weight: 750; letter-spacing: -0.02em; margin-top: 2px; }
  .kpi .n { font-size: 10px; color: var(--mut); margin-top: 1px; }
  .chart { display: block; width: 100%; height: auto; }
  .chart text { font-family: inherit; font-size: 8.5px; fill: var(--mut); }
  .chart .b { fill: var(--red); }
  .chart .z { fill: var(--line); }
  .chart .g { stroke: #f0f0f3; stroke-width: 1; }
  .chart .base { stroke: var(--red); stroke-opacity: .5; stroke-width: 1; }
  table { width: 100%; border-collapse: collapse; }
  tr { break-inside: avoid; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .1em; color: var(--mut);
    border-bottom: 1px solid var(--line); padding: 4px 8px 5px; }
  td { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: middle; }
  th.r, td.r { text-align: right; }
  tr:last-child td { border-bottom: none; }
  tr.sep td { border-top: 1px solid var(--line); }
  td.barcell { width: 22%; }
  .bar { height: 6px; border-radius: 999px; background: #efeff2; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 999px; background: var(--red); }
  .ch { display: inline-flex; align-items: center; gap: 6px; }
  .split { display: grid; grid-template-columns: 1.15fr 1fr; gap: 20px; align-items: start; }
  .hint { display: block; font-size: 9.5px; color: var(--mut); }
  .note { color: var(--mut); font-size: 10px; margin-top: 8px; }
  .empty { color: var(--mut); font-size: 11px; padding: 6px 0; }
  footer { margin-top: 26px; border-top: 1px solid var(--line); padding-top: 8px;
    display: flex; justify-content: space-between; gap: 16px; font-size: 9px; color: var(--mut); }
</style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="mark">APMG</div>
      <div><b>APMG Services</b><span>Customer portal performance</span></div>
    </div>
    <div class="meta">
      <div class="period">Last ${esc(range)}</div>
      ${first && last ? `<div>${esc(longDay(first))} to ${esc(longDay(last))}</div>` : ""}
      ${first ? `<div>Compared with ${esc(longDay(shiftDay(first, -days)))} to ${esc(longDay(shiftDay(first, -1)))}</div>` : ""}
      <div>Generated ${esc(stamp(opts.generatedAt, tz))}</div>
    </div>
  </header>

  <h1>Customer portal performance, last ${esc(range)}</h1>
  <div class="portal"><span class="k">Customer portal</span><a href="${esc(opts.portalHref)}">${esc(portalText)}</a></div>
  <div class="sub">How the page customers land on is doing: visits, clicks, calls and enquiries, and how many clicks each service got, each set against the ${esc(range)} before.</div>
  ${banner}

  <section>
    <h2>At a glance</h2>
    <div class="kpis">
      ${kpis
        .map(
          (k) => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v num">${esc(formatInt(k.value))}</div><div class="n">${
            !k.series
              ? esc(k.note ?? "")
              : k.series.total === 0 && k.series.previous === 0
                ? "None in either period"
                : `${changeCell(k.series.total, k.series.previous)} <span class="mut">vs ${esc(formatInt(k.series.previous))} before</span>`
          }</div></div>`,
        )
        .join("")}
    </div>
  </section>

  <section>
    <h2>Portal interactions by ${byWeek ? "week" : "day"}</h2>
    ${chartSvg(buckets, `Portal interactions by ${byWeek ? "week" : "day"}, last ${range}`)}
    <div class="note">${
      byWeek ? "Each bar is seven days, counted back from the newest; the first bar can be shorter." : "Each bar is one day."
    } Interactions are service clicks, quote clicks, calls, enquiries, chats, and website, email, WhatsApp and reviews clicks.</div>
  </section>

  <section>
    <h2>Clicks by service</h2>
    <table>
      <thead><tr><th>Service</th><th class="r">Clicks</th><th class="r">Before</th><th class="r">Change</th><th></th><th class="r">Share</th><th class="r">Enquiries</th></tr></thead>
      <tbody>
        ${data.services.map((s) => serviceRow(esc(serviceName(s.service)), s, true)).join("")}
        ${serviceRow(`Enquiry form <span class="mut">(no trade picked)</span>`, data.general, false).replace("<tr>", '<tr class="sep">')}
      </tbody>
    </table>
    <div class="note">A click is someone opening that trade's card on the customer portal. Every trade is listed, including ones nobody clicked.</div>
  </section>

  <section>
    <div class="split">
      <div>
        <h2>Interactions</h2>
        <table>
          <thead><tr><th>Interaction</th><th class="r">Count</th><th class="r">Change</th></tr></thead>
          <tbody>
            ${INTERACTIONS.map((m) => {
              const s = data.interactions[m.id];
              return `<tr><td>${esc(m.label)}<span class="hint">${esc(m.hint)}</span></td><td class="r num">${formatInt(s.total)}</td><td class="r">${changeCell(s.total, s.previous)}</td></tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div>
        <h2>Where they came from</h2>
        ${
          sources.length > 0
            ? `<table><thead><tr><th>Source</th><th class="r">Visits</th><th class="r">Interactions</th></tr></thead><tbody>${sources
                .map(
                  (src) =>
                    `<tr><td>${sourceCell(src)}</td><td class="r num">${formatInt(data.visits.bySource[src] ?? 0)}</td><td class="r num">${formatInt(all.bySource[src] ?? 0)}</td></tr>`,
                )
                .join("")}</tbody></table>`
            : `<div class="empty">Nobody visited in this period.</div>`
        }
      </div>
    </div>
  </section>

  <section>
    ${notes.map((n) => `<div class="note">${esc(n)}</div>`).join("")}
  </section>

  <footer>
    <span>APMG Services. Internal report from the lead generation console.</span>
    <span>${esc(portalText)}</span>
  </footer>
  <script>addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;
}

/**
 * Open the report and the print dialog. Must run inside the click handler:
 * a window opened later is eaten by popup blockers. Returns false when the
 * browser blocked it anyway, so the page can say so.
 */
export function openPerformanceReport(data: Performance, portalUrl: string, portalHref: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(performanceReportHtml(data, { portalUrl, portalHref, generatedAt: new Date() }));
  win.document.close();
  return true;
}
