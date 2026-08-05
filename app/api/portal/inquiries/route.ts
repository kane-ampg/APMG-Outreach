import {
  isUuid,
  sameOrigin,
  supabaseTarget,
  enquiryNotifyWebhook,
  readSetting,
  webhookAuthHeaders,
  SETTING_ENQUIRY_NOTIFY_EMAIL,
} from "@/lib/pipeline/server";
import {
  INQUIRY_STATUSES,
  insertPortalEvents,
  isBotRequest,
  isInternalRequest,
  isMissingColumn,
  isMissingPortalTable,
  lookupLead,
  portalAdminAuthorized,
  readAttribution,
  type InquiryStatus,
  type PortalInquiry,
} from "@/lib/portal/server";
import { loadLegalDocs } from "@/lib/legal/legalStore";
import { isPlaceholderLegal, isValidVersion } from "@/lib/legal/legalDocs";
import { parseNotifyEmails } from "@/lib/pipeline/notifyEmails";

// Portal enquiries — the lead-qualifying end of the services portal.
//   POST  — the ServiceInquiryModal submits here: honeypot-screened, validated,
//           enriched with the visitor's outreach attribution (apmg_ref cookie →
//           lead/business/category), stored in portal_inquiries, and mirrored
//           as the canonical `portal_inquiry` event in portal_events.
//   GET   — newest-first listing (limit 200) for the admin Enquiries tab.
//   PATCH — status workflow (new → contacted → closed) from the same tab.
//   DELETE— remove a single enquiry (operator test rows / spam) by ?id=.
// Server-side (keeps the service role key off the browser).
//
// SECURITY — POST is public by design (it's the customer form target, screened
// by honeypot + validation). GET/PATCH expose/mutate visitor PII, so on top of
// the sameOrigin (CSRF) floor they require the PORTAL_ADMIN_KEY shared secret
// (x-portal-admin-key header, entered once on the admin Enquiries tab). With
// no key configured, live-mode GET/PATCH are refused rather than left open —
// the portal invites external strangers to this origin, and the listing
// contains visitor emails and phone numbers. Replace with real per-user auth
// when a session lands.
export const runtime = "nodejs";

const TABLE = "portal_inquiries";
const LIST_LIMIT = 200;
const COLS =
  "id,service_slug,service_name,name,email,phone,message,lead_id,business,campaign,category,source,status,consent_version,created_at";
/** COLS minus `source` — the listing's fallback while the column migration
 *  (supabase/portal-telemetry.sql) hasn't been run yet. */
const LEGACY_COLS = COLS.replace(",source", "");

const SERVICE_RE = /^[a-z0-9-]{1,40}$/;
/** Mirrors the client-side check in ServiceInquiryModal. Rejects `?&=#` so a
 *  stored "email" can never smuggle mailto query params (subject=/body=
 *  header injection) into the admin's mail compose when the Enquiries tab
 *  renders it as a mailto: link. */
