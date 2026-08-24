import { describe, expect, it } from "vitest";
import {
  buildMasterClientList,
  isIdentifyingDomain,
  siteIsRetired,
  squash,
  type ClientGroup,
} from "./normalize";
import { SITE_EXPORT_CSV } from "./siteExport";

const HEADER =
  "Customer,Site Name,Contact Name,Phone Number,Mobile Number,Fax Number,Email Address," +
  "Address Street,Address City,Address Region,Address Postal Code,Address Country," +
  "Custom 1,Custom 2,Custom 3,Custom 4,Archived";

/** Build a one-line CSV row from the fields a case actually cares about. */
function row(fields: Partial<Record<string, string>>): string {
  const order = [
    "Customer",
    "Site Name",
    "Contact Name",
    "Phone Number",
    "Mobile Number",
    "Fax Number",
    "Email Address",
    "Address Street",
    "Address City",
    "Address Region",
    "Address Postal Code",
    "Address Country",
    "Custom 1",
    "Custom 2",
    "Custom 3",
    "Custom 4",
    "Archived",
  ];
  return order.map((k) => `"${(fields[k] ?? "").replace(/"/g, '""')}"`).join(",");
}

function build(...rows: string[]) {
  return buildMasterClientList([HEADER, ...rows].join("\n"));
}

function byName(list: { groups: ClientGroup[] }, name: string): ClientGroup {
  const found = list.groups.find((g) => g.name === name);
  if (!found) throw new Error(`no group named "${name}" — got ${list.groups.map((g) => g.name).join(", ")}`);
  return found;
}

describe("buildMasterClientList — folding spellings", () => {
  it("folds a hand-verified family into one customer and keeps its branches", () => {
    const list = build(
      row({ Customer: "Ace Body Corp - Aspendale", "Site Name": "602 Bonbeach" }),
      row({ Customer: "ACE Body Corp - Brighton", "Site Name": "2 Leman Cres" }),
      row({ Customer: "Ace Body Corporate Management - Collingwood", "Site Name": "12 Smith St" }),
      row({ Customer: "Ace Body Corporate Management Croydon & Dandenong", "Site Name": "9 Main St" }),
    );

    expect(list.groups).toHaveLength(1);
    const ace = list.groups[0];
    expect(ace.name).toBe("Ace Body Corporate Management");
    expect(ace.branches).toEqual(["Aspendale", "Brighton", "Collingwood", "Croydon & Dandenong"]);
    expect(ace.siteCount).toBe(4);
    expect(ace.aliases).toHaveLength(4);
  });

  it("treats a bare family name as head office, not as a branch", () => {
    const list = build(
      row({ Customer: "MBCM", "Site Name": "HQ" }),
      row({ Customer: "MBCM - Mitcham", "Site Name": "1 Whitehorse Rd" }),
      row({ Customer: "MBCM Strata Specialists", "Site Name": "2 Whitehorse Rd" }),
    );

    const mbcm = byName(list, "MBCM Strata Specialists");
    expect(mbcm.siteCount).toBe(3);
    // "Strata Specialists" is a legal/trading suffix, not a suburb
    expect(mbcm.branches).toEqual(["Mitcham"]);
  });

  it("splits a generic 'Brand - Suburb' pair only when the export proves it is a family", () => {
    const proven = build(
      row({ Customer: "Ironman - Kilsyth", "Site Name": "A" }),
      row({ Customer: "Ironman - Ringwood", "Site Name": "B" }),
    );
    expect(proven.groups).toHaveLength(1);
    expect(proven.groups[0].name).toBe("Ironman");
    expect(proven.groups[0].branches).toEqual(["Kilsyth", "Ringwood"]);

    // A one-off hyphenated name is a whole name — "Brant - John Deere" is a
    // John Deere dealership, not a "Brant" branch.
    const oneOff = build(
      row({ Customer: "Brant - John Deere", "Site Name": "A" }),
      row({ Customer: "Vemi - Vandaag & Morgan Pty Ltd", "Site Name": "B" }),
    );
    expect(oneOff.groups.map((g) => g.name).sort()).toEqual([
      "Brant - John Deere",
      "Vemi - Vandaag & Morgan",
    ]);
    expect(oneOff.groups.every((g) => g.branches.length === 0)).toBe(true);
  });

  it("strips legal noise, a care-of agent, and an ACN so both spellings meet", () => {
    const list = build(
      row({ Customer: "Residential Indepedence Pty Ltd (1)", "Site Name": "A" }),
      row({
        Customer: "Residential Indepedence Pty Ltd, Care of:/ Noble Knight Real Estate Pty Ltd",
        "Site Name": "B",
      }),
      row({ Customer: "Green Leaves (VIC3) Early Learning Centres Pty Ltd ACN 608 039 112", "Site Name": "C" }),
      row({ Customer: "Green Leaves Early Learning", "Site Name": "D" }),
    );

    expect(byName(list, "Residential Independence").siteCount).toBe(2);
    expect(byName(list, "Green Leaves Early Learning").siteCount).toBe(2);
  });

  it("folds the 'Yarra Rangers' typo but leaves Yarra Ranges Council alone", () => {
    const list = build(
      row({ Customer: "Yarra Ranges Kinders", "Site Name": "A" }),
      row({ Customer: "Yarra Rangers Kinders", "Site Name": "B" }),
      row({ Customer: "Yarra Ranges Council", "Site Name": "C" }),
    );

    expect(byName(list, "Yarra Ranges Kinders").siteCount).toBe(2);
    expect(byName(list, "Yarra Ranges Council").siteCount).toBe(1);
  });
});

