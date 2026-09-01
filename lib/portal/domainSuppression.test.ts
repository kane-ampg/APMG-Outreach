import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSuppressedDomains, organisationDomain } from "./server";

describe("organisationDomain", () => {
  it("returns the domain of a business address", () => {
    expect(organisationDomain("info@jennyselc.com.au")).toBe("jennyselc.com.au");
  });

  it("lowercases and trims", () => {
    expect(organisationDomain("Info@JennysELC.com.au")).toBe("jennyselc.com.au");
  });

  it("refuses public mailbox providers, so one opt-out cannot mute a whole provider", () => {
    for (const e of ["a@gmail.com", "b@bigpond.com", "c@outlook.com", "d@yahoo.com.au", "e@icloud.com"]) {
      expect(organisationDomain(e)).toBeNull();
    }
  });

  it("refuses anything that is not a parseable domain", () => {
    for (const e of ["", "no-at-sign", "@nothing.com", "a@", "a@localhost", "a@-bad.com", "a@bad-.com"]) {
      expect(organisationDomain(e)).toBeNull();
    }
  });

  it("never returns a value that could break out of a PostgREST filter", () => {
    for (const e of ["a@ev,il.com", "a@ev)il.com", "a@ev il.com", "a@ev*il.com"]) {
      expect(organisationDomain(e)).toBeNull();
    }
  });
});

describe("fetchSuppressedDomains", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubFetch(rows: unknown, ok = true) {
    const fetchMock = vi.fn(async () => ({
      ok,
      status: ok ? 200 : 500,
      json: async () => rows,
      text: async () => JSON.stringify(rows),
    })) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock as unknown as ReturnType<typeof vi.fn>;
  }

  it("maps an organisation domain to the colleague who opted out", async () => {
    stubFetch([{ email: "maidengully@jennyselc.com.au" }]);
    const out = await fetchSuppressedDomains("https://db.test", "key", ["info@jennyselc.com.au"]);
    expect(out.get("jennyselc.com.au")).toBe("maidengully@jennyselc.com.au");
  });

  it("does not ask about public providers at all", async () => {
    const f = stubFetch([]);
    await fetchSuppressedDomains("https://db.test", "key", ["someone@gmail.com"]);
    expect(f).not.toHaveBeenCalled();
  });

  it("ignores a suffix match on a domain it never asked about", async () => {
    // `ilike *@jennyselc.com.au` cannot match this, but a widened filter or a
    // future refactor could — the re-check must hold the line either way.
    stubFetch([{ email: "someone@notjennyselc.com.au" }]);
    const out = await fetchSuppressedDomains("https://db.test", "key", ["info@jennyselc.com.au"]);
    expect(out.size).toBe(0);
  });

  it("fails OPEN when the lookup errors, so a broken table never blocks a send", async () => {
    stubFetch({ message: "relation does not exist" }, false);
    const out = await fetchSuppressedDomains("https://db.test", "key", ["info@jennyselc.com.au"]);
    expect(out.size).toBe(0);
  });

  it("fails OPEN when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch);
    const out = await fetchSuppressedDomains("https://db.test", "key", ["info@jennyselc.com.au"]);
    expect(out.size).toBe(0);
  });
});
