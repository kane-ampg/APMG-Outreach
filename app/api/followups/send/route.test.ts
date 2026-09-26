import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUpQueueItem, FollowUpRow } from "@/lib/followups/types";

vi.mock("server-only", () => ({}));

const requirePermission = vi.fn();
vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/server")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, supabaseTarget: () => ({ state: "ok", base: "https://sb.test", key: "k" }) };
});

const readFollowUpsByIds = vi.fn();
const loadQueue = vi.fn();
const patchFollowUps = vi.fn();
vi.mock("@/lib/followups/server", () => ({
  readFollowUpsByIds: (...a: unknown[]) => readFollowUpsByIds(...a),
  loadQueue: (...a: unknown[]) => loadQueue(...a),
  patchFollowUps: (...a: unknown[]) => patchFollowUps(...a),
}));
const deliverCampaign = vi.fn();
vi.mock("@/lib/pipeline/deliver", () => ({ deliverCampaign: (...a: unknown[]) => deliverCampaign(...a) }));

import { POST } from "./route";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const R2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(id: string, lead: string, over: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id, lead_id: lead, touch: 1, status: "draft", subject: "DB subject", body_html: "<p>DB body <a href=\"{{link}}\">Go</a></p>",
    service_slug: "plumbing", model: "m", note: null, drafted_at: null, sent_at: null, sent_by: null,
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z", ...over,
  };
}
function item(lead: string, draft: FollowUpRow | null, over: Partial<FollowUpQueueItem> = {}): FollowUpQueueItem {
  return {
    leadId: lead, business: "Acme", category: "Childcare", website: null, email: `info@${lead.slice(0, 4)}.test`,
    score: 70, service: "plumbing", services: ["plumbing"], stage: "awaiting", touch: 1, reason: null, draft,
    touch1SentAt: null, touch2DueOn: null, likelyScanner: false, scannerGapSeconds: null, clientWarning: null, ...over,
  };
}
const req = (body: unknown) =>
  new Request("http://local/api/followups/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
/** the patchFollowUps calls that wrote `status` */
const patchesTo = (status: string) =>
  patchFollowUps.mock.calls.filter((c) => (c[2] as { status?: string }).status === status);

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@apmgservices.com.au", actingAs: null });
  // every patch "succeeds" for every id it was given, echoing the new status
  patchFollowUps.mockImplementation(async (_sb: unknown, ids: string[], patch: Partial<FollowUpRow>) =>
    ids.map((id) => row(id, L1, { status: patch.status ?? "draft" })),
  );
  deliverCampaign.mockImplementation(async ({ recipients }: { recipients: Array<{ id: string }> }) => ({
    status: 200, result: { ok: true, sent: recipients.length, mode: "live" }, deliveredIds: recipients.map((r) => r.id), drops: [],
  }));
});

