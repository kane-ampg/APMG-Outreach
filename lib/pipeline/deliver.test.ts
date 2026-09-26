import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const campaignWebhook = vi.fn();
const supabaseTarget = vi.fn(() => ({ state: "ok", base: "https://sb.test", key: "k" }) as unknown);
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, campaignWebhook: () => campaignWebhook(), supabaseTarget: () => supabaseTarget() };
});

const fetchSuppressedEmails = vi.fn(async () => new Set<string>());
const fetchSuppressedDomains = vi.fn(async () => new Map<string, string>());
// typed with rest args so mock.calls[0][2] (the rows) type-checks under tsc
const insertPortalEvents = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/portal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal/server")>();
  return {
    ...actual,
    fetchSuppressedEmails: (...a: unknown[]) => fetchSuppressedEmails(...(a as [])),
    fetchSuppressedDomains: (...a: unknown[]) => fetchSuppressedDomains(...(a as [])),
    insertPortalEvents: (...a: unknown[]) => insertPortalEvents(...a),
  };
});
vi.mock("@/lib/pipeline/sectorStore", () => ({ loadPlaybooks: async () => [], playbookPdfUrl: () => null }));

import { deliverCampaign, type CleanRecipient } from "./deliver";

const A: CleanRecipient = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "info@northside.example",
  business: "Northside",
  subject: "Plumbing for Northside",
  html: "<p>Hi</p><p><a href=\"{{link}}\">Go</a></p>",
  category: "Childcare",
};
/** Whittles is a real client on the bundled Master Client List. */
const CLIENT: CleanRecipient = { ...A, id: "33333333-3333-4333-8333-333333333333", email: "x@whittles.com.au", business: "Whittles Strata" };

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  supabaseTarget.mockReturnValue({ state: "ok", base: "https://sb.test", key: "k" });
  fetchSuppressedEmails.mockResolvedValue(new Set());
  fetchSuppressedDomains.mockResolvedValue(new Map());
  campaignWebhook.mockResolvedValue({ state: "ok", url: "https://n8n.example/hook", source: "setting" });
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
});

function payload(): { campaign: string; messages: Array<Record<string, unknown>> } {
  const call = fetchSpy.mock.calls.find(([url]: [unknown, unknown]) => String(url) === "https://n8n.example/hook");
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

describe("deliverCampaign", () => {
  it("uses a recipient's own hero over the send-level one", async () => {
    await deliverCampaign({
      campaign: "hot-followup",
      base: "https://x.test",
      hero: { url: "https://img/default.jpg", alt: "default" },
      recipients: [{ ...A, hero: { url: "https://img/plumbing.jpg", alt: "a plumber" } }],
    });
    expect(payload().messages[0]).toMatchObject({ hero: "https://img/plumbing.jpg", hero_alt: "a plumber" });
  });

  it("merges send-level and per-recipient ledger props onto email_sent rows", async () => {
    const out = await deliverCampaign({
      campaign: "hot-followup",
      base: "https://x.test",
      ledgerProps: { kind: "follow_up" },
      recipients: [{ ...A, ledgerProps: { touch: "2" } }],
    });
    expect(out.result.ok).toBe(true);
    expect(out.deliveredIds).toEqual([A.id]);
    const rows = insertPortalEvents.mock.calls[0][2] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ event: "email_sent", campaign: "hot-followup", props: { kind: "follow_up", touch: "2" } });
  });

  it("reports every dropped recipient by id with a reason", async () => {
    fetchSuppressedDomains.mockResolvedValue(new Map([["northside.example", "boss@northside.example"]]));
    const out = await deliverCampaign({ campaign: "c", base: "https://x.test", recipients: [A, CLIENT] });
    expect(out.drops).toEqual(
      expect.arrayContaining([
        { id: CLIENT.id, reason: expect.stringMatching(/existing client/i) },
        { id: A.id, reason: expect.stringMatching(/organisation opted out/i) },
      ]),
    );
    expect(out.deliveredIds).toEqual([]);
    expect(out.result.ok).toBe(false);
  });

  it("delivers nothing and marks nothing when the automation is paused", async () => {
    campaignWebhook.mockResolvedValue({ state: "paused", url: "u", source: "setting" });
    const out = await deliverCampaign({ campaign: "c", base: "https://x.test", recipients: [A] });
    expect(out.status).toBe(503);
    expect(out.deliveredIds).toEqual([]);
    expect(insertPortalEvents).not.toHaveBeenCalled();
  });
});
