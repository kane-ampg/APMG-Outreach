import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, type Row } from "@/lib/portal/fakePostgrest";

/**
 * GET /api/portal/chats — the Telemetry tab's Chats view. Transcripts are what
 * visitors typed, so the gate matters as much as the grouping; and a console
 * that hasn't run supabase/portal-chats.sql must say "not recording yet"
 * rather than "nobody has chatted".
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
    requireLiveSupabase: () => null,
  };
});

import { DELETE, GET } from "./route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const CONVO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function req(opts: { key?: string; method?: string; query?: string } = {}): Request {
  return new Request(`http://localhost/api/portal/chats${opts.query ?? ""}`, {
    method: opts.method ?? "GET",
    headers: {
      origin: "http://localhost",
      host: "localhost",
      ...(opts.key === undefined ? { "x-portal-admin-key": "secret" } : opts.key ? { "x-portal-admin-key": opts.key } : {}),
    },
  });
}

let seq = 0;
function chatRow(extra: Row = {}): Row {
  seq += 1;
  return {
    id: `r${String(seq).padStart(4, "0")}`,
    conversation_id: CONVO,
    visitor_id: "v1",
    lead_id: null,
    business: null,
    category: null,
    campaign: null,
    source: null,
    question: `question ${seq}`,
    reply: `reply ${seq}`,
    outcome: "answered",
    ua: "Mozilla/5.0",
    created_at: new Date(Date.UTC(2026, 9, 1) + seq * 60_000).toISOString(),
    ...extra,
  };
}

beforeEach(() => {
  seq = 0;
  vi.unstubAllGlobals();
  process.env.PORTAL_ADMIN_KEY = "secret";
});

describe("GET /api/portal/chats", () => {
  it("refuses without the access key, and never touches the table", async () => {
    const pg = fakePostgrest({ portal_chats: [chatRow()] });
    vi.stubGlobal("fetch", vi.fn(pg.handler));
    const res = await GET(req({ key: "" }));
    expect(res.status).toBe(401);
    expect(pg.calls).toEqual([]);
  });

  it("says the migration is missing instead of showing an empty list", async () => {
    vi.stubGlobal("fetch", vi.fn(fakePostgrest({}).handler));
    const body = await (await GET(req())).json();
    expect(body).toMatchObject({ ok: true, mode: "demo", needsMigration: true, conversations: [] });
  });

  it("groups a chat in order and names the lead behind it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        fakePostgrest({
          portal_chats: [
            chatRow({ lead_id: LEAD, business: "Snapshot Name", category: "Schools" }),
            chatRow({ lead_id: LEAD, outcome: "limit" }),
            chatRow({ conversation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", source: "facebook" }),
          ],
          leads: [
            {
              id: LEAD,
              name: "St Mary's Primary",
              category: "Schools",
              bing_maps_url: "https://www.google.com/maps/place/x",
              source: null,
            },
          ],
        }).handler,
      ),
    );
    const body = await (await GET(req())).json();
    expect(body.mode).toBe("live");
    expect(body.conversations).toHaveLength(2);
    const [facebook, lead] = body.conversations;
    expect(facebook).toMatchObject({ channel: "facebook", business: null });
    expect(lead).toMatchObject({
      business: "St Mary's Primary",
      channel: "outreach",
      leadSource: "google",
      category: "Schools",
    });
    expect(lead.exchanges.map((e: { question: string }) => e.question)).toEqual(["question 1", "question 2"]);
    expect(lead.exchanges[1].outcome).toBe("limit");
  });
});

describe("DELETE /api/portal/chats", () => {
  it("rejects a conversation id that isn't one we mint", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await DELETE(req({ method: "DELETE", query: "?conversationId=eq.anything" }));
    expect(res.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("deletes exactly one conversation", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await DELETE(req({ method: "DELETE", query: `?conversationId=${CONVO}` }));
    expect(res.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://db.test/rest/v1/portal_chats?conversation_id=eq.${CONVO}`);
    expect(init.method).toBe("DELETE");
  });

  it("refuses without the access key", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const res = await DELETE(req({ method: "DELETE", key: "", query: `?conversationId=${CONVO}` }));
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
