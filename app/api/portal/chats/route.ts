import {
  isMissingLinkedInColumn,
  isUuid,
  requireLiveSupabase,
  sameOrigin,
  supabaseTarget,
} from "@/lib/pipeline/server";
import { leadSource } from "@/lib/pipeline/source";
import {
  CHATS_MAX_CONVERSATIONS,
  groupChatRows,
  type ChatConversation,
  type ChatLeadInfo,
  type ChatRow,
} from "@/lib/data/chats";
import { CHAT_LOG_TABLE, isConversationId } from "@/lib/portal/chatLog";
import { isMissingPortalTable, MAX_ROWS_PER_READ, portalAdminAuthorized } from "@/lib/portal/server";

// GET /api/portal/chats — the Telemetry tab's Chats view: what visitors asked
// the portal's APMG Assistant and what it answered, grouped into
// conversations, each with who asked (the outreach lead's school / business
// when they came through a tracked email) and how they got there (Facebook,
// Google, LinkedIn, Outreach email, Direct / unknown, …). Rows are written by
// /api/portal/chat (lib/portal/chatLog) into portal_chats
// (supabase/portal-chats.sql).
//
// DELETE /api/portal/chats?conversationId=… — erase one chat (a test chat,
// or a visitor who asks to be forgotten). Transcript rows only, never a lead.
//
// SECURITY — transcripts are what people typed (a visitor may well type their
// phone number), and they name leads. Same gate as /api/portal/lead-activity:
// sameOrigin (CSRF floor) plus the PORTAL_ADMIN_KEY shared secret,
// deny-by-default when it's unset.
export const runtime = "nodejs";

/** The newest exchanges read. Chats are short (the quota stops a visitor at
 *  10 questions), so one PostgREST page reaches back a long way. The oldest
 *  chat in a full window may be missing its first questions — `windowFull`
 *  tells the page so. */
const WINDOW_ROWS = MAX_ROWS_PER_READ;

const CHAT_COLS =
  "id,conversation_id,visitor_id,lead_id,business,category,campaign,source,question,reply,outcome,created_at";

const LEAD_COLS = "id,name,category,bing_maps_url,source";
/** Before supabase/linkedin-source.sql: no `source` column, so LinkedIn leads
 *  can't be told apart — Google / Bing still resolve off the maps URL. */
const LEAD_COLS_LEGACY = "id,name,category,bing_maps_url";

const UNAUTHORIZED = {
  ok: false as const,
  error: process.env.PORTAL_ADMIN_KEY
    ? "Unauthorised — a valid access key is required."
    : "Unauthorised — set PORTAL_ADMIN_KEY on the server to enable chat transcripts.",
};

interface ChatsResponse {
  ok: boolean;
  mode: "live" | "demo";
  needsMigration?: boolean;
  error?: string;
  conversations: ChatConversation[];
  /** true when the read window filled — older chats exist beyond it */
  windowFull: boolean;
}

const EMPTY = { conversations: [] as ChatConversation[], windowFull: false };

function restGet(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
}

const text = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toRow(v: unknown): ChatRow | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const conversationId = text(o.conversation_id);
  const createdAt = text(o.created_at);
  if (!conversationId || !createdAt || typeof o.question !== "string") return null;
  return {
    conversation_id: conversationId,
    visitor_id: text(o.visitor_id),
    lead_id: isUuid(o.lead_id) ? o.lead_id : null,
    business: text(o.business),
    category: text(o.category),
    campaign: text(o.campaign),
    source: text(o.source),
    question: o.question,
    reply: typeof o.reply === "string" ? o.reply : "",
    outcome: text(o.outcome) ?? "answered",
    created_at: createdAt,
  };
}

/** Live names + lead origin for the leads in the window. Best-effort: leads
 *  turn over, and a miss just means the chat-time snapshot is shown. */
