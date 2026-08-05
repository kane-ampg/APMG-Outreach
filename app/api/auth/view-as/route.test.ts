import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getUserRole = vi.fn();
vi.mock("@/lib/auth/userStore", () => ({
  getUserRole: (...a: unknown[]) => getUserRole(...a),
}));

import { SESSION_COOKIE, signSession, verifySession } from "@/lib/auth/session";
import type { Role } from "@/lib/rbac/roles";
import { POST } from "./route";

const ADMIN = "kane@apmgservices.com.au";
const REP = "rep@apmgservices.com.au";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-value-at-least-32-bytes-long!!";
});

beforeEach(() => {
  vi.clearAllMocks();
});

function reqWith(headers: Record<string, string>, body: unknown): Request {
  return new Request("http://local/api/auth/view-as", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function reqAs(email: string, body: unknown, viewAs: Role | null = null): Promise<Request> {
  const token = await signSession({ email, viewAs });
  return reqWith({ cookie: `${SESSION_COOKIE}=${token}` }, body);
}

function setCookieValue(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) throw new Error("no session cookie in response");
  return decodeURIComponent(match[1]);
}

describe("POST /api/auth/view-as — same-origin floor", () => {
  it("rejects a cross-origin Origin header even with a valid admin session", async () => {
    getUserRole.mockResolvedValue("admin");
    const token = await signSession({ email: ADMIN });
    const res = await POST(
      reqWith({ cookie: `${SESSION_COOKIE}=${token}`, origin: "https://evil.example" }, { role: "sales" }),
    );
    expect(res.status).toBe(403);
    expect(getUserRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/view-as — authentication", () => {
  it("401s with no session cookie", async () => {
    const res = await POST(reqWith({}, { role: "sales" }));
    expect(res.status).toBe(401);
    expect(getUserRole).not.toHaveBeenCalled();
  });

  it("401s a garbage cookie value", async () => {
    const res = await POST(reqWith({ cookie: `${SESSION_COOKIE}=garbage` }, { role: "sales" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/view-as — authorization uses trueRole, not the effective role", () => {
  it("403s a real 'sales' trueRole even for an otherwise-valid session", async () => {
    getUserRole.mockResolvedValue("sales");
    const res = await POST(await reqAs(REP, { role: "client" }));
    expect(res.status).toBe(403);
  });

  it("403s pending", async () => {
    getUserRole.mockResolvedValue("pending");
    const res = await POST(await reqAs(REP, { role: "sales" }));
    expect(res.status).toBe(403);
  });

  it("allows a real admin", async () => {
    getUserRole.mockResolvedValue("admin");
    const res = await POST(await reqAs(ADMIN, { role: "sales" }));
    expect(res.status).toBe(200);
  });

  it("critical: an admin CURRENTLY PREVIEWING sales can still switch again", async () => {
    // The request the client actually sends from inside an active preview:
    // the incoming cookie already carries viewAs:"sales", so the EFFECTIVE
    // role is "sales". If this route mistakenly gated on the effective role
    // (the way requirePermission does), a previewing admin could never
    // switch again or exit — exactly the trap design doc §9 warns about.
    getUserRole.mockResolvedValue("admin");
    const res = await POST(await reqAs(ADMIN, { role: "client" }, "sales"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/view-as — validation", () => {
  beforeEach(() => getUserRole.mockResolvedValue("admin"));

  it("rejects a role outside the catalog", async () => {
    const res = await POST(await reqAs(ADMIN, { role: "superuser" }));
    expect(res.status).toBe(400);
  });

  it("rejects a role that is an inherited object property", async () => {
    const res = await POST(await reqAs(ADMIN, { role: "constructor" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing role key", async () => {
    const res = await POST(await reqAs(ADMIN, {}));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed JSON body", async () => {
    const token = await signSession({ email: ADMIN });
    const res = await POST(
      new Request("http://local/api/auth/view-as", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts null to exit a preview", async () => {
    const res = await POST(await reqAs(ADMIN, { role: null }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/view-as — the re-signed session cookie", () => {
  beforeEach(() => getUserRole.mockResolvedValue("admin"));

  it("carries the requested viewAs", async () => {
    const res = await POST(await reqAs(ADMIN, { role: "sales" }));
    const claims = await verifySession(setCookieValue(res));
    expect(claims?.email).toBe(ADMIN);
    expect(claims?.viewAs).toBe("sales");
  });

  it("clears viewAs when exiting", async () => {
    const res = await POST(await reqAs(ADMIN, { role: null }, "sales"));
    const claims = await verifySession(setCookieValue(res));
    expect(claims?.viewAs).toBeNull();
  });

  it("preserves name and picture across the change", async () => {
    const token = await signSession({ email: ADMIN, name: "Kane Reroma", picture: "https://example/p.png" });
    const res = await POST(
      reqWith({ cookie: `${SESSION_COOKIE}=${token}` }, { role: "sales" }),
    );
    const claims = await verifySession(setCookieValue(res));
    expect(claims?.name).toBe("Kane Reroma");
    expect(claims?.picture).toBe("https://example/p.png");
  });
});
