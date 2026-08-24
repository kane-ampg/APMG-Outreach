import { describe, expect, it } from "vitest";
import {
  buildClientGuard,
  matchClient,
  matchReason,
  partitionByClientGuard,
  websiteDomain,
} from "./guard";
import { buildMasterClientList } from "./normalize";
import { SITE_EXPORT_CSV } from "./siteExport";

const list = buildMasterClientList(SITE_EXPORT_CSV);
const guard = buildClientGuard(list);

describe("websiteDomain", () => {
  it("reads a host out of every shape the scraper stores", () => {
    expect(websiteDomain("https://www.whittles.com.au/vic/")).toBe("whittles.com.au");
    expect(websiteDomain("whittles.com.au")).toBe("whittles.com.au");
    expect(websiteDomain("HTTP://WHITTLES.COM.AU")).toBe("whittles.com.au");
    expect(websiteDomain("")).toBeNull();
    expect(websiteDomain(null)).toBeNull();
    // no dot = not a host we can compare
    expect(websiteDomain("localhost")).toBeNull();
  });
});

describe("blocking an existing customer", () => {
  it("blocks on an exact address", () => {
    const match = matchClient({ name: "Some Strata Co", email: "matthew.dodd@acebcm.com.au" }, guard);
    expect(match?.blocked).toBe(true);
    expect(match?.basis).toBe("email");
    expect(match?.clientName).toBe("Ace Body Corporate Management");
  });

  it("blocks on a client's mail domain, whatever the trading name says", () => {
    // The prospect list is scraped, so the same customer turns up under names
    // nobody typed into the job system. The domain is what gives it away.
    const match = matchClient(
      { name: "Whittles Strata Management Melbourne", emails: ["newperson@whittles.com.au"] },
      guard,
    );
    expect(match?.blocked).toBe(true);
    expect(match?.basis).toBe("domain");
    expect(match?.clientName).toBe("Whittles");
  });

  it("blocks on the prospect's website being a client's domain", () => {
    const match = matchClient({ name: "Unknown Body Corp", website: "https://www.nobleknight.com.au" }, guard);
    expect(match?.blocked).toBe(true);
    expect(match?.basis).toBe("website");
    expect(match?.clientName).toBe("Noble Knight Real Estate");
  });

  it("blocks on the exact business name, including a folded spelling", () => {
    // "MBCM - Mitcham" is one of seventeen spellings folded into MBCM. A lead
    // scraped under any of them must still be recognised.
    for (const name of ["MBCM Strata Specialists", "MBCM - Mitcham", "mbcm mordialloc"]) {
      const match = matchClient({ name }, guard);
      expect(match?.blocked, name).toBe(true);
      expect(match?.clientName, name).toBe("MBCM Strata Specialists");
    }
  });

  it("blocks a short exact name that the resemblance tier would never risk", () => {
    const match = matchClient({ name: "Accor" }, guard);
    expect(match?.blocked).toBe(true);
    expect(match?.basis).toBe("name");
  });

  it("blocks APMG's own addresses so a campaign can't email the office", () => {
    const match = matchClient({ name: "APMG Painting" }, guard);
    expect(match?.blocked).toBe(true);
    expect(match?.clientFlag).toBe("internal");
  });
});

