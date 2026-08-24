"use client";

/**
 * Master Client List — every customer APMG already services, folded out of the
 * duplicate spellings in the site export (lib/clients/normalize.ts).
 *
 * The tab answers two questions and is laid out in that order:
 *  1. how many clients are there, really, and where are they — the KPI panel;
 *  2. is this one of them — the search, and the guard notice explaining that
 *     cold outreach already skips everyone on this page.
 *
 * The list is read-only by design. It is a periodic export from the
 * job-management system, so an edit here would be overwritten by the next one;
 * corrections belong upstream.
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  ChevronRight,
  FileDown,
  Globe,
  Mail,
  MapPin,
  Phone,
  Search,
  ShieldCheck,
  User,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { exportClientsCsv, type ClientExportGrain } from "@/lib/clients/export";
import { nameTokens } from "@/lib/clients/normalize";
import { useMasterClients, type ClientGroup, type MasterClientData } from "@/lib/data/clients";
import type { Kpi } from "@/lib/data/leads";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/rbac/Can";
import { Footer } from "./Footer";
import { KpiCard } from "./KpiCard";
import { Reveal } from "./Reveal";

/* ────────────────────────────────  filters  ──────────────────────────────── */

type FilterId = "all" | "multi" | "branched" | "organisations" | "individuals" | "flagged";

const FILTERS: Array<{ id: FilterId; label: string; keep: (g: ClientGroup) => boolean }> = [
  { id: "all", label: "All", keep: () => true },
  { id: "multi", label: "Multi-site", keep: (g) => g.siteCount > 1 },
  { id: "branched", label: "Branch networks", keep: (g) => g.branches.length > 0 },
  { id: "organisations", label: "Organisations", keep: (g) => g.kind === "organisation" },
  { id: "individuals", label: "Individuals", keep: (g) => g.kind === "individual" },
  { id: "flagged", label: "Held back", keep: (g) => g.flag !== "active" },
];

/** Search across everything an operator might have in front of them: the
 *  canonical name, the raw spellings it replaced, its branches, suburbs,
 *  contacts, addresses and site names. */
function matchesQuery(group: ClientGroup, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    group.name,
    ...group.aliases,
    ...group.branches,
    ...group.suburbs,
    ...group.contacts,
    ...group.emails,
    ...group.domains,
    ...group.sites.map((s) => s.siteName),
  ]
    .join(" ")
    .toLowerCase();
  return terms.every((t) => haystack.includes(t));
}

/* ──────────────────────────────────  KPIs  ───────────────────────────────── */

function clientKpis(stats: {
  active: number;
  clients: number;
  excluded: number;
  rawCustomers: number;
  duplicatesFolded: number;
  sites: number;
  suburbs: number;
  multiSite: number;
  branches: number;
  branched: number;
  branchedSites: number;
  emails: number;
  domains: number;
  withEmail: number;
}): Kpi[] {
  return [
    {
      id: "clients",
      label: "Clients",
      value: formatInt(stats.active),
      numeric: stats.active,
      format: "int",
      caption:
        stats.excluded > 0
          ? `${formatInt(stats.excluded)} held back (APMG's own + test records)`
          : "every record on the list is a live customer",
      ratio: {
        value: stats.rawCustomers > 0 ? stats.clients / stats.rawCustomers : 0,
        label: `folded from ${formatInt(stats.rawCustomers)} spellings`,
      },
    },
    {
      id: "sites",
      label: "Sites serviced",
      value: formatInt(stats.sites),
      numeric: stats.sites,
      format: "int",
      caption: `across ${formatInt(stats.suburbs)} suburbs`,
      ratio: {
        value: stats.clients > 0 ? Math.min(1, stats.multiSite / stats.clients) : 0,
        label: `${formatInt(stats.multiSite)} clients hold more than one`,
      },
    },
    {
      id: "branches",
      label: "Branch offices",
      value: formatInt(stats.branches),
      numeric: stats.branches,
      format: "int",
      caption:
        stats.branched > 0
          ? `across ${formatInt(stats.branched)} branch network${stats.branched === 1 ? "" : "s"}`
          : "no branch networks on the list",
      // Share of SITES under a branch network, not share of clients. Seven
      // clients out of 228 is a 3% bar that reads as an error; those seven are
      // a sixth of everything APMG services, which is the fact worth seeing.
      ratio: {
        value: stats.sites > 0 ? stats.branchedSites / stats.sites : 0,
        label: `${formatInt(stats.branchedSites)} sites sit under one`,
      },
    },
    {
      id: "protected",
      label: "Protected addresses",
      value: formatInt(stats.emails),
      numeric: stats.emails,
      format: "int",
      caption: `plus ${formatInt(stats.domains)} domains locked out of outreach`,
      ratio: {
        value: stats.clients > 0 ? stats.withEmail / stats.clients : 0,
        label: `${formatInt(stats.withEmail)} clients have contact details on file`,
      },
    },
  ];
}

