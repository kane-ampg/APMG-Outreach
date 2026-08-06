import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/**
 * The Directory client's job is to turn Google's roster into a list we are
 * willing to show as assignable. Everything asserted here is a rule about what
 * gets LEFT OUT — those are the ones that fail silently and invisibly if they
 * regress, because a wrong extra row looks exactly like a right one.
 *
 * A real RSA key is generated per run rather than checked in: the module signs
 * a JWT with `crypto.createSign`, which rejects a fake PEM, and a committed
 * private key is a bad habit even when it guards nothing.
 */
const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

const fetchMock = vi.fn();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TOKEN_OK = () => json({ access_token: "test-token", expires_in: 3600 });

function user(overrides: Record<string, unknown>) {
  return { primaryEmail: "someone@apmgservices.com.au", name: { fullName: "Someone" }, ...overrides };
}

/** Fresh module per test — the client caches both the token and the roster in
 *  module scope, which would otherwise leak between cases. */
async function loadDirectory() {
  vi.resetModules();
  return import("./directory");
}

function configure() {
  vi.stubEnv("GOOGLE_WORKSPACE_SA_EMAIL", "sa@project.iam.gserviceaccount.com");
  vi.stubEnv("GOOGLE_WORKSPACE_SA_PRIVATE_KEY", privateKey);
  vi.stubEnv("GOOGLE_WORKSPACE_ADMIN_EMAIL", "kane@apmgservices.com.au");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("configuration", () => {
  it("reports unconfigured, naming the missing vars, without calling Google", async () => {
    const { fetchWorkspaceDirectory, isDirectoryConfigured } = await loadDirectory();
    expect(isDirectoryConfigured()).toBe(false);

    const result = await fetchWorkspaceDirectory();
    expect(result.state).toBe("unconfigured");
    // The banner shows this string verbatim, so it has to be actionable.
    if (result.state === "unconfigured") {
      expect(result.reason).toContain("GOOGLE_WORKSPACE_SA_EMAIL");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("impersonates the configured admin, because the API rejects a bare service account", async () => {
    configure();
    fetchMock.mockResolvedValueOnce(TOKEN_OK()).mockResolvedValueOnce(json({ users: [] }));

    const { fetchWorkspaceDirectory } = await loadDirectory();
    await fetchWorkspaceDirectory();

    const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
    const claims = JSON.parse(
      Buffer.from(String(body.get("assertion")).split(".")[1], "base64url").toString(),
    );
    expect(claims.sub).toBe("kane@apmgservices.com.au");
    expect(claims.scope).toContain("admin.directory.user.readonly");
  });
});

describe("who makes it into the list", () => {
  beforeEach(configure);

  it("drops suspended and archived accounts, and counts them", async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_OK()).mockResolvedValueOnce(
      json({
        users: [
          user({ primaryEmail: "active@apmgservices.com.au" }),
          user({ primaryEmail: "gone@apmgservices.com.au", suspended: true }),
          user({ primaryEmail: "old@apmgservices.com.au", archived: true }),
        ],
      }),
    );

    const { fetchWorkspaceDirectory } = await loadDirectory();
    const result = await fetchWorkspaceDirectory();

    expect(result.state).toBe("synced");
    if (result.state !== "synced") return;
    expect(result.people.map((p) => p.email)).toEqual(["active@apmgservices.com.au"]);
    // Surfaced, not swallowed: the pane says "2 suspended hidden".
    expect(result.suspendedHidden).toBe(2);
  });

  it("drops addresses outside the sign-in domain", async () => {
    // A multi-domain Workspace returns these. Listing them as assignable would
    // promise access that assertWorkspaceIdentity refuses at the door.
    fetchMock.mockResolvedValueOnce(TOKEN_OK()).mockResolvedValueOnce(
      json({
        users: [
          user({ primaryEmail: "staff@apmgservices.com.au" }),
          user({ primaryEmail: "other@someotherdomain.com" }),
        ],
      }),
    );

    const { fetchWorkspaceDirectory } = await loadDirectory();
    const result = await fetchWorkspaceDirectory();

    if (result.state !== "synced") throw new Error("expected synced");
    expect(result.people.map((p) => p.email)).toEqual(["staff@apmgservices.com.au"]);
    // Not counted as suspended — it is a different exclusion entirely.
    expect(result.suspendedHidden).toBe(0);
  });

  it("lowercases emails so they join against app_users", async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK())
      .mockResolvedValueOnce(json({ users: [user({ primaryEmail: "Mixed.Case@APMGServices.com.au" })] }));

    const { fetchWorkspaceDirectory } = await loadDirectory();
    const result = await fetchWorkspaceDirectory();

    if (result.state !== "synced") throw new Error("expected synced");
    expect(result.people[0].email).toBe("mixed.case@apmgservices.com.au");
  });

  it("follows nextPageToken to the end", async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK())
      .mockResolvedValueOnce(
        json({ users: [user({ primaryEmail: "one@apmgservices.com.au" })], nextPageToken: "p2" }),
      )
      .mockResolvedValueOnce(json({ users: [user({ primaryEmail: "two@apmgservices.com.au" })] }));

    const { fetchWorkspaceDirectory } = await loadDirectory();
    const result = await fetchWorkspaceDirectory();

    if (result.state !== "synced") throw new Error("expected synced");
    expect(result.people.map((p) => p.email)).toEqual([
      "one@apmgservices.com.au",
      "two@apmgservices.com.au",
    ]);
  });
});

