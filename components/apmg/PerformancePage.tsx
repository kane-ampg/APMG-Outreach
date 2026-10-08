"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FileText,
  Globe,
  Inbox,
  LayoutGrid,
  Link2,
  Mail,
  MessagesSquare,
  MousePointerClick,
  Phone,
  RefreshCw,
  Star,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { sourceLabel } from "@/lib/data/enquiries";
import { serviceName } from "@/lib/data/leadActivity";
import {
  chartBuckets,
  DEFAULT_RANGE,
  INTERACTIONS,
  pctChange,
  PERFORMANCE_RANGES,
  RANGE_LABEL,
  sumSeries,
  toPerformance,
  type ChartBucket,
  type InteractionId,
  type PerfSeries,
  type Performance,
  type PerformanceRange,
  type ServicePerf,
} from "@/lib/data/performance";
import { downloadPerformanceCsv } from "@/lib/data/performanceExport";
import { openPerformanceReport } from "@/lib/data/performanceReport";
import { formatInt } from "@/lib/format";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { DIRECT_SOURCE, OUTREACH_SOURCE } from "@/lib/portal/source";
import { useCountUp } from "@/lib/useCountUp";
import { Button } from "@/components/ui/button";
import { BRAND_LOGO, isBrand } from "./BrandLogos";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { WhatsAppIcon } from "./WhatsAppIcon";

/**
 * Performance — the customer portal's results over a chosen period, laid out
 * like Google Business Profile's Performance screen: a headline count of
 * interactions with a chart of it by day, the same count split by kind, and
 * how many clicks each service got. Every figure is set against the period
 * just before it.
 *
 * The chart follows a selection. Click a kind of interaction, a service, or
 * Visits, and the chart and the "Where they came from" panel switch to it.
 *
 * There are no impressions. Google can count everyone who saw a listing in
 * search; the portal can only count people who arrived.
 */

type Selection =
  | { kind: "all" }
  | { kind: "visits" }
  | { kind: "interaction"; id: InteractionId }
  | { kind: "service"; slug: string };

interface Resolved {
  label: string;
  unit: string;
  series: PerfSeries;
}

const INTERACTION_ICON: Record<InteractionId, ComponentType<{ className?: string }>> = {
  services: LayoutGrid,
  quotes: FileText,
  calls: Phone,
  enquiries: Inbox,
  chats: MessagesSquare,
  website: Globe,
  email: Mail,
  whatsapp: WhatsAppIcon,
  reviews: Star,
};

/** The page asks again after the window has been away this long, the same
 *  five minutes the server keeps a tally. Never on a timer: a miss pages
 *  through months of events. */
const STALE_MS = 5 * 60_000;

/** The customer portal page every figure here describes. Named on the page
 *  and at the top of the CSV, so whoever reads either knows which page it is. */
const PORTAL_PAGE_URL = `${PORTAL_ORIGIN}/portal`;

/** The on-page link opens it through the staff marker (app/api/portal/staff),
 *  so a manager clicking through to look at the page isn't counted in it. */
const PORTAL_STAFF_LINK = `${PORTAL_ORIGIN}/api/portal/staff?next=portal`;

/** A kept copy younger than this is shown without asking the server at all. */
const REUSE_MS = 60_000;

/**
 * Each period's last answer, kept for as long as this browser tab is open.
 * The page unmounts whenever another console tab is opened, so without this
 * every return to Performance, and every flick back to a period already seen,
 * showed a skeleton and waited on the server. Now the copy shows at once, and
 * the server is asked again only once it's over a minute old. Keyed on the
 * zone as well, because the days are cut in it.
 */
const pageCache = new Map<string, { data: Performance; fetchedAt: number }>();

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    return "";
  }
}

/* ───────────────────────────  formatting  ─────────────────────────── */

/** YYYY-MM-DD → a Date at UTC midnight, formatted in UTC, so the label is the
 *  calendar day the server cut, whatever zone the browser is in. */