async function lookupLeads(base: string, key: string, ids: string[]): Promise<Map<string, ChatLeadInfo>> {
  const out = new Map<string, ChatLeadInfo>();
  if (ids.length === 0) return out;
  try {
    const query = (cols: string) => restGet(base, key, `leads?select=${cols}&id=in.(${ids.join(",")})`);
    let res = await query(LEAD_COLS);
    if (!res.ok) {
      let detail = await res.text().catch(() => "");
      if (isMissingLinkedInColumn(detail)) {
        res = await query(LEAD_COLS_LEGACY);
        detail = res.ok ? "" : await res.text().catch(() => "");
      }
      if (!res.ok) {
        console.error(`[portal/chats] leads lookup ${res.status}:`, detail.slice(0, 500));
        return out;
      }
    }
    const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !isUuid(row.id)) continue;
      out.set(row.id, {
        name: text(row.name),
        category: text(row.category),
        source: leadSource(text(row.bing_maps_url), text(row.source)),
      });
    }
  } catch (e) {
    console.error("[portal/chats] leads lookup failed:", e);
  }
  return out;
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", ...EMPTY, error: "Forbidden." }, { status: 403 });
  }
  const refused = requireLiveSupabase("portal/chats");
  if (refused) return refused;

  const target = supabaseTarget();
  if (target.state !== "ok") {
    // No database: nothing to show, and nothing secret to gate.
    return Response.json({ ok: true, mode: "demo", ...EMPTY } satisfies ChatsResponse);
  }
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, mode: "live", ...EMPTY }, { status: 401 });
  }

  try {
    const res = await restGet(
      target.base,
      target.key,
      `${CHAT_LOG_TABLE}?select=${CHAT_COLS}&order=created_at.desc,id.desc&limit=${WINDOW_ROWS}`,
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (isMissingPortalTable(res.status, detail)) {
        return Response.json({
          ok: true,
          mode: "demo",
          needsMigration: true,
          ...EMPTY,
        } satisfies ChatsResponse);
      }
      console.error(`[portal/chats] Supabase ${res.status}:`, detail.slice(0, 1000));
      return Response.json(
        { ok: false, mode: "live", ...EMPTY, error: "Couldn't read the chat transcripts." },
        { status: 502 },
      );
    }
    const raw = (await res.json().catch(() => null)) as unknown;
    const rows = (Array.isArray(raw) ? raw : []).map(toRow).filter((r): r is ChatRow => r !== null);
    const leadIds = [...new Set(rows.map((r) => r.lead_id).filter((id): id is string => id !== null))];
    const leads = await lookupLeads(target.base, target.key, leadIds);
    return Response.json({
      ok: true,
      mode: "live",
      conversations: groupChatRows(rows, leads, CHATS_MAX_CONVERSATIONS),
      windowFull: Array.isArray(raw) && raw.length >= WINDOW_ROWS,
    } satisfies ChatsResponse);
  } catch (e) {
    console.error("[portal/chats] read failed:", e);
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "Could not reach the database." },
      { status: 502 },
    );
  }
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }
  const target = supabaseTarget();
  if (target.state !== "ok") {
    return Response.json({ ok: false, error: "No database is connected." }, { status: 503 });
  }
  if (!portalAdminAuthorized(req)) {
    return Response.json(UNAUTHORIZED, { status: 401 });
  }
  const conversationId = new URL(req.url).searchParams.get("conversationId");
  // Validated before it goes anywhere near a PostgREST filter.
  if (!isConversationId(conversationId)) {
    return Response.json({ ok: false, error: "A valid conversationId is required." }, { status: 400 });
  }
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${CHAT_LOG_TABLE}?conversation_id=eq.${encodeURIComponent(conversationId)}`,
      {
        method: "DELETE",
        headers: { apikey: target.key, Authorization: `Bearer ${target.key}`, Prefer: "return=minimal" },
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[portal/chats] delete ${res.status}:`, detail.slice(0, 500));
      return Response.json({ ok: false, error: "Couldn't delete that chat." }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (e) {
    console.error("[portal/chats] delete failed:", e);
    return Response.json({ ok: false, error: "Could not reach the database." }, { status: 502 });
  }
}
