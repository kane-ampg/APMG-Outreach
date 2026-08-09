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
