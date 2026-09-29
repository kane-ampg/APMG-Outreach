import { describe, expect, it } from "vitest";

import { buildRecipientPrompt } from "./composePrompt";

describe("buildRecipientPrompt", () => {
  it("is empty for a company lead, so the cold prompt stands unchanged", () => {
    expect(buildRecipientPrompt({ business: "Rosebank Aged Care" })).toBe("");
    expect(buildRecipientPrompt({ business: "Rosebank Aged Care", contactName: "  " })).toBe("");
  });

  it("names the person, their role and the exact first-name greeting", () => {
    const p = buildRecipientPrompt({ business: "Harbour Care", contactName: "Ada Brook", contactTitle: "Director" });
    expect(p).toContain("Recipient: Ada Brook, Director at Harbour Care.");
    expect(p).toContain('"Hi Ada,"');
  });

  it("works without a title", () => {
    const p = buildRecipientPrompt({ business: "Harbour Care", contactName: "Ada Brook" });
    expect(p).toContain("Recipient: Ada Brook at Harbour Care.");
  });

  it("falls back to the business greeting when no usable first name exists", () => {
    const p = buildRecipientPrompt({ business: "Harbour Care", contactName: "A.", contactTitle: "Director" });
    expect(p).toContain("Recipient: A., Director at Harbour Care.");
    expect(p).not.toContain('"Hi ');
  });
});
