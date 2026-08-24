import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Sales hand-off notification. These tests pin the properties that decide
 * whether the desk trusts this email: it goes out ONCE per hand-off, it never
 * goes out with nobody configured to receive it, it can never fail the hand-off
 * that triggered it, and every fact in it is one the app read back itself.
 */

vi.mock("server-only", () => ({}));

vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    readSetting: vi.fn(),
    salesNotifyWebhook: vi.fn(),
    webhookAuthHeaders: () => ({ "x-apmg-secret": "shh" }),
  };
});

vi.mock("@/lib/portal/leadBrief", () => ({
  readLeadSubject: vi.fn(),
  readTrail: vi.fn(),
}));

import { readLeadSubject, readTrail } from "@/lib/portal/leadBrief";
import { readSetting, salesNotifyWebhook } from "@/lib/pipeline/server";
import type { LeadActivity } from "@/lib/data/leadActivity";
import { notifySalesHandoff, type SalesHandoffNotifyPayload } from "./handoffNotify";

const mockSetting = vi.mocked(readSetting);
const mockWebhook = vi.mocked(salesNotifyWebhook);
const mockSubject = vi.mocked(readLeadSubject);
const mockTrail = vi.mocked(readTrail);

const WEBHOOK = "https://n8n.test/webhook/sales-handoff-notify";
const LEAD = "0df6326c-42ce-46f6-805c-8d03ec6f493f";
const ACTOR = { email: "kane@simple.biz", role: "admin", actingAs: null };

/** A lead that clicked through, browsed, and opened service cards — enough to
 *  score in the "Hot" band, which is what put it on Hot Leads to begin with. */
function trail(leadId = LEAD): LeadActivity {
  return {
    leadId,
    business: "Riverside Property Group",
    category: "Property Management",
    campaign: "vic-aug-plumbing",
    firstSeen: "2026-08-21T01:00:00.000Z",
    lastSeen: "2026-08-23T07:00:00.000Z",
    events: [
      { event: "attribution_click", service: null, destination: "/portal", version: null, ts: "2026-08-21T01:00:00.000Z" },
      { event: "portal_view", service: null, destination: null, version: null, ts: "2026-08-21T01:02:00.000Z" },
      { event: "portal_service_open", service: "plumbing", destination: null, version: null, ts: "2026-08-23T07:00:00.000Z" },
    ],
    counts: { emailClicks: 1, portalViews: 1, serviceOpens: 1, inquiries: 0, chatPrompts: 0 },
  };
}

function subject(leadId = LEAD) {
  return {
    leadId,
    business: "Riverside Property Group",
    contactName: null,
    email: "info@riverside.com.au",
    phone: "03 9123 4567",
    website: "riverside.com.au",
    sector: "Property Management",
    campaign: null,
    handedOverAt: "2026-08-23T09:12:00.000Z",
  };
}

/** Capture every outbound fetch; answer 200 by default. */
function stubFetch(status = 200) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  vi.stubGlobal("fetch", (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(new Response("{}", { status }));
  });
  return calls;
}

function sent(calls: Array<{ url: string; init: RequestInit }>): SalesHandoffNotifyPayload {
  return JSON.parse(String(calls[0].init.body)) as SalesHandoffNotifyPayload;
}

