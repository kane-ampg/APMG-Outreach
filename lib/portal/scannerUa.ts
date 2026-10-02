/**
 * FORGED BROWSER AGENTS. isBotRequest (./server) drops clients that SAY they
 * are bots. The mail-gateway sandboxes that detonate our tracked links mostly
 * don't: they present a browser user-agent, run the portal's JS, and so land
 * as an attribution_click + portal_view pair that scores Warm. What gives them
 * away is that the string they present is one no shipping browser has sent in
 * years. Audited against live portal_events on 2026-10-01: these tells cover
 * 1,082 of the 1,406 Warm leads, and none of the one real enquirer's events.
 *
 * Each tell is a string a real browser CANNOT produce, never a merely unusual
 * one, so a person on an old laptop is not caught by it:
 *
 *  - Desktop Chrome with a full build number (Chrome/142.0.7444.175). Chrome
 *    has reported MAJOR.0.0.0 since UA reduction (Chrome 113, 2023). Android
 *    is exempt — the system WebView still sends the full version — and so is
 *    Electron, which does too.
 *  - Chrome 110+ on Windows 7/8 (Windows NT 5.x/6.x). Chrome dropped those
 *    systems at 110, so the combination does not exist.
 *  - A macOS version of 11 or later in the platform token. Chrome, Safari and
 *    Firefox all freeze it at 10_15_7 / 10.15.
 *  - Internet Explorer 10 or older (MSIE), which cannot run the portal at all.
 *
 * A missing UA is NOT a tell here: it is no evidence either way.
 */

const CHROME_VERSION_RE = /Chrome\/(\d+)\.(\d+)\.(\d+)\.(\d+)/;

export function isForgedBrowserUa(ua: string | null | undefined): boolean {
  if (!ua || !ua.trim()) return false;

  const chrome = CHROME_VERSION_RE.exec(ua);
  if (chrome) {
    const [, major, minor, build, patch] = chrome;
    const unreduced = minor !== "0" || build !== "0" || patch !== "0";
    if (unreduced && !/Android|Electron\//.test(ua)) return true;
    if (Number(major) >= 110 && /Windows NT [56]\./.test(ua)) return true;
  }
  if (/Mac OS X (1[1-9]|[2-9]\d)[._]\d/.test(ua)) return true;
  if (/MSIE \d/.test(ua)) return true;
  return false;
}