describe("POST /api/followups/send", () => {
  it("sends the DATABASE copy under the hot-followup tag with touch ledger props", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    const res = await POST(req({ ids: [R1], subject: "IGNORED" }));
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, sent: 1 });
    const input = deliverCampaign.mock.calls[0][0];
    expect(input.campaign).toBe("hot-followup");
    expect(input.ledgerProps).toEqual({ kind: "follow_up" });
    expect(input.recipients[0]).toMatchObject({ id: L1, subject: "DB subject", ledgerProps: { touch: "1" } });
    // settled from the claim, never from draft
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], expect.objectContaining({ status: "sent", sent_by: "kane@apmgservices.com.au" }), "sending");
    expect(patchesTo("sent")[0][3]).toBe("sending");
  });

  it("claims the drafts (draft → sending) BEFORE handing anything to the automation", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    await POST(req({ ids: [R1] }));
    expect(patchFollowUps.mock.calls[0]).toEqual([expect.anything(), [R1], { status: "sending" }, "draft"]);
    expect(patchFollowUps.mock.invocationCallOrder[0]).toBeLessThan(deliverCampaign.mock.invocationCallOrder[0]);
  });

  it("delivers only the rows it claimed; the rest were taken by another send", async () => {
    const r1 = row(R1, L1);
    const r2 = row(R2, L2);
    readFollowUpsByIds.mockResolvedValue([r1, r2]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r1), item(L2, r2)] });
    // another request won the race for R2
    patchFollowUps.mockImplementationOnce(async () => [row(R1, L1, { status: "sending" })]);
    const data = await (await POST(req({ ids: [R1, R2] }))).json();
    expect(deliverCampaign.mock.calls[0][0].recipients.map((x: { id: string }) => x.id)).toEqual([L1]);
    expect(data).toMatchObject({ ok: true, sent: 1 });
    expect(data.skipped).toEqual([{ leadId: L2, reason: "Already being sent or closed" }]);
    expect(patchesTo("sent")[0][1]).toEqual([R1]);
  });

  it("sends nothing when the drafts can't be locked", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    patchFollowUps.mockResolvedValueOnce(null);
    const res = await POST(req({ ids: [R1] }));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data).toMatchObject({ ok: false, sent: 0, error: "Couldn't lock the drafts, so nothing was sent." });
    expect(deliverCampaign).not.toHaveBeenCalled();
  });

  it("does not resend a draft that is no longer a draft (double click)", async () => {
    readFollowUpsByIds.mockResolvedValue([row(R1, L1, { status: "sent" })]);
    loadQueue.mockResolvedValue({ ok: true, items: [] });
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(deliverCampaign).not.toHaveBeenCalled();
    expect(data.sent).toBe(0);
    expect(data.skipped[0].reason).toMatch(/already sent or closed/i);
  });

  it("skips a draft whose lead enquired since it was written", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, null, { stage: "excluded", touch: null, reason: "Enquired — Sales owns this lead" })] });
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(deliverCampaign).not.toHaveBeenCalled();
    expect(data.skipped).toEqual([{ leadId: L1, reason: "Enquired — Sales owns this lead" }]);
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "skipped", note: "Enquired — Sales owns this lead" }, "draft");
  });

  it("mails a shared address once and skips the duplicate", async () => {
    const r1 = row(R1, L1);
    const r2 = row(R2, L2);
    readFollowUpsByIds.mockResolvedValue([r1, r2]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r1, { email: "same@x.test" }), item(L2, r2, { email: "Same@x.test" })] });
    const data = await (await POST(req({ ids: [R1, R2] }))).json();
    expect(deliverCampaign.mock.calls[0][0].recipients).toHaveLength(1);
    expect(data.skipped).toEqual([{ leadId: L2, reason: expect.stringMatching(/same address/i) }]);
    // persisted, so the duplicate doesn't come back as sendable
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R2], { status: "skipped", note: "Same address as another follow-up" }, "draft");
    expect(patchesTo("sending")[0][1]).toEqual([R1]);
  });

  it("marks guard drops as blocked with the reason", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    deliverCampaign.mockResolvedValue({ status: 400, result: { ok: false, sent: 0, mode: "noop", error: "Every recipient has unsubscribed." }, deliveredIds: [], drops: [{ id: L1, reason: "Opted out" }] });
    const res = await POST(req({ ids: [R1] }));
    const data = await res.json();
    expect(data.blocked).toEqual([{ leadId: L1, reason: "Opted out" }]);
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "blocked", note: "Opted out" }, "sending");
    // nothing went out, so it is not a success
    expect(res.status).toBe(400);
    expect(data).toMatchObject({ ok: false, sent: 0, error: "Every recipient has unsubscribed.", mode: "noop" });
    expect(patchesTo("draft")).toHaveLength(0);
  });

  it("puts the claimed drafts back to draft when the automation refuses (paused)", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    deliverCampaign.mockResolvedValue({ status: 503, result: { ok: false, sent: 0, mode: "paused", error: "The campaign automation is paused." }, deliveredIds: [], drops: [] });
    const res = await POST(req({ ids: [R1] }));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data).toMatchObject({ ok: false, sent: 0, mode: "paused" });
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "draft" }, "sending");
    expect(patchesTo("sent")).toHaveLength(0);
  });

  it("leaves the claimed drafts LOCKED when n8n was called and failed (some emails may have gone)", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    deliverCampaign.mockResolvedValue({ status: 502, result: { ok: false, sent: 0, mode: "live", error: "Could not reach the campaign automation." }, deliveredIds: [], drops: [] });
    const res = await POST(req({ ids: [R1] }));
    const data = await res.json();
    expect(res.status).toBe(502);
    expect(data).toMatchObject({ ok: false, sent: 0, mode: "live" });
    expect(data.error).toBe(
      "Could not reach the campaign automation. The drafts were left locked because some emails may already have gone — check the outreach mailbox's Sent folder.",
    );
    expect(patchesTo("draft")).toHaveLength(0);
    expect(patchesTo("sent")).toHaveLength(0);
  });

  it("puts the claimed drafts back when the automation isn't configured (never called)", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    deliverCampaign.mockResolvedValue({ status: 503, result: { ok: false, sent: 0, mode: "unconfigured", error: "No campaign automation is configured, so nothing can be sent." }, deliveredIds: [], drops: [] });
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(data).toMatchObject({ ok: false, mode: "unconfigured", error: "No campaign automation is configured, so nothing can be sent." });
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "draft" }, "sending");
  });

  it("paused plus a guard drop: not ok, the paused error, the dropped row blocked", async () => {
    const r1 = row(R1, L1);
    const r2 = row(R2, L2);
    readFollowUpsByIds.mockResolvedValue([r1, r2]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r1), item(L2, r2)] });
    deliverCampaign.mockResolvedValue({
      status: 503,
      result: { ok: false, sent: 0, mode: "paused", error: "The campaign automation is paused." },
      deliveredIds: [],
      drops: [{ id: L2, reason: "Opted out" }],
    });
    const res = await POST(req({ ids: [R1, R2] }));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data).toMatchObject({ ok: false, sent: 0, mode: "paused", error: "The campaign automation is paused." });
    expect(data.blocked).toEqual([{ leadId: L2, reason: "Opted out" }]);
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R2], { status: "blocked", note: "Opted out" }, "sending");
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "draft" }, "sending");
    expect(patchesTo("sent")).toHaveLength(0);
  });

  it("says so when a refused send can't put its claimed drafts back", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    deliverCampaign.mockResolvedValue({ status: 503, result: { ok: false, sent: 0, mode: "paused", error: "The campaign automation is paused." }, deliveredIds: [], drops: [] });
    patchFollowUps.mockImplementation(async (_sb: unknown, ids: string[], patch: Partial<FollowUpRow>) =>
      patch.status === "draft" ? null : ids.map((id) => row(id, L1, { status: patch.status })),
    );
    const res = await POST(req({ ids: [R1] }));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data).toMatchObject({ ok: false, sent: 0, mode: "paused" });
    expect(data.warning).toMatch(/couldn't be unlocked/i);
  });

  it("warns — never a clean success — when sent rows can't be marked", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    // the claim works; marking sent fails (rows stay `sending`: nothing can resend them)
    patchFollowUps.mockImplementation(async (_sb: unknown, ids: string[], patch: Partial<FollowUpRow>) =>
      patch.status === "sent" ? null : ids.map((id) => row(id, L1, { status: patch.status })),
    );
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(data.sent).toBe(1);
    expect(data.warning).toMatch(/do not send them again/i);
  });

  it("needs followups.send", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "Forbidden — missing permission: followups.send" });
    const res = await POST(req({ ids: [R1] }));
    expect(res.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "followups.send");
  });
});
