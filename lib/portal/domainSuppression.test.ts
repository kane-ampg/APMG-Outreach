import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSuppressedDomains, isKnownCampaign, organisationDomain } from "./server";

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

/* ── the rollup only widens on a verifiable address ─────────────────────────
   Exact-address suppression honours every row unconditionally. Widening one
   row to a whole organisation is a different act: on 2026-09-03, 129 rewritten
   rows carrying mangled local parts on REAL domains had muted 89 organisations
   — every VIC and QLD state school among them — off requests nobody made. */

describe("fetchSuppressedDomains — unverifiable rows", () => {
  afterEach(() => vi.unstubAllGlobals());

  /** Answers the suppression query and the leads lookup differently, the way
   *  Supabase does: `heldOnLead` decides what the leads table returns. */
  function stubTwoTables(suppressed: Array<{ email: string }>, heldOnLead: boolean) {
    const fetchMock = vi.fn(async (url: unknown) => {
      const rows = String(url).includes("/leads") ? (heldOnLead ? [{ id: "x" }] : []) : suppressed;
      return { ok: true, status: 200, json: async () => rows, text: async () => JSON.stringify(rows) };
    }) as unknown as typeof fetch;
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock as unknown as ReturnType<typeof vi.fn>;
  }

  it("ignores a row whose address is held on no lead", async () => {
    stubTwoTables([{ email: "cybdxchea.uf@education.vic.gov.au" }], false);
    const out = await fetchSuppressedDomains("https://db.test", "key", [
      "eltham.ps@education.vic.gov.au",
    ]);
    expect(out.size).toBe(0);
  });

  it("still rolls up a genuine opt-out from an address we hold", async () => {
    stubTwoTables([{ email: "maidengully@jennyselc.com.au" }], true);
    const out = await fetchSuppressedDomains("https://db.test", "key", ["info@jennyselc.com.au"]);
    expect(out.get("jennyselc.com.au")).toBe("maidengully@jennyselc.com.au");
  });
});

/* ── whole-of-government school domains ──────────────────────────────────── */

describe("organisationDomain — shared institution domains", () => {
  it("refuses whole-of-government school domains", () => {
    // Different schools, different people, one mail domain. A rollup here mutes
    // every state school in the state — which is exactly what happened.
    for (const e of [
      "eltham.ps@education.vic.gov.au",
      "greensborough.ps@edumail.vic.gov.au",
      "principal@eq.edu.au",
      "a@education.nsw.gov.au",
      "b@sa.edu.au",
    ]) {
      expect(organisationDomain(e)).toBeNull();
    }
  });

  it("still treats an individual school's own domain as an organisation", () => {
    // mhs.vic.edu.au is one school on its own domain — the rollup belongs there.
    expect(organisationDomain("mhs@mhs.vic.edu.au")).toBe("mhs.vic.edu.au");
    expect(organisationDomain("reception@preshil.vic.edu.au")).toBe("preshil.vic.edu.au");
  });
});

/* ── the campaign ledger ──────────────────────────────────────────────────── */

describe("isKnownCampaign", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stub(rows: unknown, ok = true) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok, status: ok ? 200 : 500,
      json: async () => rows,
      text: async () => JSON.stringify(rows),
    })) as unknown as typeof fetch);
  }

  it("is true for a tag with an email_sent row behind it", async () => {
    stub([{ campaign: "outreach-2026" }]);
    expect(await isKnownCampaign("https://db.test", "k", "outreach-2026")).toBe(true);
  });

  it("is false for a tag that never sent an email", async () => {
    stub([]);
    expect(await isKnownCampaign("https://db.test", "k", "bhgefbdu-5359")).toBe(false);
  });

  it("is false for a tag safeCampaignTag could never have produced", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f as unknown as typeof fetch);
    expect(await isKnownCampaign("https://db.test", "k", "not a tag!")).toBe(false);
    expect(f).not.toHaveBeenCalled();
  });

  it("says nothing (true) when there is no tag at all", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f as unknown as typeof fetch);
    expect(await isKnownCampaign("https://db.test", "k", "")).toBe(true);
    expect(await isKnownCampaign("https://db.test", "k", null)).toBe(true);
    expect(f).not.toHaveBeenCalled();
  });

  it("fails OPEN on a lookup error, so a broken query cannot forge an opt-out", async () => {
    stub({ message: "boom" }, false);
    expect(await isKnownCampaign("https://db.test", "k", "outreach-2026")).toBe(true);
  });

  it("fails OPEN when fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }) as unknown as typeof fetch);
    expect(await isKnownCampaign("https://db.test", "k", "outreach-2026")).toBe(true);
  });
});
