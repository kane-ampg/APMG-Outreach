import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal/server")>();
  return {
    ...actual,
    fetchSuppressedEmails: async () => new Set<string>(),
    fetchSuppressedDomains: async () => new Map<string, string>(),
  };
});

import { loadQueue, patchFollowUps, readFollowUpRows, readSignals, writeFollowUp } from "./server";

const SB = { base: "https://sb.test", key: "k" };
const LEAD = "11111111-1111-4111-8111-111111111111";

/** Route PostgREST GETs by table/event to canned rows. */
function stubRest(routes: Array<[RegExp, unknown[] | number]>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = decodeURIComponent(String(url));
    for (const [re, body] of routes) {
      if (re.test(u)) {
        return typeof body === "number"
          ? new Response('{"code":"PGRST205","message":"Could not find the table"}', { status: body })
          : new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("[]", { status: 200 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("readSignals", () => {
  it("folds a lead's events into opens, first open, enquiries, sends and markers", async () => {
    stubRest([
      [
        /portal_events\?select=lead_id,event,props,created_at/,
        [
          { lead_id: LEAD, event: "email_sent", props: {}, created_at: "2026-09-20T00:00:00Z" },
          { lead_id: LEAD, event: "portal_service_open", props: { service: "Plumbing" }, created_at: "2026-09-20T00:05:00Z" },
          { lead_id: LEAD, event: "portal_service_open", props: { service: "plumbing" }, created_at: "2026-09-21T00:00:00Z" },
          { lead_id: LEAD, event: "sales_handoff", props: {}, created_at: "2026-09-22T00:00:00Z" },
        ],
      ],
    ]);
    const map = await readSignals(SB, [LEAD]);
    if (map === "error") throw new Error("read failed");
    const s = map.get(LEAD)!;
    expect(s.serviceOpens).toEqual({ plumbing: 2 });
    expect(s.firstServiceOpenAt).toBe("2026-09-20T00:05:00Z");
    expect(s.sends).toEqual(["2026-09-20T00:00:00Z"]);
    expect(s.handedOff).toBe(true);
    expect(s.archived).toBe(false);
    expect(s.returned).toBe(false);
    expect(s.returnedNote).toBeNull();
  });

  it("asks for sales_returned and folds it, keeping the rep's note", async () => {
    const fetchSpy = stubRest([
      [
        /portal_events\?select=lead_id,event,props,created_at/,
        [
          { lead_id: LEAD, event: "sales_returned", props: { note: "  we already work with them " }, created_at: "2026-09-22T00:00:00Z" },
          { lead_id: LEAD, event: "sales_returned", props: { note: "" }, created_at: "2026-09-23T00:00:00Z" },
        ],
      ],
    ]);
    const map = await readSignals(SB, [LEAD]);
    if (map === "error") throw new Error("read failed");
    expect(map.get(LEAD)).toMatchObject({ returned: true, returnedNote: "we already work with them" });
    expect(decodeURIComponent(String(fetchSpy.mock.calls[0][0]))).toContain("sales_returned");
  });

  it("marks a lead returned even when the rep left no note", async () => {
    stubRest([[/portal_events\?select=lead_id,event,props,created_at/, [{ lead_id: LEAD, event: "sales_returned", props: {}, created_at: "2026-09-22T00:00:00Z" }]]]);
    const map = await readSignals(SB, [LEAD]);
    if (map === "error") throw new Error("read failed");
    expect(map.get(LEAD)).toMatchObject({ returned: true, returnedNote: null });
  });
});

/** A fetch stub that serves `total` rows of `make(i)` in PostgREST pages
 *  (reading limit/offset off the URL), recording every URL it was asked for. */
function stubPaged(match: RegExp, total: number, make: (i: number) => unknown) {
  const urls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = decodeURIComponent(String(url));
    if (!match.test(u)) return new Response("[]", { status: 200 });
    urls.push(u);
    const limit = Number(/[?&]limit=(\d+)/.exec(u)?.[1] ?? total);
    const offset = Number(/[?&]offset=(\d+)/.exec(u)?.[1] ?? 0);
    const rows = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, k) => make(offset + k));
    return new Response(JSON.stringify(rows), { status: 200 });
  });
  return urls;
}

describe("paged reads (PostgREST caps a response at 1000 rows)", () => {
  it("reads follow_ups past the first 1000 rows, in a stable order", async () => {
    const urls = stubPaged(/follow_ups\?/, 1003, (i) => ({
      id: `row-${i}`, lead_id: LEAD, touch: 1, status: "sent", created_at: new Date(Date.UTC(2026, 8, 1) + i * 1000).toISOString(),
    }));
    const rows = await readFollowUpRows(SB);
    if (!Array.isArray(rows)) throw new Error("read failed");
    expect(rows).toHaveLength(1003);
    expect(rows.slice(-3).map((r) => r.id)).toEqual(["row-1000", "row-1001", "row-1002"]);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toMatch(/order=created_at\.asc,id\.asc&limit=1000&offset=0$/);
    expect(urls[1]).toMatch(/limit=1000&offset=1000$/);
  });

  it("folds a lead's newest events even when they land on page 2", async () => {
    const urls = stubPaged(/portal_events\?select=lead_id,event,props,created_at/, 1003, (i) =>
      i < 1000
        ? { lead_id: LEAD, event: "email_sent", props: {}, created_at: new Date(Date.UTC(2026, 7, 1) + i * 1000).toISOString() }
        : { lead_id: LEAD, event: "portal_inquiry", props: {}, created_at: `2026-09-2${i - 997}T00:00:00Z` },
    );
    const map = await readSignals(SB, [LEAD]);
    if (map === "error") throw new Error("read failed");
    expect(map.get(LEAD)?.sends).toHaveLength(1000);
    expect(map.get(LEAD)?.inquiries).toBe(3);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("order=created_at.asc,id.asc");
  });
});

const LEAD_B = "22222222-2222-4222-8222-222222222222";

/** Route the loadQueue reads; `leads` rows are served only for the ids asked for. */
function stubQueue(opts: {
  rows: unknown[];
  candidates: string[];
  events: unknown[];
  leads: Array<Record<string, unknown>>;
}) {
  const urls: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = decodeURIComponent(String(url));
    urls.push(u);
    const asked = /id=in\.\(([^)]*)\)/.exec(u)?.[1]?.split(",") ?? [];
    const body = /follow_ups\?/.test(u)
      ? opts.rows
      : /portal_events\?select=lead_id&event=eq.portal_service_open/.test(u)
        ? opts.candidates.map((lead_id) => ({ lead_id }))
        : /portal_events\?select=lead_id,event,props,created_at/.test(u)
          ? opts.events
          : /leads\?select=/.test(u)
            ? opts.leads.filter((r) => asked.includes(String(r.id)))
            : [];
    return new Response(JSON.stringify(body), { status: 200 });
  });
  return urls;
}

