import "server-only";
import { createHash } from "node:crypto";
import { supabaseTarget } from "@/lib/pipeline/server";
import {
  insertPortalEvents,
  isMissingPortalTable,
  lookupLead,
  readAttribution,
} from "@/lib/portal/server";
import { PROMPT_LIMIT } from "./chatLimits";
import { clientIp } from "./chatRateLimit";

/**
 * Lifetime prompt quota for the PUBLIC portal chat (app/api/portal/chat) —
 * the "10 questions, then Enquire" allowance. Sits ON TOP of the per-IP
 * sliding-window limiter (./chatRateLimit): the window limiter stops bursts,
 * this module stops slow-drip abuse and turns the last prompt into the
 * lead-capture moment.
 *
 * IDENTITY — who a "visitor" is, strongest signal first:
 *   • lead — the visitor clicked a tracked outreach email (/t/[id]) and
 *     carries the httpOnly `apmg_ref` cookie, AND that uuid resolves to a real
 *     row in public.leads. The existence check matters: the cookie is
 *     client-supplied, so shape alone must never be trusted — otherwise
 *     rotating random uuids would mint a fresh allowance per request. Lead
 *     usage is counted DURABLY: one `chat_prompt` row per accepted prompt in
 *     portal_events (same server-canonical ledger pattern as `email_sent`),
 *     so the cap survives reloads and cold starts.
 *   • ip — everything else: no cookie, forged/stale cookie, operator browser
 *     (see openChatSlot opts), or Supabase not live. Counted in-memory per
 *     instance only (portal_events has no IP column, deliberately — an IP is
 *     PII-ish and a weak identity). Resets on cold start; the window limiter
 *     bounds the burn rate and the daily breaker bounds total spend.
 *
 * KNOWN RESIDUAL (accepted, spend-bounded): identity is cookie-derived, so a
 * visitor who clears `apmg_ref` (or self-sets `apmg_internal`) demotes
 * themselves to the shared IP bucket — one extra batch of PROMPT_LIMIT per
 * (IP, warm instance). Quota integrity degrades to that floor; SPEND stays
 * bounded by the window limiter and the daily breaker, which is the property
 * that actually protects the key.
 *
 * The ledger read/write is best-effort and DEGRADES to the in-memory counter
 * (never to "unlimited"): whichever count is HIGHER wins, so a failed insert
 * can't hand out extra prompts on the same instance.
 *
 * RACE NOTE: the memory check+reserve in openChatSlot is synchronous, so two
 * concurrent requests on the SAME instance can never both take the last slot.
 * Cross-instance (serverless) races on the count-then-insert ledger remain
 * possible; the overshoot is small and bounded by the window limiter, and
 * this is spend protection, not billing.
 */

/** Server-canonical portal_events name for one accepted chat prompt. Also
 *  listed in SERVER_RESERVED_EVENT_NAMES in /api/portal/events so the public
 *  beacon sink can never forge or inflate it. */
export const CHAT_PROMPT_EVENT = "chat_prompt";

export type ChatIdentity =
  | {
      kind: "lead";
      leadId: string;
      campaign: string | null;
      /** in-memory counter key */
      key: string;
      /** opaque per-user ref forwarded as Anthropic metadata.user_id */
      userRef: string;
    }
  | { kind: "ip"; ip: string; key: string; userRef: string };

/** One admitted (or refused) prompt slot, resolved by openChatSlot. */
export interface ChatSlot {
  allowed: boolean;
  /** prompts used BEFORE this one (max of durable ledger and memory) */
  used: number;
  /** true when this is the visitor's FINAL allowed prompt — the caller tells
   *  the model to close with the contact-details / Enquire CTA */
  finalTurn: boolean;
  /** prompts left AFTER this one is consumed (0 on the final prompt) */
  remaining: number;
  identity: ChatIdentity;
  /** leads-row snapshot when the identity is a validated lead — reused by
   *  recordChatPrompt so the ledger row is enriched without a second fetch */
  lead: { name: string | null; category: string | null } | null;
}

