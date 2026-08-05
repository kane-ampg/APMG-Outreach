/**
 * Client-side lead exports — CSV, XLSX and PDF — with zero dependencies,
 * mirroring the TelemetryReportExport approach (the one existing export).
 *
 * - CSV: RFC-4180 quoting with a UTF-8 BOM so Excel opens it correctly.
 * - XLSX: a real Office Open XML workbook written by hand — a stored (no
 *   compression) ZIP containing the minimal parts Excel needs, with inline
 *   strings, a frozen bold header row and sensible column widths. Rows that
 *   span more than one import folder are split into one sheet per folder.
 * - PDF: the browser's print pipeline — open a window synchronously on
 *   click, write a print-styled A4 landscape document, auto window.print()
 *   so the user lands in "Save as PDF". Popup-blocker safe because the
 *   data is already client-side (no async between click and open).
 *
 * Every export receives the rows already scoped by the caller (the open
 * folder, the search filter, and any checkbox selection), so what you see
 * is exactly what you get.
 *
 * Multi-folder exports keep the folders apart in whichever way the format
 * allows: separate sheets (XLSX), folder-ordered rows plus the Folder column
 * (CSV), and folder section headings (PDF).
 */

import { bestEmail } from "@/lib/pipeline/campaign";
import type { LeadView } from "@/components/apmg/pipeline/LeadsTable";

/* ── column model (shared by CSV + XLSX) ─────────────────────────────────── */

interface ExportColumn {
  header: string;
  /** XLSX column width (chars). */
  width: number;
  value: (r: LeadView) => string | number | null;
}

const joinList = (v: string[] | null | undefined) =>
  (v ?? []).map((s) => s.trim()).filter(Boolean).join("; ") || null;

const asRating = (v: LeadView["rating"]): string | number | null => {
  if (v == null || v === "") return null;
  const num = typeof v === "number" ? v : Number(v);
  return Number.isFinite(num) ? num : String(v);
};

export const LEAD_EXPORT_COLUMNS: ExportColumn[] = [
  { header: "Business", width: 32, value: (r) => r.name || null },
  { header: "Address", width: 42, value: (r) => r.address ?? null },
  { header: "Website", width: 32, value: (r) => r.website ?? null },
  { header: "Phone", width: 16, value: (r) => r.phone ?? null },
  { header: "Primary email", width: 30, value: (r) => bestEmail(r.emails) },
  { header: "All emails", width: 40, value: (r) => joinList(r.emails) },
  { header: "Rating", width: 8, value: (r) => asRating(r.rating) },
  { header: "Category", width: 20, value: (r) => r.category ?? null },
  { header: "Social profiles", width: 40, value: (r) => joinList(r.social_medias) },
  { header: "Facebook", width: 30, value: (r) => r.facebook ?? null },
  { header: "Instagram", width: 30, value: (r) => r.instagram ?? null },
  { header: "Twitter", width: 30, value: (r) => r.twitter ?? null },
  { header: "Maps URL", width: 40, value: (r) => r.bing_maps_url ?? null },
  { header: "Image URL", width: 40, value: (r) => r.featured_image ?? null },
  { header: "Folder", width: 24, value: (r) => r.batch ?? null },
  { header: "Imported at", width: 22, value: (r) => r.created_at ?? null },
];

/* ── folder grouping ─────────────────────────────────────────────────────── */

// keep in sync with UNGROUPED in lib/pipeline/server.ts
const UNGROUPED = "__ungrouped__";

export interface LeadGroup {
  /** Display name — the folder, or "Ungrouped" for leads with no batch. */
  name: string;
  rows: LeadView[];
}

const folderKey = (r: LeadView) => r.batch?.trim() || UNGROUPED;

/** Split rows into one group per import folder — alphabetical, Ungrouped last.
 *  A single-folder scope (or a pre-folders flat list) comes back as one group. */
