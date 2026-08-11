import { describe, expect, it } from "vitest";
import {
  MAIN_ADMIN_EMAIL,
  assertWorkspaceIdentity,
  denyRoleChange,
  effectiveRoles,
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

describe("effectiveRoles", () => {
  it("returns the held roles when not previewing anything", () => {
    expect(effectiveRoles(["admin"], null)).toEqual(["admin"]);
    expect(effectiveRoles(["client", "sales"], null)).toEqual(["client", "sales"]);
  });

  it("collapses to the single previewed role for someone who may impersonate", () => {
    // The point of a preview is to see LESS than you have. Keeping the admin's
    // own roles alongside the previewed one would show them a console no rep
    // could ever see, which is the opposite of the feature.
    expect(effectiveRoles(["admin"], "sales")).toEqual(["sales"]);
    expect(effectiveRoles(["admin", "sales"], "client")).toEqual(["client"]);
  });

  it("IGNORES a forged viewAs from someone who may not impersonate", () => {
    expect(effectiveRoles(["sales"], "admin")).toEqual(["sales"]);
    expect(effectiveRoles(["client", "sales"], "admin")).toEqual(["client", "sales"]);
    expect(effectiveRoles([], "admin")).toEqual([]);
  });

  it("does not let a previewing admin escalate beyond one real role", () => {
    // viewAs is a single role by construction, so even an authorised preview
    // can never resolve to a set larger than what one role grants.
    expect(effectiveRoles(["admin"], "sales")).toHaveLength(1);
  });

  it("is a no-op when the preview is a role they already hold alone", () => {
    expect(effectiveRoles(["admin"], "admin")).toEqual(["admin"]);
  });
});

describe("denyRoleChange", () => {
  const base = {
    actorEmail: "other@apmgservices.com.au",
    adminEmails: [MAIN_ADMIN_EMAIL, "other@apmgservices.com.au"],
  };

  it("blocks taking admin away from the main admin", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL, nextRoles: ["sales"] }),
    ).toBe("main-admin");
  });

  it("blocks revoking the main admin entirely", () => {
    expect(denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL, nextRoles: [] })).toBe(
      "main-admin",
    );
  });

  it("allows the main admin to gain a role, as long as admin is kept", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL, nextRoles: ["admin", "sales"] }),
    ).toBeNull();
  });

  it("blocks changing your own roles", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: "other@apmgservices.com.au", nextRoles: ["sales"] }),
    ).toBe("self");
  });

  it("blocks taking admin from the last remaining admin", () => {
    expect(
      denyRoleChange({
        actorEmail: "someone@apmgservices.com.au",
        targetEmail: "solo@apmgservices.com.au",
        nextRoles: ["sales"],
        adminEmails: ["solo@apmgservices.com.au"],
      }),
    ).toBe("last-admin");
  });

  it("blocks revoking the last remaining admin outright", () => {
    expect(
      denyRoleChange({
        actorEmail: "someone@apmgservices.com.au",
        targetEmail: "solo@apmgservices.com.au",
        nextRoles: [],
        adminEmails: ["solo@apmgservices.com.au"],
      }),
    ).toBe("last-admin");
  });

  it("allows the last admin to gain roles while staying admin", () => {
    // Adding Sales to the only admin must not read as demoting them — this is
    // the case a naive "did the set change?" check would refuse.
    expect(
      denyRoleChange({
        actorEmail: "someone@apmgservices.com.au",
        targetEmail: "solo@apmgservices.com.au",
        nextRoles: ["admin", "sales"],
        adminEmails: ["solo@apmgservices.com.au"],
      }),
    ).toBeNull();
  });

  it("allows demoting an admin while another admin remains", () => {
    expect(
      denyRoleChange({
        actorEmail: "someone@apmgservices.com.au",
        targetEmail: "one@apmgservices.com.au",
        nextRoles: ["sales"],
        adminEmails: ["one@apmgservices.com.au", "two@apmgservices.com.au"],
      }),
    ).toBeNull();
  });

  it("allows a normal grant", () => {
    expect(
      denyRoleChange({
        ...base,
        targetEmail: "nicole@apmgservices.com.au",
        nextRoles: ["sales", "client"],
      }),
    ).toBeNull();
  });

  it("allows revoking somebody who is not an admin", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: "nicole@apmgservices.com.au", nextRoles: [] }),
    ).toBeNull();
  });

  it("compares case-insensitively", () => {
    expect(
      denyRoleChange({
        ...base,
        targetEmail: MAIN_ADMIN_EMAIL.toUpperCase(),
        nextRoles: ["client"],
      }),
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