describe("not blocking a genuine prospect", () => {
  it("ignores a free-provider address a client happens to use", () => {
    // Two clients are on file at bigpond/ymail addresses. Those domains are
    // shared by thousands of unrelated businesses.
    expect(matchClient({ name: "Totally New Painter", email: "someone@bigpond.com" }, guard)).toBeNull();
    expect(matchClient({ name: "Totally New Painter", email: "someone@gmail.com" }, guard)).toBeNull();
  });

  it("ignores APMG's own domain, which sits on 71 client rows as the billing contact", () => {
    expect(matchClient({ name: "Totally New Painter", email: "x@apmgservices.com.au" }, guard)).toBeNull();
  });

  it("ignores a shared government domain several unrelated kinders use", () => {
    expect(
      matchClient({ name: "Brand New Kinder", email: "hello@kindergarten.vic.gov.au" }, guard),
    ).toBeNull();
  });

  it("does not warn on generic market vocabulary alone", () => {
    // Every second business in this market is a "Strata Management Group".
    // Matching on those words would flag the entire prospect list.
    expect(matchClient({ name: "Strata Management Group" }, guard)).toBeNull();
    expect(matchClient({ name: "Melbourne Property Services Pty Ltd" }, guard)).toBeNull();
    expect(matchClient({ name: "Early Learning Centre" }, guard)).toBeNull();
  });

  it("does not treat a person's surname as a business name", () => {
    // "Chris Brooke" is an individual on the client list. A prospect business
    // whose owner shares that surname is not that client.
    expect(matchClient({ name: "Brooke Plumbing & Gas" }, guard)).toBeNull();
  });

  it("leaves an unrelated business alone", () => {
    expect(
      matchClient(
        {
          name: "Northside Plumbing & Gas",
          website: "https://northsideplumbing.example",
          emails: ["info@northsideplumbing.example"],
        },
        guard,
      ),
    ).toBeNull();
  });
});

describe("the resemblance tier warns instead of blocking", () => {
  it("flags a prospect whose name contains a client's distinctive words", () => {
    const match = matchClient({ name: "Hive Strata Group Pty Ltd" }, guard);
    expect(match).not.toBeNull();
    expect(match?.blocked).toBe(false);
    expect(match?.basis).toBe("resemblance");
    expect(match?.clientName).toBe("Hive Strata");
  });

  it("prefers a certain match over a resemblance when both apply", () => {
    const match = matchClient(
      { name: "Hive Strata Group", email: "someone@hivestrata.com.au" },
      guard,
    );
    expect(match?.basis).toBe("domain");
    expect(match?.blocked).toBe(true);
  });
});

describe("partitionByClientGuard", () => {
  it("separates what may be mailed from what may not", () => {
    const prospects = [
      { name: "Northside Plumbing", email: "info@northsideplumbing.example" },
      { name: "MBCM - Mitcham", email: "office@example.test" },
      { name: "Hive Strata Group", email: "hi@unrelated.example" },
    ];
    const { clear, blocked, warned } = partitionByClientGuard(prospects, guard);

    expect(clear.map((p) => p.name)).toEqual(["Northside Plumbing"]);
    expect(blocked.map((b) => b.prospect.name)).toEqual(["MBCM - Mitcham"]);
    expect(warned.map((w) => w.prospect.name)).toEqual(["Hive Strata Group"]);
    // nothing is silently lost
    expect(clear.length + blocked.length + warned.length).toBe(prospects.length);
  });

  it("explains every verdict in words an operator can act on", () => {
    for (const basis of ["email", "domain", "website", "name", "resemblance"] as const) {
      const match = {
        clientKey: "k",
        clientName: "Whittles",
        clientFlag: "active" as const,
        basis,
        evidence: "whittles.com.au",
        blocked: basis !== "resemblance",
      };
      expect(matchReason(match)).toContain("Whittles");
    }
  });
});

describe("the index built from the live export", () => {
  it("covers every client and their addresses", () => {
    expect(guard.clients).toHaveLength(list.groups.length);
    expect(Object.keys(guard.emails)).toHaveLength(list.stats.emails);
    expect(Object.keys(guard.domains)).toHaveLength(list.stats.domains);
  });

  it("indexes every spelling, not just the canonical name", () => {
    // 265 raw spellings + 228 canonical names, minus the overlap where a
    // canonical name IS one of the spellings.
    expect(Object.keys(guard.names).length).toBeGreaterThanOrEqual(list.stats.rawCustomers);
  });

  it("keeps individuals out of the resemblance tier", () => {
    const individualNames = new Set(
      list.groups.filter((g) => g.kind === "individual").map((g) => g.name),
    );
    for (const [, index] of guard.signatures) {
      expect(individualNames.has(guard.clients[index][1])).toBe(false);
    }
  });

  it("never lets a non-identifying domain into the domain tier", () => {
    for (const domain of Object.keys(guard.domains)) {
      expect(domain.endsWith(".gov.au"), domain).toBe(false);
      expect(domain, domain).not.toBe("gmail.com");
      expect(domain, domain).not.toBe("apmgservices.com.au");
    }
  });
});
