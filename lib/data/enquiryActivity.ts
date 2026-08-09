/**
 * What a lead actually DID on the portal — derived once, read everywhere.
 *
 * The per-row "View" modal answers one question for the rep about to make the
 * call: how warm is this, and what do I open with? The raw material for that
 * already exists in two places —
 *
 *   the enquiry row      (GET /api/portal/inquiries)   → who, what service, message
 *   the lead's click trail (GET /api/portal/lead-activity) → email click → PDF
 *                                                            download → portal
 *                                                            views → service
 *                                                            opens → chat → enquiry
 *
 * TWO KINDS OF SUBJECT, ONE SHAPE. The Enquiries tab views an ENQUIRY: someone
 * filled the form, so there's a service, a message and a moment to reason from.
 * The Sales queue views a LEAD: admin handed it over off the back of tracked
 * clicks, and most of those leads have never enquired — the trail IS the whole
 * story. Both reduce to the same `EngagementFacts` (`kind` says which), so the
 * modal, the talking points and the AI prompt are written once and the two
 * surfaces can never tell different stories about the same lead.
 *
 * So this module is the join: `buildEngagementFacts()` / `buildLeadFacts()`
 * reduce either subject into a flat, countable shape, plus the two readouts
 * built off it:
 *
 *   `talkingPoints()`  — the bullet list the rep skims before dialling
 *   `fallbackSummary()` — a deterministic prose summary, used verbatim when the
 *                         AI summary is unavailable (no key, demo mode, error)
 *                         and as the grounding facts for the AI one
 *
 * Pure and isomorphic on purpose: the modal renders it client-side, and the
 * lead-summary route feeds the SAME facts to Claude server-side, so the two can
 * never tell different stories about the same lead.
 *
 * FACTS ONLY. Every line here is countable off the trail — no inferred intent,
 * no "they seem keen". The AI summary is where interpretation happens; the desk
 * needs to be able to check any of these against the timeline by eye.
 */

import { eventKind, serviceName, type LeadActivity } from "@/lib/data/leadActivity";
import { DIRECT_CATEGORY, serviceLabel, sourceLabel, type PortalInquiry } from "@/lib/data/enquiries";
import { OUTREACH_SOURCE } from "@/lib/portal/source";

/* ───────────────────────────  the facts  ─────────────────────────── */

/** Per-service interest, busiest first. */
export interface ServiceInterest {
  service: string;
  opens: number;
}

/** The tracked half of the story — null for an enquirer who arrived without an
 *  attribution cookie (direct / social), where the enquiry IS the first touch. */
export interface EngagementTrail {
  firstSeen: string;
  lastSeen: string;
  /** tracked outreach links opened that forwarded to the portal */
  emailClicks: number;
  /** tracked links that forwarded to the sector info-pack PDF */
  packDownloads: number;
  portalViews: number;
  serviceOpens: number;
  /** questions asked of the portal assistant */
  chatPrompts: number;
  /** enquiries sent (≥1 for a row that's in this table) */
  enquiries: number;
  /** clicked through to apmgservices.com.au */
  websiteClicks: number;
  /** accepted the Terms & Privacy Policy at some point */
  consented: boolean;
  /** which trades they opened, busiest first */
  services: ServiceInterest[];
  /** visible steps in the trail (what the timeline renders) */
  steps: number;
  /** minutes from the first tracked touch to the enquiry, null if unorderable */
  minutesToEnquiry: number | null;
  /** distinct local days the lead was active on */
  daysActive: number;
  /** more than one distinct day = they came back */
  returned: boolean;
}

