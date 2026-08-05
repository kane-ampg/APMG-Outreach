// Server-only helpers shared by the Pipeline API routes.

/** CSRF floor: reject cross-origin browser writes/reads. NOT a substitute for
 *  real auth — the routes use the RLS-bypassing service role (see route files). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // same-origin requests / non-browser callers may omit it
  try {
    return new URL(origin).host === new URL(req.url).host;
  } catch {
    return false;
  }
}

/** Resolve the Supabase REST base + service key, or null when unset (demo mode).
 *  Returns "misconfigured" when a value is present but unusable. */
export function supabaseTarget():
  | { state: "demo" }
  | { state: "misconfigured" }
  | { state: "ok"; base: string; key: string } {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { state: "demo" };
  try {
    return { state: "ok", base: new URL(url).origin, key };
  } catch {
    return { state: "misconfigured" };
  }
}

/** Optional shared secret sent with every outbound n8n webhook POST. Set
 *  `N8N_WEBHOOK_SECRET` in the app's environment and add a matching Header Auth
 *  credential (header `x-apmg-secret`) on the n8n webhook node so anonymous
 *  callers can't trigger the automation (server-side page fetches + paid LLM
 *  calls). No secret set → no header (unauthenticated, as before). */
export function webhookAuthHeaders(): Record<string, string> {
  const secret = process.env.N8N_WEBHOOK_SECRET;
  return secret ? { "x-apmg-secret": secret } : {};
}

/** How a resolved webhook was configured: saved in app_settings from the
 *  Integrations tab, or from an environment variable. */
export type WebhookSource = "setting" | "env";
export type WebhookTarget =
  | { state: "demo" }
  | { state: "ok"; url: string; source: WebhookSource };

/** app_settings keys for the runtime-configurable n8n webhooks. Each webhook
 *  has a URL key and an on/off `_enabled` key (the Integrations tab toggle);
 *  when the toggle is off the resolver returns demo, i.e. the automation is
 *  paused and nothing is actually sent. */
export const SETTING_CAMPAIGN_WEBHOOK = "n8n_campaign_webhook_url";
export const SETTING_CAMPAIGN_ENABLED = "n8n_campaign_webhook_enabled";
export const SETTING_EMAIL_FINDER_WEBHOOK = "n8n_email_finder_webhook_url";
export const SETTING_EMAIL_FINDER_ENABLED = "n8n_email_finder_webhook_enabled";
/** Enquiry-notification integration: the n8n webhook that emails a landed portal
 *  enquiry to the operator, plus its on/off toggle. Managed on the Integrations
 *  tab like the others. NOTE: stored in app_settings (key/value) — no dedicated
 *  SQL migration needed, since these are single config values. */
export const SETTING_ENQUIRY_NOTIFY_WEBHOOK = "n8n_enquiry_notify_webhook_url";
export const SETTING_ENQUIRY_NOTIFY_ENABLED = "n8n_enquiry_notify_webhook_enabled";
/** app_settings key holding the address(es) enquiry notifications are emailed TO
 *  (set on the Integrations tab) — one address, or several as a comma-separated
 *  list, parsed by `lib/pipeline/notifyEmails.ts`. Still a scalar string, so it
 *  stays outside the JSON-blob convention used by `sector_playbooks`. Passed to
 *  the n8n notify workflow as `notifyTo` (one send, all recipients). */
export const SETTING_ENQUIRY_NOTIFY_EMAIL = "enquiry_notify_email";

/** app_settings key holding the Sector Playbooks config (JSON): per-sector
 *  category keywords + the uploaded KB markdown. Managed from the Sector
 *  Playbooks tab; read by the compose flow to ground the email per sector. */
export const SETTING_SECTOR_PLAYBOOKS = "sector_playbooks";

/** app_settings key holding the versioned legal documents (JSON): the current
 *  Terms & Conditions + Privacy Policy text and a `version` string. Read by the
 *  public portal (to show the exact text a customer agrees to) and pinned onto
 *  every recorded consent, so an acceptance can always be traced to the precise
 *  wording that was live at the time. Managed from the Legal Documents tab. */
