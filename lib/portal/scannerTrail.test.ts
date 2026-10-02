import { describe, expect, it } from "vitest";
import { isScannerOnlyTrail, LINK_BURST_MS, type ScanRow } from "./scannerTrail";

const MAC_CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
const OTHER_BROWSER =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36";
const FORGED =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.163 Safari/537.36";
const PDF = "https://x.supabase.co/storage/v1/object/public/sector-assets/education.pdf?v=3";

const T0 = Date.parse("2026-10-02T01:42:47.902Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();
const click = (ua: string | null, destination: string, ms: number): ScanRow => ({
  event: "attribution_click",
  ua,
  destination,
  ts: at(ms),
});
const view = (ua: string | null, ms: number): ScanRow => ({ event: "portal_view", ua, destination: null, ts: at(ms) });

describe("isScannerOnlyTrail", () => {
  it("calls a browser that opened both email links within a second a scanner", () => {
    // Lifted from lead 0d602471: portal + PDF 282ms apart, then the page view.
    expect(isScannerOnlyTrail([click(MAC_CHROME, "/portal", 0), click(MAC_CHROME, PDF, 282), view(MAC_CHROME, 8_000)])).toBe(
      true,
    );
  });

  it("calls a trail of forged agents a scanner", () => {
    expect(isScannerOnlyTrail([click(FORGED, "/portal", 0), view(FORGED, 6_000)])).toBe(true);
  });

  it("keeps a person who opened one link", () => {
    expect(isScannerOnlyTrail([click(MAC_CHROME, "/portal", 0), view(MAC_CHROME, 6_000)])).toBe(false);
  });

  it("keeps a person who opened the second link later on", () => {
    expect(isScannerOnlyTrail([click(MAC_CHROME, PDF, 0), click(MAC_CHROME, "/portal", 45_000)])).toBe(false);
  });

  it("treats the burst window as inclusive at its boundary", () => {
    expect(isScannerOnlyTrail([click(MAC_CHROME, "/portal", 0), click(MAC_CHROME, PDF, LINK_BURST_MS)])).toBe(true);
    expect(isScannerOnlyTrail([click(MAC_CHROME, "/portal", 0), click(MAC_CHROME, PDF, LINK_BURST_MS + 1)])).toBe(false);
  });

  it("does not count two clicks on the same link as a burst", () => {
    expect(isScannerOnlyTrail([click(MAC_CHROME, PDF, 0), click(MAC_CHROME, `${PDF}&x=1`, 100)])).toBe(false);
  });

  it("keeps the whole trail when one visit looks like a person", () => {
    // Lead 9293b9bf's shape: a forged burst, then a second browser 80s later.
    expect(
      isScannerOnlyTrail([
        click(FORGED, "/portal", 0),
        click(FORGED, PDF, 13),
        view(FORGED, 6_500),
        click(OTHER_BROWSER, "/portal", 82_000),
        view(OTHER_BROWSER, 88_000),
      ]),
    ).toBe(false);
  });

  it("never calls a trail with no agents a scanner", () => {
    expect(isScannerOnlyTrail([click(null, "/portal", 0), click(null, PDF, 10)])).toBe(false);
    expect(isScannerOnlyTrail([])).toBe(false);
  });
});
