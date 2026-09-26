import { describe, expect, it } from "vitest";
import { FOLLOW_UP_ANGLES, NO_TRACKING_RULE, type LeadHistory } from "./followUpPrompt";
import { buildHotFollowUpPrompt, followUpAngleFor } from "./hotFollowUpPrompt";

const ID = "11111111-1111-4111-8111-111111111111";
const HISTORY: LeadHistory = {
  sends: 1,
  lastSentAt: "2026-09-18T00:00:00Z",
  daysSince: 7,
  services: ["plumbing"],
  engaged: true,
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("buildHotFollowUpPrompt — touch 1", () => {
  const p = buildHotFollowUpPrompt({ history: HISTORY, services: ["plumbing", "painting"], touch: 1, leadId: ID });

  it("makes the most-opened service the subject", () => {
    expect(p).toMatch(/follow-up 1 of 2/i);
    expect(p).toMatch(/make plumbing the whole subject/i);
    expect(p).toMatch(/subject line must be about plumbing/i);
  });

  it("grounds the service in its real description", () => {
    expect(p).toMatch(/What APMG's Plumbing Services covers/);
  });

  it("carries the no-tracking rule exactly once", () => {
    expect(count(p, NO_TRACKING_RULE)).toBe(1);
  });

  it("contains no em dashes (they leak into the copy)", () => {
    expect(p).not.toContain("—");
  });
});

describe("buildHotFollowUpPrompt — touch 2", () => {
  const p = buildHotFollowUpPrompt({ history: { ...HISTORY, sends: 2 }, services: ["plumbing"], touch: 2, leadId: ID });

  it("is the last touch, from a stable angle", () => {
    expect(p).toMatch(/follow-up 2 of 2/i);
    expect(p).toContain(followUpAngleFor(ID));
    expect(FOLLOW_UP_ANGLES).toContain(followUpAngleFor(ID));
    expect(followUpAngleFor(ID)).toBe(followUpAngleFor(ID));
  });

  it("offers an easy way out and forbids reusing the first email", () => {
    expect(p).toMatch(/do not reuse the opening/i);
    expect(p).toMatch(/timing isn't right/i);
  });

  it("carries the no-tracking rule exactly once", () => {
    expect(count(p, NO_TRACKING_RULE)).toBe(1);
  });
});

describe("buildHotFollowUpPrompt — no send on the ledger", () => {
  const p = buildHotFollowUpPrompt({ history: null, services: ["electrical"], touch: 1, leadId: ID });

  it("never invents when APMG last wrote", () => {
    expect(p).not.toMatch(/earlier today|yesterday|days ago|week/i);
    expect(p).toMatch(/do not say when APMG last wrote/i);
  });

  it("still leads with the service and keeps the rule", () => {
    expect(p).toMatch(/electrical work/);
    expect(count(p, NO_TRACKING_RULE)).toBe(1);
  });
});

describe("buildHotFollowUpPrompt — touch 1's email as reference for touch 2", () => {
  const previous = {
    subject: "Plumbing for Acme — a quick idea",
    text: "Hi Acme team,\n\nWe look after plumbing for childcare centres — burst pipes, tap audits.\n\n" + "More detail. ".repeat(200),
  };
  const p2 = buildHotFollowUpPrompt({ history: { ...HISTORY, sends: 2 }, services: ["plumbing"], touch: 2, leadId: ID, previous });
  const p1 = buildHotFollowUpPrompt({ history: HISTORY, services: ["plumbing"], touch: 1, leadId: ID, previous });

  it("shows touch 2 the previous subject and text, to steer away from, not repeat", () => {
    expect(p2).toContain(
      "For reference only, this is APMG's previous email to them (do not repeat it, and do not quote it):\nSubject: Plumbing for Acme, a quick idea\nHi Acme team,",
    );
    expect(p2).toContain("burst pipes, tap audits");
  });

  it("trims a long previous email to about 1,500 characters", () => {
    const from = p2.indexOf("\n", p2.indexOf("Subject: Plumbing for Acme")) + 1;
    const text = p2.slice(from, p2.indexOf("\nTHIS EMAIL (follow-up 2 of 2"));
    expect(text.length).toBeLessThan(1600);
    expect(text.length).toBeGreaterThan(1400);
  });

  it("keeps the block free of em dashes, even when touch 1 had them", () => {
    expect(p2).not.toContain("—");
  });

  it("still carries the no-tracking rule exactly once", () => {
    expect(count(p2, NO_TRACKING_RULE)).toBe(1);
  });

  it("never shows it to touch 1", () => {
    expect(p1).not.toMatch(/for reference only/i);
    expect(p1).not.toContain("tap audits");
  });

  it("leaves touch 2 without the block when there is no previous email", () => {
    const bare = buildHotFollowUpPrompt({ history: HISTORY, services: ["plumbing"], touch: 2, leadId: ID });
    expect(bare).not.toMatch(/for reference only/i);
  });
});