describe("buildMasterClientList — flags", () => {
  it("flags APMG's own jobs as internal rather than as a customer", () => {
    const list = build(
      row({ Customer: "APMG Painting", "Site Name": "A" }),
      row({ Customer: "PERFORMANCE ASSET MANAGEMENT MELBOURNE", "Site Name": "B" }),
    );
    expect(list.groups).toHaveLength(1);
    expect(list.groups[0].flag).toBe("internal");
    expect(list.stats.clients).toBe(1);
    expect(list.stats.active).toBe(0);
  });

  it("flags test records without deleting them", () => {
    const list = build(row({ Customer: "Carly Test", "Site Name": "A" }));
    expect(list.groups[0].flag).toBe("do-not-use");
    expect(list.groups[0].kind).toBe("individual");
  });

  it("keeps a customer live when only a duplicate record was retired", () => {
    // Noble Knight appears twice: a live record and one tagged (DONT USE).
    // Folding must not retire the live customer.
    const list = build(
      row({ Customer: "Noble Knight (DONT USE)", "Site Name": "A" }),
      row({ Customer: "Noble Knight Real Estate Pty Ltd", "Site Name": "B" }),
    );
    expect(list.groups).toHaveLength(1);
    expect(list.groups[0].flag).toBe("active");
    expect(list.groups[0].aliases).toContain("Noble Knight (DONT USE)");
  });
});

describe("buildMasterClientList — sites and contacts", () => {
  it("drops the customer's name off the front of a site label", () => {
    const list = build(
      row({ Customer: "Guardian Childcare & Education", "Site Name": "Guardian Childcare & Education Caulfield" }),
    );
    expect(list.groups[0].sites[0].siteName).toBe("Caulfield");
  });

  it("reads a bracketed status marker as archived and drops it from the label", () => {
    const list = build(
      row({ Customer: "Guardian Childcare & Education", "Site Name": "[CLOSED] St Kilda North" }),
      row({ Customer: "Guardian Childcare & Education", "Site Name": "Abbotsford", Archived: "No" }),
    );
    const g = list.groups[0];
    expect(g.archivedSites).toBe(1);
    expect(g.sites.map((s) => s.siteName).sort()).toEqual(["Abbotsford", "St Kilda North"]);
    expect(siteIsRetired("[OLD] Carlton")).toBe(true);
    expect(siteIsRetired("Carlton")).toBe(false);
  });

  it("scrapes addresses out of every column, including the Custom ones", () => {
    const list = build(
      row({
        Customer: "Boongalla Group",
        "Site Name": "A",
        "Email Address": "one@boongallagroup.com.au",
        // an operator pasted the billing contact into a Custom column
        "Custom 1": "bvatandas@boongallagroup.com.au",
      }),
      row({
        Customer: "Boongalla Group",
        "Site Name": "B",
        // two addresses in one cell, as the export does in places
        "Email Address": "aamax@bigpond.com, capewrath@ymail.com",
      }),
    );
    const g = list.groups[0];
    expect(g.emails).toContain("bvatandas@boongallagroup.com.au");
    expect(g.emails).toContain("capewrath@ymail.com");
    expect(g.emails).toHaveLength(4);
    // free providers never become an identifying domain
    expect(g.domains).toEqual(["boongallagroup.com.au"]);
  });

  it("survives a zero-width character inside an address", () => {
    const zw = String.fromCharCode(0x200b);
    const list = build(
      row({ Customer: "Guardian Childcare & Education", "Site Name": "A", "Email Address": `boxhillnorth${zw}@guardian.edu.au` }),
    );
    expect(list.groups[0].emails).toEqual(["boxhillnorth@guardian.edu.au"]);
  });

  it("folds state abbreviations so a facet can't list the same state twice", () => {
    const list = build(
      row({ Customer: "Acme Strata", "Site Name": "A", "Address Region": "VIC" }),
      row({ Customer: "Acme Strata", "Site Name": "B", "Address Region": "Victoria" }),
      row({ Customer: "Acme Strata", "Site Name": "C", "Address Region": "New South Wales" }),
    );
    expect(list.groups[0].states).toEqual(["New South Wales", "Victoria"]);
  });
});