describe("department resolution", () => {
  beforeEach(configure);

  async function departmentFor(overrides: Record<string, unknown>) {
    fetchMock.mockResolvedValueOnce(TOKEN_OK()).mockResolvedValueOnce(json({ users: [user(overrides)] }));
    const { fetchWorkspaceDirectory } = await loadDirectory();
    const result = await fetchWorkspaceDirectory();
    if (result.state !== "synced") throw new Error("expected synced");
    return result.people[0].department;
  }

  it("prefers the primary organization's department", async () => {
    expect(
      await departmentFor({
        organizations: [
          { department: "Ops", primary: false },
          { department: "Sales", primary: true },
        ],
      }),
    ).toBe("Sales");
  });

  it("falls back to the org unit path when no department is set", async () => {
    expect(await departmentFor({ orgUnitPath: "/Sales/Inbound" })).toBe("Sales · Inbound");
  });

  it("treats the root org unit as no department, not as a department named /", async () => {
    expect(await departmentFor({ orgUnitPath: "/" })).toBeNull();
  });
});

describe("failure and caching", () => {
  beforeEach(configure);

  it("degrades to an error state instead of throwing at the route", async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK())
      .mockResolvedValueOnce(new Response("nope", { status: 403 }));

    const { fetchWorkspaceDirectory } = await loadDirectory();
    const result = await fetchWorkspaceDirectory();
    expect(result.state).toBe("error");
  });

  it("explains unauthorized_client, the usual delegation mistake", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: "unauthorized_client" }, 401));

    const { fetchWorkspaceDirectory } = await loadDirectory();
    const result = await fetchWorkspaceDirectory();

    if (result.state !== "error") throw new Error("expected error");
    expect(result.reason).toContain("Domain-wide delegation");
  });

  it("serves a second call from cache without re-hitting Google", async () => {
    fetchMock.mockResolvedValueOnce(TOKEN_OK()).mockResolvedValueOnce(json({ users: [] }));

    const { fetchWorkspaceDirectory } = await loadDirectory();
    await fetchWorkspaceDirectory();
    await fetchWorkspaceDirectory();

    expect(fetchMock).toHaveBeenCalledTimes(2); // token + one list, not four
  });

  it("does not cache a failure, so recovery is immediate", async () => {
    fetchMock
      .mockResolvedValueOnce(TOKEN_OK())
      .mockResolvedValueOnce(new Response("boom", { status: 500 }))
      .mockResolvedValueOnce(json({ users: [user({ primaryEmail: "back@apmgservices.com.au" })] }));

    const { fetchWorkspaceDirectory } = await loadDirectory();
    expect((await fetchWorkspaceDirectory()).state).toBe("error");

    const second = await fetchWorkspaceDirectory();
    expect(second.state).toBe("synced");
    if (second.state !== "synced") return;
    expect(second.people).toHaveLength(1);
  });
});