const EMAIL_RE = /^[^\s@?&=#]+@[^\s@?&=#]+\.[^\s@?&=#]+$/;
const MAX_EMAIL_LEN = 200;

/** 401 body shared by the PII-bearing handlers (GET listing / PATCH status). */
const UNAUTHORIZED = {
  ok: false as const,
  error: process.env.PORTAL_ADMIN_KEY
    ? "Unauthorised — a valid access key is required."
    : "Unauthorised — set PORTAL_ADMIN_KEY on the server to enable the enquiries listing.",
};

/** Optional free-text field: trim + cap, empty → null. Truncating (rather than
 *  rejecting) keeps a keen customer's long brief instead of bouncing them. */
function clip(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

/** DB row (snake_case) → the camelCase client shape. */
function toInquiry(row: Record<string, unknown>): PortalInquiry {
  const status = INQUIRY_STATUSES.includes(row.status as InquiryStatus)
    ? (row.status as InquiryStatus)
    : "new";
  return {
    id: String(row.id ?? ""),
    serviceSlug: String(row.service_slug ?? ""),
    serviceName: typeof row.service_name === "string" ? row.service_name : null,
    name: typeof row.name === "string" ? row.name : null,
    email: String(row.email ?? ""),
    phone: typeof row.phone === "string" ? row.phone : null,
    message: typeof row.message === "string" ? row.message : null,
    leadId: typeof row.lead_id === "string" ? row.lead_id : null,
    business: typeof row.business === "string" ? row.business : null,
    campaign: typeof row.campaign === "string" ? row.campaign : null,
    category: typeof row.category === "string" ? row.category : null,
    source: typeof row.source === "string" && row.source ? row.source : null,
    status,
    consentVersion: typeof row.consent_version === "string" ? row.consent_version : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // HONEYPOT: `website` is a visually-hidden field no human ever fills. A value
  // here means a bot — answer success WITHOUT storing so it can't tell it was
  // caught (and doesn't retry harder).
  if (typeof b.website === "string" && b.website.trim()) {
    return Response.json({ ok: true, mode: "live" });
  }

  const service = typeof b.service === "string" ? b.service.trim() : "";
  if (!SERVICE_RE.test(service)) {
    return Response.json({ ok: false, error: "Unknown service." }, { status: 400 });
  }
  const email = typeof b.email === "string" ? b.email.trim() : "";
  if (email.length > MAX_EMAIL_LEN || !EMAIL_RE.test(email)) {
    return Response.json({ ok: false, error: "Enter a valid email address." }, { status: 400 });
  }
  const name = clip(b.name, 120);
  const phone = clip(b.phone, 40);
  const message = clip(b.message, 2000);
  const serviceName = clip(b.serviceName, 80);

  // CONSENT (Privacy Act / APP 5, Spam Act): the enquirer must have agreed to
  // the Terms & Privacy Policy BEFORE we store their PII. This is the binding,
  // server-side gate — the client checkbox alone is unenforceable. We take the
  // version the client says it accepted and require it to match the version
  // currently published (loadLegalDocs), so a stale or forged tag can't be
  // recorded as valid consent. Fail-CLOSED: no valid, current consent → no
  // insert. (Demo mode has no DB/real traffic, so it is exempted below.)
  const acceptedVersion =
    typeof b.consentVersion === "string" ? b.consentVersion.trim() : "";

  const target = supabaseTarget();
  if (target.state === "demo") {
    // No Supabase — the modal still shows its thank-you state; nothing is lost
    // that existed (demo mode has no real traffic, nothing is stored).
    return Response.json({ ok: true, mode: "demo" });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/inquiries] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, error: "storage" }, { status: 500 });
  }

  // Resolve the currently-published legal version and enforce the match.
  const legal = await loadLegalDocs();
  if (isPlaceholderLegal(legal)) {
    // No lawyer-reviewed policy has been published yet — we must not be
    // collecting PII at all. Refuse rather than store without a real policy.
    console.error("[portal/inquiries] refused: no published legal docs (placeholder).");
    return Response.json(
      { ok: false, error: "consent_unavailable" },
      { status: 503 },
    );
  }
  if (!isValidVersion(acceptedVersion) || acceptedVersion !== legal.version) {
    // Missing / malformed / stale consent version → the customer has not
    // validly agreed to the CURRENT terms. Do not store their PII.
    return Response.json(
      { ok: false, error: "consent_required", currentVersion: legal.version },
      { status: 409 },
    );
  }
  // Non-prospect submission — keep the enquiry row so the flow stays testable
  // end-to-end (it's visible and deletable on the Enquiries tab), but strip
  // attribution and skip the canonical funnel event below so it never appears
  // in a lead's Telemetry trail or the enquiry totals. Two kinds:
  //  • internal — operator test submission (browser marked by middleware.ts).
  //  • bot — a scanner/script that somehow posted the form (belt & braces on
  //    top of the honeypot); its UA gives it away (isBotRequest).
  const internal = isInternalRequest(req) || isBotRequest(req);

  // Attribution enrichment: snapshot the lead's name + CSV category now (leads
  // get reimported/deleted, so a join-at-read-time would rot). `source` is the
  // traffic-source cookie (utm_source on the promoted portal link / social
  // Referer) — how we know an enquiry came from TikTok vs Facebook vs email.
  const { leadId, campaign, source } = internal
    ? { leadId: null, campaign: null, source: null }
    : readAttribution(req);
  const lead = leadId ? await lookupLead(target.base, target.key, leadId) : null;

  const inquiryRow: Record<string, unknown> = {
    service_slug: service,
    service_name: serviceName,
    name,
    email,
    phone,
    message,
    lead_id: leadId,
    business: lead?.name ?? null,
    campaign,
    category: lead?.category ?? null,
    source,
    // The pinned legal version the enquirer agreed to (validated to match
    // the current published version above) — the durable, server-side
    // consent record tied to this exact PII row.
    consent_version: legal.version,
  };
  const postRow = (body: Record<string, unknown>) =>
    fetch(`${target.base}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "return=representation", // we need the new row's id for the response
      },
      body: JSON.stringify([body]),
    });

  let res: Response;
  let failDetail = "";
  try {
    res = await postRow(inquiryRow);
    if (!res.ok) {
      failDetail = await res.text().catch(() => "");
      // `source` column not migrated in yet (supabase/portal-telemetry.sql) —
      // retry without it. Losing the enquiry over an analytics column is the
      // one outcome this route must never allow.
      if (isMissingColumn(failDetail)) {
        console.error(
          "[portal/inquiries] portal_inquiries.source column missing — run supabase/portal-telemetry.sql; storing without source.",
        );
        const legacyRow = { ...inquiryRow };
        delete legacyRow.source;
        res = await postRow(legacyRow);
        if (!res.ok) failDetail = await res.text().catch(() => "");
      }
    }
  } catch (e) {
    console.error("[portal/inquiries] insert fetch failed:", e);
    return Response.json({ ok: false, error: "storage" }, { status: 502 });
  }

  if (!res.ok) {
    console.error(`[portal/inquiries] Supabase insert ${res.status}:`, failDetail.slice(0, 1000));
    // The enquiry IS the lead — failing to store it is a real error (the modal
    // falls back to the mailto: link so the customer isn't lost).
    return Response.json({ ok: false, error: "storage" }, { status: 502 });
  }

  const rows = (await res.json().catch(() => [])) as Array<{ id?: unknown }>;
  const rawId = Array.isArray(rows) ? rows[0]?.id : undefined;
  const id = isUuid(rawId) ? rawId : null;

  // Canonical server-side count: one `portal_inquiry` event per stored enquiry
  // — skipped for internal (operator test) submissions so the funnel counts
  // clients only (the notification below still fires, so the whole flow stays
  // testable). Best-effort — the enquiry row above is the source of truth, so
  // a telemetry hiccup here is logged (inside insertPortalEvents) and
  // otherwise ignored.
  if (!internal) {
    const ua = req.headers.get("user-agent")?.slice(0, 400) ?? null;
    const referer = req.headers.get("referer")?.slice(0, 600) ?? null;
    // Traffic source rides in props on BOTH events, same as the beacon sink
    // stamps it — so the funnel aggregations can group by source uniformly.
    const sourceProp: Record<string, string> = source ? { source } : {};
    await insertPortalEvents(target.base, target.key, [
      {
        // The consent gate above proved this enquirer accepted the CURRENT
        // Privacy Policy & Terms — record that acceptance as its own event so
        // the lead's Telemetry trail shows it explicitly (the enquiry row's
        // consent_version column remains the authoritative record). Server-
        // emitted only: the name is in SERVER_RESERVED_EVENT_NAMES, so the
        // public sink rejects client forgeries of it.
        event: "portal_consent_accept",
        props: { service, consent_version: legal.version, scope: "enquiry", ...sourceProp },
        lead_id: leadId,
        campaign,
        category: lead?.category ?? null,
        ua,
        referer,
      },
      {
        event: "portal_inquiry",
        // consent_version rides in props so the canonical funnel event also
        // carries the accepted-terms version (queryable in the admin telemetry).
        props: { service, consent_version: legal.version, ...sourceProp },
        lead_id: leadId,
        campaign,
        category: lead?.category ?? null,
        ua,
        referer,
      },
    ]);
  }

  // Email the enquiry to the operator's configured notification address via the
  // n8n Enquiry Notification workflow. Entirely best-effort and fire-and-forget:
  // it must NEVER delay or fail the customer's thank-you (the enquiry is already
  // safely stored above). Silently skipped when no notify webhook or no address
  // is configured. Not awaited into the response path beyond a bounded timeout.
  void notifyOperator({
    to: (await readSetting(SETTING_ENQUIRY_NOTIFY_EMAIL)) ?? "",
    enquiry: {
      id,
      service: serviceName ?? service,
      name,
      email,
      phone,
      message,
      business: lead?.name ?? null,
      category: lead?.category ?? null,
      campaign,
      // Which platform sent them (tiktok / facebook / instagram / …) — the
      // n8n notification email can show it; absent field = untagged visit.
      source,
    },
  });

  return Response.json({ ok: true, mode: "live", id });
}

/** Fire the enquiry-notification webhook (n8n → Gmail). Best-effort: resolves
 *  the webhook + toggle, requires at least one configured `notifyTo` address
 *  (comma-separated list → ONE Gmail send addressed to all of them), and
 *  swallows every error so a notification problem can never affect the stored
 *  enquiry or the customer response. Bounded so a hung webhook can't wedge the
 *  request. */
async function notifyOperator(input: {
  to: string;
  enquiry: Record<string, unknown>;
}): Promise<void> {
  try {
    // Parse rather than just truthiness-check: a malformed stored value should
    // skip the send instead of POSTing junk that n8n silently drops (this whole
    // path returns 200 regardless, so a bad send is otherwise invisible).
    const parsed = parseNotifyEmails(input.to);
    if (!parsed.ok || parsed.emails.length === 0) return; // nothing set on the Integrations tab
    const target = await enquiryNotifyWebhook();
    if (target.state !== "ok") return; // demo / not configured / toggled off
    // Deliberately ONE request with every recipient joined, never one request
    // per address: a single Gmail send counts once against the 2,000
    // messages/day cap, whereas looping would multiply it and can lock the
    // sending mailbox out for up to 24h.
    await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...webhookAuthHeaders() },
      body: JSON.stringify({ notifyTo: parsed.value, enquiry: input.enquiry }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.error("[portal/inquiries] enquiry notification failed (non-fatal):", e);
  }
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", inquiries: [], error: "Forbidden." }, { status: 403 });
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", inquiries: [] });
  }
  // Live mode holds real visitor PII — require the admin access key.
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, mode: "live", inquiries: [] }, { status: 401 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/inquiries] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, mode: "live", inquiries: [], error: "Portal storage is misconfigured." }, { status: 500 });
  }

  const list = (cols: string) =>
    fetch(`${target.base}/rest/v1/${TABLE}?select=${cols}&order=created_at.desc&limit=${LIST_LIMIT}`, {
      headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
      cache: "no-store",
    });

  let res: Response;
  let detail = "";
  try {
    res = await list(COLS);
    if (!res.ok) {
      detail = await res.text().catch(() => "");
      // `source` column not migrated in yet — list without it (rows render
      // with no source chip) rather than failing the whole tab.
      if (isMissingColumn(detail)) {
        console.error(
          "[portal/inquiries] portal_inquiries.source column missing — run supabase/portal-telemetry.sql; listing without source.",
        );
        res = await list(LEGACY_COLS);
        if (!res.ok) detail = await res.text().catch(() => "");
      }
    }
  } catch (e) {
    console.error("[portal/inquiries] fetch to Supabase failed:", e);
    return Response.json({ ok: false, mode: "live", inquiries: [], error: "Could not reach the database." }, { status: 502 });
  }

  if (!res.ok) {
    console.error(`[portal/inquiries] Supabase ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      // Migration not run yet → answer demo so the admin tab shows the "run
      // supabase/portal-telemetry.sql" banner instead of a hard error.
      return Response.json({ ok: true, mode: "demo", needsMigration: true, inquiries: [] });
    }
    return Response.json({ ok: false, mode: "live", inquiries: [], error: "Couldn't read the enquiries table." }, { status: 502 });
  }

  const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const inquiries = Array.isArray(rows) ? rows.map(toInquiry) : [];
  return Response.json({ ok: true, mode: "live", inquiries });
}

