import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The Sales desk's only write path. These tests pin the two properties the
 * whole audit trail rests on: identity comes from the session and never the
 * body, and a state change that could not be recorded does not happen.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac/server", () => ({
  requirePermission: vi.fn(),
  guardResponse: (g: { status: number; error: string }) =>
    Response.json({ error: g.error }, { status: g.status }),
}));
vi.mock("@/lib/audit/write", () => ({
  recordAudit: vi.fn(),
  actorFromGuard: (g: { email: string; role: string; actingAs: string | null }) => ({
    email: g.email,
    role: g.role,
    actingAs: g.actingAs,
  }),
}));
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
  };
});

import { recordAudit } from "@/lib/audit/write";
import { requirePermission } from "@/lib/rbac/server";
import { POST } from "./route";

const mockGuard = vi.mocked(requirePermission);
const mockRecord = vi.mocked(recordAudit);

const LEAD = "0df6326c-42ce-46f6-805c-8d03ec6f493f";

function req(body: unknown): Request {
  return new Request("http://localhost/api/sales/status", {
    method: "POST",
    headers: {
      origin: "http://localhost",
      host: "localhost",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function allow() {
  mockGuard.mockResolvedValue({
    ok: true,
    roles: ["sales"],
    role: "sales",
    email: "rep@apmgservices.com.au",
    trueRoles: ["sales"],
    trueRole: "sales",
    actingAs: null,
  });
}

beforeEach(() => {
  mockGuard.mockReset();
  mockRecord.mockReset();
  mockRecord.mockResolvedValue({ ok: true });
  // The route re-reads the lead's trail after writing; an empty history is a
  // perfectly good answer and keeps these tests off the network.
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
});

describe("POST /api/sales/status", () => {
  it("401s when the guard refuses, and records nothing", async () => {
    mockGuard.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await POST(req({ leadId: LEAD, action: "contacted" }));
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects a lead id that is not a uuid", async () => {
    allow();
    const res = await POST(req({ leadId: "not-a-uuid", action: "contacted" }));
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    allow();
    const res = await POST(req({ leadId: LEAD, action: "deleted" }));
    expect(res.status).toBe(400);
  });

  it("rejects handoff and returned, which belong to the handoff route", async () => {
    allow();
    for (const action of ["handoff", "returned"]) {
      expect((await POST(req({ leadId: LEAD, action }))).status).toBe(400);
    }
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects a win whose note is too short", async () => {
    allow();
    const res = await POST(
      req({ leadId: LEAD, action: "closed_won", note: "ok", valueCents: 100 }),
    );
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects a loss with no reason, so lost leads cannot vanish silently", async () => {
    allow();
    const res = await POST(req({ leadId: LEAD, action: "closed_lost" }));
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects a win with a negative value", async () => {
    allow();
    const res = await POST(
      req({ leadId: LEAD, action: "closed_won", note: "signed the retainer", valueCents: -1 }),
    );
    expect(res.status).toBe(400);
  });

  it("records a win with its note and value in cents", async () => {
    allow();
    const res = await POST(
      req({
        leadId: LEAD,
        action: "closed_won",
        note: "signed the retainer",
        valueCents: 1_200_000,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledWith(
      { email: "rep@apmgservices.com.au", role: "sales", actingAs: null },
      expect.objectContaining({
        action: "closed_won",
        leadId: LEAD,
        note: "signed the retainer",
        valueCents: 1_200_000,
      }),
    );
  });

  it("ignores an actor address supplied by the client", async () => {
    allow();
    await POST(
      req({
        leadId: LEAD,
        action: "contacted",
        actorEmail: "someone.else@apmgservices.com.au",
        actor_email: "someone.else@apmgservices.com.au",
      }),
    );
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ email: "rep@apmgservices.com.au" }),
      expect.anything(),
    );
  });

  it("carries impersonation into the row when an admin acts as sales", async () => {
    mockGuard.mockResolvedValue({
      ok: true,
      roles: ["sales"],
      role: "sales",
      email: "kane@apmgservices.com.au",
      trueRoles: ["admin"],
      trueRole: "admin",
      actingAs: "sales",
    });
    await POST(req({ leadId: LEAD, action: "contacted" }));
    expect(mockRecord).toHaveBeenCalledWith(
      { email: "kane@apmgservices.com.au", role: "sales", actingAs: "sales" },
      expect.anything(),
    );
  });

  it("fails the request when the audit write fails, so nothing changes unrecorded", async () => {
    allow();
    mockRecord.mockResolvedValue({ ok: false, reason: "error" });
    const res = await POST(req({ leadId: LEAD, action: "contacted" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("answers 409 when the migration has not been run", async () => {
    allow();
    mockRecord.mockResolvedValue({ ok: false, reason: "missing_table" });
    const res = await POST(req({ leadId: LEAD, action: "contacted" }));
    expect(res.status).toBe(409);
  });
});
