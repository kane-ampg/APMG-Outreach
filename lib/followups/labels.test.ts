import { describe, expect, it } from "vitest";
import { followUpChip } from "./labels";
import type { FollowUpQueueItem } from "./types";

const item = (over: Partial<FollowUpQueueItem>): FollowUpQueueItem => ({
  leadId: "x",
  business: null,
  category: null,
  website: null,
  email: "a@b.test",
  score: 70,
  service: "plumbing",
  services: ["plumbing"],
  stage: "ready",
  touch: 1,
  reason: null,
  draft: null,
  touch1SentAt: null,
  touch2DueOn: null,
  likelyScanner: false,
  scannerGapSeconds: null,
  clientWarning: null,
  ...over,
});

describe("followUpChip", () => {
  it("names each stage", () => {
    expect(followUpChip(item({ stage: "ready", touch: 1 }))).toBe("Follow-up ready to draft");
    expect(followUpChip(item({ stage: "ready", touch: 2 }))).toBe("Follow-up 2 due");
    expect(followUpChip(item({ stage: "awaiting", touch: 2 }))).toBe("Follow-up 2 drafted");
    expect(followUpChip(item({ stage: "sending", touch: 1 }))).toBe("Follow-up sending");
    expect(followUpChip(item({ stage: "waiting", touch: 2, touch2DueOn: "2026-09-28" }))).toBe("Follow-up 1 sent · #2 due 28 Sep");
    expect(followUpChip(item({ stage: "done", touch: null }))).toBe("Ready for Sales");
  });

  it("says nothing for excluded or unknown leads", () => {
    expect(followUpChip(item({ stage: "excluded", touch: null }))).toBeNull();
    expect(followUpChip(undefined)).toBeNull();
  });
});
