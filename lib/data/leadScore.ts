/**
 * The single intent-score definition, shared by every surface that ranks leads
 * by "how hot is this". Lifted out of TelemetryPage so the Telemetry row badge
 * and the Hot Leads tab can never disagree about what a 62 means.
 *
 * Scoring reads only `counts` (the funnel tallies the lead-activity route
 * derives over the whole event window), so it works on any LeadActivity —
 * live, demo, or a defensively-rebuilt payload.
 */

import { type LeadActivity } from "@/lib/data/leadActivity";

/**
 * Intent score (0–100) per lead — a single readout of "how hot is this lead".
 * The rule the operator asked for: an ENQUIRY is always the best score. So the
 * funnel is banded, not additive — reaching a deeper stage sets a floor no
 * amount of shallower activity can beat:
 *
 *   enquired      → 90–100  (money event; the enquiry itself is worth ~1 lead)
 *   opened a svc  → 60–89   (strong intent — looked at what we sell)
 *   reached portal→ 35–59   (clicked through and browsed)
 *   just clicked  → 10–34   (opened the email link, went no further)
 *
 * Inside each band, repeat activity nudges the number up (capped to the band)
 * so two enquiries out-score one, ten service opens out-score two — but a
 * browser can never overtake an enquirer. Fully deterministic (no time decay)
 * so the same trail always scores the same, and the number matches the trail
 * the operator can count by eye.
 */
export function leadScore(lead: LeadActivity): number {
  const { inquiries, serviceOpens, portalViews, emailClicks } = lead.counts;
  // ramp: how far a count fills its band, saturating so extras keep adding but
  // with diminishing return (1→~0.3, 3→~0.6, 6→~0.8, big→~1).
  const ramp = (n: number, k: number) => (n <= 0 ? 0 : 1 - Math.exp(-n / k));
  if (inquiries > 0) return Math.round(90 + 10 * ramp(inquiries, 2));
  if (serviceOpens > 0) return Math.round(60 + 29 * ramp(serviceOpens, 4));
  if (portalViews > 0) return Math.round(35 + 24 * ramp(portalViews, 4));
  if (emailClicks > 0) return Math.round(10 + 24 * ramp(emailClicks, 4));
  return 0;
}

/**
 * The Hot Leads cut-off. A lead qualifies ABOVE this (strictly greater), so a
 * lead sitting exactly on 50 stays out — the operator asked for "above 50".
 *
 * Where that lands on the bands above: every enquirer (90+) and every lead
 * that opened a service card (60+) is hot, plus a portal browser who came back
 * enough times to climb past the middle of the 35–59 band (~4 views).
 */
export const HOT_LEAD_MIN_SCORE = 50;

/** Does this lead belong on the Hot Leads tab? */
export function isHotLead(lead: LeadActivity): boolean {
  return leadScore(lead) > HOT_LEAD_MIN_SCORE;
}

/**
 * The four score bands, hottest first — the same cuts scoreTier() colours by,
 * named and given explicit ranges so a UI can offer them as filter options
 * ("Warm (35–59)") without re-deriving the thresholds.
 */
export const SCORE_BANDS = [
  { id: "hottest", label: "Hottest", min: 90, max: 100 },
  { id: "hot", label: "Hot", min: 60, max: 89 },
  { id: "warm", label: "Warm", min: 35, max: 59 },
  { id: "cool", label: "Cool", min: 0, max: 34 },
] as const;

export type ScoreBand = (typeof SCORE_BANDS)[number]["id"];

/** Which band a score falls in. Mirrors scoreTier's cuts exactly. */
export function scoreBand(score: number): ScoreBand {
  if (score >= 90) return "hottest";
  if (score >= 60) return "hot";
  if (score >= 35) return "warm";
  return "cool";
}

export type ScoreTier = { label: string; chip: string; ring: string };

/** Which band a score sits in → its label + tone. The enquiry band is the
 *  loudest thing on the row (solid signal red), matching the "Enquired" pill
 *  and enquiry trail chip so the hottest leads read the same everywhere. */
export function scoreTier(score: number): ScoreTier {
  if (score >= 90)
    return {
      label: "Hottest",
      chip: "border-transparent bg-primary-solid text-primary-foreground",
      ring: "text-primary-foreground/80",
    };
  if (score >= 60)
    return { label: "Hot", chip: "border-primary/40 bg-primary/10 text-primary", ring: "text-primary/70" };
  if (score >= 35)
    return {
      label: "Warm",
      chip: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
      ring: "text-amber-500/70",
    };
  return {
    label: "Cool",
    chip: "border-border bg-background text-muted-foreground",
    ring: "text-muted-foreground/60",
  };
}