function run(leadIds: string[] = [LEAD]) {
  return notifySalesHandoff({
    base: "https://db.test",
    key: "k",
    leadIds,
    actor: ACTOR,
    consoleUrl: "https://admin.apmgservices.com.au",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  mockSetting.mockResolvedValue("george@apmgservices.com.au, kane@simple.biz");
  mockWebhook.mockResolvedValue({ state: "ok", url: WEBHOOK, source: "setting" });
  mockSubject.mockResolvedValue(subject());
  mockTrail.mockResolvedValue(trail());
});

describe("notifySalesHandoff — when it stays silent", () => {
  it("sends nothing when no lead was newly marked", async () => {
    const calls = stubFetch();
    expect(await run([])).toBe(false);
    expect(calls).toHaveLength(0);
    // Not even a settings read: an idempotent re-POST must cost nothing.
    expect(mockSetting).not.toHaveBeenCalled();
  });

  it("sends nothing when no notification address is configured", async () => {
    mockSetting.mockResolvedValue("");
    const calls = stubFetch();
    expect(await run()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sends nothing when the stored address list is malformed", async () => {
    mockSetting.mockResolvedValue("not-an-address");
    const calls = stubFetch();
    expect(await run()).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("sends nothing when the webhook is unconfigured or paused", async () => {
    const calls = stubFetch();
    mockWebhook.mockResolvedValue({ state: "unconfigured" });
    expect(await run()).toBe(false);
    mockWebhook.mockResolvedValue({ state: "paused", url: WEBHOOK, source: "setting" });
    expect(await run()).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("notifySalesHandoff — the payload", () => {
  it("POSTs once, to the resolved webhook, with the shared secret", async () => {
    const calls = stubFetch();
    expect(await run()).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({ "x-apmg-secret": "shh" });
  });

  it("addresses ONE email to every configured recipient", async () => {
    const calls = stubFetch();
    await run();
    // One send, all recipients on it — never one request per address, which
    // would multiply the sending mailbox's daily cap.
    expect(sent(calls).notifyTo).toBe("george@apmgservices.com.au, kane@simple.biz");
  });

  it("carries the discriminator the workflow refuses anything else by", async () => {
    const calls = stubFetch();
    await run();
    expect(sent(calls).type).toBe("sales_handoff");
    expect(sent(calls).version).toBe(1);
  });

  it("names the admin who pressed it, including a previewed role", async () => {
    const calls = stubFetch();
    await notifySalesHandoff({
      base: "https://db.test",
      key: "k",
      leadIds: [LEAD],
      actor: { email: "kane@simple.biz", role: "admin", actingAs: "sales" },
      consoleUrl: null,
    });
    expect(sent(calls).handedOverBy).toEqual({
      email: "kane@simple.biz",
      role: "admin",
      actingAs: "sales",
    });
    expect(sent(calls).consoleUrl).toBeNull();
  });

  it("briefs the lead with the score, the prose and the trail behind them", async () => {
    const calls = stubFetch();
    await run();
    const lead = sent(calls).leads[0];

    expect(lead.leadId).toBe(LEAD);
    expect(lead.business).toBe("Riverside Property Group");
    expect(lead.phone).toBe("03 9123 4567");
    // Opened a service card ⇒ the 60–89 band, the reason it was hot.
    expect(lead.score).toBeGreaterThanOrEqual(60);
    expect(lead.band).toBe("Hot");
    // The prose is the deterministic summary off the same facts the console
    // renders — not an AI call on an admin's click.
    expect(lead.summary).toContain("Riverside Property Group");
    expect(lead.talkingPoints.length).toBeGreaterThan(0);
    expect(lead.activity).toMatchObject({ portalViews: 1, serviceOpens: 1 });
    expect(lead.timeline).toHaveLength(3);
    expect(lead.timeline[0]).toEqual({
      ts: "2026-08-21T01:00:00.000Z",
      label: "Clicked the email link",
    });
  });

  it("brief still renders for a lead with no tracked activity at all", async () => {
    mockTrail.mockResolvedValue(null);
    const calls = stubFetch();
    await run();
    const lead = sent(calls).leads[0];
    expect(lead.score).toBeNull();
    expect(lead.band).toBeNull();
    expect(lead.activity).toBeNull();
    expect(lead.timeline).toEqual([]);
    // The rep is told it's a cold call rather than shown a blank card.
    expect(lead.summary).toContain("no tracked portal activity");
  });

  it("keeps a lead whose record could not be read, and says so", async () => {
    mockSubject.mockResolvedValue("error");
    const calls = stubFetch();
    expect(await run()).toBe(true);
    const lead = sent(calls).leads[0];
    expect(lead.leadId).toBe(LEAD);
    expect(lead.summary).toContain("couldn't be read");
  });

  it("caps how many leads it briefs and reports the real total", async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `${LEAD.slice(0, -2)}${(10 + i).toString()}`);
    mockSubject.mockImplementation(async (_b, _k, id) => subject(id));
    mockTrail.mockImplementation(async (_b, _k, id) => trail(id));
    const calls = stubFetch();
    await run(ids);
    const payload = sent(calls);
    // 25 handed over, 20 briefed — the email says 25 so the overflow line can
    // account for the other five instead of quietly dropping them.
    expect(payload.totalLeads).toBe(25);
    expect(payload.leads).toHaveLength(20);
  });
});

describe("notifySalesHandoff — it can never break the hand-off", () => {
  it("reports failure instead of throwing when the webhook errors", async () => {
    stubFetch(500);
    await expect(run()).resolves.toBe(false);
  });

  it("reports failure instead of throwing when the request itself blows up", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("socket hang up")));
    await expect(run()).resolves.toBe(false);
  });

  it("reports failure instead of throwing when a read blows up", async () => {
    mockSubject.mockRejectedValue(new Error("db down"));
    stubFetch();
    await expect(run()).resolves.toBe(false);
  });
});
