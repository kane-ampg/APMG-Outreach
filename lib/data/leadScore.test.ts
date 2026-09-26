import { describe, expect, it } from "vitest";
import { FOLLOW_UP_MIN_SCORE, leadScore } from "./leadScore";

const counts = (c: Partial<Record<"inquiries" | "serviceOpens" | "portalViews" | "emailClicks" | "chatPrompts", number>>) => ({
  counts: { inquiries: 0, serviceOpens: 0, portalViews: 0, emailClicks: 0, chatPrompts: 0, ...c },
});

describe("FOLLOW_UP_MIN_SCORE", () => {
  it("is exactly what one service open scores", () => {
    expect(FOLLOW_UP_MIN_SCORE).toBe(66);
    expect(leadScore(counts({ serviceOpens: 1 }))).toBe(66);
  });

  it("is out of reach for a portal browser who opened no service", () => {
    expect(leadScore(counts({ portalViews: 50, emailClicks: 50 }))).toBeLessThan(FOLLOW_UP_MIN_SCORE);
  });
});
