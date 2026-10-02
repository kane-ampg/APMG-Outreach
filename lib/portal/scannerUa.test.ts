import { describe, expect, it } from "vitest";
import { isForgedBrowserUa } from "./scannerUa";

/** Agents lifted from live portal_events (2026-10-01 audit). */
const SCANNER = {
  unreducedChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.175 Safari/537.36",
  win7ModernChrome:
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  futureMacOs:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_2) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  ie8: "Mozilla/4.0 (compatible; MSIE 8.0; Windows NT 6.1; WOW64; Trident/4.0; SLCC2)",
};

const BROWSER = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",
  edge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.3595.94",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0",
  iphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5.2 Mobile/15E148 Safari/604.1",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/142.0.7444.171 Mobile Safari/537.36",
  electron:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Slack/4.41.105 Chrome/130.0.6723.191 Electron/33.2.1 Safari/537.36",
  oldChromeWin7:
    "Mozilla/5.0 (Windows NT 6.1; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36",
};

describe("isForgedBrowserUa", () => {
  it.each(Object.entries(SCANNER))("flags the %s scanner agent", (_, ua) => {
    expect(isForgedBrowserUa(ua)).toBe(true);
  });

  it.each(Object.entries(BROWSER))("passes a real %s", (_, ua) => {
    expect(isForgedBrowserUa(ua)).toBe(false);
  });

  it("treats a missing agent as no evidence, not as a scanner", () => {
    expect(isForgedBrowserUa(null)).toBe(false);
    expect(isForgedBrowserUa(undefined)).toBe(false);
    expect(isForgedBrowserUa("  ")).toBe(false);
  });
});
