import {
  COMPOSE_RATE,
  demoDraft,
  ensureLinkToken,
  isEmail,
  MAX_COMPOSE_LEADS,
  MAX_DRAFT_EMAILS,
  safeCampaignTag,
  type ComposeDraft,
  type ComposeLeadInput,
} from "@/lib/pipeline/campaign";
import { isUuid, sameOrigin } from "@/lib/pipeline/server";
import { serviceBySlug, type ServiceTemplate } from "@/lib/pipeline/services";
import { buildComposeKb, loadPlaybooks } from "@/lib/pipeline/sectorStore";
import { draftEmail } from "@/lib/ai/composeEmail";
import { COMPOSE_ANGLES } from "@/lib/ai/composePrompt";
import { loadComposePrompt, type ComposePromptConfig } from "@/lib/ai/composeStore";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// "Compose email": drafts a per-lead cold email in-app with the Claude API
// (lib/ai/composeEmail.ts), grounded in the sector knowledge base for the
// lead's CSV Category (general company file + the matched sector markdown; see
// lib/pipeline/sectorStore.ts). The CTA keeps the literal {{link}} token — the
// send route substitutes the tracked /t/<lead>?c= URL per recipient. Recipients
// come from the lead's stored (CSV) addresses; a lead can be hand-addressed in
// the review UI. Runs on Node.
//
// Delivery: with ANTHROPIC_API_KEY set, each lead is drafted live by Claude and
// falls back to the deterministic template (campaign.ts demoDraft) on any miss;
// with no key we return the template for every lead (demo mode) so the review
// UI is fully exercisable.
export const runtime = "nodejs";
// Leads are drafted through a small concurrency pool (one Claude call each) so
// a big request still takes minutes; give serverless deploys the platform max —
// and guarantee a response BEFORE it (SOFT_DEADLINE_MS below): the gateway
// 504ing a slow batch throws away every finished draft.
export const maxDuration = 300;
// Wall-clock budget for drafting. Past it, remaining leads ship as the
// deterministic template and the response returns — an honest partial (the
// client shows `drafted` as "N AI-written") beats a gateway timeout. Clients
// keep requests small anyway (campaign.ts COMPOSE_CHUNK_LEADS); this is the
// backstop for pathological 429 backoff chains on the org's rate tier.
const SOFT_DEADLINE_MS = (maxDuration - 60) * 1000;

const MAX_SUBJECT = 300;
const MAX_HTML = 20_000;

type ComposeMode = "live" | "demo" | "noop";

interface ComposeResult {
  ok: boolean;
  mode: ComposeMode;
  campaign?: string;
  results?: ComposeDraft[];
  /** how many leads Claude actually drafted (the rest are template fallbacks). */
  drafted?: number;
  /** retained for the client contract; always 0 now that we no longer scrape. */
  saved?: number;
  error?: string;
}

/** Whitelist a client lead → the fields the composer needs. Drops anything
 *  without a stable stored id and a name. */
function sanitizeLead(input: unknown): ComposeLeadInput | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!isUuid(id)) return null;
  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const emails = Array.isArray(o.emails)
    ? o.emails
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim().toLowerCase())
        .filter(isEmail)
        .slice(0, MAX_DRAFT_EMAILS)
    : [];
  return { id, name, website: str(o.website), category: str(o.category), emails };
}

/** Build a lead's reviewable draft: the deterministic template supplies the
 *  address fields (emails / email_source / best_email) and the fallback copy;
 *  a successful Claude draft overrides the subject + HTML. The CTA {{link}}
 *  token is guaranteed either way. */
