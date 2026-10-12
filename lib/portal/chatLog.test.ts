import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The transcript writer behind the Chats view: what gets stored for each
 * question, and — the part the tab exists for — who asked and where they came
 * from. Staff browsers must never land in it.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }) };
});

import { chatConversationId, chatTrafficSource, recordChatExchange } from "./chatLog";
import type { ChatSlot } from "./chatQuota";

const LEAD = "11111111-1111-4111-8111-111111111111";
const CONVO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UA = "Mozilla/5.0 (Windows NT 10.0) Chrome/130";

function req(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/portal/chat", {
    method: "POST",
    headers: { "user-agent": UA, "x-forwarded-for": "203.0.113.9", ...headers },
  });
}

const record = {
  conversationId: CONVO,
  visitorId: "v1",
  question: "Do you service schools in Geelong?",
  reply: "Yes — tap Enquire and the team will confirm.",
  outcome: "answered" as const,
};

/** Every POST body sent to portal_chats; GETs (the leads lookup) answer `leads`. */
function stub(leads: unknown[] = []) {
  const inserts: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "POST") {
        inserts.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 201 });
      }
      if (url.includes("/rest/v1/leads")) return Response.json(leads);
      return new Response("not found", { status: 404 });
    }),
  );
  return inserts;
}

beforeEach(() => vi.unstubAllGlobals());

describe("chatTrafficSource", () => {
  it("reads the apmg_src cookie the proxy set on arrival", () => {
    expect(chatTrafficSource(req({ cookie: "apmg_src=fb" }))).toBe("facebook");
  });
  it("falls back to a utm tag on the portal page the chat came from", () => {
    expect(chatTrafficSource(req({ referer: "https://customer.example/portal?utm_source=linkedin" }))).toBe(
      "linkedin",
    );
  });
  it("is null for a visitor who came straight to the link", () => {
    expect(chatTrafficSource(req({ referer: "https://customer.example/portal" }))).toBeNull();
  });
});

describe("chatConversationId", () => {
  it("keeps the client's uuid", () => {
    expect(chatConversationId(CONVO, req())).toBe(CONVO);
  });
  it("folds an old client's questions into one stable chat", () => {
    const a = chatConversationId(undefined, req());
    expect(a).toMatch(/^legacy-[0-9a-f]{24}$/);
    expect(chatConversationId("not-a-uuid", req())).toBe(a);
  });
});

describe("recordChatExchange", () => {
  it("stores the lead's business from the quota slot, with no second lookup", async () => {
    const inserts = stub();
    const slot = {
      identity: { kind: "lead", leadId: LEAD, campaign: "oct-schools", key: `lead:${LEAD}`, userRef: "x" },
      lead: { name: "St Mary's Primary", category: "Schools" },
    } as unknown as ChatSlot;
    await recordChatExchange(req({ cookie: "apmg_src=google" }), record, slot);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(inserts[0]).toMatchObject({
      conversation_id: CONVO,
      visitor_id: "v1",
      lead_id: LEAD,
      business: "St Mary's Primary",
      category: "Schools",
      campaign: "oct-schools",
      source: "google",
      question: record.question,
      reply: record.reply,
      outcome: "answered",
    });
  });

  it("looks the lead up itself when the route bailed before the quota", async () => {
    const inserts = stub([{ name: "Kew Childcare", category: "Childcare" }]);
    await recordChatExchange(req({ cookie: `apmg_ref=${LEAD}` }), { ...record, outcome: "fallback" });
    expect(inserts[0]).toMatchObject({ lead_id: LEAD, business: "Kew Childcare", outcome: "fallback" });
  });

  it("stores no lead when the cookie's lead doesn't exist", async () => {
    const inserts = stub([]);
    await recordChatExchange(req({ cookie: `apmg_ref=${LEAD}` }), record);
    expect(inserts[0]).toMatchObject({ lead_id: null, business: null });
  });

  it("skips staff browsers entirely", async () => {
    stub();
    await recordChatExchange(req({ cookie: "apmg_internal=1" }), record);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("never fails the chat when the table is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "PGRST205" }), { status: 404 })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(recordChatExchange(req(), record)).resolves.toBeUndefined();
    warn.mockRestore();
  });
});
