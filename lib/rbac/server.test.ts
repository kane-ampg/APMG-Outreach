import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/rbac/server.ts composes four already-unit-tested pieces (verifySession,
 * getUserRole, effectiveRole, roleCan) into the one function every Route
 * Handler trusts. This file exists to prove the GLUE — the cookie read, the
 * null-propagation chain, "every branch fails closed", and "a forged viewAs
 * cannot escalate" — not to re-prove facts the other suites already cover.
 *
 * verifySession and getUserRole are mocked (no network, no Supabase, no JWT
 * crypto). effectiveRole and roleCan are deliberately left real: the whole
 * point is to exercise the actual gating logic, not a stand-in for it.
 */

// lib/rbac/server.ts does `import "server-only"`. Next's bundler resolves
// that specifier via package.json "exports" conditions to a vendored pair
// (a no-op under the `react-server` condition, a throw under `default`).
// Plain Vite/Node resolution has neither the package installed nor that
// condition active, so the bare specifier can't load here at all. This is
// the standard workaround for testing Next.js server-only modules in Vitest.
vi.mock("server-only", () => ({}));

// Partial mock: keep every real export — SESSION_COOKIE in particular, so
// the cookie name this file writes and the regex lib/rbac/server.ts reads
// with stay the same constant — and replace only the crypto/JWT call.
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/session")>();
  return { ...actual, verifySession: vi.fn() };
});

// getUserRole is the only export lib/rbac/server.ts uses from this module;
// a full replacement avoids ever touching Supabase or the network.
vi.mock("@/lib/auth/userStore", () => ({ getUserRole: vi.fn() }));

import { SESSION_COOKIE, verifySession, type SessionClaims } from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/userStore";
import { guardResponse, requirePermission, resolveSession } from "./server";

const mockVerifySession = vi.mocked(verifySession);
const mockGetUserRole = vi.mocked(getUserRole);

beforeEach(() => {
  mockVerifySession.mockReset();
  mockGetUserRole.mockReset();
});

function reqWithCookie(cookieHeader?: string): Request {
  const headers = new Headers();
  if (cookieHeader !== undefined) headers.set("cookie", cookieHeader);
  return new Request("http://localhost/api/test", { headers });
}

function claimsFor(email: string, viewAs: SessionClaims["viewAs"] = null): SessionClaims {
  return { email, viewAs };
}

describe("resolveSession", () => {
  it("returns null with no cookie at all, and asks verifySession to verify no token", async () => {
    mockVerifySession.mockResolvedValue(null);
    const session = await resolveSession(reqWithCookie(undefined));
    expect(session).toBeNull();
    expect(mockVerifySession).toHaveBeenCalledWith(undefined);
    expect(mockGetUserRole).not.toHaveBeenCalled();
  });

  it("returns null when verifySession rejects the token (garbage/tampered/expired)", async () => {
    mockVerifySession.mockResolvedValue(null);
    const session = await resolveSession(reqWithCookie(`${SESSION_COOKIE}=garbage-token`));
    expect(session).toBeNull();
    expect(mockVerifySession).toHaveBeenCalledWith("garbage-token");
    expect(mockGetUserRole).not.toHaveBeenCalled();
  });

  it("reads the session cookie correctly when other cookies surround it", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("rep@apmgservices.com.au"));
    mockGetUserRole.mockResolvedValue("sales");
    await resolveSession(reqWithCookie(`foo=1; ${SESSION_COOKIE}=valid-token; bar=2`));
    expect(mockVerifySession).toHaveBeenCalledWith("valid-token");
  });

  it("decodes a percent-encoded cookie value before verifying it (Important 1 regression)", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("rep@apmgservices.com.au"));
    mockGetUserRole.mockResolvedValue("sales");
    // %2F is "/". A raw, undecoded read would hand verifySession "abc%2Fdef"
    // instead — the same encode/decode mismatch that silently broke the
    // OAuth `next` cookie one commit earlier in this branch.
    await resolveSession(reqWithCookie(`${SESSION_COOKIE}=abc%2Fdef`));
    expect(mockVerifySession).toHaveBeenCalledWith("abc/def");
  });

  it("forged viewAs cannot escalate: a real 'sales' claiming viewAs:admin still resolves to sales", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("rep@apmgservices.com.au", "admin"));
    mockGetUserRole.mockResolvedValue("sales");
    const session = await resolveSession(reqWithCookie(`${SESSION_COOKIE}=valid-token`));
    expect(session).toEqual({
      email: "rep@apmgservices.com.au",
      trueRole: "sales",
      role: "sales", // NOT "admin" — this is the single most important case in the file
    });
  });

  it("legitimate view-as: a real admin viewing as sales resolves to sales", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("kane@apmgservices.com.au", "sales"));
    mockGetUserRole.mockResolvedValue("admin");
    const session = await resolveSession(reqWithCookie(`${SESSION_COOKIE}=valid-token`));
    expect(session).toEqual({
      email: "kane@apmgservices.com.au",
      trueRole: "admin",
      role: "sales",
    });
  });
});