export function groupLeadsByFolder(rows: LeadView[]): LeadGroup[] {
  const map = new Map<string, LeadView[]>();
  for (const r of rows) {
    const key = folderKey(r);
    const bucket = map.get(key);
    if (bucket) bucket.push(r);
    else map.set(key, [r]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => (a === UNGROUPED ? 1 : b === UNGROUPED ? -1 : a.localeCompare(b)))
    .map(([key, groupRows]) => ({ name: key === UNGROUPED ? "Ungrouped" : key, rows: groupRows }));
}

/** How many distinct folders a set of rows spans (drives the menu's hints). */
export function leadFolderCount(rows: LeadView[]): number {
  return new Set(rows.map(folderKey)).size;
}

/* ── filenames + download plumbing ───────────────────────────────────────── */

function fileSlug(scope: string): string {
  const slug = scope.trim().toLowerCase().replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "leads";
}

function dateStamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function exportFilename(scope: string, ext: string): string {
  return `${fileSlug(scope)}-leads-${dateStamp()}.${ext}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/* ── CSV ─────────────────────────────────────────────────────────────────── */

function csvField(v: string | number | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function exportLeadsCsv(rows: LeadView[], scope: string) {
  // One flat file can't hold sheets, so a multi-folder export is at least
  // ordered folder-by-folder — the Folder column carries the split.
  const groups = groupLeadsByFolder(rows);
  const ordered = groups.length > 1 ? groups.flatMap((g) => g.rows) : rows;
  const lines = [
    LEAD_EXPORT_COLUMNS.map((c) => csvField(c.header)).join(","),
    ...ordered.map((r) => LEAD_EXPORT_COLUMNS.map((c) => csvField(c.value(r))).join(",")),
  ];
  // BOM so Excel detects UTF-8 (business names/addresses can be non-ASCII)
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, exportFilename(scope, "csv"));
}

/* ── XLSX (hand-rolled OOXML in a stored ZIP) ────────────────────────────── */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Stored (method 0) ZIP — no compression keeps the writer tiny and reliable. */
function buildZip(entries: { name: string; text: string }[]): Blob {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
  const dosDate = (((now.getFullYear() - 1980) & 0x7f) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();

  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = enc.encode(entry.name);
    const data = enc.encode(entry.text);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); // local file header
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(6, 0x0800, true); // UTF-8 filenames
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);

    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, 0x02014b50, true); // central directory header
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);

    offset += local.length + data.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // end of central directory
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);

  const out = new Uint8Array(offset + centralSize + eocd.length);
  let pos = 0;
  for (const chunk of [...parts, ...central, eocd]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return new Blob([out], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

function xmlEsc(s: string): string {
  return s
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A1-style column ref for a 0-based index (A…Z, AA…). */
function colRef(i: number): string {
  let n = i + 1;
  let ref = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    ref = String.fromCharCode(65 + rem) + ref;
    n = Math.floor((n - 1) / 26);
  }
  return ref;
}

function sheetCell(col: number, row: number, v: string | number | null, styleId: 0 | 1): string {
  if (v == null || v === "") return "";
  const ref = `${colRef(col)}${row}`;
  const s = styleId ? ` s="${styleId}"` : "";
  if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${s}><v>${v}</v></c>`;
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
}

/** Excel sheet-name rules: 1–31 chars, none of []:*?/\, unique in a workbook. */
function safeSheetName(raw: string, used: Set<string>, index: number): string {
  let base = raw.replace(/[[\]:*?/\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 31);
  if (!base) base = `Sheet ${index + 1}`;
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n++) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  used.add(name.toLowerCase());
  return name;
}

/** One worksheet part: frozen bold header row, one row per lead. */
function worksheetXml(rows: LeadView[]): string {
  const cols = LEAD_EXPORT_COLUMNS.map(
    (c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width}" customWidth="1"/>`,
  ).join("");

  const headerRow = `<row r="1">${LEAD_EXPORT_COLUMNS.map((c, i) => sheetCell(i, 1, c.header, 1)).join("")}</row>`;
  const dataRows = rows
    .map(
      (r, ri) =>
        `<row r="${ri + 2}">${LEAD_EXPORT_COLUMNS.map((c, ci) => sheetCell(ci, ri + 2, c.value(r), 0)).join("")}</row>`,
    )
    .join("");

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${headerRow}${dataRows}</sheetData>` +
    `</worksheet>`
  );
}

export function exportLeadsXlsx(rows: LeadView[], scope: string) {
  // Rows spanning several folders become one sheet per folder (named after it);
  // a single-folder scope stays a single "Leads" sheet.
  const groups = groupLeadsByFolder(rows);
  const used = new Set<string>();
  const sheets =
    groups.length > 1
      ? groups.map((g, i) => ({ name: safeSheetName(g.name, used, i), rows: g.rows }))
      : [{ name: "Leads", rows }];

  const sheetParts = sheets.map((s, i) => ({
    name: `xl/worksheets/sheet${i + 1}.xml`,
    text: worksheetXml(s.rows),
  }));
  const stylesRelId = `rId${sheets.length + 1}`;

  const workbook =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets>${sheets
      .map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join("")}</sheets>` +
    `</workbook>`;

  const workbookRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    sheets
      .map(
        (_s, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="${stylesRelId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    `</Relationships>`;

  // style 0 = default, style 1 = bold (the header row)
  const styles =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>` +
    `<borders count="1"><border/></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
    `</styleSheet>`;

  const rootRels =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
    `</Relationships>`;

  const contentTypes =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
    `<Default Extension="xml" ContentType="application/xml"/>` +
    `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
    sheets
      .map(
        (_s, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
    `</Types>`;

  const blob = buildZip([
    { name: "[Content_Types].xml", text: contentTypes },
    { name: "_rels/.rels", text: rootRels },
    { name: "xl/workbook.xml", text: workbook },
    { name: "xl/_rels/workbook.xml.rels", text: workbookRels },
    { name: "xl/styles.xml", text: styles },
    ...sheetParts,
  ]);
  downloadBlob(blob, exportFilename(scope, "xlsx"));
}

/* ── PDF (print-window pattern, same as the telemetry report) ────────────── */

function htmlEsc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as const)[
      c as "&" | "<" | ">" | '"' | "'"
    ],
  );
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function buildLeadsPdfHtml(rows: LeadView[], scope: string): string {
  const generated = new Date().toLocaleString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const leadRow = (r: LeadView, i: number) => {
    const email = bestEmail(r.emails);
    const rating = asRating(r.rating);
    const socials = (r.social_medias ?? []).filter(Boolean).length;
    return `<tr>
        <td class="r num mut">${i + 1}</td>
        <td><b>${htmlEsc(r.name)}</b>${r.address ? `<span class="sub">${htmlEsc(r.address)}</span>` : ""}</td>
        <td class="wrap">${r.website ? htmlEsc(prettyUrl(r.website)) : "—"}</td>
        <td class="num">${r.phone ? htmlEsc(r.phone) : "—"}</td>
        <td class="wrap">${email ? htmlEsc(email) : "—"}</td>
        <td class="r num">${rating != null ? htmlEsc(String(rating)) : "—"}</td>
        <td>${r.category ? htmlEsc(r.category) : "—"}</td>
        <td class="r num">${socials || "—"}</td>
      </tr>`;
  };

  // Multi-folder exports get a banded heading row per folder (the print
  // equivalent of the workbook's one-sheet-per-folder split), numbered per folder.
  const groups = groupLeadsByFolder(rows);
  const grouped = groups.length > 1;
  const body = grouped
    ? groups
        .map(
          (g) =>
            `<tr class="grp"><td colspan="8">${htmlEsc(g.name)} · ${g.rows.length.toLocaleString(
              "en-US",
            )} lead${g.rows.length === 1 ? "" : "s"}</td></tr>` + g.rows.map(leadRow).join(""),
        )
        .join("")
    : rows.map(leadRow).join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>APMG lead export — ${htmlEsc(scope)}</title>
<style>
  :root { --ink: #17171a; --mut: #6b6b73; --line: #e4e4e8; --red: #c8102e; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--ink); font-size: 11px; line-height: 1.45; padding: 28px 32px;
  }
  @page { size: A4 landscape; margin: 11mm; }
  @media print { body { padding: 0; } }
  .num { font-variant-numeric: tabular-nums; }
  .mut { color: var(--mut); }
  header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    border-bottom: 3px solid var(--red); padding-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .mark { width: 34px; height: 34px; border-radius: 8px; background: var(--red); color: #fff;
    display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 11px; letter-spacing: .04em; }
  .brand b { font-size: 14px; letter-spacing: -0.01em; }
  .brand span { display: block; font-size: 9px; text-transform: uppercase; letter-spacing: .14em; color: var(--mut); }
  .meta { text-align: right; font-size: 10px; color: var(--mut); }
  .meta .scope { font-size: 13px; font-weight: 700; color: var(--ink); }
  h1 { font-size: 17px; letter-spacing: -0.02em; margin: 16px 0 2px; }
  .lede { color: var(--mut); font-size: 10.5px; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: .1em; color: var(--mut);
    border-bottom: 1px solid var(--line); padding: 4px 7px 5px; }
  td { border-bottom: 1px solid var(--line); padding: 5px 7px; vertical-align: top; }
  th.r, td.r { text-align: right; }
  tr { break-inside: avoid; }
  tr.grp td { background: #f3f3f5; font-size: 9px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .1em; padding: 5px 7px; break-after: avoid; }
  thead { display: table-header-group; }
  td .sub { display: block; font-size: 9px; color: var(--mut); }
  td.wrap { word-break: break-all; max-width: 150px; }
  footer { margin-top: 20px; border-top: 1px solid var(--line); padding-top: 8px;
    display: flex; justify-content: space-between; font-size: 9px; color: var(--mut); }
</style>
</head>
<body>
  <header>
    <div class="brand">
      <div class="mark">APMG</div>
      <div><b>APMG — Lead generation</b><span>Lead database export</span></div>
    </div>
    <div class="meta">
      <div class="scope">${htmlEsc(scope)}</div>
      <div>${rows.length.toLocaleString("en-US")} lead${rows.length === 1 ? "" : "s"}</div>
      <div>Generated ${htmlEsc(generated)}</div>
    </div>
  </header>

  <h1>Leads — ${htmlEsc(scope)}</h1>
  <div class="lede">Business details, contact channels and ratings for the ${rows.length.toLocaleString(
    "en-US",
  )} exported lead${rows.length === 1 ? "" : "s"}${
    grouped ? `, grouped into ${groups.length} folders` : ""
  }. The CSV/XLSX exports carry every captured field, including all emails and social links${
    grouped ? " — the workbook puts each folder on its own sheet" : ""
  }.</div>

  <table>
    <thead><tr>
      <th class="r">#</th><th>Business</th><th>Website</th><th>Phone</th><th>Email</th>
      <th class="r">Rating</th><th>Category</th><th class="r">Socials</th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table>

  <footer>
    <span>APMG Lead Generation — internal export. Contains business contact data; handle accordingly.</span>
    <span>apmgservices.com.au</span>
  </footer>
  <script>addEventListener("load", () => setTimeout(() => window.print(), 300));</script>
</body>
</html>`;
}

/** Returns false when the browser blocked the print window. */
export function exportLeadsPdf(rows: LeadView[], scope: string): boolean {
  const win = window.open("", "_blank");
  if (!win) return false;
  win.document.open();
  win.document.write(buildLeadsPdfHtml(rows, scope));
  win.document.close();
  return true;
}