/** Everything the modal, the talking points and the AI prompt read. */
export interface EngagementFacts {
  /** "enquiry" — they submitted the portal form, so there's a service and a
   *  message. "lead" — a handed-over outreach lead who hasn't enquired, where
   *  the click trail is the whole record. */
  kind: "enquiry" | "lead";
  business: string | null;
  contactName: string | null;
  /** null for a scraped lead with no address on file */
  email: string | null;
  phone: string | null;
  /** hostname only — lead-kind only, an enquiry doesn't carry one */
  website: string | null;
  sector: string | null;
  campaign: string | null;
  /** traffic-source slug (tiktok / facebook / …), null when untagged */
  source: string | null;
  /** the service they enquired ABOUT (slug); null when they haven't enquired */
  enquiredService: string | null;
  /** when they enquired; null when they haven't */
  enquiredAt: string | null;
  /** when admin handed the lead to the Sales desk, ISO — lead-kind only */
  handedOverAt: string | null;
  message: string | null;
  trail: EngagementTrail | null;
}

/**
 * The Sales-side subject: a lead admin handed to the desk, which usually has
 * no enquiry behind it. Everything the scraped row didn't capture is null and
 * the readouts simply omit it; `sector` and `campaign` fall back to whatever
 * the trail recorded, so a thin lead row still names the campaign it came off.
 */
export interface LeadSubject {
  /** portal_events.lead_id — the key the trail and the AI summary are read by */
  leadId: string;
  business: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  sector: string | null;
  campaign: string | null;
  /** ISO stamp of the hand-off from admin */
  handedOverAt: string | null;
}

/* ───────────────────────────  small helpers  ─────────────────────────── */

const MINUTE = 60_000;

function minutesBetween(fromIso: string, toIso: string): number | null {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  const mins = Math.round((to - from) / MINUTE);
  // A negative gap means the stamps disagree (clock skew, a re-imported lead) —
  // report nothing rather than "enquired 3 minutes before they arrived".
  return mins >= 0 ? mins : null;
}

