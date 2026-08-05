"use client";

import { useMemo } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Kpi } from "@/lib/data/leads";
import { useLeadStats, type LeadStatsData } from "@/lib/data/useLeadStats";
import { type SalesLead } from "@/lib/data/sales";
import { formatKpi } from "@/lib/format";
import { useGreeting } from "@/lib/useGreeting";
import { type SessionUser } from "./Sidebar";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { type Role } from "@/lib/rbac/roles";
import { Button } from "@/components/ui/button";
import type { LeadView } from "./pipeline/LeadsTable";
import { Footer } from "./Footer";
import { KpiCard } from "./KpiCard";
import { LeadsHistogram, type HistogramMode } from "./LeadsHistogram";
import { RecentLeadsTable } from "./RecentLeadsTable";
import { Reveal } from "./Reveal";
import { useSales } from "./SalesProvider";
import { TableSkeleton } from "./pipeline/LeadsTable";

/* ───────────────────────────  per-role copy  ─────────────────────────── */

interface OverviewCopy {
  kicker: string;
  title: string;
  lede: string;
  histogramTitle: string;
  recentTitle: string;
  recentEmpty: string;
  histogramEmpty: string;
}

/** Copy for the pipeline-sourced overview (admin + client). */
function copyFor(role: Role): OverviewCopy {
  if (role === "client") {
    return {
      kicker: "Your leads",
      title: "Delivered leads",
      lede: "Every business we've delivered to you, straight from the pipeline.",
      histogramTitle: "Delivery volume",
      recentTitle: "Recent deliveries",
      recentEmpty: "No leads delivered yet.",
      histogramEmpty: "No deliveries to chart yet.",
    };
  }
  return {
    kicker: "Signal overview",
    title: "Lead operations",
    lede: "Live readout of every lead in the pipeline.",
    histogramTitle: "Import volume",
    recentTitle: "Recent imports",
    recentEmpty: "No leads imported yet — run an import from the Pipeline tab.",
    histogramEmpty: "No import volume to chart yet.",
  };
}

/* ───────────────────────────  KPI builders  ─────────────────────────── */

const ratio = (count: number, total: number) => (total > 0 ? count / total : 0);

/** Placeholder cards (skeleton readouts) while the underlying data loads. */
function loadingKpis(labels: string[]): Kpi[] {
  return labels.map((label, i) => ({
    id: `loading-${i}`,
    label,
    value: "—",
    numeric: 0,
    format: "int",
    loading: true,
  }));
}

function totalCard(d: LeadStatsData, label: string, caption: string): Kpi {
  return {
    id: "total",
    label,
    value: formatKpi(d.total, "int"),
    numeric: d.total,
    format: "int",
    caption,
    spark: d.byDay.map((b) => b.value),
  };
}

function ratingCard(d: LeadStatsData, caption: string): Kpi {
  return {
    id: "rating",
    label: "Avg rating",
    value: d.avgRating != null ? formatKpi(d.avgRating, "rating") : "—",
    numeric: d.avgRating ?? 0,
    format: "rating",
    noCountUp: d.avgRating == null,
    caption: d.ratedCount > 0 ? caption : "no ratings yet",
    ratio: { value: ratio(d.ratedCount, d.total), label: "have a rating" },
  };
}

function countRatioCard(
  id: string,
  label: string,
  count: number,
  total: number,
  ratioLabel: string,
  caption: string,
): Kpi {
  return {
    id,
    label,
    value: formatKpi(count, "int"),
    numeric: count,
    format: "int",
    caption,
    ratio: { value: ratio(count, total), label: ratioLabel },
  };
}

function pipelineKpis(role: Role, d: LeadStatsData): Kpi[] {
  const newToday = `${d.addedToday} new · 24h`;

  if (role === "client") {
    return [
      totalCard(d, "Delivered leads", d.total > 0 ? newToday : "from the pipeline"),
      countRatioCard("email", "With email", d.withEmail, d.total, "have an email", "ready to contact"),
      ratingCard(d, "business quality"),
    ];
  }

  return [
    totalCard(
      d,
      "Total leads",
      `${d.folders} ${d.folders === 1 ? "folder" : "folders"} · ${d.addedToday} new · 24h`,
    ),
    countRatioCard("email", "With email", d.withEmail, d.total, "have an email", "reachable by email"),
    countRatioCard("phone", "With phone", d.withPhone, d.total, "have a phone", "callable directly"),
    ratingCard(d, `across ${d.ratedCount} rated`),
  ];
}

/* ───────────────────────────  shared chrome  ─────────────────────────── */

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric" });
}

