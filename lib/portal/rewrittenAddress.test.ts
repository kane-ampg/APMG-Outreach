import { describe, expect, it } from "vitest";

import { organisationDomain, rot13Local } from "./server";

/**
 * The rotation a link-rewriting mail gateway applies to the query string of a
 * URL it walks. Every address here came off the live suppression list, where
 * each was recorded as an opt-out no human ever made.
 */
describe("rot13Local", () => {
  it("recovers the address behind a rewritten local part", () => {
    expect(rot13Local("avgmeblabegu.faebyzfagf@saints.vic.edu.au")).toBe(
      "nitzroynorth.snrolmsnts@saints.vic.edu.au",
    );
    expect(rot13Local("jlbzvat@firstgrammar.com.au")).toBe("wyoming@firstgrammar.com.au");
  });

  it("leaves the domain alone — only the local part comes back rotated", () => {
    // The rows are recognisable precisely BECAUSE the domain is untouched: a
    // real prospect domain carrying a nonsense mailbox.
    expect(rot13Local("vaab@windsorccc.org.au")?.endsWith("@windsorccc.org.au")).toBe(true);
    expect(organisationDomain("avgmeblabegu.faebyzfagf@saints.vic.edu.au")).toBe("saints.vic.edu.au");
  });

  it("is its own inverse, so a decoded address re-encodes to what arrived", () => {
    const arrived = "jlbzvat@firstgrammar.com.au";
    expect(rot13Local(rot13Local(arrived)!)).toBe(arrived);
  });

  it("preserves digits, dots and punctuation", () => {
    expect(rot13Local("info.2024@example.com.au")).toBe("vasb.2024@example.com.au");
  });

  it("returns null for anything it cannot rotate", () => {
    expect(rot13Local("no-at-sign")).toBeNull();
    expect(rot13Local("@leading")).toBeNull();
    expect(rot13Local("12345@example.com")).toBeNull(); // no letters to rotate
  });
});
