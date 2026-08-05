"use client";

import { useMemo, useState } from "react";
import { CalendarDays, ChevronDown, FileDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { serviceName } from "@/lib/data/leadActivity";
import { formatInt } from "@/lib/format";
import { adminHeaders } from "@/lib/portal/adminKey";
import { Button } from "@/components/ui/button";

/**
 * Telemetry → "Export PDF": a period report (single day, Mon–Sun week, or
 * calendar month) covering the whole outreach story for that window — leads
 * imported and their email reachability, emails sent (the campaign send
 * ledger), engagement funnel (clicks → portal → services → enquiries),
 * per-campaign breakdown, top services, and the period's enquiries.
 *
 * Numbers come from GET /api/portal/report?from&to (PORTAL_ADMIN_KEY-gated,
 * same key the tab already holds). The PDF itself is the browser's print
 * pipeline: we open a window synchronously on click (popup-blocker safe),
 * stream a print-styled A4 document into it, and auto-invoke print() — the
 * user lands directly in "Save as PDF". Zero PDF dependencies.
 *
 * The period picker is ONE date input for all three granularities (type=date
 * is the only universally supported picker — type=week/month are missing in
 * Firefox/Safari): Day = that date, Week = the Mon–Sun week containing it,
 * Month = the calendar month containing it. A preview line always spells out
 * the exact resolved window before anything is generated.
 */

type PeriodMode = "day" | "week" | "month";

interface Period {
  from: Date;
  /** exclusive */
  to: Date;
  label: string;
}

/* ── period maths (all local time; the API gets ISO instants) ────────────── */

function parseDateInput(v: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayInputValue(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

const AU = "en-AU";
const fmtLong = (d: Date) =>
  d.toLocaleDateString(AU, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const fmtShort = (d: Date) => d.toLocaleDateString(AU, { day: "numeric", month: "short", year: "numeric" });
const fmtDayMonth = (d: Date) => d.toLocaleDateString(AU, { day: "numeric", month: "short" });

function periodFor(mode: PeriodMode, value: string): Period | null {
  const picked = parseDateInput(value);
  if (!picked) return null;
  if (mode === "day") {
    return { from: picked, to: addDays(picked, 1), label: fmtLong(picked) };
  }
  if (mode === "week") {
    const monday = addDays(picked, -((picked.getDay() + 6) % 7));
    const sunday = addDays(monday, 6);
    return {
      from: monday,
      to: addDays(monday, 7),
      label: `Week ${fmtDayMonth(monday)} – ${fmtShort(sunday)}`,
    };
  }
  const first = new Date(picked.getFullYear(), picked.getMonth(), 1);
  return {
    from: first,
    to: new Date(picked.getFullYear(), picked.getMonth() + 1, 1),
    label: first.toLocaleDateString(AU, { month: "long", year: "numeric" }),
  };
}

/* ── report payload (mirrors /api/portal/report) ─────────────────────────── */

interface ReportPayload {
  ok?: boolean;
  mode?: string;
  needsMigration?: boolean;
  error?: string;
  leads?: {
    added?: number;
    withEmail?: number;
    withoutEmail?: number;
    totalAllTime?: number;
    withEmailAllTime?: number;
  };
  outreach?: {
    emailsSent?: number;
    uniqueLeadsEmailed?: number;
    unsubscribes?: number;
    campaigns?: { campaign?: string; sent?: number; clicks?: number }[];
  };
  engagement?: {
    emailClicks?: number;
    uniqueLeadsClicked?: number;
    portalViews?: number;
    serviceOpens?: number;
    inquiries?: number;
    topServices?: { service?: string; opens?: number }[];
  };
  inquiries?: {
    business?: string | null;
    name?: string | null;
    service?: string | null;
    category?: string | null;
    ts?: string;
  }[];
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/* ── report document ─────────────────────────────────────────────────────── */

function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as const)[
      c as "&" | "<" | ">" | '"' | "'"
    ],
  );
}

const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");

/** The whole print-styled A4 document, as one HTML string (inline CSS only —
 *  it renders in a bare window). Every dynamic string goes through esc(). */
function buildReportHtml(data: ReportPayload, period: Period, modeLabel: string): string {
  const leads = data.leads ?? {};
  const out = data.outreach ?? {};
  const eng = data.engagement ?? {};

  const added = n(leads.added);
  const withEmail = n(leads.withEmail);
  const withoutEmail = n(leads.withoutEmail);
  const emailsSent = n(out.emailsSent);
  const uniqueEmailed = n(out.uniqueLeadsEmailed);
  const unsubscribes = n(out.unsubscribes);
  const clicks = n(eng.emailClicks);
  const uniqueClicked = n(eng.uniqueLeadsClicked);
  const views = n(eng.portalViews);
  const opens = n(eng.serviceOpens);
  const inquiries = n(eng.inquiries);

  const kpis = [
    { label: "Leads added", value: added, note: "imported this period" },
    { label: "Reachable by email", value: withEmail, note: `${pct(withEmail, added)} of leads added` },
    { label: "Emails sent", value: emailsSent, note: `${formatInt(uniqueEmailed)} unique leads` },
    { label: "Email clicks", value: clicks, note: `${formatInt(uniqueClicked)} leads engaged` },
    { label: "Portal views", value: views, note: `${pct(views, clicks)} of clicks` },
    { label: "Enquiries", value: inquiries, note: `${pct(inquiries, emailsSent)} of emails sent` },
  ];

  const funnel = [
    { stage: "Emails sent", count: emailsSent },
    { stage: "Email clicks (tracked link)", count: clicks },
    { stage: "Portal views", count: views },
    { stage: "Service cards opened", count: opens },
    { stage: "Enquiries submitted", count: inquiries },
  ];

  const campaigns = (out.campaigns ?? [])
    .map((c) => ({ campaign: typeof c.campaign === "string" ? c.campaign : "(untagged)", sent: n(c.sent), clicks: n(c.clicks) }))
    .slice(0, 20);

  const services = (eng.topServices ?? [])
    .map((s) => ({ service: typeof s.service === "string" ? s.service : "", opens: n(s.opens) }))
    .filter((s) => s.service);

  const inquiryRows = (data.inquiries ?? [])
    .filter((q) => typeof q.ts === "string")
    .map((q) => ({
      business: q.business ?? q.name ?? "—",
      service: q.service ?? "—",
      category: q.category ?? "—",
      when: new Date(q.ts as string).toLocaleString(AU, {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }),
    }));

  const generated = new Date().toLocaleString(AU, {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const demoBanner =
    data.mode === "demo"
      ? `<div class="banner">Demo data — connect Supabase (and run the portal migrations) to report on live activity.</div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>APMG outreach report — ${esc(period.label)}</title>
<style>
  :root { --ink: #17171a; --mut: #6b6b73; --line: #e4e4e8; --red: #c8102e; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink); font-size: 12px; line-height: 1.5; padding: 32px 36px;
  }
  @page { size: A4; margin: 13mm; }
  @media print { body { padding: 0; } }
  .num { font-variant-numeric: tabular-nums; }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    border-bottom: 3px solid var(--red); padding-bottom: 14px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; border-radius: 8px; background: var(--red); color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 11px; letter-spacing: .04em; }
  .brand b { font-size: 14px; letter-spacing: -0.01em; }
  .brand span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .14em; color: var(--mut); }
  .meta { text-align: right; font-size: 10px; color: var(--mut); }
  .meta .period { font-size: 13px; font-weight: 700; color: var(--ink); }
  h1 { font-size: 19px; letter-spacing: -0.02em; margin: 18px 0 2px; }
  .sub { color: var(--mut); font-size: 11px; }
  .banner { margin-top: 12px; border: 1px solid #eab30866; background: #eab3081a; color: #92660a;
    border-radius: 8px; padding: 8px 12px; font-size: 11px; }
  section { margin-top: 22px; break-inside: avoid; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .16em; color: var(--red);
    border-bottom: 1px solid var(--line); padding-bottom: 5px; margin-bottom: 10px; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .kpi .l { font-size: 9px; text-transform: uppercase; letter-spacing: .12em; color: var(--mut); }
  .kpi .v { font-size: 24px; font-weight: 750; letter-spacing: -0.02em; margin-top: 2px; }
  .kpi .n { font-size: 10px; color: var(--mut); margin-top: 1px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .1em; color: var(--mut);
    border-bottom: 1px solid var(--line); padding: 4px 8px 5px; }
  td { border-bottom: 1px solid var(--line); padding: 6px 8px; vertical-align: top; }
  th.r, td.r { text-align: right; }
  tr:last-child td { border-bottom: none; }
  .bar { height: 6px; border-radius: 999px; background: #efeff2; overflow: hidden; margin-top: 4px; }
  .bar i { display: block; height: 100%; border-radius: 999px; background: var(--red); }
  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  .note { color: var(--mut); font-size: 10px; margin-top: 8px; }
  .empty { color: var(--mut); font-size: 11px; padding: 6px 0; }
  footer { margin-top: 26px; border-top: 1px solid var(--line); padding-top: 8px;
    display: flex; justify-content: space-between; font-size: 9px; color: var(--mut); }
</style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="mark">APMG</div>
      <div><b>APMG — Lead generation</b><span>Outreach performance report</span></div>
    </div>
    <div class="meta">
      <div class="period">${esc(period.label)}</div>
      <div>${esc(modeLabel)} report · ${esc(fmtShort(period.from))} → ${esc(fmtShort(addDays(period.to, -1)))}</div>
      <div>Generated ${esc(generated)}</div>
    </div>
  </header>

  <h1>Outreach performance — ${esc(period.label)}</h1>
  <div class="sub">Lead intake, email reachability, campaign sends and the engagement funnel for the selected period.</div>
  ${demoBanner}

  <section>
    <h2>At a glance</h2>
    <div class="kpis">
      ${kpis
        .map(
          (k) => `<div class="kpi"><div class="l">${esc(k.label)}</div><div class="v num">${esc(
            formatInt(k.value),
          )}</div><div class="n">${esc(k.note)}</div></div>`,
        )
        .join("")}
    </div>
  </section>

  <section>
    <h2>Lead intake &amp; email reachability</h2>
    <table>
      <thead><tr><th>Segment</th><th class="r">Leads</th><th class="r">Share</th><th style="width:34%"></th></tr></thead>
      <tbody>
        <tr><td>Leads added this period</td><td class="r num">${formatInt(added)}</td><td class="r num">100%</td>
          <td><div class="bar"><i style="width:100%"></i></div></td></tr>
        <tr><td>Reachable — at least one email address</td><td class="r num">${formatInt(withEmail)}</td>
          <td class="r num">${pct(withEmail, added)}</td>
          <td><div class="bar"><i style="width:${added > 0 ? Math.round((withEmail / added) * 100) : 0}%"></i></div></td></tr>
        <tr><td>Not reachable — no email found yet</td><td class="r num">${formatInt(withoutEmail)}</td>
          <td class="r num">${pct(withoutEmail, added)}</td>
          <td><div class="bar"><i style="width:${added > 0 ? Math.round((withoutEmail / added) * 100) : 0}%"></i></div></td></tr>
      </tbody>
    </table>
    <div class="note">All-time database: ${esc(formatInt(n(leads.totalAllTime)))} leads stored, ${esc(
      formatInt(n(leads.withEmailAllTime)),
    )} reachable by email (${pct(n(leads.withEmailAllTime), n(leads.totalAllTime))}).</div>
  </section>

  <section>
    <h2>Engagement funnel</h2>
    <table>
      <thead><tr><th>Stage</th><th class="r">Count</th><th class="r">Step conversion</th><th class="r">From sends</th></tr></thead>
      <tbody>
        ${funnel
          .map(
            (f, i) => `<tr><td>${esc(f.stage)}</td><td class="r num">${formatInt(f.count)}</td>
              <td class="r num">${i === 0 ? "—" : pct(f.count, funnel[i - 1].count)}</td>
              <td class="r num">${i === 0 ? "—" : pct(f.count, funnel[0].count)}</td></tr>`,
          )
          .join("")}
      </tbody>
    </table>
    <div class="note">${esc(formatInt(unsubscribes))} unsubscribe${unsubscribes === 1 ? "" : "s"} recorded this period. Clicks are tracked outreach links (/t/…); enquiries are qualified — an email address was captured.</div>
  </section>

  <section>
    <div class="split">
      <div>
        <h2>Campaigns this period</h2>
        ${
          campaigns.length > 0
            ? `<table><thead><tr><th>Campaign</th><th class="r">Sent</th><th class="r">Clicks</th><th class="r">CTR</th></tr></thead><tbody>${campaigns
                .map(
                  (c) => `<tr><td>${esc(c.campaign)}</td><td class="r num">${formatInt(c.sent)}</td>
                    <td class="r num">${formatInt(c.clicks)}</td><td class="r num">${pct(c.clicks, c.sent)}</td></tr>`,
                )
                .join("")}</tbody></table>`
            : `<div class="empty">No campaign sends recorded in this period.</div>`
        }
      </div>
      <div>
        <h2>Top services viewed</h2>
        ${
          services.length > 0
            ? `<table><thead><tr><th>Service</th><th class="r">Opens</th></tr></thead><tbody>${services
                .map(
                  (s) => `<tr><td>${esc(serviceName(s.service))}</td><td class="r num">${formatInt(s.opens)}</td></tr>`,
                )
                .join("")}</tbody></table>`
            : `<div class="empty">No service opens in this period.</div>`
        }
      </div>
    </div>
  </section>

  <section>
    <h2>Enquiries this period</h2>
    ${
      inquiryRows.length > 0
        ? `<table><thead><tr><th>Business / contact</th><th>Service</th><th>Sector</th><th class="r">When</th></tr></thead><tbody>${inquiryRows
            .map(
              (q) => `<tr><td>${esc(q.business)}</td><td>${esc(q.service)}</td><td>${esc(q.category)}</td><td class="r num">${esc(q.when)}</td></tr>`,
            )
            .join("")}</tbody></table>${
            inquiries > inquiryRows.length
              ? `<div class="note">Showing the newest ${inquiryRows.length} of ${esc(formatInt(inquiries))} enquiries — the full list lives in the Enquiries tab.</div>`
              : ""
          }`
        : `<div class="empty">No enquiries submitted in this period.</div>`
    }
  </section>

  <footer>
    <span>APMG Lead Generation — internal report. Contains business-level outreach data; handle accordingly.</span>
    <span>apmgservices.com.au</span>
  </footer>
  <script>addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;
}

/* ── the control ─────────────────────────────────────────────────────────── */

const MODES: { id: PeriodMode; label: string }[] = [
  { id: "day", label: "Day" },
  { id: "week", label: "Week" },
  { id: "month", label: "Month" },
];

const MODE_HINT: Record<PeriodMode, string> = {
  day: "Report covers the selected date.",
  week: "Report covers the Mon–Sun week containing the selected date.",
  month: "Report covers the calendar month containing the selected date.",
};

export function TelemetryReportExport({ demo }: { demo: boolean }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<PeriodMode>("week");
  const [date, setDate] = useState(todayInputValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = useMemo(() => periodFor(mode, date), [mode, date]);

  async function generate() {
    if (!period || busy) return;
    setError(null);
    // Open the target window synchronously in the click — an async window.open
    // after the fetch would be eaten by popup blockers.
    const win = window.open("", "_blank");
    if (!win) {
      setError("Your browser blocked the report window — allow pop-ups for this site.");
      return;
    }
    win.document.write(
      `<title>APMG report</title><body style="font-family:system-ui;color:#666;padding:40px">Building the report…</body>`,
    );
    setBusy(true);
    try {
      const qs = `from=${encodeURIComponent(period.from.toISOString())}&to=${encodeURIComponent(period.to.toISOString())}`;
      const res = await fetch(`/api/portal/report?${qs}`, { cache: "no-store", headers: adminHeaders() });
      const data = (await res.json().catch(() => null)) as ReportPayload | null;
      if (!res.ok || !data?.ok) {
        win.close();
        setError(
          res.status === 401
            ? "Unlock the Telemetry tab with the access key first, then export."
            : (data?.error ?? `Couldn't build the report (${res.status}).`),
        );
        return;
      }
      const modeLabel = mode === "day" ? "Daily" : mode === "week" ? "Weekly" : "Monthly";
      win.document.open();
      win.document.write(buildReportHtml(data, period, modeLabel));
      win.document.close();
      setOpen(false);
    } catch {
      win.close();
      setError("Network error building the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-track="telemetry_report_open"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
      >
        <FileDown className="h-3.5 w-3.5" aria-hidden />
        Export PDF
        <ChevronDown
          className={cn("h-3 w-3 transition-transform duration-200 ease-out", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {/* Kept mounted so closing animates as smoothly as opening — see
          `.apmg-menu` in globals.css. */}
      <div
        role="dialog"
        aria-label="Export a period report"
        aria-hidden={!open}
        data-open={open}
        className="apmg-menu apmg-menu-end absolute right-0 top-full z-40 mt-2 w-72 rounded-xl border border-border bg-card p-3 shadow-lg ring-1 ring-foreground/10"
      >
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Report period
        </div>

        {/* granularity segments */}
        <div className="mt-2 grid grid-cols-3 gap-px overflow-hidden rounded-lg border border-border bg-border">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              aria-pressed={mode === m.id}
              data-track="telemetry_report_mode"
              data-track-mode={m.id}
              className={cn(
                "px-2 py-1.5 text-[11px] font-medium transition-colors",
                mode === m.id
                  ? "bg-primary-solid text-primary-foreground"
                  : "bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* one date input drives all three granularities (see docblock) */}
        <label
          htmlFor="telemetry-report-date"
          className="mt-3 block text-[10px] font-medium uppercase tracking-[0.1em] text-muted-foreground"
        >
          {mode === "day" ? "Date" : mode === "week" ? "Any day in the week" : "Any day in the month"}
        </label>
        <input
          id="telemetry-report-date"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-2.5 text-xs text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />

        {/* resolved-window preview: what the PDF will actually cover */}
        <p className="mt-2 flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
          <CalendarDays className="mt-px h-3 w-3 shrink-0" aria-hidden />
          <span>
            {period ? <span className="font-medium text-foreground">{period.label}</span> : "Pick a date"}
            {" — "}
            {MODE_HINT[mode]}
          </span>
        </p>

        {demo && (
          <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 font-mono text-[10px] leading-relaxed text-amber-600 dark:text-amber-400">
            Demo data — connect Supabase to export live reports.
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 font-mono text-[10.5px] leading-relaxed text-destructive">
            {error}
          </p>
        )}

        <div className="mt-3 flex items-center justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={generate}
            disabled={!period || busy || demo}
            data-track="telemetry_report_generate"
            data-track-mode={mode}
            className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <FileDown className="h-3.5 w-3.5" aria-hidden />}
            {busy ? "Building…" : "Generate PDF"}
          </Button>
        </div>
      </div>
    </div>
  );
}