function OverviewHeader({
  copy,
  user,
  metaLabel,
  metaValue,
  demo,
}: {
  copy: OverviewCopy;
  /** signed-in account — greeted by first name in place of the page title */
  user?: SessionUser;
  metaLabel: string;
  metaValue: string;
  demo?: boolean;
}) {
  const greeting = useGreeting();
  // Everyone here goes by first name. With no session (the dev role preview,
  // or the console's admin default) the page keeps its own title.
  const firstName = user?.name.trim().split(/\s+/)[0];

  return (
    <Reveal className="mb-5" y={6}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            {copy.kicker}
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            {firstName ? `${greeting}, ${firstName}` : copy.title}
          </h1>
          {/* The greeting takes the headline, so the title it displaced leads
              the lede — the page still says what it is. */}
          <p className="mt-1 text-xs text-muted-foreground">
            {firstName && (
              <>
                <span className="text-foreground/80">{copy.title}</span>
                {" · "}
              </>
            )}
            {copy.lede}
          </p>
        </div>
        <div className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          <div>{metaLabel}</div>
          <div className="tnum text-foreground/80">{metaValue}</div>
          {demo && (
            <div className="mt-1 inline-flex items-center gap-1 rounded border border-border bg-background/60 px-1.5 py-0.5 text-[9px] text-muted-foreground">
              demo mode
            </div>
          )}
        </div>
      </div>
    </Reveal>
  );
}

/** KPIs fused into one instrument panel, hairline-divided via gap-px. */
function KpiPanel({ kpis }: { kpis: Kpi[] }) {
  const cols = kpis.length === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3";
  return (
    <Reveal delay={0.04}>
      <div
        className={cn("grid gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10", cols)}
      >
        {kpis.map((kpi) => (
          <KpiCard key={kpi.id} kpi={kpi} />
        ))}
      </div>
    </Reveal>
  );
}

/** Histogram + recent table, side by side on lg (equal height). */
function InstrumentRow({
  ready,
  modes,
  recent,
  copy,
  loadingNote,
}: {
  ready: boolean;
  modes: HistogramMode[];
  recent: LeadView[];
  copy: OverviewCopy;
  /** what the chart skeleton says it's waiting on */
  loadingNote?: string;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 items-stretch gap-3 lg:grid-cols-[1.45fr_1fr]">
      <Reveal delay={0.12} className="h-full">
        {ready ? (
          <LeadsHistogram
            modes={modes}
            title={copy.histogramTitle}
            emptyHint={copy.histogramEmpty}
            autoCycle
          />
        ) : (
          <HistogramSkeleton title={copy.histogramTitle} note={loadingNote} />
        )}
      </Reveal>
      <Reveal delay={0.16} className="h-full">
        {ready ? (
          <RecentLeadsTable rows={recent} title={copy.recentTitle} emptyHint={copy.recentEmpty} />
        ) : (
          <RecentSkeleton title={copy.recentTitle} />
        )}
      </Reveal>
    </div>
  );
}

function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Reveal>
      <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
        <h2 className="text-base font-semibold text-foreground">Couldn&rsquo;t load lead data</h2>
        <p role="alert" className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground">
          {message}
        </p>
        <Button variant="outline" size="sm" onClick={onRetry} data-track="overview_retry" className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
          Retry
        </Button>
      </div>
    </Reveal>
  );
}

const SHELL = "flex min-h-full flex-col px-4 py-5 sm:px-6";

/* ───────────────────────────  page  ─────────────────────────── */

/**
 * Which overview a role sees is a component switch, not a branch inside one
 * component — and that's load-bearing. A rep's overview must be built from the
 * SALES QUEUE (what admin handed over) and nothing else, so `SalesOverview`
 * simply never mounts `useLeadStats`, meaning a rep's browser never even
 * requests the admin-wide leads table.
 */
export function OverviewPage({ user }: { user?: SessionUser }) {
  const { role } = useRbac();
  return role === "sales" ? (
    <SalesOverview user={user} />
  ) : (
    <PipelineOverview role={role} user={user} />
  );
}

/* ─────────────────────  admin / client: the pipeline  ───────────────────── */

function PipelineOverview({ role, user }: { role: Role; user?: SessionUser }) {
  const { state, reload } = useLeadStats();

  const copy = copyFor(role);
  const data = state.status === "ready" ? state.data : null;
  const kpis = data
    ? pipelineKpis(role, data)
    : loadingKpis(
        role === "client"
          ? ["Delivered leads", "With email", "Avg rating"]
          : ["Total leads", "With email", "With phone", "Avg rating"],
      );

  // Week first → it's the default; the panel auto-cycles week → day → month.
  const modes = useMemo<HistogramMode[]>(() => {
    if (!data) return [];
    return [
      { id: "week", label: "Week", data: data.byWeek, unit: "leads" },
      { id: "day", label: "Day", data: data.byDay, unit: "leads" },
      { id: "month", label: "Month", data: data.byMonth, unit: "leads" },
    ];
  }, [data]);

  return (
    <div className={SHELL}>
      <OverviewHeader
        copy={copy}
        user={user}
        metaLabel="Last import"
        metaValue={fmtDate(data?.latestImport ?? null)}
        demo={data?.mode === "demo"}
      />

      {state.status === "error" ? (
        <ErrorPanel message={state.error} onRetry={reload} />
      ) : (
        <>
          <KpiPanel kpis={kpis} />
          <InstrumentRow ready={!!data} modes={modes} recent={data?.recent ?? []} copy={copy} />
        </>
      )}

      <Footer />
    </div>
  );
}