export const SETTING_LEGAL_DOCS = "legal_docs";

/** Public Storage bucket holding the per-sector attachment PDFs (managed from
 *  the Sector Playbooks tab; the send flow attaches them by public URL, which
 *  the n8n Gmail node downloads). */
export const SECTOR_ASSETS_BUCKET = "sector-assets";

/** Resolve the n8n campaign-send webhook. A URL saved from the Integrations tab
 *  (app_settings) wins; otherwise the N8N_CAMPAIGN_WEBHOOK_URL env var; else
 *  demo mode (the send is simulated). When set, the Send Campaigns tab POSTs
 *  rendered outreach messages here for the automation to deliver. */
export function campaignWebhook(): Promise<WebhookTarget> {
  return resolveWebhook(SETTING_CAMPAIGN_WEBHOOK, SETTING_CAMPAIGN_ENABLED, "N8N_CAMPAIGN_WEBHOOK_URL");
}

/** Resolve the n8n enquiry-notification webhook (references/APMG Enquiry
 *  Notification.json). A URL saved from the Integrations tab wins; otherwise the
 *  N8N_ENQUIRY_NOTIFY_WEBHOOK_URL env var; else demo (no notification is sent).
 *  The enquiry route POSTs a landed enquiry here so the operator gets emailed. */
export function enquiryNotifyWebhook(): Promise<WebhookTarget> {
  return resolveWebhook(SETTING_ENQUIRY_NOTIFY_WEBHOOK, SETTING_ENQUIRY_NOTIFY_ENABLED, "N8N_ENQUIRY_NOTIFY_WEBHOOK_URL");
}

/** Resolve the n8n email-finder webhook (references/APMG Email Finder.json).
 *  A URL saved from the Integrations tab (app_settings) wins; otherwise the
 *  N8N_EMAIL_FINDER_WEBHOOK_URL env var; else demo mode (no scrape happens).
 *  When set, "Find emails" POSTs the selected website-only leads there — the
 *  automation fetches each lead's site + contact page and returns the best
 *  contact address it finds, which the app stores on the lead. */
export function emailFinderWebhook(): Promise<WebhookTarget> {
  return resolveWebhook(SETTING_EMAIL_FINDER_WEBHOOK, SETTING_EMAIL_FINDER_ENABLED, "N8N_EMAIL_FINDER_WEBHOOK_URL");
}

/** Setting override → env fallback → demo. Invalid URLs are ignored (logged).
 *  A configured webhook whose toggle is explicitly off resolves to demo too
 *  (paused). The toggle defaults ON, so a saved/env URL goes live immediately. */
async function resolveWebhook(settingKey: string, enabledKey: string, envVar: string): Promise<WebhookTarget> {
  let url = "";
  let source: WebhookSource = "setting";

  const saved = await readSetting(settingKey);
  if (saved && isValidUrl(saved)) {
    url = saved;
    source = "setting";
  } else {
    const env = process.env[envVar];
    if (env && isValidUrl(env)) {
      url = env;
      source = "env";
    } else if (env) {
      console.error(`[pipeline] ${envVar} is not a valid URL — falling back to demo.`);
    }
  }

  if (!url) return { state: "demo" };
  // toggle: absent/anything-but-"false" ⇒ enabled (default on)
  if ((await readSetting(enabledKey)) === "false") return { state: "demo" };
  return { state: "ok", url, source };
}

function isValidUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

const SETTINGS_TABLE = "app_settings";

/** Read one app_settings value with the service role. Returns null on any
 *  miss/error (demo mode, missing table, network) so callers degrade to env. */
