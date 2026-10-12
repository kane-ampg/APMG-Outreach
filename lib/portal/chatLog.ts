import "server-only";
import { createHash } from "node:crypto";
import { isUuid, supabaseTarget } from "@/lib/pipeline/server";
import { type ChatOutcome } from "@/lib/data/chats";
import {
  isInternalRequest,
  isMissingPortalTable,
  lookupLead,
  readAttribution,
} from "@/lib/portal/server";
import { resolveSource } from "@/lib/portal/source";
import type { ChatSlot } from "./chatQuota";
import { clientIp } from "./chatRateLimit";

/**
 * The chat transcript writer — one portal_chats row (supabase/portal-chats.sql)
 * per question the APMG Assistant receives, with the reply it got and who
 * asked: the outreach lead and their business when the visitor came through a
 * tracked email, plus the traffic source (facebook / google / linkedin / …).
 * Read back by /api/portal/chats for the Telemetry tab's Chats view.
 *
 * Kept apart from chatQuota's `chat_prompt` ledger on purpose: that row lives
 * in portal_events, which stays content-free. This table holds what people
 * typed, so it has its own migration and sits behind PORTAL_ADMIN_KEY.
 *
 * Best-effort by contract, like every telemetry write: a missing table or a
 * failed insert is logged and the visitor still gets their reply.
 */

export const CHAT_LOG_TABLE = "portal_chats";

/** The reply is already bounded by the model's token cap; this is the
 *  belt-and-braces clip so no row can carry an unbounded blob. */
const MAX_REPLY_CHARS = 4000;
const MAX_VISITOR_ID = 64;

/** Valid stored conversation ids: a client uuid, or the legacy fold below. */
const CONVERSATION_ID_RE = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|legacy-[0-9a-f]{24})$/i;

export function isConversationId(v: unknown): v is string {
  return typeof v === "string" && CONVERSATION_ID_RE.test(v);
}

/**
 * The chat this question belongs to. PortalChat mints a uuid per page load;
 * a browser still running a bundle from before that (cached across a deploy)
 * sends none, so its questions fold into one chat per browser per UTC day
 * rather than one chat per question.
 */
export function chatConversationId(raw: unknown, req: Request): string {
  if (isUuid(raw)) return raw.toLowerCase();
  const day = new Date().toISOString().slice(0, 10);
  const ua = req.headers.get("user-agent") ?? "";
  const hash = createHash("sha256").update(`${clientIp(req)}|${ua}|${day}`).digest("hex");
  return `legacy-${hash.slice(0, 24)}`;
}

/** The browser's localStorage visitor id, trimmed the way /api/portal/events
 *  trims it so the two tables can be matched on it. */
export function chatVisitorId(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim() ? raw.trim().slice(0, MAX_VISITOR_ID) : null;
}

/**
 * Where this visitor came from: the apmg_src cookie the proxy set on arrival
 * (a ?utm_source= tag or a recognised referring site), else a tag on the
 * portal page the chat was sent from — the request's Referer is that page,
 * which covers a visitor whose cookie never stuck. Null = untagged.
 */
export function chatTrafficSource(req: Request): string | null {
  const { source } = readAttribution(req);
  if (source) return source;
  const referer = req.headers.get("referer");
  if (!referer) return null;
  try {
    return resolveSource(new URL(referer).searchParams, null);
  } catch {
    return null;
  }
}

export interface ChatExchangeRecord {
  conversationId: string;
  visitorId: string | null;
  question: string;
  reply: string;
  outcome: ChatOutcome;
}

/** Warn about the missing table once per instance, not on every question. */
let warnedMissingTable = false;

/**
 * Store one exchange. `slot` is the quota slot when the route opened one — it
 * already validated the visitor's lead, so that lookup is reused; branches
 * that bail before the quota pass none and the lead is looked up here.
 *
 * Staff browsers (apmg_internal) are skipped, same rule as every telemetry
 * writer, so the Chats view is customers only.
 */
export async function recordChatExchange(
  req: Request,
  record: ChatExchangeRecord,
  slot?: ChatSlot,
): Promise<void> {
  if (isInternalRequest(req)) return;
  const target = supabaseTarget();
  if (target.state !== "ok") return;

  let lead: { id: string; name: string | null; category: string | null; campaign: string | null } | null =
    null;
  if (slot) {
    if (slot.identity.kind === "lead") {
      lead = {
        id: slot.identity.leadId,
        name: slot.lead?.name ?? null,
        category: slot.lead?.category ?? null,
        campaign: slot.identity.campaign,
      };
    }
  } else {
    // Only a lead that really exists is trusted: the cookie is client-supplied.
    const { leadId, campaign } = readAttribution(req);
    const found = leadId ? await lookupLead(target.base, target.key, leadId) : null;
    if (leadId && found) lead = { id: leadId, ...found, campaign };
  }

  try {
    const res = await fetch(`${target.base}/rest/v1/${CHAT_LOG_TABLE}`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        conversation_id: record.conversationId,
        visitor_id: record.visitorId,
        lead_id: lead?.id ?? null,
        business: lead?.name ?? null,
        category: lead?.category ?? null,
        campaign: lead?.campaign ?? null,
        source: chatTrafficSource(req),
        question: record.question,
        reply: record.reply.slice(0, MAX_REPLY_CHARS),
        outcome: record.outcome,
        ua: req.headers.get("user-agent")?.slice(0, 400) ?? null,
      }),
    });
    if (res.ok) return;
    const detail = await res.text().catch(() => "");
    if (isMissingPortalTable(res.status, detail)) {
      if (!warnedMissingTable) {
        warnedMissingTable = true;
        console.warn("[portal/chat] portal_chats is missing — run supabase/portal-chats.sql to record chats.");
      }
      return;
    }
    console.error(`[portal/chat] transcript insert ${res.status}:`, detail.slice(0, 300));
  } catch (e) {
    console.error("[portal/chat] transcript insert failed:", e);
  }
}
