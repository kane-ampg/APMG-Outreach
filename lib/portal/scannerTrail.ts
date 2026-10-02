import { isForgedBrowserUa } from "./scannerUa";

/**
 * Two DIFFERENT links in one email opened this close together is a machine.
 * A mail-gateway sandbox clicks every link in the message at once; a person
 * reads, then clicks one. Across every lead (2026-10-01 audit) the gap between
 * clicks on different links split into 652 pairs inside 2s and then minutes —
 * one pair at 5s, the rest 30s or more — so nothing a person does lands here.
 */
export const LINK_BURST_MS = 2_000;

/** The slice of a portal_events row the scanner checks read. */
export interface ScanRow {
  event: string;
  ua: string | null | undefined;
  /** attribution_click's redirect target (props.destination) */
  destination: string | null;
  /** ISO timestamp */
  ts: string;
}

/**
 * True when every visit on this trail was a scanner. The trail is split into
 * visits by user agent (one person = one browser = one agent string), and a
 * visit is a scanner when its agent is forged (isForgedBrowserUa) or when it
 * opened two different email links within LINK_BURST_MS. One visit that looks
 * like a person keeps the whole trail. Rows without an agent are no evidence,
 * and a trail with no evidence at all is never called a scanner.
 */
export function isScannerOnlyTrail(rows: readonly ScanRow[]): boolean {
  const visits = new Map<string, ScanRow[]>();
  for (const row of rows) {
    if (!row.ua || !row.ua.trim()) continue;
    const visit = visits.get(row.ua);
    if (visit) visit.push(row);
    else visits.set(row.ua, [row]);
  }
  if (visits.size === 0) return false;
  for (const [ua, visit] of visits) {
    if (!isForgedBrowserUa(ua) && !hasLinkBurst(visit)) return false;
  }
  return true;
}

/** The link without its query string, which can differ between two clicks
 *  on the same link. */
function linkOf(destination: string | null): string | null {
  return destination ? destination.split("?")[0] : null;
}

function hasLinkBurst(visit: ScanRow[]): boolean {
  const clicks = visit
    .filter((r) => r.event === "attribution_click")
    .map((r) => ({ ms: Date.parse(r.ts), link: linkOf(r.destination) }))
    .filter((c): c is { ms: number; link: string } => c.link !== null && Number.isFinite(c.ms))
    .sort((a, b) => a.ms - b.ms);
  for (let i = 1; i < clicks.length; i++) {
    if (clicks[i].link !== clicks[i - 1].link && clicks[i].ms - clicks[i - 1].ms <= LINK_BURST_MS) {
      return true;
    }
  }
  return false;
}