export async function readSetting(key: string): Promise<string | null> {
  const target = supabaseTarget();
  if (target.state !== "ok") return null;
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${SETTINGS_TABLE}?key=eq.${encodeURIComponent(key)}&select=value&limit=1`,
      {
        headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json().catch(() => [])) as Array<{ value: string | null }>;
    const v = Array.isArray(rows) && rows[0] ? rows[0].value : null;
    return typeof v === "string" && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Upsert one app_settings value with the service role. Returns "ok",
 *  "demo" (Supabase not configured), "missing-table", or "error". */
export async function writeSetting(
  key: string,
  value: string,
): Promise<"ok" | "demo" | "missing-table" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  try {
    const res = await fetch(`${target.base}/rest/v1/${SETTINGS_TABLE}?on_conflict=key`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify([{ key, value, updated_at: new Date().toISOString() }]),
    });
    if (res.ok) return "ok";
    const detail = await res.text().catch(() => "");
    console.error(`[integrations] app_settings upsert ${res.status}:`, detail.slice(0, 500));
    if (res.status === 404 || /find the table|PGRST205/i.test(detail)) return "missing-table";
    return "error";
  } catch (e) {
    console.error("[integrations] app_settings upsert failed:", e);
    return "error";
  }
}

/** Delete one app_settings value (clears a saved override → env/demo fallback). */
export async function deleteSetting(key: string): Promise<"ok" | "demo" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${SETTINGS_TABLE}?key=eq.${encodeURIComponent(key)}`,
      {
        method: "DELETE",
        headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
      },
    );
    return res.ok ? "ok" : "error";
  } catch (e) {
    console.error("[integrations] app_settings delete failed:", e);
    return "error";
  }
}

/* ─────────────────────────  Storage (sector PDFs)  ───────────────────────── */

/** Encode each path segment but keep the slashes. */
function encodeObjectPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/** Public URL for an object in a public bucket. Null in demo mode. */
export function publicObjectUrl(bucket: string, path: string): string | null {
  const target = supabaseTarget();
  if (target.state !== "ok") return null;
  return `${target.base}/storage/v1/object/public/${bucket}/${encodeObjectPath(path)}`;
}

/** Upsert an object into a Storage bucket with the service role. `data` is the
 *  raw bytes — pass `await file.arrayBuffer()` from an upload route, or a
 *  Uint8Array (e.g. Ghostscript-compressed PDF bytes). */
export async function uploadObject(
  bucket: string,
  path: string,
  data: ArrayBuffer | Uint8Array,
  contentType: string,
): Promise<"ok" | "demo" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  try {
    const res = await fetch(`${target.base}/storage/v1/object/${bucket}/${encodeObjectPath(path)}`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": contentType,
        "x-upsert": "true",
        "cache-control": "3600",
      },
      // Cast: both ArrayBuffer and Uint8Array are valid BlobParts at runtime;
      // the union widens `buffer` to ArrayBufferLike which the DOM lib rejects.
      body: new Blob([data as BlobPart], { type: contentType }),
    });
    if (res.ok) return "ok";
    const detail = await res.text().catch(() => "");
    console.error(`[sector-playbooks] storage upload ${res.status}:`, detail.slice(0, 500));
    return "error";
  } catch (e) {
    console.error("[sector-playbooks] storage upload failed:", e);
    return "error";
  }
}

/** Delete an object from a Storage bucket. */
export async function deleteObject(bucket: string, path: string): Promise<"ok" | "demo" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  try {
    const res = await fetch(`${target.base}/storage/v1/object/${bucket}/${encodeObjectPath(path)}`, {
      method: "DELETE",
      headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
    });
    return res.ok ? "ok" : "error";
  } catch (e) {
    console.error("[sector-playbooks] storage delete failed:", e);
    return "error";
  }
}

/** Sentinel for the null/no-batch folder, used in query params + filters. */
export const UNGROUPED = "__ungrouped__";

/** Validate a batch ("folder") name. Allows leads-0001-… and similar; rejects
 *  anything that could break out of a PostgREST filter value. */
export function safeBatchName(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^[\w.-]{1,80}$/.test(t) ? t : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(v: unknown): v is string {
  return typeof v === "string" && UUID_RE.test(v);
}

/** True when a PostgREST error body indicates one of the later-added lead
 *  columns (`batch` from the folders feature, `category` from the AI-compose
 *  feature) is missing — i.e. the one-time migration hasn't been run yet. */
export function isMissingBatchColumn(detail: string): boolean {
  return /(batch|category)/i.test(detail) && /(does not exist|could not find|PGRST204)/i.test(detail);
}
