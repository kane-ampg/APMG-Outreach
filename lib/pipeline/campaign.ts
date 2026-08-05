// Outreach-campaign template + merge helpers, shared by the Send Campaigns tab
// (client preview) and the send route (server render). Pure and framework-free
// so the SAME render runs in the browser preview and on the server — what the
// admin previews is exactly what is sent.
//
// The copy mirrors the n8n "Send a message" Gmail node in
// references/Leadgen Automation.json: a short HTML email whose CTA links to the
// attribution hook /t/<leadId>?c=<campaign> (see app/t/[id]/route.ts).

import type { ServiceTemplate } from "./services";

/** Default tracking tag (the `?c=` value). Mirrors the n8n outreach campaign. */
export const DEFAULT_CAMPAIGN = "outreach-2026";

/** Default subject line. APMG sells property maintenance TO the recipient — not
 *  lead generation — so the copy pitches trusted, one-partner upkeep. */
export const DEFAULT_SUBJECT = "Your property maintenance, sorted by one local crew";

/**
 * Default HTML body. `{{business}}` and `{{link}}` are the two merge tokens:
 * the recipient's business name and the per-lead tracked CTA URL. Framed as
 * APMG's real offer — multi-trade property maintenance for the recipient's own
 * facility — never a lead-generation / "more customers" pitch. Copy mirrors the
 * live AI compose prompt's tone: natural Australian English, genuine intro, the
 * "who's the best person" ask, and the category-agnostic Aussie CTA label.
 */
export const DEFAULT_BODY_HTML = `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne-based property maintenance team covering painting, electrical, plumbing, carpentry, flooring, grounds and make safe works, all handled by one licensed local crew.</p>
<p>We work with businesses like yours to keep sites safe, compliant and well maintained, working around your day so the people who rely on your site aren't disrupted. Who's the best person to speak to about your site's maintenance and repairs?</p>
<p><a href="{{link}}">Your property, well looked after</a></p>
<p>The APMG Services team</p>`;

/** The merge tokens the composer documents to the user. */
export const MERGE_TOKENS = ["{{business}}", "{{link}}"] as const;

/** Hard cap on recipients per send (shared by the client gate + the route). */
export const MAX_RECIPIENTS = 1000;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Scraper junk that structurally looks like an email but never is one:
// versioned CDN paths ("react@18.2.0", "react@18.umd.min.js"), asset filenames
// ("logo@2x.png"), and bundler tokens that don't occur in real addresses. The
// n8n Email Finder filters these too, but n8n runs its saved copy — this
// app-side gate is the one that actually protects stored leads.
const ASSET_TLD_RE =
  /\.(js|mjs|cjs|css|map|json|png|jpe?g|gif|svg|webp|avif|ico|bmp|woff2?|ttf|otf|eot|mp[34]|webm|wasm|pdf|zip|gz|br|xml|txt|html?|php)$/i;
const JUNK_TOKEN_RE = /(^|[.@-])(umd|esm|cjs|polyfill|webpack|wixpress|sentry|unpkg|jsdelivr)([.@-]|$)/i;

export function isEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  const s = v.trim();
  if (!EMAIL_RE.test(s)) return false;
  const labels = s.slice(s.lastIndexOf("@") + 1).split(".");
  // a real TLD is alphabetic (rejects "react@18.2.0"), and no domain label is
  // a bare version number (rejects "lib@2.0.x")
  if (!/^[a-z]{2,24}$/i.test(labels[labels.length - 1])) return false;
  if (labels.some((l) => /^\d+$/.test(l))) return false;
  if (ASSET_TLD_RE.test(s) || JUNK_TOKEN_RE.test(s)) return false;
  return true;
}

// Role-based local-parts a human would reach first, best → worst.
const PREFERRED_LOCALPARTS = ["info", "contact", "sales", "hello", "office", "enquiries", "admin", "support"];

/** Addresses that bounce or nobody reads — never picked, never topped-up. */
const NO_REPLY_RE = /^(no-?reply|donotreply|bounce)@/i;

/**
 * Pick the single best address to contact a business — prefers a role inbox
 * (info@, contact@, sales@…), skips no-reply addresses, else the first listed.
 * Mirrors the intent of the n8n "best_contact_email" extraction step.
 */
export function bestEmail(emails: readonly string[] | null | undefined): string | null {
  const list = (emails ?? []).map((e) => e.trim()).filter(Boolean);
  if (list.length === 0) return null;
  const usable = list.filter((e) => !NO_REPLY_RE.test(e));
  const pool = usable.length ? usable : list;
  for (const p of PREFERRED_LOCALPARTS) {
    const hit = pool.find((e) => e.toLowerCase().startsWith(`${p}@`));
    if (hit) return hit;
  }
  return pool[0];
}