function dayDate(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

function fmtShort(day: string): string {
  const d = dayDate(day);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", timeZone: "UTC" });
}

function fmtDay(day: string): string {
  const d = dayDate(day);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function bucketLabel(b: ChartBucket): string {
  return b.start === b.end ? fmtDay(b.start) : `${fmtShort(b.start)} – ${fmtShort(b.end)}`;
}

function channelName(source: string): string {
  if (source === OUTREACH_SOURCE) return "Outreach email";
  if (source === DIRECT_SOURCE) return "Direct / unknown";
  return sourceLabel(source);
}

function ChannelIcon({ source }: { source: string }) {
  if (isBrand(source)) {
    const Logo = BRAND_LOGO[source];
    return <Logo className="h-3.5 w-3.5" />;
  }
  const Icon = source === OUTREACH_SOURCE ? Mail : source === DIRECT_SOURCE ? Link2 : Globe;
  return <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />;
}

/* ───────────────────────────  small parts  ─────────────────────────── */

/**
 * Change against the previous period. Up is the signal red and down is muted,
 * so the direction stays inside the red family (no green, ui-standards §17.8).
 * With nothing in the previous period there is no percentage to give, so it
 * says "New" (or nothing at all, when both are zero).
 */
function Delta({
  current,
  previous,
  days,
  className,
}: {
  current: number;
  previous: number;
  days: PerformanceRange;
  className?: string;
}) {
  const change = pctChange(current, previous);
  const vs = `previous ${RANGE_LABEL[days]}: ${formatInt(previous)}`;
  const base = "tnum inline-flex items-center gap-0.5 whitespace-nowrap font-mono text-[11px] font-semibold";
  if (change === null) {
    return current > 0 ? (
      <span className={cn(base, "text-primary", className)} title={`Nothing in the ${vs.split(":")[0]}`}>
        New
      </span>
    ) : (
      <span className={cn(base, "text-muted-foreground/70", className)} title={`Nothing this period or the ${vs.split(":")[0]}`}>
        —
      </span>
    );
  }
  const pct = Math.round(Math.abs(change) * 100);
  if (pct === 0) {
    return (
      <span className={cn(base, "text-muted-foreground", className)} title={`No change (${vs})`}>
        0%
      </span>
    );
  }
  const up = change > 0;
  const Arrow = up ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(base, up ? "text-primary" : "text-muted-foreground", className)}
      title={`${up ? "Up" : "Down"} ${pct}% (${vs})`}
    >
      <Arrow className="h-3.5 w-3.5" aria-hidden />
      {pct}%<span className="sr-only">{` ${up ? "up" : "down"} on the ${vs}`}</span>
    </span>
  );
}

/** Hairline panel head, same grammar as the Telemetry and Enquiries panels. */
function PanelHead({ title, meta }: { title: string; meta?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
      <h2 className="shrink-0 font-heading text-sm font-semibold text-foreground">{title}</h2>
      {meta}
    </div>
  );
}

function PanelMeta({ children }: { children: ReactNode }) {
  return (
    <span className="tnum min-w-0 truncate font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
      {children}
    </span>
  );
}

/** A decorative trend line for a table row. The row's own label carries the
 *  numbers, so this stays aria-hidden. */