async function draftForLead(
  lead: ComposeLeadInput,
  kb: string,
  promptCfg: ComposePromptConfig,
  angle: string,
  service: ServiceTemplate | null,
): Promise<{ draft: ComposeDraft; ai: boolean }> {
  const base = demoDraft(lead, service);
  const drafted = await draftEmail(
    { business: lead.name, category: lead.category, website: lead.website },
    kb,
    promptCfg,
    angle,
    service ? serviceFocusPrompt(service) : undefined,
  );
  if (!drafted) return { draft: base, ai: false };
  const subject = drafted.subject.slice(0, MAX_SUBJECT);
  const html = drafted.html.slice(0, MAX_HTML);
  if (!subject || !html) return { draft: base, ai: false };
  return { draft: { ...base, subject, html: ensureLinkToken(html) }, ai: true };
}

/** The campaign's service focus, appended to each lead's user message when a
 *  service template was picked on Step 2. Leads the email with that service
 *  while STILL tailoring to the recipient's sector — e.g. Flooring Services to
 *  a childcare centre becomes safe, soft, non-slip floors for the kids. */
function serviceFocusPrompt(svc: ServiceTemplate): string {
  return (
    `Service focus for this campaign: ${svc.name}. What it covers: ${svc.focus}\n` +
    `Lead the email with this service and make it the star of the pitch, but TAILOR it to the recipient's sector and the people who use their site every day ` +
    `(for example: flooring for an early learning centre is about safe, non-slip floors where children play; electrical for aged care is about safe, compliant power and lighting for residents). ` +
    `Mention APMG's other trades only briefly, as backup. The subject and the CTA anchor label must both fit this service and the recipient's sector.`
  );
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return json({ ok: false, mode: "noop", error: "Forbidden." }, 403);
  }

  const guard = await requirePermission(req, "campaigns.send");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, mode: "noop", error: "Invalid JSON body." }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const campaign = safeCampaignTag(b.campaign);
  if (!campaign) {
    return json({ ok: false, mode: "noop", error: "Invalid campaign tag — use letters, numbers, and dashes." }, 400);
  }

  // Optional service template (Step 2 picker). Unknown/absent slug → null →
  // the classic general multi-trade compose, unchanged.
  const service = serviceBySlug(typeof b.service === "string" ? b.service : null);

  const rawLeads = b.leads;
  if (!Array.isArray(rawLeads)) {
    return json({ ok: false, mode: "noop", error: "Expected { leads: [...] }." }, 400);
  }
  if (rawLeads.length > MAX_COMPOSE_LEADS) {
    return json(
      { ok: false, mode: "noop", error: `AI drafting works on up to ${MAX_COMPOSE_LEADS} leads per run — deselect some.` },
      413,
    );
  }

  const leads = rawLeads.map(sanitizeLead).filter((l): l is ComposeLeadInput => l !== null);
  if (leads.length === 0) {
    return json({ ok: false, mode: "noop", error: "No valid stored leads to compose for." }, 400);
  }

  // No API key → deterministic template for every lead (demo mode). Still fully
  // reviewable and sendable; just not AI-written.
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ ok: true, mode: "demo", campaign, results: leads.map((l) => demoDraft(l, service)), saved: 0 });
  }

  // Ground each draft in the sector KB for its Category (general company file +
  // the matched sector markdown; uploaded KB in Supabase wins over the repo
  // file). The editable prompt config (model + instructions + message template +
  // output schema) — loaded once per batch, from the compose_prompt singleton
  // if saved, else the in-code defaults.
  const promptCfg = await loadComposePrompt();
  const playbooks = await loadPlaybooks();
  // Memoize the KB per Category so the general company file isn't re-read from
  // disk once per lead, and same-Category leads get a byte-identical (and thus
  // cacheable) system prefix. Memoized as promises so concurrent workers on the
  // same category share one build instead of racing.
  const kbByCategory = new Map<string, Promise<string>>();
  const kbFor = (category: string | null | undefined): Promise<string> => {
    const key = (category ?? "").toLowerCase().trim();
    const hit = kbByCategory.get(key);
    if (hit !== undefined) return hit;
    const kb = buildComposeKb(category, playbooks);
    kbByCategory.set(key, kb);
    return kb;
  };

  // Draft through a small worker pool paced under a hard requests/minute
  // ceiling (COMPOSE_RATE — the ONE knob to open up after raising the Console
  // tier). Two layers of guard rail:
  //   1. CONCURRENCY workers, so a slow/backing-off call can't let the others
  //      race ahead. Kept low because wider pools just burn calls on 429s
  //      (observed live: 5 workers → half the batch falling back to template).
  //   2. A server-side rate gate: every call start is spaced by at least
  //      MIN_INTERVAL_MS via a shared "next allowed start" cursor, so the route
  //      provably never exceeds RPM no matter how fast calls return. This is
  //      the actual rate-limit guarantee; the SDK's per-request retries
  //      (composeEmail.ts) stay as a backstop for anything that still slips.
  // Same-sector leads still hit the cached KB system prefix after round one.
  // Results keep the input order.
  const CONCURRENCY = COMPOSE_RATE.CONCURRENCY;
  const results: ComposeDraft[] = new Array<ComposeDraft>(leads.length);
  let drafted = 0;
  let throttledMs = 0; // total wall-clock this run spent waiting on the gate
  let cursor = 0;
  const startedAt = Date.now();

  // Rate gate: monotonic timestamp of the earliest moment the next call may
  // start. Each worker claims its slot by advancing this before it awaits, so
  // the two workers can't both fire in the same instant — starts are serialized
  // to one per MIN_INTERVAL_MS across the whole pool.
  let nextSlot = startedAt;
  const rateGate = async (): Promise<void> => {
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + COMPOSE_RATE.MIN_INTERVAL_MS;
    const wait = slot - now;
    if (wait > 0) {
      throttledMs += wait;
      await new Promise((r) => setTimeout(r, wait));
    }
  };

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= leads.length) return;
      const lead = leads[i];
      // Out of wall-clock budget — template-fill the rest instantly so the
      // response beats the platform kill instead of 504ing the whole batch.
      // Checked before the gate so a backed-up gate queue drains to templates
      // rather than pushing the function past the deadline.
      if (SOFT_DEADLINE_MS - (Date.now() - startedAt) <= 0) {
        results[i] = demoDraft(lead, service);
        continue;
      }
      // Pace this call under the RPM ceiling before spending any budget on it.
      await rateGate();
      // Re-check the deadline: the gate may have made us wait.
      const remaining = SOFT_DEADLINE_MS - (Date.now() - startedAt);
      if (remaining <= 0) {
        results[i] = demoDraft(lead, service);
        continue;
      }
      // Rotate the writing angle per lead so same-sector emails in one batch
      // don't converge on a single shape (each draft is an independent call).
      const angle = COMPOSE_ANGLES[i % COMPOSE_ANGLES.length];
      // Cap the draft at the remaining budget too: one call grinding through
      // 429 backoffs must not carry the function past the deadline.
      const { draft, ai } = await withDeadline(
        draftForLead(lead, await kbFor(lead.category), promptCfg, angle, service),
        remaining,
        { draft: demoDraft(lead, service), ai: false },
      );
      results[i] = draft;
      if (ai) drafted += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, leads.length) }, worker));
  if (throttledMs > 0) {
    console.info(
      `[compose] paced ${leads.length} leads under ${COMPOSE_RATE.RPM} RPM; ` +
        `${Math.round(throttledMs / 1000)}s spent waiting on the rate gate.`,
    );
  }

  // Key set but every draft fell back to the template (bad key, outage, all
  // refusals) → report demo, so the UI flags "demo drafts" instead of passing
  // identical template copy off as per-lead AI writing.
  return json({ ok: true, mode: drafted > 0 ? "live" : "demo", campaign, results, drafted, saved: 0 });
}

/** Race `work` against a wall-clock budget, resolving with `fallback` when the
 *  budget runs out first. The abandoned draft settles (or is discarded with the
 *  function) harmlessly later — draftEmail never rejects. */
function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([work, cap]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function json(result: ComposeResult, status = 200): Response {
  return Response.json(result, { status });
}