const opened = (lead: string) => ({ lead_id: lead, event: "portal_service_open", props: { service: "painting" }, created_at: "2026-09-20T00:05:00Z" });
const SENT_A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", lead_id: LEAD, touch: 1, status: "sent", sent_at: "2026-09-21T00:00:00Z", created_at: "2026-09-21T00:00:00Z" };

describe("loadQueue", () => {
  it("excludes a lead whose address already belongs to another lead's follow-up", async () => {
    const urls = stubQueue({
      rows: [SENT_A],
      candidates: [LEAD_B],
      events: [opened(LEAD), opened(LEAD_B)],
      leads: [
        { id: LEAD, name: "Acme Kinder", category: "Childcare", website: null, emails: ["office@shared.test"] },
        { id: LEAD_B, name: "Acme ELC", category: "Childcare", website: null, emails: ["Office@Shared.test"] },
      ],
    });
    const q = await loadQueue(SB, { leadIds: [LEAD_B], now: Date.parse("2026-09-25T02:00:00Z") });
    if (!q.ok) throw new Error("queue failed");
    // only the asked-for lead is classified and returned...
    expect(q.items.map((i) => i.leadId)).toEqual([LEAD_B]);
    expect(q.items[0]).toMatchObject({ stage: "excluded", reason: "Same address as Acme Kinder (already in follow-ups)" });
    // ...but every follow_ups row is read, and the owner's contact is fetched too
    expect(urls.find((u) => u.includes("follow_ups?"))).not.toContain("lead_id=in.");
    expect(urls.filter((u) => u.includes("leads?select=")).join(" ")).toContain(LEAD);
  });

  it("leaves the owning lead itself in its sequence", async () => {
    stubQueue({
      rows: [SENT_A],
      candidates: [LEAD, LEAD_B],
      events: [opened(LEAD), opened(LEAD_B)],
      leads: [
        { id: LEAD, name: "Acme Kinder", category: "Childcare", website: null, emails: ["office@shared.test"] },
        { id: LEAD_B, name: "Acme ELC", category: "Childcare", website: null, emails: ["office@shared.test"] },
      ],
    });
    const q = await loadQueue(SB, { now: Date.parse("2026-09-25T02:00:00Z") });
    if (!q.ok) throw new Error("queue failed");
    const by = new Map(q.items.map((i) => [i.leadId, i]));
    expect(by.get(LEAD)?.stage).toBe("waiting");
    expect(by.get(LEAD_B)?.reason).toBe("Same address as Acme Kinder (already in follow-ups)");
  });

  it("does not let a skipped follow-up claim the address", async () => {
    stubQueue({
      rows: [{ ...SENT_A, status: "skipped", sent_at: null }],
      candidates: [LEAD_B],
      events: [opened(LEAD_B)],
      leads: [
        { id: LEAD, name: "Acme Kinder", category: "Childcare", website: null, emails: ["office@shared.test"] },
        { id: LEAD_B, name: "Acme ELC", category: "Childcare", website: null, emails: ["office@shared.test"] },
      ],
    });
    const q = await loadQueue(SB, { leadIds: [LEAD_B], now: Date.parse("2026-09-25T02:00:00Z") });
    if (!q.ok) throw new Error("queue failed");
    expect(q.items[0]).toMatchObject({ leadId: LEAD_B, stage: "ready" });
  });

  it("excludes a lead whose SECONDARY address is a client's (all emails reach the guard)", async () => {
    stubQueue({
      rows: [],
      candidates: [LEAD],
      events: [opened(LEAD)],
      // Whittles is a real client on the bundled Master Client List
      leads: [{ id: LEAD, name: "Northside Body Corp", category: "Strata", website: null, emails: ["info@northside.test", "x@whittles.com.au"] }],
    });
    const q = await loadQueue(SB, { now: Date.parse("2026-09-25T02:00:00Z") });
    if (!q.ok) throw new Error("queue failed");
    expect(q.items[0].email).toBe("info@northside.test");
    expect(q.items[0]).toMatchObject({ stage: "excluded", reason: expect.stringMatching(/^Existing client \(/) });
  });

  it("reports a missing follow_ups table as 'missing'", async () => {
    stubRest([[/follow_ups\?/, 404]]);
    expect(await loadQueue(SB)).toEqual({ ok: false, reason: "missing" });
  });

  it("builds a ready item for a hot lead with a contact", async () => {
    stubRest([
      [/follow_ups\?/, []],
      [/portal_events\?select=lead_id&event=eq.portal_service_open/, [{ lead_id: LEAD }]],
      [
        /portal_events\?select=lead_id,event,props,created_at/,
        [{ lead_id: LEAD, event: "portal_service_open", props: { service: "painting" }, created_at: "2026-09-20T00:05:00Z" }],
      ],
      [/leads\?select=/, [{ id: LEAD, name: "Acme", category: "Childcare", website: "acme.test", emails: ["info@acme.test"] }]],
    ]);
    const q = await loadQueue(SB, { now: Date.parse("2026-09-25T02:00:00Z") });
    if (!q.ok) throw new Error("queue failed");
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ leadId: LEAD, stage: "ready", touch: 1, service: "painting", email: "info@acme.test" });
  });
});