describe("isIdentifyingDomain", () => {
  it("rejects domains that belong to nobody in particular", () => {
    // consumer providers
    expect(isIdentifyingDomain("gmail.com")).toBe(false);
    expect(isIdentifyingDomain("bigpond.net.au")).toBe(false);
    // APMG's own address, which sits on 71 rows as the billing contact
    expect(isIdentifyingDomain("apmgservices.com.au")).toBe(false);
    // shared public-sector domain — several unrelated kinders use it
    expect(isIdentifyingDomain("kindergarten.vic.gov.au")).toBe(false);
  });

  it("accepts a real business domain", () => {
    expect(isIdentifyingDomain("whittles.com.au")).toBe(true);
    expect(isIdentifyingDomain("MBCM.com.au")).toBe(true);
  });
});

describe("the live export", () => {
  const list = buildMasterClientList(SITE_EXPORT_CSV);

  it("reads every row and folds the duplicate spellings", () => {
    expect(list.stats.rows).toBe(1385);
    expect(list.stats.sites).toBe(1385);
    // 265 raw spellings → 228 real customers. If a re-export moves these, the
    // numbers are meant to be updated here deliberately, not loosened away.
    expect(list.stats.rawCustomers).toBe(265);
    expect(list.stats.clients).toBe(228);
    expect(list.stats.duplicatesFolded).toBe(37);
    expect(list.stats.clients).toBe(list.stats.active + list.stats.excluded);
    expect(list.stats.clients).toBe(list.stats.organisations + list.stats.individuals);
  });

  it("puts the twelve known families back together", () => {
    const folded = new Map(list.groups.filter((g) => g.aliases.length > 1).map((g) => [g.name, g]));
    expect([...folded.keys()].sort()).toEqual([
      "APMG (internal)",
      "Ace Body Corporate Management",
      "Green Leaves Early Learning",
      "MBCM Strata Specialists",
      "Mayfield Childcare",
      "Noble Knight Real Estate",
      "Noel Jones Real Estate",
      "Residential Independence",
      "The Knight",
      "Whittles",
      "Woodlands Childcare & Education",
      "Yarra Ranges Kinders",
    ]);

    // the two worst offenders, in full
    expect(folded.get("MBCM Strata Specialists")!.aliases).toHaveLength(17);
    expect(folded.get("MBCM Strata Specialists")!.branches).toHaveLength(15);
    expect(folded.get("Ace Body Corporate Management")!.aliases).toHaveLength(9);
  });

  it("classifies every current customer without guessing", () => {
    // Companies named after people must not read as private individuals.
    for (const name of [
      "Barry Plant",
      "Nelson Alexander",
      "Noel Jones Real Estate",
      "Woodards Camberwell",
      "Oscar Wylee",
      "Explorers Early Learning",
      "Choklits Child Care",
      "Ray White Berwick",
    ]) {
      expect(byName(list, name).kind, name).toBe("organisation");
    }
    for (const name of ["Adam Saad", "Kathy Wilton", "Peter and Sandy", "Xiang Wang"]) {
      expect(byName(list, name).kind, name).toBe("individual");
    }
  });

  it("holds back only APMG's own jobs and the two test records", () => {
    expect(list.groups.filter((g) => g.flag !== "active").map((g) => g.name).sort()).toEqual([
      "APMG (internal)",
      "Carly Test",
      "Craig Test",
    ]);
  });

  it("gives every group a unique key", () => {
    const keys = new Set(list.groups.map((g) => g.key));
    expect(keys.size).toBe(list.groups.length);
    expect(keys.has(squash("MBCM Strata Specialists"))).toBe(true);
  });

  it("orders the biggest customers first", () => {
    expect(list.groups[0].name).toBe("City Integrated Maintenance Services (Aus)");
    expect(list.groups[0].siteCount).toBe(364);
    for (let i = 1; i < list.groups.length; i++) {
      expect(list.groups[i - 1].siteCount).toBeGreaterThanOrEqual(list.groups[i].siteCount);
    }
  });
});