function loadingKpis(): Kpi[] {
  return ["Clients", "Sites serviced", "Branch offices", "Protected addresses"].map((label, i) => ({
    id: `loading-${i}`,
    label,
    value: "—",
    numeric: 0,
    format: "int" as const,
    loading: true,
  }));
}

/* ────────────────────────────────  the page  ─────────────────────────────── */

export function MasterClientListPage() {
  const { state, reload } = useMasterClients();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterId>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);

  const data = state.status === "ready" ? state.data : null;
  const kpis = data ? clientKpis(data.stats) : loadingKpis();

  const terms = useMemo(
    () => nameTokens(query).filter((t) => t.length > 0),
    [query],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const keep = FILTERS.find((f) => f.id === filter)?.keep ?? (() => true);
    return data.groups.filter((g) => keep(g) && matchesQuery(g, terms));
  }, [data, filter, terms]);

  const filtered = !!data && rows.length !== data.groups.length;

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal className="mb-4" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Existing customers
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Master Client List
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Every customer APMG already services, normalized to one row each. The site export
              spells the same customer several ways — nine variants of Ace Body Corp, seventeen of
              MBCM — so those are folded together here, with their branches and sites underneath.
            </p>
          </div>
          <Can perm="clients.export">
            <ExportMenu groups={rows} disabled={!data || rows.length === 0} scoped={filtered} />
          </Can>
        </div>
      </Reveal>

      <GuardNotice stats={data?.stats ?? null} />

      <Reveal delay={0.04}>
        <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-foreground/10 lg:grid-cols-4">
          {kpis.map((kpi) => (
            <KpiCard key={kpi.id} kpi={kpi} />
          ))}
        </div>
      </Reveal>

      {state.status === "error" ? (
        <div
          role="alert"
          className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-14 text-center"
        >
          <p className="text-sm font-medium text-foreground">Couldn&apos;t load the client list</p>
          <p className="max-w-sm text-xs text-muted-foreground">{state.error}</p>
          <Button variant="outline" onClick={reload} data-track="clients_retry">
            Try again
          </Button>
        </div>
      ) : (
        <Reveal delay={0.08} className="mt-3">
          <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
            <Toolbar
              query={query}
              onQuery={setQuery}
              filter={filter}
              onFilter={setFilter}
              shown={rows.length}
              total={data?.stats.clients ?? 0}
              loading={!data}
            />

            {!data ? (
              <ListSkeleton />
            ) : rows.length === 0 ? (
              <p className="py-14 text-center text-xs text-muted-foreground">
                No client matches “{query.trim()}”
                {filter !== "all" ? ` in ${FILTERS.find((f) => f.id === filter)?.label}` : ""}.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border border-y border-border">
                {rows.map((group) => (
                  <ClientRow
                    key={group.key}
                    group={group}
                    open={openKey === group.key}
                    onToggle={() => setOpenKey((prev) => (prev === group.key ? null : group.key))}
                  />
                ))}
              </ul>
            )}
          </div>
        </Reveal>
      )}

      <Footer />
    </div>
  );
}

/* ────────────────────────────  the guard notice  ─────────────────────────── */

/**
 * The warning the whole tab exists to make true: these customers are taken.
 * Phrased as what the system already does rather than as advice, because the
 * send route enforces it — see /api/pipeline/campaigns/send.
 */
function GuardNotice({ stats }: { stats: MasterClientData["stats"] | null }) {
  return (
    <Reveal delay={0.02}>
      <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary/[0.05] px-4 py-3">
        <span className="mt-px flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
          <ShieldCheck className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 text-[12.5px] leading-relaxed text-foreground/90">
          <span className="font-semibold text-foreground">
            These clients are already taken — outreach skips them.
          </span>{" "}
          Before a campaign goes out, every recipient is checked against every record on this page
          {stats
            ? ` — ${formatInt(stats.emails)} addresses, ${formatInt(stats.domains)} mail domains, and all ${formatInt(stats.rawCustomers)} trading names`
            : ""}
          . A match is dropped from the send and reported, so a cold email cannot reach an existing
          customer even if the lead was scraped under a different name or a website we&apos;ve never
          filed. Prospects that merely{" "}
          <em className="not-italic text-foreground">resemble</em> a client are flagged for a
          decision instead of dropped.
        </div>
      </div>
    </Reveal>
  );
}