describe("patchFollowUps", () => {
  it("issues PATCH with onlyStatus filter in URL and returns parsed rows", async () => {
    const rowUuid = "22222222-2222-4222-8222-222222222222";
    const mockRow = { id: rowUuid, lead_id: LEAD, touch: 1, status: "sent", created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:01:00Z" };
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([mockRow]), { status: 200 }));
    const result = await patchFollowUps(SB, [rowUuid], { status: "sent" }, "draft");
    expect(result).toEqual([mockRow]);
    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toContain("follow_ups");
    expect(String(url)).toContain(`id=in.(${rowUuid})`);
    expect(String(url)).toContain("status=eq.draft");
    expect(init?.method).toBe("PATCH");
    expect(init?.headers).toHaveProperty("Prefer", "return=representation");
    const body = JSON.parse(String(init?.body));
    expect(body).toHaveProperty("status", "sent");
    expect(body).toHaveProperty("updated_at");
  });

  it("omits status=eq. from URL when onlyStatus is not given", async () => {
    const rowUuid = "22222222-2222-4222-8222-222222222222";
    const mockRow = { id: rowUuid, lead_id: LEAD, touch: 1, status: "sent", created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:01:00Z" };
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([mockRow]), { status: 200 }));
    await patchFollowUps(SB, [rowUuid], { status: "sent" });
    const [url] = mock.mock.calls[0];
    expect(String(url)).not.toContain("status=eq.");
  });

  it("returns empty array and makes no fetch when id list is empty or non-uuids", async () => {
    const mock = vi.spyOn(globalThis, "fetch");
    const result1 = await patchFollowUps(SB, [], { status: "sent" });
    expect(result1).toEqual([]);
    expect(mock).not.toHaveBeenCalled();

    const result2 = await patchFollowUps(SB, ["not-a-uuid"], { status: "sent" });
    expect(result2).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
  });

  it("returns null on non-2xx response", async () => {
    const rowUuid = "22222222-2222-4222-8222-222222222222";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response('{"code":"ERROR"}', { status: 500 }));
    const result = await patchFollowUps(SB, [rowUuid], { status: "sent" });
    expect(result).toBeNull();
  });
});