describe("requirePermission", () => {
  it("401s with no cookie", async () => {
    mockVerifySession.mockResolvedValue(null);
    const guard = await requirePermission(reqWithCookie(undefined), "sales.view");
    expect(guard).toEqual({ ok: false, status: 401, error: expect.any(String) });
  });

  it("401s when the session does not verify", async () => {
    mockVerifySession.mockResolvedValue(null);
    const guard = await requirePermission(
      reqWithCookie(`${SESSION_COOKIE}=garbage-token`),
      "sales.view",
    );
    expect(guard).toEqual({ ok: false, status: 401, error: expect.any(String) });
  });

  it("403s a valid session whose stored role is pending — never a pass", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("new-hire@apmgservices.com.au"));
    mockGetUserRole.mockResolvedValue("pending");
    const guard = await requirePermission(
      reqWithCookie(`${SESSION_COOKIE}=valid-token`),
      "sales.view",
    );
    expect(guard).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });

  it("allows a real role that holds the permission, returning that role and email", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("rep@apmgservices.com.au"));
    mockGetUserRole.mockResolvedValue("sales");
    const guard = await requirePermission(
      reqWithCookie(`${SESSION_COOKIE}=valid-token`),
      "sales.view",
    );
    expect(guard).toEqual({ ok: true, role: "sales", email: "rep@apmgservices.com.au" });
  });

  it("403s a real role that does not hold the permission", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("rep@apmgservices.com.au"));
    mockGetUserRole.mockResolvedValue("sales");
    const guard = await requirePermission(
      reqWithCookie(`${SESSION_COOKIE}=valid-token`),
      "users.manage", // admin-only; sales does not hold it
    );
    expect(guard).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });

  it("forged viewAs: sales claiming viewAs:admin is refused an admin-only permission", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("rep@apmgservices.com.au", "admin"));
    mockGetUserRole.mockResolvedValue("sales");
    const guard = await requirePermission(
      reqWithCookie(`${SESSION_COOKIE}=valid-token`),
      "users.manage",
    );
    expect(guard).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });

  it("legitimate view-as: admin viewing as sales gets sales's access", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("kane@apmgservices.com.au", "sales"));
    mockGetUserRole.mockResolvedValue("admin");
    const guard = await requirePermission(
      reqWithCookie(`${SESSION_COOKIE}=valid-token`),
      "sales.view",
    );
    expect(guard).toEqual({ ok: true, role: "sales", email: "kane@apmgservices.com.au" });
  });

  it("legitimate view-as: admin viewing as sales loses admin-only access", async () => {
    mockVerifySession.mockResolvedValue(claimsFor("kane@apmgservices.com.au", "sales"));
    mockGetUserRole.mockResolvedValue("admin");
    const guard = await requirePermission(
      reqWithCookie(`${SESSION_COOKIE}=valid-token`),
      "users.manage",
    );
    expect(guard).toEqual({ ok: false, status: 403, error: expect.any(String) });
  });

  /**
   * Fix round 2 regression: decodeURIComponent throws URIError on a malformed
   * percent-sequence, and anyone can set one from devtools or a buggy proxy.
   * Unhandled, that throw propagates out of resolveSession as a REJECTED
   * promise (a thrown error inside an async function rejects it), then out of
   * requirePermission the same way, then out of the route handler as a bare
   * 500 -- a denial of service, and worse than the encoding bug the decode
   * exists to prevent. A cookie that cannot be decoded cannot be verified, so
   * it must fall through to the ordinary "no token" 401 path, not reject.
   *
   * `.resolves.toEqual(...)` is used deliberately instead of
   * `await requirePermission(...); expect(guard).toEqual(...)` -- if the
   * try/catch were removed, the awaited call would throw *before* a `guard`
   * value ever existed to assert on, which would surface as an uncaught
   * exception failing the test for the right underlying reason but the wrong
   * visible one. `.resolves` fails loudly and specifically on a rejection.
   */
  describe("malformed percent-encoded cookie value (must 401, never reject)", () => {
    it("a bare '%' does not crash the guard", async () => {
      mockVerifySession.mockResolvedValue(null);
      await expect(
        requirePermission(reqWithCookie(`${SESSION_COOKIE}=%`), "sales.view"),
      ).resolves.toEqual({ ok: false, status: 401, error: expect.any(String) });
      // The catch must have set token back to undefined -- proves the malformed
      // value never reached verifySession, not just that *some* 401 came back.
      expect(mockVerifySession).toHaveBeenCalledWith(undefined);
    });

    it("an invalid hex escape '%zz' does not crash the guard", async () => {
      mockVerifySession.mockResolvedValue(null);
      await expect(
        requirePermission(reqWithCookie(`${SESSION_COOKIE}=%zz`), "sales.view"),
      ).resolves.toEqual({ ok: false, status: 401, error: expect.any(String) });
      expect(mockVerifySession).toHaveBeenCalledWith(undefined);
    });

    it("a truncated multi-byte escape '%E0' does not crash the guard", async () => {
      mockVerifySession.mockResolvedValue(null);
      await expect(
        requirePermission(reqWithCookie(`${SESSION_COOKIE}=%E0`), "sales.view"),
      ).resolves.toEqual({ ok: false, status: 401, error: expect.any(String) });
      expect(mockVerifySession).toHaveBeenCalledWith(undefined);
    });
  });
});

describe("guardResponse", () => {
  it("serializes a denial to the matching HTTP status and error body", async () => {
    const res = guardResponse({ ok: false, status: 403, error: "nope" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "nope" });
  });
});
