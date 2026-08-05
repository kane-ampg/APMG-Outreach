import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import {
  insertPortalEvents,
  isBotRequest,
  isInternalRequest,
  lookupLead,
  readAttribution,
  type PortalEventRow,
} from "@/lib/portal/server";

// POST /api/portal/events — the telemetry sink lib/telemetry.ts flushes to
// (point NEXT_PUBLIC_TELEMETRY_ENDPOINT at this path). Batches arrive via
// navigator.sendBeacon / fetch-keepalive as { source, visitorId?, events }.
// Each event is validated, enriched with the visitor's outreach attribution
// (apmg_ref cookie → lead + denormalized category), and inserted into
// portal_events. Server-side (keeps the service role key off the browser).
//
// This is fire-and-forget by design: sendBeacon can't read responses, so the
// route NEVER requires one — invalid events are skipped (not 400'd), storage
// failures are logged and answered 202 with accepted:0 rather than a 5xx that
// nothing would act on anyway.
export const runtime = "nodejs";

/** Reject oversized batches before parsing — the client flushes ≤50 tiny
 *  events per POST (MAX_BATCH in lib/telemetry.ts, matching
 *  MAX_EVENTS_PER_POST below), so anything near this is not our telemetry
 *  lib talking. */
const MAX_BODY_BYTES = 64 * 1024;
const MAX_EVENTS_PER_POST = 50;
const MAX_PROP_KEYS = 20;
const MAX_PROP_VALUE_LEN = 300;
/** Same shape lib/telemetry.ts generates (word chars, dots, dashes). */
const EVENT_NAME_RE = /^[\w.-]{1,60}$/;
/** Event names the contract reserves for SERVER-side emission (`/t/[id]` and
 *  the inquiries route). A client-submitted event with one of these names is a
 *  forgery attempt — accepting it would let anyone inflate the canonical
 *  funnel counts (/api/portal/summary) from curl — so it is skipped. */
const SERVER_RESERVED_EVENT_NAMES = new Set([
  "attribution_click",
  "portal_inquiry",
  "portal_consent_accept",
  // The chat-quota ledger (lib/portal/chatQuota) — forging it from the beacon
  // would let a visitor inflate (never reset) a lead's used-prompt count.
  "chat_prompt",
  // The send ledger (/api/pipeline/campaigns/send) — it gates the Sales queue
  // and the reports, so a forged row would fabricate outreach history.
  "email_sent",
  // The admin → Sales hand-off ledger (/api/sales/handoff) — it records an
  // OPERATOR decision, so nothing client-side may ever write it.
  "sales_handoff",
]);
/** Trust the browser clock only within a week of ours — beyond that the
 *  client_ts would poison time-series analysis, so store null instead. */
const MAX_CLIENT_CLOCK_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

/** Loose shape of one incoming client event (see TelemetryEvent in lib/telemetry.ts). */
type IncomingEvent = {
  name?: unknown;
  ts?: unknown;
  props?: unknown;
  view?: unknown;
};

/** Browser epoch-ms → ISO string, or null when absent/unbelievable. */
function clientTs(ts: unknown): string | null {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
  if (Math.abs(Date.now() - ts) > MAX_CLIENT_CLOCK_SKEW_MS) return null;
  return new Date(ts).toISOString();
}

/** Keep at most 20 sane props; values coerced + capped so one crafted event
 *  can't bloat the jsonb column. */
