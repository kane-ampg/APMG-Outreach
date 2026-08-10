import { describe, expect, it } from "vitest";
import { CLICK_DEDUPE_MS, SCANNER_WINDOW_MS, classifyClick } from "./server";

const NOW = 1_754_700_000_000; // fixed instant; the function must never read the clock

describe("classifyClick", () => {
  it("records a click from a lead with no send on file", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: null, lastClickMs: null })).toBe("record");
  });

  it("records a click a plausible interval after the send", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - 4 * 60_000, lastClickMs: null })).toBe("record");
  });

  it("rejects a click landing within the scanner window of the send", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - 2_000, lastClickMs: null })).toBe("too-fast");
  });

  it("treats the scanner window as exclusive at its boundary", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - SCANNER_WINDOW_MS, lastClickMs: null })).toBe("record");
  });

  it("rejects a repeat click inside the dedupe window", () => {
    expect(
      classifyClick({ nowMs: NOW, lastSentMs: NOW - 3_600_000, lastClickMs: NOW - 5_000 }),
    ).toBe("duplicate");
  });

  it("records a genuine second visit after the dedupe window", () => {
    expect(
      classifyClick({ nowMs: NOW, lastSentMs: NOW - 3_600_000, lastClickMs: NOW - CLICK_DEDUPE_MS - 1 }),
    ).toBe("record");
  });

  it("reports too-fast ahead of duplicate when both apply", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - 1_000, lastClickMs: NOW - 1_000 })).toBe("too-fast");
  });

  it("ignores a send timestamp in the future rather than rejecting the click", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW + 60_000, lastClickMs: null })).toBe("record");
  });
});
