import { beforeEach, describe, expect, it, vi } from "vitest";

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
const writeFollowUp = vi.fn();
const patchFollowUps = vi.fn();
const readFollowUpRows = vi.fn();
vi.mock("@/lib/followups/server", () => ({
  loadQueue: (...a: unknown[]) => loadQueue(...a),
  writeFollowUp: (...a: unknown[]) => writeFollowUp(...a),
  patchFollowUps: (...a: unknown[]) => patchFollowUps(...a),
  readFollowUpRows: (...a: unknown[]) => readFollowUpRows(...a),
}));
const draftEmail = vi.fn();
vi.mock("@/lib/ai/composeEmail", () => ({ draftEmail: (...a: unknown[]) => draftEmail(...a) }));
vi.mock("@/lib/ai/composeStore", () => ({
  loadComposePrompt: async () => ({ model: "claude-opus-4-8", instructions: "i", leadPromptTemplate: "t", outputSchema: {} }),
  resolveModel: (m: string) => m,
}));
vi.mock("@/lib/pipeline/sectorStore", () => ({ loadPlaybooks: async () => [], buildComposeKb: async () => "KB" }));
vi.mock("@/lib/pipeline/leadHistory", () => ({ readLeadHistories: async () => new Map() }));
vi.mock("@/lib/pipeline/campaign", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/campaign")>();
  return { ...actual, COMPOSE_RATE: { RPM: 1000, CONCURRENCY: 1, MIN_INTERVAL_MS: 0 } };
});

import { POST } from "./route";

