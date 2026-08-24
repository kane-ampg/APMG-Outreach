"use client";

/**
 * CSV export of the Master Client List, at whichever grain answers the question
 * being asked:
 *
 *  · `clients`  — one row per real customer, with its branches, site count and
 *                 the spellings that were folded into it. This is the list
 *                 somebody means by "how many clients do we have".
 *  · `sites`    — one row per site, carrying its client and branch. The original
 *                 export's grain, but de-duplicated and attributed.
 *
 * Zero dependencies, same conventions as lib/pipeline/leadExport.ts: RFC-4180
 * quoting and a UTF-8 BOM so Excel opens it without mangling "St Kilda" or an
 * apostrophe in a contact's name.
 */

import type { ClientGroup } from "./normalize";

export type ClientExportGrain = "clients" | "sites";

function field(value: string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(csv: string, filename: string) {
  // U+FEFF byte-order mark, written from its code point rather than as a
  // literal so no invisible character sits in this file. Excel needs it to
  // read the file as UTF-8 instead of as the local codepage.
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

const list = (values: readonly string[]) => values.join("; ");

const CLIENT_COLUMNS: Array<{ header: string; value: (g: ClientGroup) => string | number | null }> = [
  { header: "Client", value: (g) => g.name },
  { header: "Type", value: (g) => (g.kind === "individual" ? "Individual" : "Organisation") },
  { header: "Status", value: (g) => (g.flag === "active" ? "Active client" : g.flag === "internal" ? "APMG internal" : "Do not use") },
  { header: "Sites", value: (g) => g.siteCount },
  { header: "Archived sites", value: (g) => g.archivedSites },
  { header: "Branches", value: (g) => g.branches.length },
  { header: "Branch names", value: (g) => list(g.branches) },
  { header: "Suburbs", value: (g) => list(g.suburbs) },
  { header: "States", value: (g) => list(g.states) },
  { header: "Contacts", value: (g) => list(g.contacts) },
  { header: "Phones", value: (g) => list(g.phones) },
  { header: "Emails", value: (g) => list(g.emails) },
  { header: "Protected domains", value: (g) => list(g.domains) },
  { header: "Source spellings folded in", value: (g) => list(g.aliases) },
];

const SITE_COLUMNS: Array<{
  header: string;
  value: (row: { group: ClientGroup; site: ClientGroup["sites"][number] }) => string | number | null;
}> = [
  { header: "Client", value: ({ group }) => group.name },
  { header: "Branch", value: ({ site }) => site.branch },
  { header: "Site", value: ({ site }) => site.siteName },
  { header: "Contact", value: ({ site }) => site.contact },
  { header: "Phone", value: ({ site }) => site.phone },
  { header: "Emails", value: ({ site }) => list(site.emails) },
  { header: "Street", value: ({ site }) => site.street },
  { header: "Suburb", value: ({ site }) => site.suburb },
  { header: "State", value: ({ site }) => site.state },
  { header: "Postcode", value: ({ site }) => site.postcode },
  { header: "Archived", value: ({ site }) => (site.archived ? "Yes" : "No") },
  { header: "Source spelling", value: ({ site }) => site.sourceCustomer },
];

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function exportClientsCsv(groups: ClientGroup[], grain: ClientExportGrain) {
  if (grain === "clients") {
    const lines = [
      CLIENT_COLUMNS.map((c) => field(c.header)).join(","),
      ...groups.map((g) => CLIENT_COLUMNS.map((c) => field(c.value(g))).join(",")),
    ];
    download(lines.join("\r\n"), `apmg-master-client-list-${stamp()}.csv`);
    return;
  }

  const rows = groups.flatMap((group) => group.sites.map((site) => ({ group, site })));
  const lines = [
    SITE_COLUMNS.map((c) => field(c.header)).join(","),
    ...rows.map((row) => SITE_COLUMNS.map((c) => field(c.value(row))).join(",")),
  ];
  download(lines.join("\r\n"), `apmg-client-sites-${stamp()}.csv`);
}
