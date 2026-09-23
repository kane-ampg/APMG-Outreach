import { describe, expect, it } from "vitest";
import { kbFileName, mergePlaybooks, resolveSectorForCategory } from "./sectors";

describe("healthcare sector split", () => {
  const playbooks = mergePlaybooks(null);

  it("routes hospitals and health categories to Health & Hospitals, not Aged Care", () => {
    for (const c of ["Hospital", "Children's hospital", "Health", "Healthcare provider", "Medical centre"]) {
      expect(resolveSectorForCategory(c, playbooks)?.slug).toBe("healthcare");
    }
  });

  it("keeps aged care categories on Aged Care", () => {
    for (const c of ["Aged care", "Nursing home", "Retirement village", "Disability services"]) {
      expect(resolveSectorForCategory(c, playbooks)?.slug).toBe("aged-care");
    }
  });

  it("grounds healthcare in the aged-care KB file", () => {
    expect(kbFileName("healthcare")).toBe("aged-care.md");
    expect(kbFileName("education")).toBe("education.md");
  });

  it("adds the healthcare sector to older stored configs with no PDF", () => {
    const merged = mergePlaybooks([{ slug: "aged-care", name: "Aged Care", categories: ["aged care"], pdf: { path: "aged-care.pdf", name: "Aged Care.pdf" } }]);
    const hc = merged.find((p) => p.slug === "healthcare");
    expect(hc?.pdf).toBeNull();
    expect(merged.find((p) => p.slug === "aged-care")?.pdf?.name).toBe("Aged Care.pdf");
  });
});