/** "12 minutes" / "3 hours" / "2 days" — for prose, so it reads out loud. */
export function humanDuration(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"}`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"}`;
}

/** "12 minutes ago" / "3 days ago" — how warm a lead with no enquiry is. Read
 *  against the caller's clock, which is what "warm" means on both the desk and
 *  the server (both are asking "how long since they touched us?"). */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "at an unknown time";
  const mins = Math.round((Date.now() - then) / MINUTE);
  if (mins < 0) return "just now";
  return `${humanDuration(mins)} ago`;
}

/** Local calendar day key — "came back on another day" is a human judgement,
 *  so it's counted in the reader's timezone, not UTC. */
function dayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Prose list: "Painting, Plumbing and Handyman". */
function joinList(items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/* ───────────────────────────  the join  ─────────────────────────── */

/**
 * Reduce one enquiry (+ its lead's trail, when it has one) into the flat facts.
 * The Enquiries tab's path, and the shape everything downstream was written to.
 */
export function buildEngagementFacts(
  inquiry: PortalInquiry,
  activity: LeadActivity | null,
): EngagementFacts {
  return withTrail(
    {
      kind: "enquiry",
      business: inquiry.business,
      contactName: inquiry.name,
      email: inquiry.email,
      phone: inquiry.phone,
      website: null,
      sector: inquiry.category,
      campaign: inquiry.campaign,
      source: inquiry.source,
      enquiredService: inquiry.serviceSlug,
      enquiredAt: inquiry.createdAt,
      handedOverAt: null,
      message: inquiry.message?.trim() || null,
      trail: null,
    },
    activity,
  );
}

/**
 * Reduce one handed-over Sales lead (+ its trail) into the same flat facts.
 *
 * The Sales queue's path: no enquiry, so no service, no message and no moment
 * to measure "time to enquiry" against — the trail carries the whole brief. The
 * sector and campaign fall back to what the trail recorded, because a scraped
 * lead row often knows less about its own campaign than its clicks do.
 */
export function buildLeadFacts(
  lead: LeadSubject,
  activity: LeadActivity | null,
): EngagementFacts {
  return withTrail(
    {
      kind: "lead",
      business: lead.business ?? activity?.business ?? null,
      contactName: lead.contactName,
      email: lead.email,
      phone: lead.phone,
      website: lead.website,
      sector: lead.sector ?? activity?.category ?? null,
      campaign: lead.campaign ?? activity?.campaign ?? null,
      source: null,
      enquiredService: null,
      enquiredAt: null,
      handedOverAt: lead.handedOverAt,
      message: null,
      trail: null,
    },
    activity,
  );
}

/**
 * Fold a lead's click trail into an already-built subject.
 *
 * The funnel tallies come from `activity.counts` — the route derives those over
 * the WHOLE event window, while `activity.events` is capped at the most recent
 * 50 — so the numbers stay honest for a busy lead even though the timeline is
 * truncated. Everything the counts don't carry (pack downloads vs plain email
 * clicks, website clicks, consent, per-service breakdown) is derived from the
 * visible events, which is all the data there is for those.
 */
function withTrail(base: EngagementFacts, activity: LeadActivity | null): EngagementFacts {
  if (!activity) return base;

  let packDownloads = 0;
  let websiteClicks = 0;
  let consented = false;
  let steps = 0;
  const opens = new Map<string, number>();
  const days = new Set<string>();

  for (const ev of activity.events) {
    const kind = eventKind(ev);
    // `other` is anything outside the customer-journey contract — it isn't
    // rendered in the timeline either, so it must not inflate the step count.
    if (kind === "other") continue;
    steps += 1;
    const day = dayKey(ev.ts);
    if (day) days.add(day);
    if (kind === "download") packDownloads += 1;
    else if (kind === "website") websiteClicks += 1;
    else if (kind === "consent") consented = true;
    else if (kind === "service" && ev.service) {
      opens.set(ev.service, (opens.get(ev.service) ?? 0) + 1);
    }
  }

  const services = [...opens.entries()]
    .map(([service, n]) => ({ service, opens: n }))
    .sort((a, b) => b.opens - a.opens || a.service.localeCompare(b.service));

  return {
    ...base,
    trail: {
      firstSeen: activity.firstSeen,
      lastSeen: activity.lastSeen,
      // counts.emailClicks is every attribution_click — the ones that forwarded
      // to the info pack are split out of it, so the two don't double-count.
      emailClicks: Math.max(0, activity.counts.emailClicks - packDownloads),
      packDownloads,
      portalViews: activity.counts.portalViews,
      serviceOpens: activity.counts.serviceOpens,
      chatPrompts: activity.counts.chatPrompts,
      enquiries: activity.counts.inquiries,
      websiteClicks,
      consented,
      services,
      steps,
      // Only meaningful against an enquiry — a lead who hasn't sent one has no
      // finish line to measure the run against.
      minutesToEnquiry: base.enquiredAt
        ? minutesBetween(activity.firstSeen, base.enquiredAt)
        : null,
      daysActive: days.size,
      returned: days.size > 1,
    },
  };
}

/* ───────────────────────────  talking points  ─────────────────────────── */

/** One line the rep can open with, plus the evidence behind it. */
export interface TalkingPoint {
  id: string;
  text: string;
  /** true for the lines that change how the call opens (rendered louder) */
  strong?: boolean;
}

/**
 * The skim-before-you-dial list. Ordered by what a rep would want to know
 * first: what they asked for, what else they looked at, how hard they looked,
 * and how to reach them. Every line is a countable fact from the trail.
 */
export function talkingPoints(facts: EngagementFacts): TalkingPoint[] {
  const points: TalkingPoint[] = [];
  const t = facts.trail;

  // 1 · what they actually asked about — or, on the Sales queue's usual case,
  //     the plain fact that they haven't asked for anything yet
  if (facts.kind === "enquiry") {
    points.push({
      id: "enquired",
      strong: true,
      text: `Enquired about ${serviceName(facts.enquiredService)}${
        facts.business ? ` for ${facts.business}` : ""
      }.`,
    });
  } else {
    points.push({
      id: "not-enquired",
      strong: true,
      text: t
        ? "Hasn’t sent an enquiry — they’ve been through the portal but never filled the form, so your call is the first direct contact."
        : "No enquiry and no tracked clicks yet — this is a cold call off the outreach list.",
    });
  }

  // 2 · the other trades they browsed — the natural upsell / "while we're there"
  if (t && t.services.length > 0) {
    const others = t.services.filter((s) => s.service !== facts.enquiredService && s.service !== "general");
    const top = t.services[0];
    if (top.opens > 1 && top.service !== "general") {
      points.push({
        id: "focus",
        strong: true,
        text: `Opened ${serviceName(top.service)} ${top.opens} times — that's where the interest is.`,
      });
    }
    if (others.length > 0) {
      const list = `${joinList(others.slice(0, 3).map((s) => serviceLabel(s.service)))}${
        others.length > 3 ? ` (+${others.length - 3} more)` : ""
      }`;
      points.push({
        id: "also-viewed",
        // "Also" only makes sense against an enquiry they've already made.
        text:
          facts.kind === "enquiry"
            ? `Also looked at ${list} — worth asking whether those need doing too.`
            : `Looked at ${list} — that's the work they were shopping for, so lead with it.`,
      });
    }
  }

  // 3 · the info pack: strong intent, and they've already read the pitch
  if (t && t.packDownloads > 0) {
    points.push({
      id: "pack",
      strong: true,
      text:
        t.packDownloads > 1
          ? `Downloaded the sector info pack ${t.packDownloads} times — they've read the pitch, so lead with specifics.`
          : "Downloaded the sector info pack — they've read the pitch, so lead with specifics.",
    });
  }

  // 4 · chat questions: they were researching before they committed
  if (t && t.chatPrompts > 0) {
    points.push({
      id: "chat",
      text: `Asked the portal assistant ${t.chatPrompts} question${
        t.chatPrompts === 1 ? "" : "s"
      } before enquiring — they had something specific they wanted answered.`,
    });
  }

  // 5 · repeat visits / how long they spent deciding
  if (t && t.returned) {
    points.push({
      id: "returned",
      text: `Came back across ${t.daysActive} separate days (${t.portalViews} portal visit${
        t.portalViews === 1 ? "" : "s"
      }) — this wasn't an impulse click.`,
    });
  } else if (t && t.portalViews > 1) {
    points.push({
      id: "revisits",
      text: `Visited the portal ${t.portalViews} times in the one session.`,
    });
  }

  if (t && t.minutesToEnquiry != null) {
    points.push({
      id: "speed",
      text:
        t.minutesToEnquiry <= 30
          ? `Went from email click to enquiry in ${humanDuration(t.minutesToEnquiry)} — call while it's hot.`
          : `Took ${humanDuration(t.minutesToEnquiry)} from first click to enquiry.`,
    });
  } else if (t && facts.kind === "lead") {
    // No enquiry to measure against, so the useful timing fact is recency —
    // "they were on the site this morning" changes how the call opens.
    points.push({
      id: "last-seen",
      text: `Last tracked activity ${relativeTime(t.lastSeen)} — that's how warm this is.`,
    });
  }

  // 6 · other signals worth a sentence
  if (t && t.websiteClicks > 0) {
    points.push({
      id: "website",
      text: "Clicked through to apmgservices.com.au — they've checked out the company itself.",
    });
  }

  // 7 · attribution — which campaign to reference, and where they came from
  if (facts.campaign) {
    points.push({
      id: "campaign",
      text: `Came in off the ${facts.campaign} campaign${
        facts.sector ? ` (${facts.sector})` : ""
      } — reference what that email offered.`,
    });
  } else if (facts.source && facts.source !== OUTREACH_SOURCE) {
    points.push({
      id: "source",
      text: `Found the portal via ${sourceLabel(facts.source)}, not an outreach email.`,
    });
  }

  // 8 · how to reach them
  if (facts.phone) {
    points.push({
      id: "phone",
      strong: true,
      text: `Left a phone number (${facts.phone}) — ring them rather than emailing.`,
    });
  }

  // The no-trail case: say so plainly instead of leaving the panel empty. A
  // direct enquirer isn't a cold lead, it just means there's nothing tracked.
  // (Lead-kind already opened with this — no need to say it twice.)
  if (!t && facts.kind === "enquiry") {
    points.push({
      id: "no-trail",
      text: facts.source
        ? `No tracked click trail — they came in through ${sourceLabel(
            facts.source,
          )}, so this enquiry is their first recorded touch.`
        : "No tracked click trail — they reached the portal directly, so this enquiry is their first recorded touch.",
    });
  }

  return points;
}