function ipIdentity(req: Request): ChatIdentity {
  const ip = clientIp(req);
  // Hash the IP for the provider-side ref — it only needs to be stable and
  // opaque so Anthropic's abuse tooling can group one caller's traffic.
  const hashed = createHash("sha256").update(ip).digest("hex").slice(0, 32);
  return { kind: "ip", ip, key: `ip:${ip}`, userRef: `ip:${hashed}` };
}

/* ── In-memory counter (sync gate for everyone; primary store for IPs) ────── */

/** identity key → prompts used on this warm instance. */
const memoryUsed = new Map<string, number>();
/** Bound the Map so a stream of unique identities can't grow it unbounded.
 *  Eviction is FIFO (oldest-inserted first) — coarse, but leads are protected
 *  by the durable ledger regardless, and evicted-IP abuse is still bounded by
 *  the window limiter and the daily breaker. */
const MAX_TRACKED_KEYS = 10_000;

function bumpMemory(key: string): void {
  if (memoryUsed.size >= MAX_TRACKED_KEYS && !memoryUsed.has(key)) {
    const oldest = memoryUsed.keys().next().value;
    if (oldest !== undefined) memoryUsed.delete(oldest);
  }
  memoryUsed.set(key, (memoryUsed.get(key) ?? 0) + 1);
}

/* ── Durable ledger (portal_events, attributed leads only) ────────────────── */

/** Count this lead's chat_prompt rows, capped at PROMPT_LIMIT (we never need
 *  more). Null on any miss (missing table, network, bad JSON) so the caller
 *  falls back to the in-memory count instead of failing the chat. */
async function countLedger(base: string, key: string, leadId: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${base}/rest/v1/portal_events?select=id&event=eq.${CHAT_PROMPT_EVENT}` +
        `&lead_id=eq.${encodeURIComponent(leadId)}&limit=${PROMPT_LIMIT}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (!isMissingPortalTable(res.status, detail)) {
        console.error(`[portal/chat] quota count ${res.status}:`, detail.slice(0, 300));
      }
      return null;
    }
    const rows = (await res.json().catch(() => null)) as unknown;
    return Array.isArray(rows) ? rows.length : null;
  } catch (e) {
    console.error("[portal/chat] quota count failed:", e);
    return null;
  }
}

/* ── Slot lifecycle ───────────────────────────────────────────────────────── */

function blockedSlot(
  identity: ChatIdentity,
  used: number,
  lead: ChatSlot["lead"],
): ChatSlot {
  return { allowed: false, used, finalTurn: false, remaining: 0, identity, lead };
}

/**
 * Resolve the caller's identity and claim one prompt slot.
 *
 * `ignoreAttribution` demotes the caller to the anonymous IP path — used for
 * operator browsers (apmg_internal cookie) so their testing is counted
 * in-memory against their IP, never against a real lead in the durable
 * ledger. Deliberately NOT a quota bypass: the internal cookie is a plain
 * unauthenticated marker anyone could set on themselves, so it must never
 * unlock spend — anonymous treatment gives it zero attack value (identical
 * to just clearing your cookies).
 *
 * The memory check+reserve is SYNCHRONOUS (no await between read and write),
 * so same-instance concurrent requests can't double-spend a slot. If the
 * caller aborts before the model call (e.g. daily budget raced to zero),
 * release the reservation with releaseChatSlot.
 */