/** When a send resolves fewer than this many addresses (one best address per
 *  lead), the recipient list is topped up with the alternate stored addresses
 *  of leads that have more than one email — a small audience still reaches
 *  every inbox we know about. At or above this count, one email per lead. */
export const MIN_SEND_EMAILS = 50;

/**
 * A lead's remaining usable addresses for the top-up: valid, not a no-reply
 * inbox, and not already in `used` (lowercased) — so the best address, and any
 * address another lead already claimed, is never mailed twice. Order preserved
 * from the stored list; the set is NOT mutated (callers own that).
 */
export function alternateEmails(
  emails: readonly string[] | null | undefined,
  used: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of emails ?? []) {
    const e = raw.trim();
    const key = e.toLowerCase();
    if (!isEmail(e) || NO_REPLY_RE.test(e)) continue;
    if (used.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}

/** Validate a campaign tag used in the `?c=` tracking param and PostgREST-safe. */
export function safeCampaignTag(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return /^[\w-]{1,60}$/.test(t) ? t : null;
}

/** Coerce free text into a valid campaign tag (lowercase, dashed). */
export function slugifyCampaign(v: string): string {
  return v
    .toLowerCase()
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Per-lead tracked CTA URL: <base>/t/<leadId>?c=<campaign>. */
export function trackedLink(base: string, leadId: string, campaign: string): string {
  const root = base.replace(/\/+$/, "");
  return `${root}/t/${encodeURIComponent(leadId)}?c=${encodeURIComponent(campaign)}`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Guarantee no em/en dash reaches an outgoing email, whatever the source (AI
 * draft, shared template, or the deterministic fallback — the model can ignore
 * the "no em dashes" instruction, and old stored drafts predate it). Handles the
 * literal characters and their HTML entities. Because it runs at the shared
 * render choke point, the browser preview and the sent email stay identical.
 *   · a dash opening a paragraph/line (e.g. a "— Sign-off") is dropped
 *   · any other dash (spaced parenthetical or tight) becomes a comma
 * Regular hyphens ("-", e.g. "multi-trade") are left untouched.
 */
export function stripDashes(s: string): string {
  return s
    .replace(/&mdash;|&ndash;|&#8212;|&#8211;|&#x201[34];/gi, "—")
    .replace(/(^|>)\s*[–—―]+\s*/g, "$1")
    .replace(/\s*[–—―]+\s*/g, ", ");
}

/** Render the HTML body, substituting both merge tokens. `business` is escaped
 *  (it lands in HTML); `link` is a URL we built ourselves, inserted verbatim. */
export function renderBody(template: string, vars: { business?: string | null; link: string }): string {
  const business = escapeHtml((vars.business ?? "").trim() || "there");
  const html = template.split("{{business}}").join(business).split("{{link}}").join(vars.link);
  return stripDashes(html);
}

/** Render the subject line. Plain text (an email header), so no HTML escaping. */
export function renderSubject(template: string, vars: { business?: string | null }): string {
  const business = (vars.business ?? "").trim() || "there";
  return stripDashes(template.split("{{business}}").join(business));
}

/**
 * Flatten a rendered HTML body to plain text for the send webhook, so the n8n
 * Gmail node owns all formatting. Anchors keep BOTH their label and href as
 * `label (url)` — the tracked /t/<lead> link is content, not styling, and
 * attribution breaks without it. Block tags become line breaks and the entities
 * our copy uses are decoded to real characters.
 */
export function htmlToText(html: string): string {
  return html
    // links → "label (url)"; the tracked URL must survive into the text
    .replace(/<a\b[^>]*\bhref="([^"]*)"[^>]*>(.*?)<\/a>/gis, "$2 ($1)")
    // block-level tags → line breaks
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    // drop any remaining tags
    .replace(/<[^>]+>/g, "")
    // decode the entities our templates / AI drafts use (&amp; last)
    .replace(/&nbsp;/gi, " ")
    .replace(/&rarr;/gi, "→")
    .replace(/&rsquo;|&#8217;|&#x2019;/gi, "’")
    .replace(/&lsquo;|&#8216;|&#x2018;/gi, "‘")
    .replace(/&rdquo;|&#8221;|&#x201d;/gi, "”")
    .replace(/&ldquo;|&#8220;|&#x201c;/gi, "“")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    // tidy whitespace: no trailing spaces, collapse blank-line runs
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ────────────────────────  AI compose (per-lead drafts)  ───────────────────────
 * The "Compose email" action drafts a per-lead subject + HTML body in-app with
 * the Claude API (lib/ai/composeEmail.ts, via app/api/pipeline/campaigns/compose),
 * grounded in the sector knowledge base for the lead's CSV Category. Addresses
 * come from the lead's stored emails. Drafts keep the {{link}} token — the send
 * route substitutes the tracked URL per recipient.
 */

/**
 * Rate-limit guard rail for AI drafting. Each lead is one Claude call to Opus,
 * and Anthropic rate-limits requests/minute per account tier — a campaign that
 * fires faster than the tier allows trips 429s and (after retries) silently
 * ships those leads as the deterministic template. This is the single ceiling
 * the compose route paces itself under so that can't happen:
 *
 *   RPM  — max Claude calls started per rolling minute. Set to ~70% of the
 *          account's Opus requests-per-minute (Console → Settings → Limits),
 *          leaving headroom for SDK retries and any other traffic on the key.
 *          After raising the tier in the Console, raise this ONE number.
 *   CONCURRENCY — in-flight calls at once. Kept low so a slow/backing-off call
 *          doesn't let the others race ahead of the RPM budget.
 *
 * MIN_INTERVAL_MS (derived) is the minimum spacing between call starts the
 * route enforces server-side — the actual guarantee (see the compose route),
 * not something the client is trusted to honour.
 */
export const COMPOSE_RATE = {
  RPM: 20,
  CONCURRENCY: 2,
  get MIN_INTERVAL_MS(): number {
    return Math.ceil(60_000 / this.RPM);
  },
} as const;

/** Hard cap on leads per compose run — each lead costs one Claude call, and
 *  the org's API tier only allows a few requests/minute, so big batches take
 *  minutes regardless of pool width. The client submits a run as
 *  COMPOSE_CHUNK_LEADS-sized requests, so this cap bounds the reviewed batch,
 *  not a single HTTP request. */
export const MAX_COMPOSE_LEADS = 50;

/** Leads per compose REQUEST. A whole run in one request outlives the
 *  serverless gateway (observed: 34 leads → 504 at maxDuration, every draft
 *  lost), so the client (SendCampaigns) POSTs a run as chunks this size, back
 *  to back: each request finishes comfortably inside the timeout, progress
 *  lands chunk by chunk, and a failed chunk resumes without re-drafting the
 *  leads already done. 8 ≈ four rounds of the route's 2-worker pool. */
export const COMPOSE_CHUNK_LEADS = 8;

/** Hard cap on leads per "Find emails" run — the n8n Email Finder fetches two
 *  pages per lead sequentially, so a large batch would outlive the webhook
 *  round-trip. Mirrored by the workflow (it slices to 50 server-side too). */
export const MAX_FIND_LEADS = 50;

/** Max stored addresses shown for one lead in the review UI. */
export const MAX_DRAFT_EMAILS = 10;

/** A lead as handed to the composer. */
export interface ComposeLeadInput {
  id: string;
  name: string;
  website?: string | null;
  category?: string | null;
  emails?: string[] | null;
}

/** Where a draft's addresses came from. */
export type DraftEmailSource = "csv" | "scraped" | "none";

/** One per-lead draft (Claude-written, or the deterministic template fallback). */
export interface ComposeDraft {
  id: string;
  business: string;
  category: string | null;
  url: string | null;
  emails: string[];
  email_source: DraftEmailSource;
  best_email: string | null;
  subject: string;
  html: string;
}

/** Guarantee the draft body carries the {{link}} CTA token the send route
 *  rewrites per lead — without it the click is untracked and Sales never
 *  sees the engagement. */
export function ensureLinkToken(html: string): string {
  if (html.includes("{{link}}")) return html;
  return `${html}\n<p><a href="{{link}}">Your property, well looked after</a></p>`;
}

/** Map a raw CSV Category to the sector wording APMG actually uses in Australian
 *  copy, lowercased so it sits naturally mid-sentence ("aged care facilities",
 *  not "Elderly Care facilities"). Keeps the deterministic template from echoing
 *  awkward or non-Australian scraper labels verbatim. First match wins. */
const SECTOR_ALIASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/retirement/i, "retirement living"],
  [/elderly|senior|nursing\s*home|\baged\b/i, "aged care"],
  [/child\s*care|day\s*care|early\s*learning|kindergarten|kinder|pre-?school|childcare/i, "early learning"],
  [/school|education|college|university/i, "education"],
  [/strata|body\s*corporate|owners\s*corp/i, "body corporate and strata"],
  [/medical|health|clinic|dental|hospital|aged\s*care\s*nursing/i, "healthcare"],
  [/warehouse|industrial|factory|logistics|manufactur/i, "industrial"],
  [/retail|shopping|store/i, "retail"],
  [/hospitality|hotel|motel|restaurant|cafe|venue/i, "hospitality"],
];

/** Resolve the sector phrase used in the template's "We keep ___ facilities"
 *  line: an APMG-preferred Australian term when the category matches an alias,
 *  otherwise the raw category (lowercased, trailing "services" stripped), or a
 *  neutral fallback when there's no category. */
function sectorPhrase(category: string | null): string {
  const c = (category ?? "").trim();
  if (!c) return "commercial and residential";
  for (const [re, phrase] of SECTOR_ALIASES) if (re.test(c)) return phrase;
  return c.replace(/\s*services?\s*$/i, "").trim().toLowerCase() || "commercial and residential";
}

/** Build the tailored, short-and-crisp Australian CTA button label from a lead's
 *  category — the deterministic mirror of the AI instruction's CTA rule, so the
 *  template fallback reads the same as a Claude draft. Reuses sectorPhrase() for
 *  the Aussie sector wording; a few sectors read better with a bespoke phrasing.
 *  Kept under ~5 words, sentence case, no trailing arrow (the n8n branded button
 *  appends its own → and the app preview needs no arrow). */
export function ctaLabel(category: string | null): string {
  const c = (category ?? "").trim();
  if (!c) return "Your property, well looked after";
  const sector = sectorPhrase(c);
  switch (sector) {
    case "aged care":
    case "retirement living":
      return "Aged care upkeep, sorted";
    case "early learning":
      return "Childcare centre, well maintained";
    case "education":
      return "Keep your school site sorted";
    case "healthcare":
      return "Healthcare property, sorted";
    case "body corporate and strata":
      return "Strata maintenance, sorted";
    case "industrial":
      return "Keep your site sorted";
    case "retail":
      return "Retail fit-out, well maintained";
    case "hospitality":
      return "Venue upkeep, sorted";
    case "commercial and residential":
      return "Your property, well looked after";
    default: {
      // Title-case the sector for a readable "<Sector> upkeep, sorted".
      const label = sector.charAt(0).toUpperCase() + sector.slice(1);
      return `${label} upkeep, sorted`;
    }
  }
}

/** Deterministic per-lead draft used as the fallback (no ANTHROPIC_API_KEY, or
 *  a Claude miss) and as the base the composer overrides — mirrors the composer's
 *  shape and rules (tailored opening paragraph, {{link}} CTA, APMG sign-off) so
 *  the review UI is always exercisable. When a service template is selected
 *  (Step 2 Compose), the fallback is that service's shared template instead of
 *  the generic multi-trade copy, so a Claude miss still pitches the right
 *  service. */
export function demoDraft(lead: ComposeLeadInput, service?: ServiceTemplate | null): ComposeDraft {
  const emails = (lead.emails ?? []).map((e) => e.trim().toLowerCase()).filter(isEmail).slice(0, MAX_DRAFT_EMAILS);
  const category = (lead.category ?? "").trim() || null;
  const trade = sectorPhrase(category);
  const business = escapeHtml(lead.name.trim() || "there");
  if (service) {
    return {
      id: lead.id,
      business: lead.name,
      category,
      url: lead.website ?? null,
      emails,
      email_source: emails.length ? "csv" : "none",
      best_email: bestEmail(emails),
      subject: service.subject.slice(0, 120),
      html: service.html.split("{{business}}").join(business),
    };
  }
  const html =
    `<p>Hi ${business},</p>` +
    `<p>APMG Services is a Melbourne-based multi-trade property maintenance partner covering painting, electrical, plumbing, carpentry, flooring, grounds and property make-safe, all handled by one licensed team. ` +
    `We keep ${escapeHtml(trade)} facilities like yours safe, compliant and well maintained, working around your operations so the people who rely on them are never disrupted. ` +
    `Whether it&rsquo;s scheduled upkeep or an urgent repair, you get one reliable partner instead of chasing multiple contractors.</p>` +
    `<p><a href="{{link}}">${escapeHtml(ctaLabel(category))}</a></p>` +
    `<p>The APMG Services team</p>`;
  return {
    id: lead.id,
    business: lead.name,
    category,
    url: lead.website ?? null,
    emails,
    email_source: emails.length ? "csv" : "none",
    best_email: bestEmail(emails),
    subject: `${lead.name}, your property maintenance, sorted`.slice(0, 120),
    html,
  };
}
