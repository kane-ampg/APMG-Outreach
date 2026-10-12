import { sourceLabel } from "@/lib/data/enquiries";
import { LEAD_SOURCES, type LeadSource } from "@/lib/pipeline/source";
import { DIRECT_SOURCE, OUTREACH_SOURCE } from "@/lib/portal/source";

/**
 * Portal chat transcripts: what visitors asked the "APMG Assistant" bubble on
 * /portal, grouped into conversations for the Telemetry tab's Chats view.
 *
 * Storage is supabase/portal-chats.sql (one row per question + reply), written
 * by lib/portal/chatLog from /api/portal/chat and read by /api/portal/chats.
 * This module is the shared middle: the shapes both sides agree on, and the
 * pure grouping / channel rules, so the route and the page can't drift. No
 * server or next imports — the Telemetry page imports it.
 */

/** How the assistant handled one question.
 *  answered — a real model reply.
 *  fallback — the model couldn't answer (no key, daily budget spent, API
 *             error) and the visitor got the "tap Enquire" nudge instead.
 *  limit    — the visitor's question allowance was already spent. */
export type ChatOutcome = "answered" | "fallback" | "limit";

export const CHAT_OUTCOMES: readonly ChatOutcome[] = ["answered", "fallback", "limit"];

export function isChatOutcome(v: unknown): v is ChatOutcome {
  return typeof v === "string" && (CHAT_OUTCOMES as readonly string[]).includes(v);
}

/** A lead origin worth naming — "unknown" is carried as null instead. */
export type KnownLeadSource = Exclude<LeadSource, "unknown">;

function knownLeadSource(v: unknown): KnownLeadSource | null {
  return typeof v === "string" && v !== "unknown" && (LEAD_SOURCES as readonly string[]).includes(v)
    ? (v as KnownLeadSource)
    : null;
}

/** How to reach the lead behind a chat, off its leads row (or the saved copy
 *  once the row is gone). Every field is optional — scraped rows are patchy. */
export interface ChatLeadContact {
  /** the named person — LinkedIn leads only */
  contactName: string | null;
  contactTitle: string | null;
  emails: string[];
  phone: string | null;
  website: string | null;
  address: string | null;
}

/** One question and the reply it got. */
export interface ChatExchange {
  question: string;
  reply: string;
  outcome: ChatOutcome;
  /** ISO-8601, when the question was asked */
  ts: string;
}

/** One chat: every exchange from one opening of the bubble on one page load. */
export interface ChatConversation {
  conversationId: string;
  /** the browser's localStorage id (portal_events.visitor_id) */
  visitorId: string | null;
  /** the outreach lead, when the visitor came through a tracked email */
  leadId: string | null;
  /** the lead's school / business name — live from leads, else the name it
   *  had when they chatted (leads turn over; the snapshot outlives the row) */
  business: string | null;
  category: string | null;
  campaign: string | null;
  /** where we GOT the lead (Google / Bing Maps scrape, LinkedIn list) — null
   *  for a visitor with no lead behind them, or when that's unknowable */
  leadSource: KnownLeadSource | null;
  /** how they reached the portal: a traffic slug (facebook, google, linkedin,
   *  instagram, a referring site…), OUTREACH_SOURCE, or DIRECT_SOURCE */
  channel: string;
  /** contact details when there's a lead behind the chat; null otherwise */
  contact: ChatLeadContact | null;
  /** "Chrome on Windows" — what they chatted from, off the User-Agent */
  device: string | null;
  startedAt: string;
  lastAt: string;
  /** chronological, oldest first */
  exchanges: ChatExchange[];
}

/** Where we got a lead, in words. Maps leads say Maps: "Google" alone would
 *  read as search traffic, which is the Source column's job. */
export const LEAD_ORIGIN_NAME: Record<KnownLeadSource, string> = {
  google: "Google Maps",
  bing: "Bing Maps",
  linkedin: "LinkedIn",
};

/** Who a chat was with: the lead's school / business when they came through
 *  an outreach email, else the door they came through. */
export function chatDisplayName(chat: Pick<ChatConversation, "business" | "leadId" | "channel">): string {
  if (chat.business) return chat.business;
  if (chat.leadId) return "Unattributed lead";
  if (chat.channel === DIRECT_SOURCE) return "Anonymous visitor";
  return `${sourceLabel(chat.channel)} visitor`;
}

/** Conversations the route sends — a review surface, not an export. */
export const CHATS_MAX_CONVERSATIONS = 200;

/**
 * Which door a chat came through. An outreach lead is "Outreach email" first —
 * the same rule the Lead activity table uses, so a lead never reads as
 * Facebook on one tab and Outreach on the other. Otherwise the traffic source
 * the proxy stamped (utm tag or referring site), else Direct / unknown: they
 * typed the link, were forwarded it, or their source cookie expired.
 */
export function chatChannel(source: string | null, leadId: string | null): string {
  if (leadId) return OUTREACH_SOURCE;
  return source ?? DIRECT_SOURCE;
}