function Sparkline({ values, muted }: { values: number[]; muted: boolean }) {
  const w = 100;
  const h = 24;
  const max = Math.max(1, ...values);
  const points =
    values.length < 2
      ? `0,${h} ${w},${h}`
      : values
          .map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - (v / max) * (h - 2) - 1).toFixed(1)}`)
          .join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-6 w-full" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={muted ? "hsl(var(--border))" : "var(--bar)"}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The range control: four presets, like Google's period picker. */
function RangePicker({ value, onChange }: { value: PerformanceRange; onChange: (r: PerformanceRange) => void }) {
  return (
    <div
      className="flex items-center gap-0.5 rounded-md border border-border bg-background/50 p-0.5"
      role="group"
      aria-label="Period"
    >
      {PERFORMANCE_RANGES.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          aria-pressed={value === r}
          data-track="performance_range"
          data-track-days={r}
          className={cn(
            "whitespace-nowrap rounded px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
            value === r ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {RANGE_LABEL[r]}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────────  headline + chart  ─────────────────────────── */

/** One of the headline figures over the chart. A button when it can drive
 *  the chart, plain text when it can't. */
function HeadlineStat({
  label,
  value,
  previous,
  days,
  selected,
  onSelect,
  hero = false,
  trackId,
}: {
  label: string;
  value: number;
  previous?: number;
  days: PerformanceRange;
  selected?: boolean;
  onSelect?: () => void;
  hero?: boolean;
  trackId: string;
}) {
  const display = useCountUp(value, "int", formatInt(value));
  const body = (
    <>
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
      <span className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span
          className={cn(
            "tnum font-mono font-semibold leading-none tracking-tight text-foreground",
            hero ? "text-[34px] sm:text-[40px]" : "text-[24px] sm:text-[28px]",
          )}
        >
          {display}
        </span>
        {previous !== undefined && <Delta current={value} previous={previous} days={days} />}
      </span>
    </>
  );
  const shell = "relative flex h-full w-full min-w-0 flex-col px-4 py-4 text-left sm:px-5";
  if (!onSelect) return <div className={shell}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-track="performance_headline"
      data-track-metric={trackId}
      className={cn(
        shell,
        "outline-none transition-colors hover:bg-muted/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))]",
        selected && "bg-muted/40",
      )}
    >
      {/* the chart is showing this one */}
      {selected && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" aria-hidden />}
      {body}
    </button>
  );
}

/**
 * The bar chart. A bar a day up to a month, a bar a week past that. Hover or
 * arrow-key along it to read a bar; at rest it reads the newest one. One tab
 * stop for the whole chart rather than one per bar, since a 28-bar chart
 * would otherwise put 28 stops between the range picker and the table.
 */
function PerformanceChart({ buckets, unit, label }: { buckets: ChartBucket[]; unit: string; label: string }) {
  const [active, setActive] = useState<number | null>(null);
  const last = buckets.length - 1;
  const shown = active ?? last;
  const reading = buckets[shown];
  const max = Math.max(1, ...buckets.map((b) => b.value));
  const peak = buckets.reduce((m, b) => Math.max(m, b.value), 0);
  // About six date labels, counted back from the newest so today is always one.
  const step = Math.max(1, Math.ceil(buckets.length / 6));
  const ticks = buckets.map((_, i) => i).filter((i) => (last - i) % step === 0);

  function onKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const move: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
    if (e.key in move) {
      e.preventDefault();
      setActive((i) => Math.max(0, Math.min(last, (i ?? last) + move[e.key])));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : last);
    }
  }

  if (!reading) return null;
  return (
    <div className="px-4 pb-4 pt-3 sm:px-5">
      <div className="tnum font-mono text-[11px] text-muted-foreground" aria-live="polite">
        <span className="text-foreground">{bucketLabel(reading)}</span>
        {" · "}
        <span className="text-primary">{formatInt(reading.value)}</span> {unit}
      </div>

      <div
        tabIndex={0}
        role="group"
        aria-label={`${label}, ${buckets.length} bars. Use the arrow keys to read each one.`}
        onKeyDown={onKeyDown}
        onMouseLeave={() => setActive(null)}
        onBlur={() => setActive(null)}
        data-track="performance_chart"
        className="relative mt-3 h-[200px] rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card"
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <span
            key={g}
            aria-hidden
            className="absolute inset-x-0 h-px"
            style={{ bottom: `${g * 100}%`, background: "var(--grid)" }}
          />
        ))}
        <span
          aria-hidden
          className="tnum absolute right-0 top-0 font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground"
        >
          peak {formatInt(peak)}
        </span>
        <div className="relative flex h-full items-end gap-[2px] sm:gap-1">
          {buckets.map((b, i) => {
            const isActive = i === shown;
            return (
              <div
                key={`${b.start}-${i}`}
                className="flex h-full min-w-0 flex-1 items-end"
                onMouseEnter={() => setActive(i)}
              >
                <span
                  className="w-full rounded-t-[2px] transition-opacity motion-safe:animate-bar-rise"
                  style={{
                    height: b.value > 0 ? `${Math.max(1.5, (b.value / max) * 100)}%` : "2px",
                    background: b.value > 0 ? (isActive ? "var(--bar-strong)" : "var(--bar)") : "hsl(var(--border))",
                    opacity: b.value > 0 && !isActive ? 0.62 : 1,
                    transformOrigin: "bottom",
                    animationDelay: `${Math.min(i * 0.012, 0.3)}s`,
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>

      {/* baseline datum + date labels */}
      <div className="h-px w-full" style={{ background: "hsl(var(--primary) / 0.5)" }} aria-hidden />
      <div className="relative mt-1.5 h-3" aria-hidden>
        {ticks.map((i) => {
          const edge = i === last ? "right-0" : i === 0 ? "left-0" : "-translate-x-1/2";
          return (
            <span
              key={i}
              className={cn(
                "tnum absolute whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.04em]",
                i === shown ? "text-foreground" : "text-muted-foreground",
                edge,
              )}
              style={i === last || i === 0 ? undefined : { left: `${((i + 0.5) / buckets.length) * 100}%` }}
            >
              {fmtShort(buckets[i].start)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function OverviewPanel({
  data,
  all,
  selection,
  resolved,
  onSelect,
}: {
  data: Performance;
  all: PerfSeries;
  selection: Selection;
  resolved: Resolved;
  onSelect: (s: Selection) => void;
}) {
  const buckets = useMemo(() => chartBuckets(data.dates, resolved.series.daily), [data.dates, resolved.series]);
  const narrowed = selection.kind !== "all";
  return (
    <section className="rounded-xl bg-card ring-1 ring-foreground/10">
      {/* The headline across the top on a phone, the other three in a row
          under it; one row of four once there's room. */}
      <div className="grid grid-cols-1 border-b border-border sm:grid-cols-[minmax(0,1.4fr)_minmax(0,3fr)]">
        <div className="border-b border-border sm:border-b-0 sm:border-r">
          <HeadlineStat
            hero
            label="Portal interactions"
            value={all.total}
            previous={all.previous}
            days={data.days}
            selected={selection.kind === "all"}
            onSelect={() => onSelect({ kind: "all" })}
            trackId="interactions"
          />
        </div>
        <div className="grid grid-cols-3 divide-x divide-border">
          <HeadlineStat
            label="Visits"
            value={data.visits.total}
            previous={data.visits.previous}
            days={data.days}
            selected={selection.kind === "visits"}
            onSelect={() => onSelect({ kind: "visits" })}
            trackId="visits"
          />
          <HeadlineStat
            label="Enquiries"
            value={data.interactions.enquiries.total}
            previous={data.interactions.enquiries.previous}
            days={data.days}
            selected={selection.kind === "interaction" && selection.id === "enquiries"}
            onSelect={() => onSelect({ kind: "interaction", id: "enquiries" })}
            trackId="enquiries"
          />
          <HeadlineStat label="Visitors" value={data.visitors} days={data.days} trackId="visitors" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="truncate font-heading text-sm font-semibold text-foreground">{resolved.label}</h2>
          {narrowed && (
            <button
              type="button"
              onClick={() => onSelect({ kind: "all" })}
              data-track="performance_clear_selection"
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-3 w-3" aria-hidden />
              All interactions
            </button>
          )}
        </div>
        <PanelMeta>
          {formatInt(resolved.series.total)} {resolved.unit} · {RANGE_LABEL[data.days]}
        </PanelMeta>
      </div>
      <PerformanceChart
        key={`${data.days}|${resolved.label}`}
        buckets={buckets}
        unit={resolved.unit}
        label={resolved.label}
      />
    </section>
  );
}

/* ───────────────────────────  services  ─────────────────────────── */

const SERVICE_GRID =
  "grid grid-cols-[minmax(0,1fr)_3.5rem_4rem] items-center gap-x-3 sm:grid-cols-[minmax(0,1fr)_4rem_4.5rem_7rem_4.5rem]";

function ServiceRow({
  row,
  label,
  max,
  dates,
  days,
  selected,
  onSelect,
}: {
  row: ServicePerf;
  label: ReactNode;
  max: number;
  dates: string[];
  days: PerformanceRange;
  selected: boolean;
  onSelect: () => void;
}) {
  const trend = useMemo(() => chartBuckets(dates, row.daily).map((b) => b.value), [dates, row.daily]);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        data-track="performance_service"
        data-track-service={row.service}
        className={cn(
          SERVICE_GRID,
          "relative w-full px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))]",
          selected && "bg-accent/60",
        )}
      >
        {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
        <span className="min-w-0">
          <span
            className={cn(
              "block truncate text-[12.5px] font-medium",
              row.total > 0 ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <span className="mt-1 block h-1 w-full overflow-hidden rounded-full bg-border" aria-hidden>
            <span
              className="block h-full rounded-full bg-primary"
              style={{ width: `${(row.total / max) * 100}%` }}
            />
          </span>
        </span>
        <span className="tnum text-right font-mono text-[12px] text-foreground">{formatInt(row.total)}</span>
        <span className="text-right">
          <Delta current={row.total} previous={row.previous} days={days} />
        </span>
        <span className="hidden sm:block">
          <Sparkline values={trend} muted={row.total === 0} />
        </span>
        <span className="tnum hidden text-right font-mono text-[12px] text-muted-foreground sm:block">
          {row.enquiries > 0 ? <span className="text-foreground">{formatInt(row.enquiries)}</span> : "—"}
        </span>
      </button>
    </li>
  );
}

/**
 * Clicks per service — the table the tab exists for. Every trade is listed,
 * zero-click ones too, ranked by clicks. The enquiry form sits underneath:
 * it is opened without a trade picked, so it isn't one.
 */
function ServicesPanel({
  data,
  selection,
  onSelect,
}: {
  data: Performance;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  const max = Math.max(1, ...data.services.map((s) => s.total));
  const total = data.interactions.services.total;
  const isSelected = (slug: string) => selection.kind === "service" && selection.slug === slug;
  const toggle = (slug: string) => onSelect(isSelected(slug) ? { kind: "all" } : { kind: "service", slug });

  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead
        title="Clicks by service"
        meta={
          <PanelMeta>
            {formatInt(total)} {total === 1 ? "click" : "clicks"}
          </PanelMeta>
        }
      />
      <div
        className={cn(
          SERVICE_GRID,
          "border-b border-border/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
        )}
        aria-hidden
      >
        <span>Service</span>
        <span className="text-right">Clicks</span>
        <span className="text-right">Change</span>
        <span className="hidden sm:block">Trend</span>
        <span className="hidden text-right sm:block">Enquiries</span>
      </div>
      <ul className="divide-y divide-border/60">
        {data.services.map((row) => (
          <ServiceRow
            key={row.service}
            row={row}
            label={serviceName(row.service)}
            max={max}
            dates={data.dates}
            days={data.days}
            selected={isSelected(row.service)}
            onSelect={() => toggle(row.service)}
          />
        ))}
      </ul>
      <ul className="border-t border-border">
        <ServiceRow
          row={data.general}
          label={
            <>
              Enquiry form <span className="text-muted-foreground">· opened with no trade picked</span>
            </>
          }
          max={Math.max(max, data.general.total)}
          dates={data.dates}
          days={data.days}
          selected={isSelected(data.general.service)}
          onSelect={() => toggle(data.general.service)}
        />
      </ul>
      <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
        A click is someone opening that trade&rsquo;s card on the customer portal. Pick a service to
        chart it.
        {data.scannerEventsExcluded > 0 && (
          <>
            {" "}
            {formatInt(data.scannerEventsExcluded)} events from email scanners (automated link
            checkers) are left out of every number on this page.
          </>
        )}
      </p>
    </section>
  );
}

/* ───────────────────────────  interactions + channels  ─────────────────────────── */

function InteractionsPanel({
  data,
  selection,
  onSelect,
}: {
  data: Performance;
  selection: Selection;
  onSelect: (s: Selection) => void;
}) {
  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead title="Interactions" meta={<PanelMeta>vs previous {RANGE_LABEL[data.days]}</PanelMeta>} />
      <ul className="divide-y divide-border/60">
        {INTERACTIONS.map((m) => {
          const s = data.interactions[m.id];
          const Icon = INTERACTION_ICON[m.id];
          const selected = selection.kind === "interaction" && selection.id === m.id;
          return (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => onSelect(selected ? { kind: "all" } : { kind: "interaction", id: m.id })}
                aria-pressed={selected}
                data-track="performance_interaction"
                data-track-interaction={m.id}
                className={cn(
                  "relative flex w-full items-center gap-3 px-4 py-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:shadow-[inset_0_0_0_2px_hsl(var(--ring))]",
                  selected && "bg-accent/60",
                )}
              >
                {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-primary" aria-hidden />}
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary"
                  aria-hidden
                >
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-[12.5px] font-medium",
                      s.total > 0 ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {m.label}
                  </span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{m.hint}</span>
                </span>
                <span className="tnum shrink-0 font-mono text-[12px] text-foreground">{formatInt(s.total)}</span>
                <Delta current={s.total} previous={s.previous} days={data.days} className="w-12 justify-end" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Where the selected series came from — the portal's answer to Google's
 *  platform-and-device split. */
function ChannelsPanel({ resolved }: { resolved: Resolved }) {
  const rows = Object.entries(resolved.series.bySource)
    .map(([source, n]) => ({ source, n }))
    .sort((a, b) => b.n - a.n);
  const total = rows.reduce((t, r) => t + r.n, 0);
  return (
    <section className="flex min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10">
      <PanelHead title="Where they came from" meta={<PanelMeta>{resolved.label}</PanelMeta>} />
      {rows.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
          <span className="flex h-10 w-10 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
            <MousePointerClick className="h-4 w-4" aria-hidden />
          </span>
          <p className="max-w-[16rem] font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            Nothing in this period yet.
          </p>
        </div>
      ) : (
        <ul className="space-y-3 px-4 py-4">
          {rows.map(({ source, n }) => {
            const pct = Math.round((n / total) * 100);
            return (
              <li key={source}>
                <div className="flex items-center gap-2">
                  <span className="flex w-4 shrink-0 justify-center">
                    <ChannelIcon source={source} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                    {channelName(source)}
                  </span>
                  <span className="tnum shrink-0 font-mono text-[11px] text-foreground">{formatInt(n)}</span>
                  <span className="tnum w-9 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                    {pct}%
                  </span>
                </div>
                <div
                  className="ml-6 mt-1 h-1 overflow-hidden rounded-full bg-border"
                  role="img"
                  aria-label={`${channelName(source)}: ${pct} percent`}
                >
                  <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/* ───────────────────────────  skeletons  ─────────────────────────── */

function PageSkeleton() {
  return (
    <div aria-busy className="space-y-3">
      <div className="rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="grid grid-cols-2 gap-4 border-b border-border p-5 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
              <div className="mt-3 h-8 w-1/2 animate-pulse rounded bg-muted" />
            </div>
          ))}
        </div>
        <div className="p-5">
          <div className="h-[200px] animate-pulse rounded bg-muted/60" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="h-[420px] animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
        <div className="h-[420px] animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
      </div>
    </div>
  );
}

/* ───────────────────────────  page  ─────────────────────────── */

function resolveSelection(sel: Selection, data: Performance, all: PerfSeries): Resolved {
  if (sel.kind === "visits") return { label: "Portal visits", unit: "visits", series: data.visits };
  if (sel.kind === "interaction") {
    const m = INTERACTIONS.find((x) => x.id === sel.id);
    if (m) return { label: m.label, unit: m.unit, series: data.interactions[m.id] };
  }
  if (sel.kind === "service") {
    const row =
      sel.slug === data.general.service ? data.general : data.services.find((s) => s.service === sel.slug);
    if (row) {
      const label = row === data.general ? "Enquiry form opened" : `${serviceName(row.service)} clicks`;
      return { label, unit: "clicks", series: row };
    }
  }
  return { label: "All interactions", unit: "interactions", series: all };
}

export function PerformancePage() {
  const [range, setRange] = useState<PerformanceRange>(DEFAULT_RANGE);
  const [data, setData] = useState<Performance | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Selection>({ kind: "all" });
  /** Set when the browser blocks the PDF report's window. */
  const [exportError, setExportError] = useState<string | null>(null);
  /** The newest request wins; an older one landing late is dropped. */
  const requestRef = useRef(0);
  const fetchedAtRef = useRef(0);
  const rangeRef = useRef(range);
  rangeRef.current = range;

  useEffect(
    () => () => {
      requestRef.current += 1; // unmounted: ignore whatever is still in flight
    },
    [],
  );

  /** Show the kept copy for `days` if there is one, and ask the server when
   *  there isn't or it has aged. `fresh` is the Refresh button: past both
   *  caches, this page's and the server's. */
  const fetchPerformance = useCallback(async (days: PerformanceRange, opts?: { fresh?: boolean }) => {
    const fresh = opts?.fresh === true;
    const tz = browserZone();
    const key = `${days}|${tz}`;
    const kept = fresh ? undefined : pageCache.get(key);
    if (kept) {
      setData(kept.data);
      setError(null);
      fetchedAtRef.current = kept.fetchedAt;
      if (Date.now() - kept.fetchedAt < REUSE_MS) {
        requestRef.current += 1; // whatever is in flight is for another period
        setLoading(false);
        return;
      }
    }
    const id = ++requestRef.current;
    setLoading(true);
    try {
      const res = await fetch(
        `/api/performance?days=${days}&tz=${encodeURIComponent(tz)}${fresh ? "&fresh=1" : ""}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (id !== requestRef.current) return;
      if (!res.ok || !body || body.ok === false) {
        setError(
          body?.error ??
            (res.status === 401
              ? "Your session has ended. Sign in again to see portal performance."
              : `Couldn't load portal performance (${res.status}).`),
        );
        return;
      }
      const next = toPerformance(body);
      const fetchedAt = Date.now();
      pageCache.set(key, { data: next, fetchedAt });
      setData(next);
      setError(null);
      fetchedAtRef.current = fetchedAt;
    } catch {
      if (id === requestRef.current) setError("Network error loading portal performance.");
    } finally {
      if (id === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPerformance(range);
  }, [range, fetchPerformance]);

  // Back after a while away: ask again, once. No timer; see STALE_MS.
  useEffect(() => {
    const wake = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - fetchedAtRef.current < STALE_MS) return;
      fetchPerformance(rangeRef.current);
    };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [fetchPerformance]);

  const all = useMemo(
    () => (data ? sumSeries(Object.values(data.interactions), data.days) : null),
    [data],
  );
  const resolved = data && all ? resolveSelection(selection, data, all) : null;

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      {/* ── header row ─────────────────────────────────────────────────── */}
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Monitor — how the portal is doing
            </div>
            <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">Performance</h1>
            <p className="mt-1 max-w-xl text-xs text-muted-foreground">
              Clicks, calls and enquiries on the customer portal, and how many clicks each service got.
              There are no impressions: the portal only sees people who arrive.
            </p>
            <a
              href={PORTAL_STAFF_LINK}
              target="_blank"
              rel="noopener noreferrer"
              data-track="performance_open_portal"
              title="Opens the live customer portal in a new tab. Your own visit isn't counted."
              className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-sm text-[11px] font-medium text-primary outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Globe className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">
                Customer portal: {PORTAL_PAGE_URL.replace(/^https?:\/\//, "")}
              </span>
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {data?.computedAt && (
              <div className="mr-1 text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <div>Updated</div>
                <div className="tnum text-foreground/80">
                  {new Date(data.computedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
                </div>
              </div>
            )}
            <RangePicker value={range} onChange={setRange} />
            <button
              type="button"
              onClick={() => fetchPerformance(range, { fresh: true })}
              data-track="performance_refresh"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} aria-hidden />
              Refresh
            </button>
            <button
              type="button"
              onClick={() => data && downloadPerformanceCsv(data, PORTAL_PAGE_URL)}
              disabled={!data}
              data-track="performance_export_csv"
              title={data ? `Download the last ${RANGE_LABEL[data.days]} as a CSV for Excel` : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </button>
            <button
              type="button"
              onClick={() => {
                if (!data) return;
                // Opened inside the click, or popup blockers eat it.
                const opened = openPerformanceReport(data, PORTAL_PAGE_URL, PORTAL_STAFF_LINK);
                setExportError(
                  opened ? null : "Your browser blocked the report window. Allow pop-ups for this site, then try again.",
                );
              }}
              disabled={!data}
              data-track="performance_export_pdf"
              title={data ? `Open the last ${RANGE_LABEL[data.days]} as a report, ready to save as PDF` : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
            >
              <FileDown className="h-3.5 w-3.5" aria-hidden />
              Export PDF
            </button>
          </div>
        </div>
      </Reveal>

      {/* ── demo banner (the app's amber demo-banner grammar) ──────────── */}
      {data?.mode === "demo" && (
        <Reveal className="mb-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <p className="font-mono text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
              {data.needsMigration
                ? "Not connected — the portal telemetry tables are missing. Run supabase/portal-telemetry.sql in the Supabase SQL editor to see real portal performance."
                : "Not connected — configure Supabase and run supabase/portal-telemetry.sql to see real portal performance."}
            </p>
          </div>
        </Reveal>
      )}

      {exportError && (
        <p role="alert" className="mb-3 px-1 font-mono text-[10.5px] text-destructive">
          {exportError}
        </p>
      )}

      {error && data && (
        <p role="alert" className="mb-3 px-1 font-mono text-[10.5px] text-destructive">
          {error} Showing the last figures that loaded.
        </p>
      )}

      {error && !data ? (
        <Reveal>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-card px-6 py-12 text-center ring-1 ring-foreground/10">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
              <AlertTriangle className="h-6 w-6" aria-hidden />
            </span>
            <h2 className="text-base font-semibold text-foreground">Couldn&rsquo;t load portal performance</h2>
            <p role="alert" className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground">
              {error}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchPerformance(range)}
              data-track="performance_retry"
              className="gap-1.5"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Retry
            </Button>
          </div>
        </Reveal>
      ) : !data || !all || !resolved ? (
        <PageSkeleton />
      ) : (
        <div
          // Dimmed only while it still shows another period's figures. A
          // kept copy being checked in the background stays at full strength.
          className={cn("space-y-3 transition-opacity", loading && data.days !== range && "opacity-60")}
          aria-busy={loading || undefined}
        >
          <Reveal delay={0.04}>
            <OverviewPanel
              data={data}
              all={all}
              selection={selection}
              resolved={resolved}
              onSelect={setSelection}
            />
          </Reveal>
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <Reveal delay={0.08} className="min-w-0">
              <ServicesPanel data={data} selection={selection} onSelect={setSelection} />
            </Reveal>
            <div className="flex min-w-0 flex-col gap-3">
              <Reveal delay={0.1} className="min-w-0">
                <InteractionsPanel data={data} selection={selection} onSelect={setSelection} />
              </Reveal>
              <Reveal delay={0.12} className="min-w-0">
                <ChannelsPanel resolved={resolved} />
              </Reveal>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  );
}
