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

const loadQueue = vi.fn();
const patchFollowUps = vi.fn();
const writeFollowUp = vi.fn();
vi.mock("@/lib/followups/server", () => ({
  loadQueue: (...a: unknown[]) => loadQueue(...a),
  patchFollowUps: (...a: unknown[]) => patchFollowUps(...a),
  writeFollowUp: (...a: unknown[]) => writeFollowUp(...a),
}));

import { POST } from "./route";

const L1 = "11111111-1111-4111-8111-111111111111";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const req = (body: unknown) =>
  new Request("http://local/api/followups/mark", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function row(id: string, lead: string, over: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id, lead_id: lead, touch: 1, status: "draft", subject: "S", body_html: "<p>B</p>",
    service_slug: "plumbing", model: "m", note: null, drafted_at: null, sent_at: null, sent_by: null,
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z", ...over,
  };
}
function item(over: Partial<FollowUpQueueItem> = {}): FollowUpQueueItem {
  return {
    leadId: L1, business: "Acme", category: "Childcare", website: null, email: "info@acme.test",
    score: 70, service: "plumbing", services: ["plumbing"], stage: "waiting", touch: 2, reason: null, draft: null,
    touch1SentAt: "2026-09-10T00:00:00Z", touch2DueOn: "2026-09-25", likelyScanner: false, scannerGapSeconds: null,
    clientWarning: null, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@x", actingAs: null });
});

describe("POST /api/followups/mark", () => {
  it("patches the exact draft row when the lead is awaiting approval", async () => {
    const draft = row(R1, L1, { touch: 1, status: "draft" });
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "awaiting", touch: 1, draft })] });
    patchFollowUps.mockResolvedValue([{ ...draft, status: "skipped", note: "Not interested" }]);
    const data = await (await POST(req({ leadId: L1, status: "skipped", note: "Not interested" }))).json();
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "skipped", note: "Not interested" }, "draft");
    expect(writeFollowUp).not.toHaveBeenCalled();
    expect(data).toMatchObject({ ok: true, row: { status: "skipped" } });
  });

  it("409s when the draft race loses (the row already left draft)", async () => {
    const draft = row(R1, L1, { touch: 1, status: "draft" });
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "awaiting", touch: 1, draft })] });
    patchFollowUps.mockResolvedValue([]);
    const res = await POST(req({ leadId: L1, status: "skipped" }));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data.error).toMatch(/already sent or closed/i);
    expect(writeFollowUp).not.toHaveBeenCalled();
  });

  it("inserts (insert-only) for a waiting lead with no row yet for the open touch", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "waiting", touch: 2, draft: null })] });
    writeFollowUp.mockResolvedValue(row(R1, L1, { touch: 2, status: "replied" }));
    const data = await (await POST(req({ leadId: L1, status: "replied" }))).json();
    expect(writeFollowUp).toHaveBeenCalledWith(
      expect.anything(),
      { lead_id: L1, touch: 2, status: "replied", note: null },
      { insertOnly: true },
    );
    expect(patchFollowUps).not.toHaveBeenCalled();
    expect(data).toMatchObject({ ok: true, row: { touch: 2, status: "replied" } });
  });

  it("marks a ready touch-2 lead replied with an insert-only write", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "ready", touch: 2, draft: null })] });
    writeFollowUp.mockResolvedValue(row(R1, L1, { touch: 2, status: "replied" }));
    const data = await (await POST(req({ leadId: L1, status: "replied" }))).json();
    expect(writeFollowUp.mock.calls[0][2]).toEqual({ insertOnly: true });
    expect(data).toMatchObject({ ok: true, row: { status: "replied" } });
  });

  it("409s, overwriting nothing, when a row appeared for that touch meanwhile", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "ready", touch: 1, draft: null })] });
    writeFollowUp.mockResolvedValue("conflict");
    const res = await POST(req({ leadId: L1, status: "skipped" }));
    const data = await res.json();
    expect(res.status).toBe(409);
    expect(data).toEqual({ ok: false, error: "Something changed for this lead — refresh." });
  });

  it("can't close a row a send has claimed (sending → conflict → 409)", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "sending", touch: 1, draft: null, reason: "Sending" })] });
    writeFollowUp.mockResolvedValue("conflict");
    const res = await POST(req({ leadId: L1, status: "replied" }));
    expect(res.status).toBe(409);
    expect(patchFollowUps).not.toHaveBeenCalled();
    expect(writeFollowUp.mock.calls[0][2]).toEqual({ insertOnly: true });
  });

  it("502s when the insert fails", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "ready", touch: 1, draft: null })] });
    writeFollowUp.mockResolvedValue(null);
    const res = await POST(req({ leadId: L1, status: "skipped" }));
    expect(res.status).toBe(502);
  });

  it("409s an excluded/done lead and writes nothing", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [item({ stage: "excluded", touch: null, reason: "Opted out" })] });
    const res = await POST(req({ leadId: L1, status: "skipped" }));
    expect(res.status).toBe(409);
    expect(patchFollowUps).not.toHaveBeenCalled();
    expect(writeFollowUp).not.toHaveBeenCalled();
  });

  it("400s a bad status", async () => {
    const res = await POST(req({ leadId: L1, status: "bogus" }));
    expect(res.status).toBe(400);
    expect(loadQueue).not.toHaveBeenCalled();
  });

  it("needs followups.send", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "Forbidden — missing permission: followups.send" });
    const res = await POST(req({ leadId: L1, status: "skipped" }));
    expect(res.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "followups.send");
  });
});
