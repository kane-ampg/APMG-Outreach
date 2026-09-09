import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { parseLeadsCsv, type LeadImportRow } from "@/lib/pipeline/csv";
import { leadSource, sourceFilter } from "@/lib/pipeline/source";

/** The real Google Maps scraper export (aged care, inner Melbourne, 2026-09-08). */
const GOOGLE_CSV = readFileSync(
  fileURLToPath(new URL("./__fixtures__/google-maps-scraper.csv", import.meta.url)),
  "utf8",
);

const byName = (rows: LeadImportRow[], name: string): LeadImportRow => {
  const hit = rows.find((r) => r.name === name);
  if (!hit) throw new Error(`no row named ${name}`);
  return hit;
};

describe("Google Maps scraper export", () => {
  const parsed = parseLeadsCsv(GOOGLE_CSV);

  it("maps rows despite the headers being DOM class names", () => {
    expect(parsed.headers[0]).toBe("hfpxzc href");
    expect(parsed.headers[1]).toBe("xxVWCe");
    expect(parsed.rows.length).toBeGreaterThan(80);
    expect(parsed.skipped).toBe(0);
  });

  it("classifies every row as a Google-sourced lead", () => {
    expect(parsed.sources.google).toBe(parsed.rows.length);
    expect(parsed.sources.bing).toBe(0);
  });

  it("drops the repeated listings the scroll re-render produced", () => {
    expect(parsed.duplicates).toBeGreaterThan(0);
    const keys = parsed.rows.map((r) => r.bing_maps_url);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("keeps the first, intact copy when a later duplicate is scrambled", () => {
    // The tail of the file repeats VMCH O'Neill House with Elder Rights'
    // website attached. First-occurrence-wins must keep the real one.
    expect(byName(parsed.rows, "VMCH O'Neill House").website).toBe(
      "https://vmch.com.au/services/palliative-care/oneill-house-prahran/",
    );
    // Same trap: Prague House's duplicate carries aacs.com.au.
    expect(byName(parsed.rows, "Prague House").website).toContain("svhm.org.au");
  });

  it("separates category from address in the anonymous text columns", () => {
    const napier = byName(parsed.rows, "Napier Street Aged Care Services");
    expect(napier.category).toBe("Aged care");
    expect(napier.address).toBe("179 Napier St");

    const alba = byName(parsed.rows, "Australian Unity The Alba Aged Care Suites");
    expect(alba.category).toBe("Aged care");
    expect(alba.address).toBe("114 Albert Rd");

    // Sub-premise addresses must not be read as a category.
    const plena = byName(parsed.rows, "Plena Healthcare");
    expect(plena.address).toBe("Level 4/417 St Kilda Rd");
    expect(plena.category).toBe("Aged care");
  });

  it("leaves category null rather than filing an address under it", () => {
    // This listing showed no category — only "Basement/335 Flinders Ln".
    const view = byName(parsed.rows, "Aged Care View");
    expect(view.address).toBe("Basement/335 Flinders Ln");
    expect(view.category).toBeNull();
  });

  it("never stores a sponsored /aclk redirect as the website", () => {
    for (const row of parsed.rows) {
      expect(row.website ?? "").not.toContain("/aclk");
    }
    // Airlie Ivanhoe is an ad row: real business, no real website to keep.
    const airlie = byName(parsed.rows, "Airlie Ivanhoe");
    expect(airlie.website).toBeNull();
    expect(airlie.address).toBe("1 Waverley Avenue");
    expect(airlie.category).toBe("Retirement community");
  });

  it("drops Google's grey placeholder avatar instead of storing it as a photo", () => {
    for (const row of parsed.rows) {
      expect(row.featured_image ?? "").not.toContain("default_user");
    }
  });

  it("reads phones in whatever column the listing put them in", () => {
    expect(byName(parsed.rows, "Napier Street Aged Care Services").phone).toBe("+61 3 9696 9229");
    // This listing has no website, so every later cell shifted one column left.
    expect(byName(parsed.rows, "St Catherine's Aged Care Facility").phone).toBe("+61 3 9857 9488");
    // Bracketed local form.
    expect(byName(parsed.rows, "Uniting AgeWell Hawthorn AgeWell Centre").phone).toBe("(03) 7503 7200");
  });

  it("keeps ratings inside the 0–5 range and nulls the blanks", () => {
    for (const row of parsed.rows) {
      if (row.rating !== null) {
        expect(row.rating).toBeGreaterThanOrEqual(0);
        expect(row.rating).toBeLessThanOrEqual(5);
      }
    }
    expect(byName(parsed.rows, "Napier Street Aged Care Services").rating).toBe(4.6);
    expect(byName(parsed.rows, "Aged Care Hub").rating).toBeNull();
  });

  it("carries no email addresses — Google Maps has none to give", () => {
    expect(parsed.withEmail).toBe(0);
  });
});

describe("content detection on unfamiliar columns", () => {
  it("finds email, website, phone and socials in unnamed extra columns", () => {
    const csv = [
      '"col_a","col_b","col_c","col_d","col_e","col_f"',
      '"Vic Facilities Group","Aged care","12 Smith St","office@vicfacilities.com.au, admin@vicfacilities.com.au","https://vicfacilities.com.au/","+61 3 9000 1234"',
    ].join("\n");

    const { rows } = parseLeadsCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Vic Facilities Group");
    expect(rows[0].emails).toEqual(["office@vicfacilities.com.au", "admin@vicfacilities.com.au"]);
    expect(rows[0].website).toBe("https://vicfacilities.com.au/");
    expect(rows[0].phone).toBe("+61 3 9000 1234");
    expect(rows[0].category).toBe("Aged care");
    expect(rows[0].address).toBe("12 Smith St");
  });

  it("routes social profiles to their own columns wherever they appear", () => {
    const csv = [
      '"Name","Notes","Extra 1","Extra 2","Extra 3"',
      '"Southbank Care","","https://www.facebook.com/southbankcare","https://instagram.com/southbankcare","https://x.com/southbankcare"',
    ].join("\n");

    const { rows } = parseLeadsCsv(csv);
    expect(rows[0].facebook).toBe("https://www.facebook.com/southbankcare");
    expect(rows[0].instagram).toBe("https://instagram.com/southbankcare");
    expect(rows[0].twitter).toBe("https://x.com/southbankcare");
    expect(rows[0].social_medias).toHaveLength(3);
  });

  it("does not mistake a street number range for a phone number", () => {
    const csv = ['"Name","Address"', '"Villawood Aged Care","1113-1121 High St"'].join("\n");
    const { rows } = parseLeadsCsv(csv);
    expect(rows[0].phone).toBeNull();
    expect(rows[0].address).toBe("1113-1121 High St");
  });
});

describe("Bing Maps scraper export (unchanged behaviour)", () => {
  const csv = [
    '"Name","Address","Featured image","Bing Maps URL","Rating","Category","Website","Phone","Emails","Social Medias","Facebook","Instagram","Twitter"',
    '"Acme HVAC, Pty Ltd","5 Queen St, Melbourne VIC","https://th.bing.com/x.jpg","https://www.bing.com/maps?ss=ypid.YN123","4.5","HVAC services","https://acmehvac.com.au","+61 3 9111 2222","a@acmehvac.com.au, b@acmehvac.com.au","https://www.facebook.com/acme","https://www.facebook.com/acme","### In progress ###","### In progress ###"',
  ].join("\n");

  const { rows, sources } = parseLeadsCsv(csv);

  it("keeps the named-header mapping and the in-progress placeholder rule", () => {
    expect(rows[0].name).toBe("Acme HVAC, Pty Ltd");
    expect(rows[0].address).toBe("5 Queen St, Melbourne VIC");
    expect(rows[0].category).toBe("HVAC services");
    expect(rows[0].rating).toBe(4.5);
    expect(rows[0].website).toBe("https://acmehvac.com.au");
    expect(rows[0].phone).toBe("+61 3 9111 2222");
    expect(rows[0].emails).toEqual(["a@acmehvac.com.au", "b@acmehvac.com.au"]);
    expect(rows[0].instagram).toBeNull();
    expect(rows[0].twitter).toBeNull();
    expect(rows[0].bing_maps_url).toBe("https://www.bing.com/maps?ss=ypid.YN123");
  });

  it("classifies it as a Bing-sourced lead", () => {
    expect(sources.bing).toBe(1);
    expect(sources.google).toBe(0);
  });
});

describe("leadSource", () => {
  it("reads the provider off the maps URL host", () => {
    expect(leadSource("https://www.google.com/maps/place/Foo/data=!4m7")).toBe("google");
    expect(leadSource("https://www.bing.com/maps?ss=ypid.YN123")).toBe("bing");
    expect(leadSource("https://maps.google.com.au/maps/place/Foo")).toBe("google");
    expect(leadSource(null)).toBe("unknown");
    expect(leadSource("")).toBe("unknown");
    expect(leadSource("not a url")).toBe("unknown");
  });

  it("does not misfile a Bing URL that merely mentions google", () => {
    expect(leadSource("https://www.bing.com/maps?q=google+office")).toBe("bing");
  });

  it("builds PostgREST filters that include NULL in the unknown bucket", () => {
    expect(sourceFilter("google")).toBe("bing_maps_url=ilike.*google.*/maps*");
    expect(sourceFilter("unknown")).toContain("bing_maps_url.is.null");
  });
});
