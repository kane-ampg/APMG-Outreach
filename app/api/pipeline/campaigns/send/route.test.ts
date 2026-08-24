import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requirePermission = vi.fn();
const campaignWebhook = vi.fn();

vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/server")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, campaignWebhook: () => campaignWebhook() };
});

// Keep the test off the network: neither helper is what we're exercising.
vi.mock("@/lib/portal/server", () => ({
  fetchSuppressedEmails: async () => new Set<string>(),
  insertPortalEvents: async () => true,
}));
vi.mock("@/lib/pipeline/sectorStore", () => ({
  loadPlaybooks: async () => [],
  playbookPdfUrl: () => null,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@apmgservices.com.au" });
});

function sendReq(body: unknown): Request {
  return new Request("http://local/api/pipeline/campaigns/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = {
  campaign: "test-campaign",
  subject: "Hello {{business}}",
  bodyHtml: "<p>Hi {{business}} — {{link}}</p>",
  recipients: [{ id: "11111111-1111-4111-8111-111111111111", business: "Acme", email: "a@acme.test" }],
};

describe("POST /api/pipeline/campaigns/send — never reports an unsent campaign as sent", () => {
  it("503s with sent: 0 when the automation is PAUSED", async () => {
    campaignWebhook.mockResolvedValue({ state: "paused", url: "https://n8n.example/h", source: "setting" });
    const res = await POST(sendReq(BODY));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.sent).toBe(0);
    expect(data.mode).toBe("paused");
    expect(data.error).toMatch(/paused/i);
  });

  it("503s with sent: 0 when no automation is configured", async () => {
    campaignWebhook.mockResolvedValue({ state: "unconfigured" });
    const res = await POST(sendReq(BODY));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.sent).toBe(0);
    expect(data.mode).toBe("unconfigured");
  });

  it("never answers ok: true with a non-zero sent count unless the webhook was live", async () => {
    for (const state of [{ state: "paused", url: "u", source: "env" }, { state: "unconfigured" }]) {
      campaignWebhook.mockResolvedValue(state);
      const data = await (await POST(sendReq(BODY))).json();
      expect(data.ok && data.sent > 0).toBe(false);
    }
  });
});

/**
 * The client rule (2026-07-29): an existing customer must never receive cold
 * outreach. The send flow removes them in the browser before Review, but that
 * copy of the guard could be stale and a hand-rolled POST wouldn't consult it
 * at all — so the route is the thing that has to hold. These cases go through
 * the REAL client list, not a fixture, because what matters is that the actual
 * customers APMG holds are the ones that get dropped.
 */
describe("POST /api/pipeline/campaigns/send — never emails an existing client", () => {
  const NEW_LEAD = {
    id: "22222222-2222-4222-8222-222222222222",
    business: "Northside Plumbing & Gas",
    email: "info@northsideplumbing.example",
  };
  /** Whittles is a real client, on file at whittles.com.au across 70 sites. */
  const CLIENT_LEAD = {
    id: "33333333-3333-4333-8333-333333333333",
    business: "Whittles Strata Melbourne",
    email: "newcontact@whittles.com.au",
  };

  /** A live, configured automation plus a stubbed network, so the only thing
   *  under test is who the route decided to mail. */
  function webhookOk() {
    campaignWebhook.mockResolvedValue({ state: "ok", url: "https://n8n.example/hook", source: "setting" });
    return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
  }

  it("drops a client from a mixed batch, sends the rest, and says who was dropped", async () => {
    const fetchSpy = webhookOk();
    const res = await POST(sendReq({ ...BODY, recipients: [NEW_LEAD, CLIENT_LEAD] }));
    const data = await res.json();

    expect(data.ok).toBe(true);
    expect(data.sent).toBe(1);
    expect(data.clients).toBe(1);
    expect(data.clientMatches[0]).toMatchObject({
      email: "newcontact@whittles.com.au",
      client: "Whittles",
    });
    expect(data.clientMatches[0].reason).toMatch(/whittles\.com\.au/);

    // and the client is genuinely absent from what went to the automation
    const sentBody = JSON.parse(String(fetchSpy.mock.calls[0][1]?.body));
    expect(sentBody.messages.map((m: { to: string }) => m.to)).toEqual([NEW_LEAD.email]);
    fetchSpy.mockRestore();
  });

  it("refuses the whole send when every recipient is a client, and calls no webhook", async () => {
    const fetchSpy = webhookOk();
    const res = await POST(sendReq({ ...BODY, recipients: [CLIENT_LEAD] }));
    const data = await res.json();

    expect(res.status).toBe(400);
    expect(data.ok).toBe(false);
    expect(data.sent).toBe(0);
    expect(data.clients).toBe(1);
    expect(data.error).toMatch(/already an APMG client/i);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("recognises a client by its own website when the address gives nothing away", async () => {
    const fetchSpy = webhookOk();
    const res = await POST(
      sendReq({
        ...BODY,
        recipients: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            business: "A Body Corporate Manager",
            email: "hello@gmail.com",
            website: "https://www.nobleknight.com.au/contact",
          },
        ],
      }),
    );
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.clients).toBe(1);
    expect(data.clientMatches[0].client).toBe("Noble Knight Real Estate");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("lets an ordinary prospect straight through", async () => {
    const fetchSpy = webhookOk();
    const data = await (await POST(sendReq({ ...BODY, recipients: [NEW_LEAD] }))).json();
    expect(data.ok).toBe(true);
    expect(data.sent).toBe(1);
    expect(data.clients).toBeUndefined();
    fetchSpy.mockRestore();
  });
});