function sanitizeProps(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  let kept = 0;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= MAX_PROP_KEYS) break;
    if (!k || k.length > 60) continue;
    out[k] = String(v).slice(0, MAX_PROP_VALUE_LEN);
    kept += 1;
  }
  return out;
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ accepted: 0, mode: "live", error: "Forbidden." }, { status: 403 });
  }

  // OPERATOR TRAFFIC IS NOT TELEMETRY. A browser that has opened the admin
  // dashboard carries the apmg_internal cookie (middleware.ts) — accept-and-
  // drop its batches wholesale. Without this, an operator who test-clicked a
  // tracked /t/ link carries apmg_ref too, and their OWN portal browsing
  // (portal_view / portal_service_open — legit customer-journey names) would
  // be written into that lead's trail and the funnel totals. The in-app
  // inspector drawer is unaffected (it reads the client-side ring buffer).
  if (isInternalRequest(req)) {
    return Response.json({ accepted: 0, internal: true }, { status: 202 });
  }

  // BOT/SCANNER TRAFFIC IS NOT TELEMETRY. Email link-scanners and headless
  // crawlers that follow a tracked link can then load /portal and fire the
  // same portal_view/portal_service_open beacons a human would — accept-and-
  // drop them (same as internal) so automated fetching never inflates funnel
  // totals or writes into a lead's trail. Matched on User-Agent (isBotRequest).
  if (isBotRequest(req)) {
    return Response.json({ accepted: 0, bot: true }, { status: 202 });
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    // No Supabase configured — accept-and-drop so the client never retries.
    return Response.json({ accepted: 0, mode: "demo" }, { status: 202 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/events] SUPABASE_URL is not a valid URL.");
    return Response.json({ accepted: 0, mode: "live", error: "Telemetry sink is misconfigured." }, { status: 500 });
  }

  // Size gate: content-length first (cheap), then the actual text (headers lie).
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return Response.json({ accepted: 0, mode: "live", error: "Batch too large." }, { status: 413 });
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    return Response.json({ accepted: 0, mode: "live", error: "Unreadable body." }, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) {
    return Response.json({ accepted: 0, mode: "live", error: "Batch too large." }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return Response.json({ accepted: 0, mode: "live", error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const incoming = Array.isArray(b.events) ? (b.events as IncomingEvent[]) : [];
  const visitorId =
    typeof b.visitorId === "string" && b.visitorId.trim() ? b.visitorId.trim().slice(0, 64) : null;

  // Attribution: one cookie read + at most ONE lead lookup per batch — every
  // row in the batch belongs to the same visitor, so they share the enrichment.
  const { leadId, campaign, source } = readAttribution(req);
  const lead = leadId ? await lookupLead(target.base, target.key, leadId) : null;
  const category = lead?.category ?? null;
  const ua = req.headers.get("user-agent")?.slice(0, 400) ?? null;
  const referer = req.headers.get("referer")?.slice(0, 600) ?? null;

  const rows: PortalEventRow[] = [];
  for (const ev of incoming.slice(0, MAX_EVENTS_PER_POST)) {
    if (!ev || typeof ev !== "object") continue;
    // Skip (don't reject) malformed names — one bad event shouldn't sink a batch.
    if (typeof ev.name !== "string" || !EVENT_NAME_RE.test(ev.name)) continue;
    // Skip forged server-only names — those rows must only ever be inserted
    // by the server routes that own them, never from the public sink.
    if (SERVER_RESERVED_EVENT_NAMES.has(ev.name)) continue;
    // Traffic source is SERVER-owned: the apmg_src cookie (set by middleware
    // from ?utm_source= / a social Referer on /portal) is the only writer, so
    // a crafted beacon can't misfile traffic under a platform it didn't come
    // from — any client-supplied props.source is dropped either way.
    const props = sanitizeProps(ev.props);
    delete props.source;
    if (source) props.source = source;
    rows.push({
      event: ev.name,
      props,
      view: typeof ev.view === "string" && ev.view ? ev.view.slice(0, 80) : null,
      lead_id: leadId,
      campaign,
      category,
      visitor_id: visitorId,
      ua,
      referer,
      client_ts: clientTs(ev.ts),
    });
  }

  if (rows.length === 0) {
    return Response.json({ accepted: 0, mode: "live" }, { status: 202 });
  }

  const stored = await insertPortalEvents(target.base, target.key, rows);
  return Response.json({ accepted: stored ? rows.length : 0, mode: "live" }, { status: 202 });
}
