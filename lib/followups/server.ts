import "server-only";
import { partitionByClientGuard } from "@/lib/clients/guard";
import { clientGuardData } from "@/lib/clients/server";
import { bestEmail } from "@/lib/pipeline/campaign";
import { isUuid } from "@/lib/pipeline/server";
import {
  fetchSuppressedDomains,
  fetchSuppressedEmails,
  isMissingPortalTable,
  organisationDomain,
} from "@/lib/portal/server";
import { ARCHIVE_EVENT, HANDOFF_EVENT, RETURN_EVENT } from "@/lib/sales/handoff";
import { classifyLead, emptySignals, sortQueue, type LeadContact, type LeadGuard, type LeadSignals } from "./eligibility";
import type { FollowUpQueueItem, FollowUpRow, FollowUpStatus, Touch } from "./types";

/**
 * Server-only data layer for the Follow-Ups tab: plain PostgREST fetches with
 * the service-role key (same idiom as lib/pipeline/leadHistory.ts), plus
 * loadQueue, which gathers every fact classifyLead needs and returns the
 * judged, sorted queue. Every route (queue, draft, send, mark) goes through
 * loadQueue, so eligibility is decided in one place.
 */

export interface Sb {
  base: string;
  key: string;
}

export type FollowUpWrite = { lead_id: string; touch: Touch } & Partial<
  Omit<FollowUpRow, "id" | "lead_id" | "touch" | "created_at">
>;
export type FollowUpPatch = Partial<Omit<FollowUpRow, "id" | "lead_id" | "touch" | "created_at">>;

const TABLE = "follow_ups";
const ROW_COLS =
  "id,lead_id,touch,status,subject,body_html,service_slug,model,note,drafted_at,sent_at,sent_by,created_at,updated_at";
/** uuids per in.() list — keeps request URLs short (leadHistory uses the same). */
const CHUNK = 200;
/** PostgREST's max-rows: one response never carries more than this. */
const PAGE = 1000;
/** Pages one list read may take before it stops and logs (50,000 rows). */
const MAX_PAGES = 50;
const SERVICE_EVENT = "portal_service_open";
const INQUIRY_EVENT = "portal_inquiry";
const SENT_EVENT = "email_sent";
const SIGNAL_EVENTS = [SERVICE_EVENT, INQUIRY_EVENT, SENT_EVENT, HANDOFF_EVENT, ARCHIVE_EVENT, RETURN_EVENT];
/** Row statuses that hold an address for a lead (see loadQueue). */
const HOLDS_ADDRESS: ReadonlySet<FollowUpStatus> = new Set(["draft", "sending", "sent"]);
const NO_GUARD: LeadGuard = { client: null, optedOut: false, sharedWith: null, clientWarning: null };