export async function openChatSlot(
  req: Request,
  opts?: { ignoreAttribution?: boolean },
): Promise<ChatSlot> {
  const target = supabaseTarget();
  let identity: ChatIdentity | null = null;
  let lead: ChatSlot["lead"] = null;

  // Lead identity requires: not demoted, cookie uuid present, live Supabase,
  // AND the uuid resolving to a real lead. A lookup miss (forged or stale
  // cookie, deleted lead, transient error) falls through to the IP bucket —
  // strictly narrower, never wider.
  if (!opts?.ignoreAttribution && target.state === "ok") {
    const { leadId, campaign } = readAttribution(req);
    if (leadId) {
      lead = await lookupLead(target.base, target.key, leadId);
      if (lead) {
        const key = `lead:${leadId}`;
        identity = { kind: "lead", leadId, campaign, key, userRef: key };
      }
    }
  }
  identity ??= ipIdentity(req);

  // Synchronous gate + reserve.
  const memBefore = memoryUsed.get(identity.key) ?? 0;
  if (memBefore >= PROMPT_LIMIT) return blockedSlot(identity, memBefore, lead);
  bumpMemory(identity.key);

  let used = memBefore;
  if (identity.kind === "lead" && target.state === "ok") {
    const durable = await countLedger(target.base, target.key, identity.leadId);
    if (durable !== null && durable > used) used = durable;
    if (used >= PROMPT_LIMIT) {
      // Cache the durable exhaustion so future requests short-circuit on the
      // synchronous memory gate without another ledger read.
      memoryUsed.set(identity.key, used);
      return blockedSlot(identity, used, lead);
    }
    if (durable !== null && durable > memBefore) {
      // Align memory with the ledger (+1 for this reservation).
      memoryUsed.set(identity.key, durable + 1);
    }
  }

  return {
    allowed: true,
    used,
    finalTurn: used === PROMPT_LIMIT - 1,
    remaining: PROMPT_LIMIT - used - 1,
    identity,
    lead,
  };
}

/** Give back a reservation taken by openChatSlot when the request aborts
 *  before any model spend (e.g. the daily budget raced to exhaustion). */
export function releaseChatSlot(identity: ChatIdentity): void {
  const current = memoryUsed.get(identity.key) ?? 0;
  if (current > 0) memoryUsed.set(identity.key, current - 1);
}

/**
 * Write the durable `chat_prompt` ledger row for an admitted lead prompt.
 * Called BEFORE the model call (a crash mid-call must not hand out a free
 * retry); best-effort — the in-memory reservation already counts. The row is
 * deliberately content-free (message LENGTH only, never the text) — chat
 * transcripts are not telemetry and must never land in portal_events.
 */
export async function recordChatPrompt(
  slot: ChatSlot,
  req: Request,
  messageChars: number,
): Promise<void> {
  if (slot.identity.kind !== "lead") return;
  const target = supabaseTarget();
  if (target.state !== "ok") return;
  await insertPortalEvents(target.base, target.key, [
    {
      event: CHAT_PROMPT_EVENT,
      props: { chars: String(messageChars) },
      lead_id: slot.identity.leadId,
      campaign: slot.identity.campaign,
      category: slot.lead?.category ?? null,
      ua: req.headers.get("user-agent")?.slice(0, 400) ?? null,
      referer: req.headers.get("referer")?.slice(0, 600) ?? null,
    },
  ]);
}

/* ── Global daily circuit-breaker ─────────────────────────────────────────── */

/** Default model calls allowed per UTC day per instance. Override with
 *  PORTAL_CHAT_DAILY_CAP — an explicit 0 is honoured as a KILL SWITCH (no
 *  model calls at all); negative or unparsable values fall back to the
 *  default. At Haiku pricing with a 400-token reply cap this bounds
 *  worst-case daily spend to pocket change even if every other guardrail is
 *  somehow sidestepped. */
const DAILY_CAP_DEFAULT = 300;

let capDay = "";
let capUsed = 0;

function dailyCap(): number {
  const raw = Number(process.env.PORTAL_CHAT_DAILY_CAP);
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DAILY_CAP_DEFAULT;
}

function rollDay(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== capDay) {
    capDay = today;
    capUsed = 0;
  }
}

/** Peek: is the day's budget already gone? Lets the route bail out BEFORE
 *  claiming the visitor's prompt slot or touching Supabase. */
export function dailyBudgetExhausted(): boolean {
  rollDay();
  return capUsed >= dailyCap();
}

/**
 * Claim one slot from the instance-wide daily budget. False → the bubble
 * degrades to the enquiry-form nudge for the rest of the UTC day. In-memory
 * and per-instance (same launch-grade caveat as the window limiter), but it
 * is the backstop that turns "runaway abuse" into "bounded bill".
 */
export function takeDailySlot(): boolean {
  rollDay();
  if (capUsed >= dailyCap()) return false;
  capUsed += 1;
  return true;
}
