import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getUserRole = vi.fn();
const touchLastSeen = vi.fn();
vi.mock("@/lib/auth/userStore", () => ({
  getUserRole: (...a: unknown[]) => getUserRole(...a),
  touchLastSeen: (...a: unknown[]) => touchLastSeen(...a),
}));

import { SESSION_COOKIE, signSession } from "@/lib/auth/session";
import type { Role } from "@/lib/rbac/roles";
import { POST } from "./route";

/**
 * The heartbeat is the only writer of `last_seen_at`, and `last_seen_at` is
 * the only thing that shows somebody as online. So the tests that matter are
 * the ones proving a beat can only ever mark the AUTHENTICATED CALLER present
 * — anything else would let one person light up another person's row.
 */

const ADMIN = "kane@apmgservices.com.au";

/**
 * A distinct address per test.
 *
 * The route's duplicate-beat throttle is module state that outlives a single
 * test, so reusing one address would silently skip the write in every test
 * after the first. Rather than reaching in to reset it, each test gets its own
 * caller — which is also closer to how the endpoint is really used.
 */
let seq = 0;
function freshRep(): string {
  seq += 1;
  return `rep${seq}@apmgservices.com.au`;
}

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-value-at-least-32-bytes-long!!";
});

beforeEach(() => {
  vi.clearAllMocks();
  getUserRole.mockResolvedValue("sales");
  touchLastSeen.mockResolvedValue("ok");
});

function reqWith(headers: Record<string, string>, body?: unknown): Request {
  return new Request("http://local/api/auth/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function beatAs(email: string, body?: unknown, viewAs: Role | null = null): Promise<Request> {
  const token = await signSession({ email, viewAs });
  return reqWith({ cookie: `${SESSION_COOKIE}=${token}` }, body);
}

describe("POST /api/auth/heartbeat — who may be marked present", () => {
  it("401s with no session, and writes nothing", async () => {
    const res = await POST(reqWith({}));
    expect(res.status).toBe(401);
    expect(touchLastSeen).not.toHaveBeenCalled();
  });

  it("rejects a cross-origin beat even with a valid session", async () => {
    const token = await signSession({ email: freshRep() });
    const res = await POST(reqWith({ cookie: `${SESSION_COOKIE}=${token}`, origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(touchLastSeen).not.toHaveBeenCalled();
  });

  it("stamps the caller from their cookie", async () => {
    const rep = freshRep();
    const res = await POST(await beatAs(rep));
    expect(res.status).toBe(200);
    expect(touchLastSeen).toHaveBeenCalledWith(rep);
  });

  it("ignores any email in the body — you cannot mark a colleague online", async () => {
    const rep = freshRep();
    await POST(await beatAs(rep, { email: ADMIN, target_email: ADMIN }));
    expect(touchLastSeen).toHaveBeenCalledTimes(1);
    expect(touchLastSeen).toHaveBeenCalledWith(rep);
  });

  it("attributes a view-as preview to the admin actually at the keyboard", async () => {
    getUserRole.mockResolvedValue("admin");
    await POST(await beatAs(ADMIN, undefined, "sales"));
    expect(touchLastSeen).toHaveBeenCalledWith(ADMIN);
  });

  it("lets a revoked (pending) user beat — presence is not a permission", async () => {
    getUserRole.mockResolvedValue("pending");
    const rep = freshRep();
    const res = await POST(await beatAs(rep));
    expect(res.status).toBe(200);
    expect(touchLastSeen).toHaveBeenCalledWith(rep);
  });
});

describe("POST /api/auth/heartbeat — failure behaviour", () => {
  it("stays 200 and reports the truth when the write fails", async () => {
    // An idle tab must never raise an error the person cannot act on, but the
    // response must not claim a write that did not happen either.
    touchLastSeen.mockResolvedValue("error");
    const res = await POST(await beatAs(freshRep()));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, wrote: false, stop: false });
  });

  it("tells the client to stop when the migration hasn't been run", async () => {
    touchLastSeen.mockResolvedValue("missing_column");
    const res = await POST(await beatAs(freshRep()));
    expect(await res.json()).toMatchObject({ ok: false, stop: true, reason: "missing_column" });
  });

  it("tells the client to stop when there is no database at all", async () => {
    touchLastSeen.mockResolvedValue("demo");
    const res = await POST(await beatAs(freshRep()));
    expect(await res.json()).toMatchObject({ ok: false, stop: true });
  });

  it("keeps retrying after a transient error rather than giving up", async () => {
    touchLastSeen.mockResolvedValue("error");
    const res = await POST(await beatAs(freshRep()));
    expect((await res.json()).stop).toBe(false);
  });
});

describe("POST /api/auth/heartbeat — duplicate beats", () => {
  it("collapses a second beat from another tab without writing twice", async () => {
    const email = freshRep();
    const first = await POST(await beatAs(email));
    expect(await first.json()).toMatchObject({ wrote: true });

    const second = await POST(await beatAs(email));
    expect(await second.json()).toMatchObject({ ok: true, wrote: false });
    expect(touchLastSeen).toHaveBeenCalledTimes(1);
  });

  it("does not cache a beat that failed, so the next one retries", async () => {
    const email = freshRep();
    touchLastSeen.mockResolvedValue("error");
    await POST(await beatAs(email));
    await POST(await beatAs(email));
    expect(touchLastSeen).toHaveBeenCalledTimes(2);
  });
});