export async function PATCH(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  if (!isUuid(b.id)) {
    return Response.json({ ok: false, error: "Invalid enquiry id." }, { status: 400 });
  }
  const status = typeof b.status === "string" ? b.status : "";
  if (!(INQUIRY_STATUSES as readonly string[]).includes(status)) {
    return Response.json({ ok: false, error: "Invalid status." }, { status: 400 });
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo" });
  }
  // Live mode mutates real enquiries — require the admin access key.
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, mode: "live" }, { status: 401 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/inquiries] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, error: "Portal storage is misconfigured." }, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch(`${target.base}/rest/v1/${TABLE}?id=eq.${encodeURIComponent(b.id)}`, {
      method: "PATCH",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ status }),
    });
  } catch (e) {
    console.error("[portal/inquiries] status PATCH failed:", e);
    return Response.json({ ok: false, error: "Could not reach the database." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[portal/inquiries] Supabase PATCH ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      return Response.json(
        { ok: false, needsMigration: true, error: "Run supabase/portal-telemetry.sql to create the enquiries table." },
        { status: 422 },
      );
    }
    return Response.json({ ok: false, error: "Couldn't update the enquiry." }, { status: 502 });
  }

  return Response.json({ ok: true, mode: "live" });
}

// Remove a single enquiry (?id=<uuid>) — for clearing operator test submissions
// and spam off the Enquiries tab. Deletes the portal_inquiries row only; any
// canonical portal_inquiry funnel event is left untouched (operator test rows
// never created one, and erasing a real customer's history is a separate,
// deliberate act via the Telemetry tab's activity delete). Same gates as
// GET/PATCH: sameOrigin floor + PORTAL_ADMIN_KEY shared secret — destroying a
// PII row is at least as sensitive as reading it.
export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    // Demo rows are a client-side constant (their ids aren't uuids) — nothing
    // to delete server-side; the tab drops the row locally.
    return Response.json({ ok: true, mode: "demo" });
  }

  const id = new URL(req.url).searchParams.get("id");
  // isUuid also makes the eq. interpolation safe (uuids never need quoting).
  if (!isUuid(id)) {
    return Response.json({ ok: false, error: "Invalid enquiry id." }, { status: 400 });
  }
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, mode: "live" }, { status: 401 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/inquiries] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, error: "Portal storage is misconfigured." }, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch(`${target.base}/rest/v1/${TABLE}?id=eq.${id}&select=id`, {
      method: "DELETE",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        Prefer: "return=representation", // so a vanished row still answers ok:true below
      },
    });
  } catch (e) {
    console.error("[portal/inquiries] delete fetch failed:", e);
    return Response.json({ ok: false, error: "Could not reach the database." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[portal/inquiries] Supabase DELETE ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      return Response.json(
        { ok: false, needsMigration: true, error: "Run supabase/portal-telemetry.sql to create the enquiries table." },
        { status: 422 },
      );
    }
    return Response.json({ ok: false, error: "Couldn't delete the enquiry." }, { status: 502 });
  }

  // Zero rows back = already gone (double-click, second tab) — that's still
  // the outcome the admin asked for, so it's ok:true either way.
  const rows = await res.json().catch(() => []);
  return Response.json({ ok: true, mode: "live", deleted: Array.isArray(rows) ? rows.length : 0 });
}