describe("writeFollowUp", () => {
  it("POSTs with on_conflict merge and returns first row", async () => {
    const rowUuid = "33333333-3333-4333-8333-333333333333";
    const mockRow = { id: rowUuid, lead_id: LEAD, touch: 1, status: "draft", created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z" };
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([mockRow]), { status: 200 }));
    const result = await writeFollowUp(SB, { lead_id: LEAD, touch: 1, status: "draft" });
    expect(result).toEqual(mockRow);
    expect(mock).toHaveBeenCalledOnce();
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toContain("follow_ups");
    expect(String(url)).toContain("on_conflict=lead_id,touch");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toHaveProperty("Prefer", "resolution=merge-duplicates,return=representation");
    expect(init?.headers).toHaveProperty("Content-Type", "application/json");
    const body = JSON.parse(String(init?.body));
    expect(Array.isArray(body)).toBe(true);
    expect(body[0]).toHaveProperty("lead_id", LEAD);
    expect(body[0]).toHaveProperty("touch", 1);
    expect(body[0]).toHaveProperty("status", "draft");
    expect(body[0]).toHaveProperty("updated_at");
  });

  it("returns null on non-2xx response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response('{"code":"ERROR"}', { status: 500 }));
    const result = await writeFollowUp(SB, { lead_id: LEAD, touch: 1, status: "draft" });
    expect(result).toBeNull();
  });

  it("insertOnly ignores an existing (lead_id, touch) row instead of merging into it", async () => {
    const rowUuid = "33333333-3333-4333-8333-333333333333";
    const mockRow = { id: rowUuid, lead_id: LEAD, touch: 1, status: "draft", created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z" };
    const mock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(JSON.stringify([mockRow]), { status: 201 }));
    const result = await writeFollowUp(SB, { lead_id: LEAD, touch: 1, status: "draft" }, { insertOnly: true });
    expect(result).toEqual(mockRow);
    const [url, init] = mock.mock.calls[0];
    expect(String(url)).toContain("on_conflict=lead_id,touch");
    expect(init?.headers).toHaveProperty("Prefer", "resolution=ignore-duplicates,return=representation");
  });

  it("insertOnly reports 'conflict' when the row already existed (empty representation)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("[]", { status: 201 }));
    expect(await writeFollowUp(SB, { lead_id: LEAD, touch: 1, status: "draft" }, { insertOnly: true })).toBe("conflict");
  });

  it("an upsert (no insertOnly) still answers null, never 'conflict', on an empty body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("[]", { status: 201 }));
    expect(await writeFollowUp(SB, { lead_id: LEAD, touch: 1, status: "draft" })).toBeNull();
  });
});