function headers(key: string, extra?: Record<string, string>): HeadersInit {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

type Got = { ok: true; rows: unknown[] } | { ok: false; missing: boolean };

async function get(sb: Sb, pathAndQuery: string): Promise<Got> {
  try {
    const res = await fetch(`${sb.base}/rest/v1/${pathAndQuery}`, { headers: headers(sb.key), cache: "no-store" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const missing = isMissingPortalTable(res.status, detail);
      if (!missing) console.error(`[followups] ${pathAndQuery.split("?")[0]} ${res.status}:`, detail.slice(0, 300));
      return { ok: false, missing };
    }
    const rows = await res.json().catch(() => null);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    console.error("[followups] read failed:", e);
    return { ok: false, missing: false };
  }
}

/** Every row a list query matches, one page at a time. PostgREST caps a
 *  response at 1000 rows and says nothing, so an unpaged read quietly loses
 *  the newest rows. `pathAndQuery` must carry a TOTAL order (…,id.asc) or
 *  pages can overlap and skip. */
async function getAll(sb: Sb, pathAndQuery: string): Promise<Got> {
  const rows: unknown[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const got = await get(sb, `${pathAndQuery}&limit=${PAGE}&offset=${page * PAGE}`);
    if (!got.ok) return got;
    rows.push(...got.rows);
    if (got.rows.length < PAGE) return { ok: true, rows };
  }
  console.error(
    `[followups] ${pathAndQuery.split("?")[0]} hit the ${MAX_PAGES}-page cap at ${rows.length} rows; later rows were not read.`,
  );
  return { ok: true, rows };
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

async function readRowsWhere(sb: Sb, column: "lead_id" | "id", ids?: string[]): Promise<FollowUpRow[] | "missing" | "error"> {
  const lists = ids === undefined ? [null] : chunks(ids.filter(isUuid));
  if (ids !== undefined && lists.length === 0) return [];
  const out: FollowUpRow[] = [];
  for (const list of lists) {
    const filter = list ? `&${column}=in.(${list.join(",")})` : "";
    const got = await getAll(sb, `${TABLE}?select=${ROW_COLS}${filter}&order=created_at.asc,id.asc`);
    if (!got.ok) return got.missing ? "missing" : "error";
    out.push(...(got.rows as FollowUpRow[]));
  }
  return out;
}

export function readFollowUpRows(sb: Sb, leadIds?: string[]) {
  return readRowsWhere(sb, "lead_id", leadIds);
}

export function readFollowUpsByIds(sb: Sb, ids: string[]) {
  return readRowsWhere(sb, "id", ids);
}

/** Every lead that has ever opened a service card. */
export async function readCandidateIds(sb: Sb): Promise<string[] | "error"> {
  const got = await getAll(
    sb,
    `portal_events?select=lead_id&event=eq.${SERVICE_EVENT}&lead_id=not.is.null&order=created_at.asc,id.asc`,
  );
  if (!got.ok) return got.missing ? [] : "error";
  const ids = new Set<string>();
  for (const r of got.rows as Array<{ lead_id?: unknown }>) if (isUuid(r.lead_id)) ids.add(r.lead_id);
  return [...ids];
}

export async function readSignals(sb: Sb, leadIds: string[]): Promise<Map<string, LeadSignals> | "error"> {
  const map = new Map<string, LeadSignals>();
  for (const list of chunks(leadIds.filter(isUuid))) {
    const got = await getAll(
      sb,
      `portal_events?select=lead_id,event,props,created_at&lead_id=in.(${list.join(",")})` +
        `&event=in.(${SIGNAL_EVENTS.join(",")})&order=created_at.asc,id.asc`,
    );
    if (!got.ok) return "error";
    for (const r of got.rows as Array<{ lead_id?: unknown; event?: unknown; props?: Record<string, unknown> | null; created_at?: unknown }>) {
      if (!isUuid(r.lead_id)) continue;
      const s = map.get(r.lead_id) ?? emptySignals(r.lead_id);
      map.set(r.lead_id, s);
      const at = typeof r.created_at === "string" ? r.created_at : "";
      switch (r.event) {
        case SERVICE_EVENT: {
          const slug = typeof r.props?.service === "string" ? r.props.service.trim().toLowerCase() : "";
          if (!slug) break;
          s.serviceOpens[slug] = (s.serviceOpens[slug] ?? 0) + 1;
          if (at && (!s.firstServiceOpenAt || at < s.firstServiceOpenAt)) s.firstServiceOpenAt = at;
          break;
        }
        case INQUIRY_EVENT:
          s.inquiries += 1;
          break;
        case SENT_EVENT:
          if (at) s.sends.push(at);
          break;
        case HANDOFF_EVENT:
          s.handedOff = true;
          break;
        case ARCHIVE_EVENT:
          s.archived = true;
          break;
        case RETURN_EVENT: {
          s.returned = true;
          const note = typeof r.props?.note === "string" ? r.props.note.trim() : "";
          if (note) s.returnedNote = note;
          break;
        }
      }
    }
  }
  return map;
}

export async function readContacts(sb: Sb, leadIds: string[]): Promise<Map<string, LeadContact> | "error"> {
  const map = new Map<string, LeadContact>();
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  for (const list of chunks(leadIds.filter(isUuid))) {
    const got = await getAll(sb, `leads?select=id,name,category,website,emails&id=in.(${list.join(",")})&order=id.asc`);
    if (!got.ok) return "error";
    for (const r of got.rows as Array<Record<string, unknown>>) {
      if (!isUuid(r.id)) continue;
      const emails = Array.isArray(r.emails) ? r.emails.filter((x): x is string => typeof x === "string") : [];
      map.set(r.id, {
        business: str(r.name),
        category: str(r.category),
        website: str(r.website),
        email: bestEmail(emails),
        emails,
      });
    }
  }
  return map;
}

/** Master Client List + address/organisation opt-outs, per lead. The client
 *  check reads EVERY stored address, as the cold flow's does; a resemblance
 *  match is carried as a warning, never an exclusion. Opt-out lookups fail
 *  open (empty) exactly as the send route's do — and the send route re-checks
 *  inside deliverCampaign regardless. `sharedWith` is loadQueue's to fill. */
export async function readGuards(sb: Sb, contacts: Map<string, LeadContact>): Promise<Map<string, LeadGuard>> {
  const out = new Map<string, LeadGuard>();
  const prospects = [...contacts.entries()]
    .filter(([, c]) => c.email)
    .map(([leadId, c]) => ({ leadId, name: c.business, email: c.email, emails: c.emails, website: c.website }));
  const clientOf = new Map<string, string>();
  const warnOf = new Map<string, string>();
  const verdict = partitionByClientGuard(prospects, clientGuardData());
  for (const { prospect, match } of verdict.blocked) clientOf.set(prospect.leadId, match.clientName);
  for (const { prospect, match } of verdict.warned) warnOf.set(prospect.leadId, match.clientName);
  const emails = prospects.map((p) => (p.email as string).toLowerCase());
  const [suppressed, domains] = await Promise.all([
    fetchSuppressedEmails(sb.base, sb.key, emails),
    fetchSuppressedDomains(sb.base, sb.key, emails),
  ]);
  for (const p of prospects) {
    const email = (p.email as string).toLowerCase();
    const domain = organisationDomain(email);
    out.set(p.leadId, {
      client: clientOf.get(p.leadId) ?? null,
      optedOut: suppressed.has(email) || Boolean(domain && domains.has(domain)),
      sharedWith: null,
      clientWarning: warnOf.get(p.leadId) ?? null,
    });
  }
  return out;
}

export async function loadQueue(
  sb: Sb,
  opts: { leadIds?: string[]; now?: number } = {},
): Promise<{ ok: true; items: FollowUpQueueItem[] } | { ok: false; reason: "missing" | "error" }> {
  // ALL rows, even when only some leads are asked about: the address check
  // below has to see which OTHER leads already hold an address. The table is
  // small (at most two rows per hot lead). `leadIds` still limits which leads
  // are classified and returned.
  const rows = await readFollowUpRows(sb);
  if (rows === "missing" || rows === "error") return { ok: false, reason: rows };
  const rowLeads = [...new Set(rows.map((r) => r.lead_id))];

  let ids: string[];
  if (opts.leadIds) {
    ids = [...new Set(opts.leadIds.filter(isUuid))];
  } else {
    const candidates = await readCandidateIds(sb);
    if (candidates === "error") return { ok: false, reason: "error" };
    ids = [...new Set([...candidates, ...rowLeads])];
  }
  if (ids.length === 0) return { ok: true, items: [] };

  const [signals, contacts] = await Promise.all([
    readSignals(sb, ids),
    readContacts(sb, [...new Set([...ids, ...rowLeads])]),
  ]);
  if (signals === "error" || contacts === "error") return { ok: false, reason: "error" };
  const wanted = new Set(ids);
  const guards = await readGuards(sb, new Map([...contacts].filter(([id]) => wanted.has(id))));

  const rowsBy = new Map<string, FollowUpRow[]>();
  for (const r of rows) rowsBy.set(r.lead_id, [...(rowsBy.get(r.lead_id) ?? []), r]);

  // One address, one sequence. The scrape holds the same inbox under several
  // leads, so the lead whose live follow-up (draft, sending or sent) was
  // created first owns the address, and every OTHER lead with it is excluded.
  const owner = new Map<string, { leadId: string; business: string | null }>();
  const byAge = [...rows].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
  for (const r of byAge) {
    if (!HOLDS_ADDRESS.has(r.status)) continue;
    const c = contacts.get(r.lead_id);
    const email = c?.email?.toLowerCase();
    if (c && email && !owner.has(email)) owner.set(email, { leadId: r.lead_id, business: c.business });
  }

  const now = opts.now ?? Date.now();
  const items: FollowUpQueueItem[] = [];
  for (const id of ids) {
    const contact = contacts.get(id) ?? null;
    const held = contact?.email ? owner.get(contact.email.toLowerCase()) : undefined;
    const item = classifyLead({
      signals: signals.get(id) ?? emptySignals(id),
      contact,
      guard: {
        ...(guards.get(id) ?? NO_GUARD),
        sharedWith: held && held.leadId !== id ? (held.business ?? "another lead") : null,
      },
      rows: rowsBy.get(id) ?? [],
      now,
    });
    if (item) items.push(item);
  }
  return { ok: true, items: sortQueue(items) };
}

/** Insert or update the (lead_id, touch) row. Only the columns passed are
 *  written on conflict (PostgREST merge-duplicates).
 *
 *  `insertOnly` writes ONLY when no row exists yet (ignore-duplicates): an
 *  existing row, which may already have been sent or closed, is left alone and
 *  the answer is "conflict". null on failure. */
export async function writeFollowUp(
  sb: Sb,
  row: FollowUpWrite,
  opts: { insertOnly?: boolean } = {},
): Promise<FollowUpRow | null | "conflict"> {
  try {
    const res = await fetch(`${sb.base}/rest/v1/${TABLE}?on_conflict=lead_id,touch&select=${ROW_COLS}`, {
      method: "POST",
      headers: headers(sb.key, {
        "Content-Type": "application/json",
        Prefer: `resolution=${opts.insertOnly ? "ignore-duplicates" : "merge-duplicates"},return=representation`,
      }),
      body: JSON.stringify([{ ...row, updated_at: new Date().toISOString() }]),
    });
    if (!res.ok) {
      console.error(`[followups] write ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    const out = (await res.json().catch(() => null)) as FollowUpRow[] | null;
    if (!Array.isArray(out)) return null;
    if (opts.insertOnly && out.length === 0) return "conflict";
    return out[0] ?? null;
  } catch (e) {
    console.error("[followups] write failed:", e);
    return null;
  }
}

/** PATCH rows by id — only those still in `onlyStatus` when given (the
 *  optimistic guard that makes a double-send a no-op). null on failure. */
export async function patchFollowUps(
  sb: Sb,
  ids: string[],
  patch: FollowUpPatch,
  onlyStatus?: FollowUpStatus,
): Promise<FollowUpRow[] | null> {
  const list = ids.filter(isUuid);
  if (list.length === 0) return [];
  const status = onlyStatus ? `&status=eq.${onlyStatus}` : "";
  try {
    const res = await fetch(`${sb.base}/rest/v1/${TABLE}?id=in.(${list.join(",")})${status}&select=${ROW_COLS}`, {
      method: "PATCH",
      headers: headers(sb.key, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.error(`[followups] patch ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    return ((await res.json().catch(() => [])) as FollowUpRow[]) ?? [];
  } catch (e) {
    console.error("[followups] patch failed:", e);
    return null;
  }
}
