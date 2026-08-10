import { describe, expect, it } from "vitest";
import {
  DORMANT_AFTER_DAYS,
  PRESENCE_WINDOW_MS,
  SIGN_IN_LABEL,
  agoText,
  exactTime,
  isOnline,
  lastSeenIso,
  signInStatus,
  type SignInFacts,
} from "./signIn";

/**
 * These functions decide what the Roles and Permissions screen ASSERTS about
 * somebody. The load-bearing claim is `online` — the only status that turns a
 * row green and the only one that says anything about the present — so most of
 * what follows exists to prove it cannot be reached from stale evidence.
 */

const NOW = Date.parse("2026-08-09T12:00:00.000Z");
const DAY = 86_400_000;

/** An ISO stamp `ms` before NOW. */
function ago(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

function facts(partial: Partial<SignInFacts> = {}): SignInFacts {
  return { lastLoginAt: null, lastSeenAt: null, ...partial };
}

describe("isOnline — the only thing allowed to show green", () => {
  it("is true for a heartbeat inside the window", () => {
    expect(isOnline(facts({ lastSeenAt: ago(0) }), NOW)).toBe(true);
    expect(isOnline(facts({ lastSeenAt: ago(PRESENCE_WINDOW_MS - 1000) }), NOW)).toBe(true);
  });

  it("goes false the moment the window closes", () => {
    expect(isOnline(facts({ lastSeenAt: ago(PRESENCE_WINDOW_MS) }), NOW)).toBe(false);
    expect(isOnline(facts({ lastSeenAt: ago(10 * 60_000) }), NOW)).toBe(false);
  });

  it("is NEVER true from a sign-in, however recent", () => {
    // The whole point of the presence column: signing in a second ago is not
    // being here now.
    expect(isOnline(facts({ lastLoginAt: ago(0) }), NOW)).toBe(false);
    expect(isOnline(facts({ lastLoginAt: ago(60_000) }), NOW)).toBe(false);
    expect(isOnline(facts({ lastLoginAt: ago(2 * 3_600_000) }), NOW)).toBe(false);
  });

  it("is false when there is no heartbeat at all", () => {
    // Every row written before the presence column existed looks like this.
    expect(isOnline(facts(), NOW)).toBe(false);
    expect(isOnline(facts({ lastSeenAt: "not-a-date" }), NOW)).toBe(false);
  });

  it("keeps a future-dated heartbeat online rather than expiring it", () => {
    // Clock skew on a genuinely live session. Treating it as stale would grey
    // out somebody who is demonstrably right there.
    expect(isOnline(facts({ lastSeenAt: ago(-60_000) }), NOW)).toBe(true);
  });
});

describe("signInStatus", () => {
  it("only ever returns online from a fresh heartbeat", () => {
    expect(signInStatus(facts({ lastSeenAt: ago(5_000) }), NOW)).toBe("online");
    expect(signInStatus(facts({ lastLoginAt: ago(5_000) }), NOW)).toBe("recent");
    expect(signInStatus(facts({ lastSeenAt: ago(PRESENCE_WINDOW_MS) }), NOW)).toBe("recent");
  });

  it("labels only the online status as a present-tense claim", () => {
    expect(SIGN_IN_LABEL.online).toBe("Online now");
    for (const status of ["recent", "dormant", "never", "unknown"] as const) {
      expect(SIGN_IN_LABEL[status]).not.toMatch(/now|online/i);
    }
  });

  it("calls a row with nothing at all never signed in", () => {
    expect(signInStatus(facts(), NOW)).toBe("never");
  });

  it("does NOT report an unreadable stamp as never signed in", () => {
    expect(signInStatus(facts({ lastLoginAt: "not-a-date" }), NOW)).toBe("unknown");
    expect(SIGN_IN_LABEL.unknown).not.toMatch(/never/i);
  });

  it("flips to dormant exactly at the threshold, not before", () => {
    expect(signInStatus(facts({ lastLoginAt: ago(DORMANT_AFTER_DAYS * DAY - 1000) }), NOW)).toBe(
      "recent",
    );
    expect(signInStatus(facts({ lastLoginAt: ago(DORMANT_AFTER_DAYS * DAY) }), NOW)).toBe("dormant");
    expect(signInStatus(facts({ lastLoginAt: ago(400 * DAY) }), NOW)).toBe("dormant");
  });

  it("lets an old heartbeat rescue a much older sign-in from dormancy", () => {
    // They were here last week without signing in again — a 12-hour session
    // spans several days of work, so the sign-in alone understates them.
    const state = facts({ lastLoginAt: ago(90 * DAY), lastSeenAt: ago(3 * DAY) });
    expect(signInStatus(state, NOW)).toBe("recent");
  });
});

describe("lastSeenIso", () => {
  it("picks whichever evidence is freshest", () => {
    expect(lastSeenIso(facts({ lastLoginAt: ago(5 * DAY), lastSeenAt: ago(DAY) }))).toBe(ago(DAY));
    expect(lastSeenIso(facts({ lastLoginAt: ago(DAY), lastSeenAt: ago(5 * DAY) }))).toBe(ago(DAY));
  });

  it("falls back to whichever one exists, and to null when neither does", () => {
    expect(lastSeenIso(facts({ lastLoginAt: ago(DAY) }))).toBe(ago(DAY));
    expect(lastSeenIso(facts({ lastSeenAt: ago(DAY) }))).toBe(ago(DAY));
    expect(lastSeenIso(facts())).toBeNull();
  });
});

describe("agoText", () => {
  it("says never when there is no stamp, without inventing a time", () => {
    expect(agoText(null, NOW)).toBe("never");
  });

  it("degrades an unreadable stamp instead of printing NaN", () => {
    expect(agoText("not-a-date", NOW)).toBe("at an unreadable time");
  });

  it("counts up through minutes, hours and days", () => {
    expect(agoText(ago(20_000), NOW)).toBe("just now");
    // 30s rounds up to a whole minute rather than staying "just now". Stated
    // as a test because it is the boundary someone will otherwise "fix".
    expect(agoText(ago(30_000), NOW)).toBe("1m ago");
    expect(agoText(ago(5 * 60_000), NOW)).toBe("5m ago");
    expect(agoText(ago(3 * 3_600_000), NOW)).toBe("3h ago");
    expect(agoText(ago(4 * DAY), NOW)).toBe("4d ago");
  });

  it("switches to an absolute date once the relative form stops being readable", () => {
    expect(agoText(ago(200 * DAY), NOW)).not.toMatch(/ago/);
    expect(agoText(ago(200 * DAY), NOW)).toContain("2026");
  });
});

describe("exactTime", () => {
  it("renders an em dash for no stamp, never a fabricated date", () => {
    expect(exactTime(null)).toBe("—");
  });

  it("says unknown for an unreadable stamp", () => {
    expect(exactTime("not-a-date")).toBe("unknown");
  });

  it("includes the month and year of a real stamp", () => {
    const text = exactTime("2026-06-23T04:12:00.000Z");
    expect(text).toMatch(/2026/);
    expect(text).toMatch(/Jun/);
  });
});
