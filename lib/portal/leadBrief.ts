/**
 * Reading one lead's BRIEF out of Supabase: the scraped lead row, plus the
 * click trail behind it.
 *
 * Two server surfaces need exactly the same two reads:
 *
 *   POST /api/portal/lead-summary  — the "AI Summary" button on the Sales desk
 *   lib/sales/handoffNotify        — the email that goes out when admin hands a
 *                                    lead to Sales
 *
 * They MUST agree. The email a rep gets and the brief they then open in the
 * console are claims about the same customer, and a rep who is told two
 * different stories stops trusting both. So the reads live here once, and both
 * callers feed the result to the same `buildLeadFacts` / `fallbackSummary`
 * pipeline in lib/data/enquiryActivity.
 *
 * Server-only: every function here takes the Supabase service-role key.
 */

import { bestEmail } from "@/lib/pipeline/campaign";
import { CUSTOMER_JOURNEY_EVENTS } from "@/lib/portal/server";
import type { LeadSubject } from "@/lib/data/enquiryActivity";
import type { LeadActivity, LeadActivityEvent } from "@/lib/data/leadActivity";
import { HANDOFF_EVENT } from "@/lib/sales/handoff";

/** The scraped lead row behind a Sales-queue brief. */
const LEAD_TABLE = "leads";
const LEAD_COLS = "id,name,category,website,phone,emails";

/** The one customer-journey allowlist (lib/portal/server), shared with
 *  /api/portal/lead-activity so the modal's trail, the summary's grounding
 *  facts and the hand-off email can never disagree with the Telemetry tab. */
const TRAIL_EVENTS = CUSTOMER_JOURNEY_EVENTS;

/** One lead's trail is small; this is a generous ceiling, not a page size. */
const EVENTS_LIMIT = 300;

export function restGet(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
}

/** Lift one string prop out of the raw jsonb (null for absent/non-string). */
function propStr(props: Record<string, unknown> | null, key: string): string | null {
  const v = props ? props[key] : undefined;
  return typeof v === "string" && v ? v : null;
}

type EventRow = {
  event?: unknown;
  props?: Record<string, unknown> | null;
  campaign?: unknown;
  category?: unknown;
  created_at?: unknown;
};

/**
 * Read one lead's trail and shape it exactly like a /api/portal/lead-activity
 * entry, so `buildEngagementFacts` sees the same thing on every path. Rows
 * arrive newest-first (the index order) and are reversed once at the end —
 * that's what makes firstSeen/lastSeen a plain first/last read.
 *
 * Best-effort: a trail that can't be read yields null, and the brief is written
 * from the lead row alone rather than the whole call failing. `label` names the
 * calling surface in the server log.
 */
export async function readTrail(
  base: string,
  key: string,
  leadId: string,
  business: string | null,
  category: string | null,
  label: string,
): Promise<LeadActivity | null> {
  const query =
    `portal_events?select=event,props,campaign,category,created_at&lead_id=eq.${leadId}` +
    `&event=in.(${TRAIL_EVENTS.join(",")})&order=created_at.desc&limit=${EVENTS_LIMIT}`;

  let res: Response;
  try {
    res = await restGet(base, key, query);
  } catch (e) {
    console.error(`[${label}] trail fetch failed:`, e);
    return null;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[${label}] trail read ${res.status}:`, detail.slice(0, 500));
    return null;
  }

  const raw = (await res.json().catch(() => [])) as EventRow[];
  const rows = Array.isArray(raw) ? raw : [];

  const newestFirst: LeadActivityEvent[] = [];
  const counts = { emailClicks: 0, portalViews: 0, serviceOpens: 0, inquiries: 0, chatPrompts: 0 };
  let campaign: string | null = null;
  let sector: string | null = category;

  for (const row of rows) {
    if (typeof row?.event !== "string" || typeof row.created_at !== "string") continue;
    if (!(TRAIL_EVENTS as readonly string[]).includes(row.event)) continue;

    if (campaign === null && typeof row.campaign === "string" && row.campaign) campaign = row.campaign;
    if (sector === null && typeof row.category === "string" && row.category) sector = row.category;

    if (row.event === "attribution_click") counts.emailClicks += 1;
    else if (row.event === "portal_view") counts.portalViews += 1;
    else if (row.event === "portal_service_open") counts.serviceOpens += 1;
    else if (row.event === "portal_inquiry") counts.inquiries += 1;
    else if (row.event === "chat_prompt") counts.chatPrompts += 1;

    newestFirst.push({
      event: row.event,
      service: propStr(row.props ?? null, "service"),
      destination: propStr(row.props ?? null, "destination"),
      version:
        propStr(row.props ?? null, "consent_version") ?? propStr(row.props ?? null, "version"),
      ts: row.created_at,
    });
  }

  if (newestFirst.length === 0) return null;

  return {
    leadId,
    business,
    category: sector,
    campaign,
    firstSeen: newestFirst[newestFirst.length - 1].ts,
    lastSeen: newestFirst[0].ts,
    events: newestFirst.reverse(), // → chronological ASC
    counts,
  };
}

/**
 * The Sales-queue subject: the scraped lead row, plus the stamp of when admin
 * handed it to the desk.
 *
 * Deliberately NOT gated on that hand-off existing. The callers already sit
 * behind their own gates, and admin views leads that were never handed over
 * (Hot Leads) — so a missing stamp just means the "handed over" line is omitted
 * from the brief, not that the read is refused.
 */
export async function readLeadSubject(
  base: string,
  key: string,
  leadId: string,
  label: string,
): Promise<LeadSubject | "missing" | "error"> {
  let res: Response;
  try {
    res = await restGet(base, key, `${LEAD_TABLE}?select=${LEAD_COLS}&id=eq.${leadId}&limit=1`);
  } catch (e) {
    console.error(`[${label}] lead fetch failed:`, e);
    return "error";
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[${label}] lead read ${res.status}:`, detail.slice(0, 500));
    return "error";
  }
  const rows = (await res.json().catch(() => [])) as Record<string, unknown>[];
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return "missing";

  // The hand-off stamp is context, not the record — a failed read costs the
  // brief one line rather than the whole summary.
  let handedOverAt: string | null = null;
  try {
    const stampRes = await restGet(
      base,
      key,
      `portal_events?select=created_at&event=eq.${HANDOFF_EVENT}&lead_id=eq.${leadId}` +
        `&order=created_at.asc&limit=1`,
    );
    if (stampRes.ok) {
      const stamps = (await stampRes.json().catch(() => [])) as Array<{ created_at?: unknown }>;
      const at = Array.isArray(stamps) ? stamps[0]?.created_at : null;
      if (typeof at === "string" && at) handedOverAt = at;
    }
  } catch {
    /* best effort — the brief reads fine without it */
  }

  const emails = Array.isArray(row.emails)
    ? (row.emails as unknown[]).filter((e): e is string => typeof e === "string")
    : [];
  const site = typeof row.website === "string" ? row.website : null;
  return {
    leadId,
    business: typeof row.name === "string" && row.name ? row.name : null,
    contactName: null,
    email: bestEmail(emails),
    phone: typeof row.phone === "string" && row.phone ? row.phone : null,
    website: site ? site.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || null : null,
    sector: typeof row.category === "string" && row.category ? row.category : null,
    campaign: null,
    handedOverAt,
  };
}
