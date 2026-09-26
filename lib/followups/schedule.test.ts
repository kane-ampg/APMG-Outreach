import { describe, expect, it } from "vitest";
import { businessDaysSince, isTouch2Due, melbourneYmd, touch2DueOn } from "./schedule";

describe("melbourneYmd", () => {
  it("reads the Melbourne calendar date, not the UTC one", () => {
    // 2026-09-24 14:00 UTC = Fri 25 Sep 00:00 AEST (UTC+10; DST starts 4 Oct)
    expect(melbourneYmd(Date.parse("2026-09-24T14:00:00Z"))).toBe("2026-09-25");
    expect(melbourneYmd(Date.parse("2026-09-24T13:59:00Z"))).toBe("2026-09-24");
  });
});

describe("touch2DueOn", () => {
  it("is five weekdays after a Monday send", () => {
    // Mon 21 Sep 10:00 local → Tue, Wed, Thu, Fri, Mon 28
    expect(touch2DueOn("2026-09-21T00:00:00Z")).toBe("2026-09-28");
  });

  it("skips the weekend after a Friday send", () => {
    // Fri 25 Sep 01:30 local → Mon 28 … Fri 2 Oct
    expect(touch2DueOn("2026-09-24T15:30:00Z")).toBe("2026-10-02");
  });

  it("uses the local date at the midnight boundary", () => {
    expect(touch2DueOn("2026-09-24T13:59:00Z")).toBe("2026-10-01"); // Thu 23:59 local
    expect(touch2DueOn("2026-09-24T14:00:00Z")).toBe("2026-10-02"); // Fri 00:00 local
  });

  it("is null for an unreadable timestamp", () => {
    expect(touch2DueOn("not a date")).toBeNull();
  });
});

describe("businessDaysSince / isTouch2Due", () => {
  const SENT = "2026-09-21T00:00:00Z"; // Mon 21 Sep 10:00 local

  it("does not count the send day or weekends", () => {
    expect(businessDaysSince(SENT, Date.parse("2026-09-21T08:00:00Z"))).toBe(0);
    expect(businessDaysSince(SENT, Date.parse("2026-09-25T08:00:00Z"))).toBe(4); // Fri
    expect(businessDaysSince(SENT, Date.parse("2026-09-27T08:00:00Z"))).toBe(4); // Sun
  });

  it("comes due on the due date, local time", () => {
    expect(isTouch2Due(SENT, Date.parse("2026-09-27T13:00:00Z"))).toBe(false); // Sun 23:00 local
    expect(isTouch2Due(SENT, Date.parse("2026-09-27T23:00:00Z"))).toBe(true); // Mon 28 09:00 local
  });

  it("treats an unreadable timestamp as not due", () => {
    expect(businessDaysSince("nope", Date.now())).toBe(0);
    expect(isTouch2Due("nope", Date.now())).toBe(false);
  });
});