/* ───────────────────────────  deterministic summary  ─────────────────────────── */

/**
 * The prose summary, written from the facts alone.
 *
 * Rendered verbatim whenever the AI summary can't run (no key configured, demo
 * mode, or an API error), and handed to the model as the grounding facts when it
 * can — so the two always agree on the numbers.
 */
export function fallbackSummary(facts: EngagementFacts): string {
  const who = facts.business ?? facts.contactName ?? facts.email ?? "This lead";
  const t = facts.trail;
  const enquired = facts.kind === "enquiry";
  const service = serviceName(facts.enquiredService);

  if (!t) {
    if (!enquired) {
      return `${who} was handed to the desk off the outreach list and has no tracked portal activity — no email clicks, no visits, no enquiry. There's nothing recorded to open with, so treat this as a cold call and qualify from scratch.${
        facts.phone ? " There's a phone number on file, so ring rather than email." : ""
      }`;
    }
    const via = facts.source
      ? `arrived via ${sourceLabel(facts.source)}`
      : "reached the portal directly";
    return `${who} ${via} and enquired about ${service}. There's no tracked click trail for them, so this enquiry is the first recorded contact — treat the enquiry itself as the whole story and qualify on the call.${
      facts.phone ? ` They left a phone number, so ring rather than email.` : ""
    }`;
  }

  const steps: string[] = [];
  if (t.emailClicks > 0) {
    steps.push(`opened the outreach link ${t.emailClicks === 1 ? "once" : `${t.emailClicks} times`}`);
  }
  if (t.packDownloads > 0) {
    steps.push(`downloaded the info pack${t.packDownloads > 1 ? ` ${t.packDownloads} times` : ""}`);
  }
  if (t.portalViews > 0) {
    steps.push(`visited the services portal ${t.portalViews === 1 ? "once" : `${t.portalViews} times`}`);
  }
  if (t.serviceOpens > 0) {
    const names = t.services.slice(0, 3).map((s) => serviceLabel(s.service));
    steps.push(
      `opened ${t.serviceOpens} service card${t.serviceOpens === 1 ? "" : "s"}${
        names.length ? ` (${joinList(names)})` : ""
      }`,
    );
  }
  if (t.chatPrompts > 0) {
    steps.push(
      `asked the portal assistant ${t.chatPrompts} question${t.chatPrompts === 1 ? "" : "s"}`,
    );
  }
  if (t.websiteClicks > 0) steps.push("clicked through to the main website");

  const journey = steps.length > 0 ? `They ${joinList(steps)}` : "They reached the portal";
  const span =
    t.minutesToEnquiry != null
      ? ` The whole run took ${humanDuration(t.minutesToEnquiry)} from first click to enquiry${
          t.returned ? `, spread over ${t.daysActive} days` : ""
        }.`
      : "";
  const sector = facts.sector && facts.sector !== DIRECT_CATEGORY ? ` (${facts.sector})` : "";
  const contact = facts.phone
    ? ` They ${enquired ? "left" : "have"} a phone number, so a call will beat an email.`
    : "";

  if (!enquired) {
    // No enquiry: the trail IS the brief, so it opens with the activity rather
    // than with a service they never named.
    const focus = t.services[0];
    const interest =
      focus && focus.service !== "general"
        ? ` The interest is in ${serviceLabel(focus.service)}${
            focus.opens > 1 ? ` (opened ${focus.opens} times)` : ""
          }, so open there.`
        : " Nothing in the trail names a specific trade yet, so open by asking what they're chasing.";
    const recency = ` Last tracked activity was ${relativeTime(t.lastSeen)}${
      t.returned ? `, across ${t.daysActive} separate days` : ""
    }.`;
    return `${who}${sector} was handed to the desk off outreach and hasn't enquired. ${journey}, but never sent the form.${recency}${interest}${contact}`;
  }

  return `${who}${sector} enquired about ${service}. ${journey}, then sent the enquiry.${span}${contact}`;
}