/* ──────────────────────────────────  rows  ───────────────────────────────── */

function FlagChip({ flag }: { flag: ClientGroup["flag"] }) {
  if (flag === "active") return null;
  const label = flag === "internal" ? "APMG internal" : "Do not use";
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-px font-mono text-[9.5px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
      <AlertTriangle className="h-2.5 w-2.5" aria-hidden />
      {label}
    </span>
  );
}

function ClientRow({
  group,
  open,
  onToggle,
}: {
  group: ClientGroup;
  open: boolean;
  onToggle: () => void;
}) {
  const Icon = group.kind === "individual" ? User : Building2;
  const where =
    group.suburbs.length === 0
      ? "no address on file"
      : group.suburbs.length <= 3
        ? group.suburbs.join(", ")
        : `${group.suburbs.slice(0, 2).join(", ")} +${formatInt(group.suburbs.length - 2)} more`;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        data-track="client_row_open"
        data-track-client={group.key}
        className="flex w-full items-center gap-3 px-1 py-2.5 text-left transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
      >
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
        <Icon className="h-[15px] w-[15px] shrink-0 text-muted-foreground" aria-hidden />

        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-foreground">{group.name}</span>
            <FlagChip flag={group.flag} />
          </span>
          <span className="mt-px block truncate font-mono text-[10.5px] text-muted-foreground">
            {where}
          </span>
        </span>

        <span className="hidden shrink-0 text-right sm:block">
          <span className="tnum block font-mono text-[13px] font-semibold text-foreground">
            {formatInt(group.siteCount)}
          </span>
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
            {group.siteCount === 1 ? "site" : "sites"}
          </span>
        </span>

        <span className="hidden w-24 shrink-0 text-right md:block">
          <span className="tnum block font-mono text-[13px] font-semibold text-foreground">
            {group.branches.length > 0 ? formatInt(group.branches.length) : "—"}
          </span>
          <span className="block font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground">
            {group.branches.length === 1 ? "branch" : "branches"}
          </span>
        </span>
      </button>

      {open && <ClientDetail group={group} />}
    </li>
  );
}

function ClientDetail({ group }: { group: ClientGroup }) {
  const branchless = group.sites.filter((s) => !s.branch);
  const byBranch = group.branches.map((branch) => ({
    branch,
    sites: group.sites.filter((s) => s.branch === branch),
  }));

  return (
    <div className="mb-3 ml-8 mr-1 flex flex-col gap-3 rounded-lg border border-border bg-background/40 p-3">
      {/* what this row was folded out of — the audit trail for the count */}
      {group.aliases.length > 1 && (
        <DetailBlock label={`Folded from ${group.aliases.length} spellings`}>
          <div className="flex flex-wrap gap-1.5">
            {group.aliases.map((alias) => (
              <span
                key={alias}
                className="rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px] text-muted-foreground"
              >
                {alias}
              </span>
            ))}
          </div>
        </DetailBlock>
      )}

      {(group.contacts.length > 0 || group.phones.length > 0 || group.emails.length > 0) && (
        <DetailBlock label="Contact on file">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] text-muted-foreground">
            {group.contacts.slice(0, 4).map((contact) => (
              <span key={contact} className="text-foreground/80">
                {contact}
              </span>
            ))}
            {group.phones.slice(0, 2).map((phone) => (
              <span key={phone} className="inline-flex items-center gap-1.5">
                <Phone className="h-3 w-3 shrink-0" aria-hidden />
                {phone}
              </span>
            ))}
            {group.emails.slice(0, 3).map((email) => (
              <span key={email} className="inline-flex min-w-0 items-center gap-1.5">
                <Mail className="h-3 w-3 shrink-0" aria-hidden />
                <span className="truncate">{email}</span>
              </span>
            ))}
            {group.emails.length > 3 && <span>+{formatInt(group.emails.length - 3)} more</span>}
          </div>
        </DetailBlock>
      )}

      {group.domains.length > 0 && (
        <DetailBlock label={`${group.domains.length} domain${group.domains.length === 1 ? "" : "s"} locked out of outreach`}>
          <div className="flex flex-wrap gap-1.5">
            {group.domains.map((domain) => (
              <span
                key={domain}
                className="inline-flex items-center gap-1 rounded border border-primary/25 bg-primary/[0.06] px-1.5 py-0.5 font-mono text-[10.5px] text-foreground/80"
              >
                <Globe className="h-2.5 w-2.5 text-primary" aria-hidden />
                {domain}
              </span>
            ))}
          </div>
        </DetailBlock>
      )}

      <DetailBlock label={`${formatInt(group.siteCount)} site${group.siteCount === 1 ? "" : "s"}${group.archivedSites > 0 ? ` · ${formatInt(group.archivedSites)} archived` : ""}`}>
        <div className="flex flex-col gap-2">
          {byBranch.map(({ branch, sites }) => (
            <SiteList key={branch} heading={branch} sites={sites} />
          ))}
          {branchless.length > 0 && (
            <SiteList
              heading={byBranch.length > 0 ? "Head office / unassigned" : null}
              sites={branchless}
            />
          )}
        </div>
      </DetailBlock>
    </div>
  );
}

