import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_ANGLES,
  buildFollowUpPrompt,
  daysSince,
  describeGap,
  type LeadHistory,
} from "./followUpPrompt";

/** A lead we've mailed once, six days ago, with nothing back. */
function history(patch: Partial<LeadHistory> = {}): LeadHistory {
  return {
    sends: 1,
    lastSentAt: "2026-09-03T01:00:00Z",
    daysSince: 6,
    services: [],
    engaged: false,
    ...patch,
  };
}

describe("describeGap", () => {
  it("says yesterday for a one-day gap", () => {
    expect(describeGap(1)).toBe("yesterday");
  });

  it("counts days inside a week", () => {
    expect(describeGap(4)).toBe("4 days ago");
  });

  // The whole reason the gap is computed rather than left to the model: a send
  // from five months back must never come out as "a few days ago".
  it("counts weeks, then months, for older sends", () => {
    expect(describeGap(9)).toBe("about a week ago");
    expect(describeGap(20)).toBe("about 3 weeks ago");
    expect(describeGap(45)).toBe("about a month ago");
    expect(describeGap(150)).toBe("about 5 months ago");
  });

  it("treats today and a nonsense gap as recent", () => {
    expect(describeGap(0)).toBe("earlier today");
    expect(describeGap(-3)).toBe("earlier today");
  });
});

describe("buildFollowUpPrompt", () => {
  it("states the send count and how long ago, so the email can't claim the wrong gap", () => {
    const out = buildFollowUpPrompt(history({ sends: 2, daysSince: 6 }));
    expect(out).toContain("2 previous emails");
    expect(out).toContain("6 days ago");
  });

  it("uses the singular for a single previous email", () => {
    const out = buildFollowUpPrompt(history({ sends: 1 }));
    expect(out).toContain("1 previous email,");
    expect(out).not.toContain("1 previous emails");
  });

  it("tells the writer to open by acknowledging the earlier email", () => {
    expect(buildFollowUpPrompt(history())).toMatch(/acknowledg/i);
  });

  // A five-month-old send described as "recently" is a claim the recipient can
  // see through, and the prompt is where that has to be caught.
  it("stops calling an old send recent", () => {
    expect(buildFollowUpPrompt(history({ daysSince: 6 }))).toContain("wrote to them recently");
    const old = buildFollowUpPrompt(history({ daysSince: 161 }));
    expect(old).toContain("wrote to them some time ago");
    expect(old).not.toContain("recently");
    expect(old).toContain("about 5 months ago");
  });

  it("forbids repeating the first email and guilting a non-reply", () => {
    const out = buildFollowUpPrompt(history());
    expect(out).toMatch(/do not repeat/i);
    expect(out).toMatch(/never (guilt|imply)/i);
  });

  it("keeps the follow-up shorter than a cold email", () => {
    expect(buildFollowUpPrompt(history())).toMatch(/shorter/i);
  });

  describe("when the lead has a service trail", () => {
    const out = buildFollowUpPrompt(
      history({ services: ["gardening", "painting"], engaged: true }),
    );

    it("names the services in plain English, not slugs", () => {
      expect(out).toContain("grounds and gardening");
      expect(out).toContain("painting");
      expect(out).not.toContain("make-safe");
    });

    // "grounds and gardening and painting" is what a naive list join produces.
    it("does not stutter 'and' when a service name already contains one", () => {
      expect(out).toContain("grounds and gardening, painting");
      expect(out).not.toMatch(/gardening and painting/);
    });

    it("tells the writer to lead with them", () => {
      expect(out).toMatch(/lead (the email |with)/i);
    });

    // The hard rule. The trail is bot-inflated (gateway scanners detonate
    // tracked links), so an email that says "I saw you looking at gardening"
    // is both creepy and, often, addressed to a spam filter.
    it("bans every form of saying we watched them", () => {
      expect(out).toMatch(/never mention/i);
      expect(out).toContain("I saw you");
      expect(out).toContain("I noticed you");
      expect(out).toMatch(/viewed, clicked/i);
    });

    // Checked one slug per call: the MAX_SERVICES cap means a single prompt
    // only ever names the first three.
    it.each([
      ["electrical", "electrical work"],
      ["painting", "painting"],
      ["plumbing", "plumbing"],
      ["carpentry", "carpentry"],
      ["flooring", "flooring"],
      ["gardening", "grounds and gardening"],
      ["handyman", "general handyman repairs"],
      ["make-safe", "make safe works"],
    ])("maps the %s slug to readable copy, never the slug itself", (slug, words) => {
      const out = buildFollowUpPrompt(history({ services: [slug] }));
      expect(out).toContain(words);
      expect(out).not.toMatch(/\bmake-safe\b/);
    });

    it("drops unknown slugs rather than pasting them into the prompt", () => {
      const out = buildFollowUpPrompt(history({ services: ["gardening", "wat?!"] }));
      expect(out).toContain("grounds and gardening");
      expect(out).not.toContain("wat?!");
    });

    it("caps a long trail so one lead can't flood the message", () => {
      const out = buildFollowUpPrompt(
        history({ services: ["electrical", "painting", "plumbing", "carpentry", "flooring"] }),
      );
      // first three only
      expect(out).toContain("electrical");
      expect(out).not.toContain("flooring");
    });
  });

  describe("when the lead never engaged", () => {
    const out = buildFollowUpPrompt(history({ services: [], engaged: false }));

    it("asks for a short nudge from a different angle", () => {
      expect(out).toMatch(/nudge|different angle/i);
    });

    it("does not tell the writer to mention the silence", () => {
      expect(out).toMatch(/do not mention|never mention/i);
    });

    it("carries no service line at all", () => {
      expect(out).not.toMatch(/have since looked at/i);
    });
  });

  it("returns an empty string for a lead that was never emailed", () => {
    expect(buildFollowUpPrompt(null)).toBe("");
    expect(buildFollowUpPrompt(history({ sends: 0 }))).toBe("");
  });
});

describe("FOLLOW_UP_ANGLES", () => {
  it("offers a rotation distinct from a first introduction", () => {
    expect(FOLLOW_UP_ANGLES.length).toBeGreaterThanOrEqual(4);
    expect(new Set(FOLLOW_UP_ANGLES).size).toBe(FOLLOW_UP_ANGLES.length);
  });
});

describe("daysSince", () => {
  const now = Date.parse("2026-09-09T06:00:00Z");

  it("counts whole elapsed days", () => {
    expect(daysSince("2026-09-03T06:00:00Z", now)).toBe(6);
    expect(daysSince("2026-09-08T18:00:00Z", now)).toBe(0);
  });

  it("never goes negative for a clock-skewed future stamp", () => {
    expect(daysSince("2026-12-25T00:00:00Z", now)).toBe(0);
  });

  it("reads an unusable stamp as today rather than throwing", () => {
    expect(daysSince(null, now)).toBe(0);
    expect(daysSince("not a date", now)).toBe(0);
  });
});
