import { describe, expect, it } from "vitest";
import {
  MAIN_ADMIN_EMAIL,
  assertWorkspaceIdentity,
  denyRoleChange,
  effectiveRole,
  isSafeNextPath,
} from "./policy";

const DOMAIN = "apmgservices.com.au";

describe("assertWorkspaceIdentity", () => {
  it("accepts a verified address on the allowed domain", () => {
    const r = assertWorkspaceIdentity(
      { email: "simon@apmgservices.com.au", email_verified: true },
      DOMAIN,
    );
    expect(r).toEqual({ ok: true, email: "simon@apmgservices.com.au" });
  });

  it("lowercases the address so identity cannot fork on case", () => {
    const r = assertWorkspaceIdentity(
      { email: "Simon@APMGServices.com.au", email_verified: true },
      DOMAIN,
    );
    expect(r).toEqual({ ok: true, email: "simon@apmgservices.com.au" });
  });

  it("rejects another domain", () => {
    const r = assertWorkspaceIdentity(
      { email: "attacker@gmail.com", email_verified: true },
      DOMAIN,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an unverified address", () => {
    const r = assertWorkspaceIdentity(
      { email: "simon@apmgservices.com.au", email_verified: false },
      DOMAIN,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a missing address", () => {
    expect(assertWorkspaceIdentity({ email_verified: true }, DOMAIN).ok).toBe(false);
  });

  it("rejects a mismatched hd claim even when the address looks right", () => {
    const r = assertWorkspaceIdentity(
      { email: "simon@apmgservices.com.au", email_verified: true, hd: "elsewhere.com" },
      DOMAIN,
    );
    expect(r.ok).toBe(false);
  });
});

describe("effectiveRole", () => {
  it("returns the true role when not viewing as anything", () => {
    expect(effectiveRole("admin", null)).toBe("admin");
  });

  it("honours viewAs for a role that may impersonate", () => {
    expect(effectiveRole("admin", "sales")).toBe("sales");
  });

  it("IGNORES a forged viewAs from a role that may not impersonate", () => {
    expect(effectiveRole("sales", "admin")).toBe("sales");
    expect(effectiveRole("pending", "admin")).toBe("pending");
  });

  it("is a no-op when viewAs equals the true role", () => {
    expect(effectiveRole("admin", "admin")).toBe("admin");
  });
});

describe("denyRoleChange", () => {
  const base = { actorEmail: "other@apmgservices.com.au", adminEmails: [MAIN_ADMIN_EMAIL, "other@apmgservices.com.au"] };

  it("blocks demoting the main admin", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL, nextRole: "sales" }),
    ).toBe("main-admin");
  });

  it("blocks changing your own role", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: "other@apmgservices.com.au", nextRole: "sales" }),
    ).toBe("self");
  });

  it("blocks demoting the last remaining admin", () => {
    expect(
      denyRoleChange({
        actorEmail: "someone@apmgservices.com.au",
        targetEmail: "solo@apmgservices.com.au",
        nextRole: "sales",
        adminEmails: ["solo@apmgservices.com.au"],
      }),
    ).toBe("last-admin");
  });

  it("allows a normal promotion", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: "nicole@apmgservices.com.au", nextRole: "sales" }),
    ).toBeNull();
  });

  it("allows setting the main admin to admin (a no-op change)", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL, nextRole: "admin" }),
    ).toBeNull();
  });

  it("compares case-insensitively", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL.toUpperCase(), nextRole: "client" }),
    ).toBe("main-admin");
  });
});

describe("isSafeNextPath", () => {
  it("accepts a same-origin relative path", () => {
    expect(isSafeNextPath("/leads")).toBe(true);
    expect(isSafeNextPath("/")).toBe(true);
    expect(isSafeNextPath("/a?b=c")).toBe(true);
  });

  it("rejects a protocol-relative URL (the open-redirect vector)", () => {
    expect(isSafeNextPath("//evil.example")).toBe(false);
  });

  it("rejects an absolute URL", () => {
    expect(isSafeNextPath("https://evil.example")).toBe(false);
    expect(isSafeNextPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects a backslash-prefixed path some browsers normalise to //", () => {
    expect(isSafeNextPath("/\\evil.example")).toBe(false);
  });

  it("rejects control characters a URL parser would strip", () => {
    // Every browser and Node strip TAB/CR/LF from anywhere in the string
    // BEFORE reading its structure, so these parse as //evil.example.
    expect(isSafeNextPath("/\t/evil.example")).toBe(false);
    expect(isSafeNextPath("/\n/evil.example")).toBe(false);
    expect(isSafeNextPath("/\r/evil.example")).toBe(false);
    expect(isSafeNextPath("/\t\\evil.example")).toBe(false);
  });

  it("rejects empty and missing values", () => {
    expect(isSafeNextPath("")).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
  });
});