/* ─────────────────────  sales: the handed-over queue  ───────────────────── */

const SALES_COPY: OverviewCopy = {
  kicker: "Sales desk",
  title: "Your overview",
  lede: "From hand-off to closed deal — your queue at a glance.",
  histogramTitle: "Hand-off volume",
  recentTitle: "Latest hand-offs",
  recentEmpty: "Nothing handed over yet — leads arrive when admin sends them from Hot Leads.",
  histogramEmpty: "No hand-offs to chart yet.",
};

/** A queued lead in the shape the recent-leads table reads. */
function toLeadView(l: SalesLead): LeadView {
  return {
    id: l.id,
    name: l.business,
    address: l.location ?? null,
    website: l.website ?? null,
    phone: l.phone ?? null,
    rating: l.rating ?? null,
    category: l.category,
    emails: l.email ? [l.email] : [],
  };
}

/**
 * The rep's overview. EVERY number here comes from the sales queue — the leads
 * admin handed over via /api/sales/handoff — never from the admin's own lead
 * database: total, arrivals, volume-over-time and the latest rows are all read
 * off the hand-off ledger through `useSales`.
 */
function SalesOverview({ user }: { user?: SessionUser }) {
  const { stats, series, handedToday, latestHandoffAt, recent, loading, mode, error, reload } =
    useSales();

  // The first load is the only one that blocks: once the desk has numbers, the
  // silent poll keeps them on screen through a transient blip rather than
  // flipping back to a spinner or an error screen.
  const hasData = stats.queueTotal > 0;
  // A blip only takes over the page while there's nothing good to show.
  const fatalError = hasData ? null : error;
  const ready = hasData || (!loading && !error);

  const kpis = ready ? salesKpis(stats, series.byDay, handedToday) : loadingKpis(SALES_LABELS);

  const modes = useMemo<HistogramMode[]>(
    () => [
      { id: "week", label: "Week", data: series.byWeek, unit: "hand-offs" },
      { id: "day", label: "Day", data: series.byDay, unit: "hand-offs" },
      { id: "month", label: "Month", data: series.byMonth, unit: "hand-offs" },
    ],
    [series],
  );

  const recentRows = useMemo(() => recent.map(toLeadView), [recent]);

  return (
    <div className={SHELL}>
      <OverviewHeader
        copy={SALES_COPY}
        user={user}
        metaLabel="Last hand-off"
        metaValue={fmtDate(latestHandoffAt || null)}
        demo={mode === "demo"}
      />

      {fatalError ? (
        <ErrorPanel message={fatalError} onRetry={reload} />
      ) : (
        <>
          <KpiPanel kpis={kpis} />
          <InstrumentRow
            ready={ready}
            modes={modes}
            recent={recentRows}
            copy={SALES_COPY}
            loadingNote="Reading your queue…"
          />
        </>
      )}

      <Footer />
    </div>
  );
}

const SALES_LABELS = ["Handed over", "Open in queue", "Engaged", "Closed · 30d"];

interface SalesFunnel {
  open: number;
  engaged: number;
  won: number;
  wonValue: number;
  queueTotal: number;
}

function salesKpis(s: SalesFunnel, byDay: { value: number }[], handedToday: number): Kpi[] {
  return [
    {
      id: "total",
      label: "Handed over",
      value: formatKpi(s.queueTotal, "int"),
      numeric: s.queueTotal,
      format: "int",
      caption: s.queueTotal > 0 ? `${handedToday} new · 24h` : "sent over by admin",
      spark: byDay.map((b) => b.value),
    },
    countRatioCard("open", "Open in queue", s.open, s.queueTotal, "of your queue", "awaiting your call"),
    countRatioCard("engaged", "Engaged", s.engaged, s.queueTotal, "of your queue", "clicked the email"),
    {
      id: "won",
      label: "Closed · 30d",
      value: formatKpi(s.wonValue, "usd0"),
      numeric: s.wonValue,
      format: "usd0",
      caption: `${s.won} ${s.won === 1 ? "deal" : "deals"} won`,
      ratio: { value: ratio(s.won, s.queueTotal), label: "close rate" },
    },
  ];
}

/* ───────────────────────────  loading skeletons (§12.3)  ─────────────────────────── */

function HistogramSkeleton({ title, note = "Reading pipeline…" }: { title: string; note?: string }) {
  const bars = [40, 65, 52, 78, 60, 88, 72, 95, 80, 70, 90, 100];
  return (
    <section
      className="flex h-full min-w-0 flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10"
      aria-busy
    >
      <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>
      <div className="mt-6 flex min-h-[180px] flex-1 items-end gap-2">
        {bars.map((h, i) => (
          <div
            key={i}
            className="flex-1 animate-pulse rounded-t-sm bg-muted"
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
        {note}
      </p>
    </section>
  );
}

function RecentSkeleton({ title }: { title: string }) {
  return (
    <section className="flex h-full min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10" aria-busy>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          loading
        </span>
      </div>
      <div className="p-3">
        <TableSkeleton />
      </div>
    </section>
  );
}