/** A portal_chats row as the route reads it. */
export interface ChatRow {
  conversation_id: string;
  visitor_id: string | null;
  lead_id: string | null;
  business: string | null;
  category: string | null;
  campaign: string | null;
  source: string | null;
  question: string;
  reply: string;
  outcome: string;
  ua: string | null;
  created_at: string;
}

/** What the route's leads lookup resolves per lead id. */
export interface ChatLeadInfo {
  name: string | null;
  category: string | null;
  source: LeadSource;
  contact: ChatLeadContact;
}

/** Browser and platform off a User-Agent, in words — "Safari on iPhone".
 *  Order matters: Edge and Opera carry "Chrome", and Chrome carries "Safari".
 *  Null when neither half is recognisable. */
export function describeDevice(ua: string | null | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS/.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  const platform = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /Mac OS X|Macintosh/.test(ua)
            ? "Mac"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  if (browser && platform) return `${browser} on ${platform}`;
  return browser ?? platform;
}

/**
 * Fold exchange rows (any order) into conversations, newest-active first,
 * capped at `max`. Attribution is the first non-null value across a chat's
 * rows — it is stamped per question, and a cookie that lands mid-chat (or a
 * lead looked up on one question but not another) shouldn't blank it. A live
 * leads row beats the snapshot for the name and sector.
 */
export function groupChatRows(
  rows: readonly ChatRow[],
  leads: ReadonlyMap<string, ChatLeadInfo> = new Map(),
  max: number = CHATS_MAX_CONVERSATIONS,
): ChatConversation[] {
  const byId = new Map<string, ChatRow[]>();
  for (const row of rows) {
    if (!row.conversation_id) continue;
    const list = byId.get(row.conversation_id);
    if (list) list.push(row);
    else byId.set(row.conversation_id, [row]);
  }

  const conversations: ChatConversation[] = [];
  for (const [conversationId, list] of byId) {
    list.sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
    const first = <K extends keyof ChatRow>(key: K): ChatRow[K] | null => {
      for (const r of list) if (r[key] !== null && r[key] !== "") return r[key];
      return null;
    };
    const leadId = first("lead_id");
    const live = leadId ? leads.get(leadId) : undefined;
    conversations.push({
      conversationId,
      visitorId: first("visitor_id"),
      leadId,
      business: live?.name ?? first("business"),
      category: live?.category ?? first("category"),
      campaign: first("campaign"),
      leadSource: knownLeadSource(live?.source),
      channel: chatChannel(first("source"), leadId),
      contact: live?.contact ?? null,
      device: describeDevice(first("ua")),
      startedAt: list[0].created_at,
      lastAt: list[list.length - 1].created_at,
      exchanges: list.map((r) => ({
        question: r.question,
        reply: r.reply,
        outcome: isChatOutcome(r.outcome) ? r.outcome : "answered",
        ts: r.created_at,
      })),
    });
  }

  conversations.sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0));
  return conversations.slice(0, max);
}

/* ───────────────────────  client-side payload normaliser  ─────────────────────── */

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toContact(v: unknown): ChatLeadContact | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Partial<ChatLeadContact>;
  return {
    contactName: str(o.contactName),
    contactTitle: str(o.contactTitle),
    emails: (Array.isArray(o.emails) ? o.emails : []).filter(
      (e): e is string => typeof e === "string" && e.length > 0,
    ),
    phone: str(o.phone),
    website: str(o.website),
    address: str(o.address),
  };
}

function toExchange(v: unknown): ChatExchange | null {
  const o = (v ?? {}) as Partial<ChatExchange>;
  if (typeof o.question !== "string" || typeof o.ts !== "string") return null;
  return {
    question: o.question,
    reply: typeof o.reply === "string" ? o.reply : "",
    outcome: isChatOutcome(o.outcome) ? o.outcome : "answered",
    ts: o.ts,
  };
}

/** Rebuild one conversation field-by-field, so an odd payload can never leave
 *  an undefined array behind for the row to `.map`. A chat with no readable
 *  exchange has nothing to show and is dropped. */
export function toChatConversation(v: unknown): ChatConversation | null {
  const o = (v ?? {}) as Partial<ChatConversation>;
  if (typeof o.conversationId !== "string" || !o.conversationId) return null;
  const exchanges = (Array.isArray(o.exchanges) ? o.exchanges : [])
    .map(toExchange)
    .filter((e): e is ChatExchange => e !== null);
  if (exchanges.length === 0) return null;
  return {
    conversationId: o.conversationId,
    visitorId: str(o.visitorId),
    leadId: str(o.leadId),
    business: str(o.business),
    category: str(o.category),
    campaign: str(o.campaign),
    leadSource: knownLeadSource(o.leadSource),
    channel: str(o.channel) ?? DIRECT_SOURCE,
    contact: toContact(o.contact),
    device: str(o.device),
    startedAt: str(o.startedAt) ?? exchanges[0].ts,
    lastAt: str(o.lastAt) ?? exchanges[exchanges.length - 1].ts,
    exchanges,
  };
}