const L1 = "11111111-1111-4111-8111-111111111111";
const req = (body: unknown) =>
  new Request("http://local/api/followups/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ready = { leadId: L1, business: "Acme", category: "Childcare", website: null, email: "a@acme.test", score: 66, service: "plumbing", services: ["plumbing"], stage: "ready", touch: 1, reason: null, draft: null, touch1SentAt: null, touch2DueOn: null, likelyScanner: false, scannerGapSeconds: null, clientWarning: null };
const D1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const oldDraft = { id: D1, lead_id: L1, touch: 1, status: "draft", subject: "Old", body_html: "<p>Old</p>", service_slug: "plumbing", model: "m", note: null, drafted_at: null, sent_at: null, sent_by: null, created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z" };
const awaiting = { ...ready, stage: "awaiting", draft: oldDraft };
const DRAFTED = { subject: "Plumbing for Acme", html: "<p>Hi</p><p><a href=\"{{link}}\">Go</a></p>" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test";
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@x", actingAs: null });
  writeFollowUp.mockImplementation(async (_sb: unknown, row: Record<string, unknown>) => ({ id: "r", ...row }));
});

describe("POST /api/followups/draft", () => {
  it("drafts a ready lead with the touch prompt and saves it as a draft", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [ready] });
    draftEmail.mockResolvedValue({ subject: "Plumbing for Acme", html: "<p>Hi</p><p><a href=\"{{link}}\">Go</a></p>" });
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(data).toMatchObject({ ok: true, drafted: [L1], failed: [], remaining: [] });
    const followUpBlock = draftEmail.mock.calls[0][5] as string;
    expect(followUpBlock).toMatch(/follow-up 1 of 2/i);
    expect(writeFollowUp).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lead_id: L1, touch: 1, status: "draft", service_slug: "plumbing" }),
      { insertOnly: true },
    );
    expect(patchFollowUps).not.toHaveBeenCalled();
  });

  it("reports a ready lead whose row appeared while Claude was writing, and overwrites nothing", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [ready] });
    draftEmail.mockResolvedValue(DRAFTED);
    writeFollowUp.mockResolvedValue("conflict");
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(data.drafted).toEqual([]);
    expect(data.failed).toEqual([{ leadId: L1, error: "Another draft was saved for this lead meanwhile — refresh." }]);
  });

  it("redrafts an awaiting draft by PATCHING it, only while it is still a draft", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [awaiting] });
    draftEmail.mockResolvedValue(DRAFTED);
    patchFollowUps.mockResolvedValue([{ ...oldDraft, subject: DRAFTED.subject }]);
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(data).toMatchObject({ ok: true, drafted: [L1], failed: [] });
    expect(writeFollowUp).not.toHaveBeenCalled();
    expect(patchFollowUps).toHaveBeenCalledWith(
      expect.anything(),
      [D1],
      {
        subject: DRAFTED.subject,
        body_html: DRAFTED.html,
        service_slug: "plumbing",
        model: "claude-opus-4-8",
        note: null,
        drafted_at: expect.any(String),
      },
      "draft",
    );
  });

  it("reports a redraft whose row was sent or closed while Claude was writing", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [awaiting] });
    draftEmail.mockResolvedValue(DRAFTED);
    patchFollowUps.mockResolvedValue([]);
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(data.drafted).toEqual([]);
    expect(data.failed).toEqual([{ leadId: L1, error: "Sent or closed while Claude was writing — refresh." }]);
    expect(writeFollowUp).not.toHaveBeenCalled();
  });

  it("reports a redraft that couldn't be saved", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [awaiting] });
    draftEmail.mockResolvedValue(DRAFTED);
    patchFollowUps.mockResolvedValue(null);
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(data.failed).toEqual([{ leadId: L1, error: "Drafted, but the draft couldn't be saved." }]);
  });

  it("shows touch 2 what touch 1 said, and keeps touch 1's service", async () => {
    const touch2 = { ...ready, touch: 2, service: "painting", services: ["painting", "plumbing"] };
    loadQueue.mockResolvedValue({ ok: true, items: [touch2] });
    readFollowUpRows.mockResolvedValue([
      { ...oldDraft, status: "sent", subject: "Plumbing for Acme", body_html: "<p>We fix taps.</p><p><a href=\"{{link}}\">Book a visit</a></p>" },
    ]);
    draftEmail.mockResolvedValue(DRAFTED);
    await POST(req({ leadIds: [L1] }));
    expect(readFollowUpRows).toHaveBeenCalledWith(expect.anything(), [L1]);
    const block = draftEmail.mock.calls[0][5] as string;
    expect(block).toContain("Subject: Plumbing for Acme\nWe fix taps.\n\nBook a visit");
    expect(block).not.toContain("{{link}}");
    expect(block).toMatch(/follow-up 2 of 2.*stay on plumbing/i);
    expect(writeFollowUp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ touch: 2, service_slug: "plumbing" }), { insertOnly: true });
  });

  it("doesn't read touch 1 for a touch-1 draft", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [ready] });
    draftEmail.mockResolvedValue(DRAFTED);
    await POST(req({ leadIds: [L1] }));
    expect(readFollowUpRows).not.toHaveBeenCalled();
    expect(draftEmail.mock.calls[0][5]).not.toMatch(/for reference only/i);
  });

  it("won't draft touch 2 blind when touch 1 can't be read", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [{ ...ready, touch: 2 }] });
    readFollowUpRows.mockResolvedValue("error");
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(draftEmail).not.toHaveBeenCalled();
    expect(data.failed).toEqual([{ leadId: L1, error: "Couldn't read the first follow-up, so this one wasn't drafted. Try again." }]);
  });

  it("refuses an ineligible lead and calls no model", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [{ ...ready, stage: "excluded", touch: null, reason: "Opted out" }] });
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(draftEmail).not.toHaveBeenCalled();
    expect(data.failed).toEqual([{ leadId: L1, error: "Opted out" }]);
  });

  it("saves nothing when Claude fails", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [ready] });
    draftEmail.mockResolvedValue(null);
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(writeFollowUp).not.toHaveBeenCalled();
    expect(data.failed[0].error).toMatch(/couldn't draft/i);
  });

  it("503s without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(req({ leadIds: [L1] }));
    expect(res.status).toBe(503);
  });
});
