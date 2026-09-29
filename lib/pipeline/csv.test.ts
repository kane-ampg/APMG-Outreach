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

describe("LinkedIn contact export", () => {
  // Synthetic rows in the prospecting tool's 12-column shape, one per edge case
  // seen in the first real export (2026-09-28). BOM included — Excel-saved.
  const HEADER =
    "First Name,Last Name,Full Name,Job Title,Company,Contact Type,Email,Secondary Email,Phone (Masked),Industry,Sub-Industry,Source";
  const csv =
    "﻿" +
    [
      HEADER,
      "Ada,Brook,Ada Brook,Director,Harbour Care,Decision Makers,ada@harbourcare.com.au,,+61 438•••••••,Healthcare,Community & Home Healthcare Services,LinkedIn",
      // secondary on a DIFFERENT organisation's domain — must not be stored
      "Cy,Dale,Cy Dale,Vice Chair,Rural Health Network,Decision Makers,cy.dale@rhn.org.au,cy.dale@health.nsw.gov.au,,Healthcare,Community & Home Healthcare Services,LinkedIn",
      // secondary on the SAME domain — kept
      "Eve,Fox,Eve Fox,Managing Director,Fox Therapy,Decision Makers,eve@foxtherapy.com.au,eve.fox@foxtherapy.com.au,,Healthcare,Community & Home Healthcare Services,LinkedIn",
      // curly apostrophe: not a valid address, and must not be cut down to "brien@…"
      "Gil,O’Brien,Gil O’Brien,Non-Executive Director,Fairway House,Decision Makers,go’brien@fairway.org.au,go@otherorg.org.au,,Healthcare,Community & Home Healthcare Services,LinkedIn",
      // two people at one company are two leads; quoted comma in the title
      'Hal,Iver,Hal Iver,"Founder, Chief Executive Officer",Nordic Care,Decision Makers,hal.iver@nordiccare.se,,,Healthcare,Community & Home Healthcare Services,LinkedIn',
      "Ivy,Jansson,Ivy Jansson,Head of Operations,Nordic Care,Decision Makers,ivy.jansson@nordiccare.se,,,Healthcare,Community & Home Healthcare Services,LinkedIn",
      // exact repeat of an earlier person — dropped as a duplicate
      "Ada,Brook,Ada Brook,Director,Harbour Care,Decision Makers,ADA@harbourcare.com.au,,,Healthcare,Community & Home Healthcare Services,LinkedIn",
      // no company — skipped
      "Jo,Kay,Jo Kay,Director,,Decision Makers,jo@kay.com.au,,,Healthcare,Community & Home Healthcare Services,LinkedIn",
      // no Full Name — built from First + Last; no Sub-Industry — falls back to Industry
      "Lu,Moss,,Director,Moss Clinics,Decision Makers,lu@mossclinics.com.au,,+61 3 9111 2222,Healthcare,,LinkedIn",
    ].join("\r\n");

  const parsed = parseLeadsCsv(csv);
  const byContact = (name: string): LeadImportRow => {
    const hit = parsed.rows.find((r) => r.contact_name === name);
    if (!hit) throw new Error(`no row for ${name}`);
    return hit;
  };

  it("files the company as the lead and keeps the person", () => {
    const r = byContact("Ada Brook");
    expect(r.name).toBe("Harbour Care");
    expect(r.contact_title).toBe("Director");
    expect(r.source).toBe("linkedin");
    expect(parsed.headers[0]).toBe("First Name");
  });

  it("counts every kept row as a LinkedIn lead, none as maps sources", () => {
    expect(parsed.sources.linkedin).toBe(parsed.rows.length);
    expect(parsed.sources.google).toBe(0);
    expect(parsed.sources.bing).toBe(0);
    expect(parsed.sources.unknown).toBe(0);
  });

  it("uses the specific Sub-Industry as the category, else Industry", () => {
    expect(byContact("Ada Brook").category).toBe("Community & Home Healthcare Services");
    expect(byContact("Lu Moss").category).toBe("Healthcare");
  });

  it("builds the contact name from First + Last when Full Name is blank", () => {
    expect(byContact("Lu Moss").name).toBe("Moss Clinics");
  });

  it("stores a secondary email only when it is on the primary's domain", () => {
    expect(byContact("Cy Dale").emails).toEqual(["cy.dale@rhn.org.au"]);
    expect(byContact("Eve Fox").emails).toEqual(["eve@foxtherapy.com.au", "eve.fox@foxtherapy.com.au"]);
  });

  it("rejects a malformed address outright instead of extracting a wrong one", () => {
    const r = byContact("Gil O’Brien");
    expect(r.emails).toEqual([]);
    expect(r.name).toBe("Fairway House");
  });

  it("drops masked phone numbers but keeps real ones", () => {
    expect(byContact("Ada Brook").phone).toBeNull();
    expect(byContact("Lu Moss").phone).toBe("+61 3 9111 2222");
  });

  it("keeps one lead per person, de-dups a repeated person, skips rows with no company", () => {
    expect(parsed.rows.filter((r) => r.name === "Nordic Care")).toHaveLength(2);
    expect(parsed.rows.filter((r) => r.contact_name === "Ada Brook")).toHaveLength(1);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.skipped).toBe(1);
    expect(parsed.totalRows).toBe(9);
    expect(parsed.rows).toHaveLength(7);
    expect(byContact("Hal Iver").contact_title).toBe("Founder, Chief Executive Officer");
  });

  it("stores nothing maps-shaped on a LinkedIn lead", () => {
    const r = byContact("Ada Brook");
    expect(r.bing_maps_url).toBeNull();
    expect(r.address).toBeNull();
    expect(r.rating).toBeNull();
    expect(r.website).toBeNull();
    expect(parsed.withEmail).toBe(6);
  });

  it("files a LinkedIn profile URL column under social profiles", () => {
    const withUrl = parseLeadsCsv(
      [
        "Full Name,Job Title,Company,Email,LinkedIn URL",
        "Ada Brook,Director,Harbour Care,ada@harbourcare.com.au,https://www.linkedin.com/in/ada-brook",
      ].join("\n"),
    );
    expect(withUrl.rows[0].social_medias).toEqual(["https://www.linkedin.com/in/ada-brook"]);
    expect(withUrl.rows[0].source).toBe("linkedin");
  });

  it("leaves maps exports on the maps mapper (no person columns → no contact, no stored source)", () => {
    const bing = parseLeadsCsv(
      ['"Name","Bing Maps URL","Emails"', '"Acme","https://www.bing.com/maps?ss=ypid.YN1","a@acme.com.au"'].join("\n"),
    );
    expect(bing.rows[0].contact_name ?? null).toBeNull();
    expect(bing.rows[0].source ?? null).toBeNull();
    expect(bing.sources.linkedin).toBe(0);
  });
});

describe("leadSource with a stored source", () => {
  it("prefers a known stored source over the URL", () => {
    expect(leadSource(null, "linkedin")).toBe("linkedin");
    expect(leadSource(undefined, "LinkedIn")).toBe("linkedin");
  });

  it("falls back to the URL for legacy rows and unknown stored values", () => {
    expect(leadSource("https://www.bing.com/maps?ss=ypid.YN123", null)).toBe("bing");
    expect(leadSource("https://www.google.com/maps/place/Foo", "someday-source")).toBe("google");
    expect(leadSource(null, "")).toBe("unknown");
  });

  it("filters LinkedIn on the stored column and keeps it out of Unknown", () => {
    expect(sourceFilter("linkedin")).toBe("source=eq.linkedin");
    expect(sourceFilter("unknown")).toContain("source.is.null");
    // before the migration there is no `source` column to filter on
    expect(sourceFilter("unknown", { legacy: true })).not.toContain("source.");
    expect(sourceFilter("google", { legacy: true })).toBe(sourceFilter("google"));
  });
});