function DetailBlock({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

/** How many sites to render per branch before collapsing the tail. City
 *  Integrated has 364 of them — printing every one would make the row
 *  unusable and the DOM enormous. */
const SITES_SHOWN = 12;

function SiteList({ heading, sites }: { heading: string | null; sites: ClientGroup["sites"] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? sites : sites.slice(0, SITES_SHOWN);
  const hidden = sites.length - shown.length;

  return (
    <div>
      {heading && (
        <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-foreground/90">
          <MapPin className="h-3 w-3 shrink-0 text-primary" aria-hidden />
          {heading}
          <span className="tnum font-mono text-[10px] text-muted-foreground">
            {formatInt(sites.length)}
          </span>
        </div>
      )}
      <ul className="flex flex-wrap gap-1.5">
        {shown.map((site) => (
          <li
            key={site.id}
            title={[site.street, site.suburb, site.postcode].filter(Boolean).join(", ") || undefined}
            className={cn(
              "rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10.5px]",
              site.archived ? "text-muted-foreground line-through" : "text-foreground/80",
            )}
          >
            {site.siteName}
            {site.suburb && site.suburb.toLowerCase() !== site.siteName.toLowerCase() && (
              <span className="text-muted-foreground"> · {site.suburb}</span>
            )}
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-1 font-mono text-[10.5px] text-primary underline-offset-2 hover:underline"
        >
          Show {formatInt(hidden)} more
        </button>
      )}
    </div>
  );
}

/* ────────────────────────────────  toolbar  ──────────────────────────────── */

function Toolbar({
  query,
  onQuery,
  filter,
  onFilter,
  shown,
  total,
  loading,
}: {
  query: string;
  onQuery: (v: string) => void;
  filter: FilterId;
  onFilter: (f: FilterId) => void;
  shown: number;
  total: number;
  loading: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            disabled={loading}
            placeholder="Search a client, branch, site, suburb, contact or domain"
            aria-label="Search the client list"
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-8 text-[12.5px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          )}
        </div>
        <span className="tnum shrink-0 font-mono text-[10.5px] text-muted-foreground">
          {loading ? "loading…" : `${formatInt(shown)} of ${formatInt(total)}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onFilter(f.id)}
            disabled={loading}
            aria-pressed={filter === f.id}
            data-track="client_filter"
            data-track-filter={f.id}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-60",
              filter === f.id
                ? "border-primary/50 bg-primary/10 font-medium text-foreground"
                : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            {f.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ────────────────────────────────  export  ───────────────────────────────── */

function ExportMenu({
  groups,
  disabled,
  scoped,
}: {
  groups: ClientGroup[];
  disabled: boolean;
  scoped: boolean;
}) {
  const sites = groups.reduce((n, g) => n + g.siteCount, 0);

  function run(grain: ClientExportGrain) {
    exportClientsCsv(groups, grain);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {scoped ? "Export what's shown" : "Export"}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => run("clients")}
        data-track="clients_export_csv"
        className="gap-1.5"
      >
        <FileDown className="h-3.5 w-3.5" aria-hidden />
        {formatInt(groups.length)} clients
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => run("sites")}
        data-track="clients_export_sites_csv"
        className="gap-1.5"
      >
        <FileDown className="h-3.5 w-3.5" aria-hidden />
        {formatInt(sites)} sites
      </Button>
    </div>
  );
}

function ListSkeleton() {
  return (
    <ul className="mt-3 divide-y divide-border border-y border-border" aria-hidden>
      {Array.from({ length: 8 }).map((_, i) => (
        <li key={i} className="flex items-center gap-3 px-1 py-3">
          <div className="h-3.5 w-3.5 shrink-0 animate-pulse rounded bg-muted" />
          <div className="flex-1">
            <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            <div className="mt-1.5 h-2.5 w-1/5 animate-pulse rounded bg-muted/60" />
          </div>
          <div className="h-6 w-10 shrink-0 animate-pulse rounded bg-muted/60" />
        </li>
      ))}
    </ul>
  );
}
