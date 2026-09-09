import { describe, expect, it } from "vitest";
import { demoDraft, type ComposeLeadInput } from "./campaign";
import { serviceBySlug } from "./services";

/**
 * The deterministic fallback draft, with an eye on the case that actually
 * reaches a recipient: Claude missing (no key, a 429 chain, the compose
 * deadline) on a lead we have ALREADY emailed. Without the follow-up variant
 * that lead gets the cold introduction posted to them a second time.
 */

const LEAD: ComposeLeadInput = {
  id: "0f8b0a2e-9c1e-4f0a-9a2b-1d3c5e7f9a1b",
  name: "Rosebank Aged Care",
  website: "https://rosebank.example.com.au",
  category: "Senior citizen services",
  emails: ["manager@rosebank.example.com.au"],
};

describe("demoDraft", () => {
  it("writes a cold introduction by default, unchanged", () => {
    const d = demoDraft(LEAD);
    expect(d.subject).toBe("Rosebank Aged Care, your property maintenance, sorted");
    expect(d.html).toContain("APMG Services is a Melbourne-based multi-trade");
    expect(d.html).not.toMatch(/follow up|got in touch/i);
  });

  describe("as a follow-up", () => {
    const d = demoDraft(LEAD, null, true);

    it("opens by referring back instead of introducing APMG cold", () => {
      expect(d.html).toMatch(/got in touch a little while back/i);
      expect(d.html).not.toContain("APMG Services is a Melbourne-based multi-trade");
    });

    it("says so in the subject", () => {
      expect(d.subject).toBe("Following up: Rosebank Aged Care");
    });

    // The template cannot know the gap, so it must not invent one. Only the AI
    // draft, which is handed the real day count, may name a timeframe.
    it("makes no claim about how long ago the last email was", () => {
      expect(d.html).not.toMatch(/last week|yesterday|a few days|days ago|last month/i);
    });

    // The trail is bot-inflated; the fallback has no business referencing it.
    it("never references the recipient's browsing", () => {
      expect(d.html).not.toMatch(/I saw|I noticed|you (viewed|clicked|opened|had a look)/i);
    });

    it("keeps the tracked CTA token and the sign-off", () => {
      expect(d.html).toContain('href="{{link}}"');
      expect(d.html.match(/href="\{\{link\}\}"/g)).toHaveLength(1);
      expect(d.html).toContain("<p>The APMG Services team</p>");
    });

    it("keeps the addressing fields the send route needs", () => {
      expect(d.best_email).toBe("manager@rosebank.example.com.au");
      expect(d.email_source).toBe("csv");
      expect(d.id).toBe(LEAD.id);
    });

    it("still leads with the campaign's service when one was picked", () => {
      const painting = serviceBySlug("painting");
      const withService = demoDraft(LEAD, painting, true);
      expect(withService.html).toContain("painting");
      expect(withService.html).toMatch(/got in touch a little while back/i);
      // ...and not the service template's own cold opening
      expect(withService.html).not.toContain("We're APMG Services, a Melbourne based");
    });

    it("falls back to 'there' for a nameless lead without breaking the greeting", () => {
      const d2 = demoDraft({ ...LEAD, name: "" }, null, true);
      expect(d2.html).toContain("<p>Hi there,</p>");
    });
  });

  it("escapes a business name that carries markup", () => {
    const d = demoDraft({ ...LEAD, name: '<script>x</script> & Co' }, null, true);
    expect(d.html).not.toContain("<script>");
    expect(d.html).toContain("&amp;");
  });
});
