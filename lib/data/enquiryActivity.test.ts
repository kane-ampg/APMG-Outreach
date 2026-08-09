import { describe, expect, it } from "vitest";
import {
  buildEngagementFacts,
  buildLeadFacts,
  fallbackSummary,
  talkingPoints,
  type LeadSubject,
} from "./enquiryActivity";
import type { PortalInquiry } from "./enquiries";
import type { LeadActivity } from "./leadActivity";

/**
 * The facts builder is what both "View" modals, both sets of talking points and
 * the AI prompt are written against, so its two subjects are pinned here:
 *
 *   enquiry — the Enquiries tab. Someone filled the form.
 *   lead    — the Sales queue. Admin handed the lead over off tracked clicks,
 *             and it has usually NEVER enquired.
 *
 * The load-bearing guarantee is the last group: nothing on the lead path may
 * claim the lead got in touch. A rep reads these lines out loud on a cold call.
 */

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

function trail(over: Partial<LeadActivity> = {}): LeadActivity {
  return {
    leadId: "lead-1",
    business: "Croydon North Kindergarten",
    category: "Preschool",
    campaign: "outreach-2026",
    firstSeen: minutesAgo(120),
    lastSeen: minutesAgo(30),
    events: [
      { event: "attribution_click", service: null, destination: "https://portal", ts: minutesAgo(120) },
      { event: "portal_view", service: null, destination: null, ts: minutesAgo(115) },
      { event: "portal_service_open", service: "gardening", destination: null, ts: minutesAgo(100) },
      { event: "portal_service_open", service: "gardening", destination: null, ts: minutesAgo(90) },
      { event: "portal_service_open", service: "painting", destination: null, ts: minutesAgo(30) },
    ],
    counts: { emailClicks: 1, portalViews: 1, serviceOpens: 3, inquiries: 0, chatPrompts: 0 },
    ...over,
  };
}

function inquiry(over: Partial<PortalInquiry> = {}): PortalInquiry {
  return {
    id: "enq-1",
    serviceSlug: "gardening",
    serviceName: "Gardening & Grounds Maintenance",
    name: "Nicole Parseghian",
    email: "cnk.president@gmail.com",
    phone: "0421490660",
    message: "Outside flooring has lifted - needs to be fixed. OH&S issue",
    leadId: "lead-1",
    business: "Croydon North Kindergarten",
    campaign: "outreach-2026",
    category: "Preschool",
    source: null,
    status: "new",
    createdAt: minutesAgo(20),
    ...over,
  };
}

const LEAD: LeadSubject = {
  leadId: "lead-1",
  business: "Croydon North Kindergarten",
  contactName: null,
  email: "office@cnk.example",
  phone: "0421490660",
  website: "cnk.example",
  sector: "Preschool",
  campaign: null,
  handedOverAt: minutesAgo(10),
};

describe("buildEngagementFacts (the enquiry subject)", () => {
  it("keeps the enquiry's own fields and marks the kind", () => {
    const facts = buildEngagementFacts(inquiry(), trail());
    expect(facts.kind).toBe("enquiry");
    expect(facts.enquiredService).toBe("gardening");
    expect(facts.message).toBe("Outside flooring has lifted - needs to be fixed. OH&S issue");
    expect(facts.website).toBeNull();
  });

  it("measures the run from first click to the enquiry", () => {
    const facts = buildEngagementFacts(inquiry(), trail());
    // first seen 120m ago, enquired 20m ago
    expect(facts.trail?.minutesToEnquiry).toBe(100);
  });

  it("survives an enquirer with no tracked trail", () => {
    const facts = buildEngagementFacts(inquiry({ leadId: null }), null);
    expect(facts.trail).toBeNull();
    expect(fallbackSummary(facts)).toContain("no tracked click trail");
  });
});

describe("buildLeadFacts (the Sales subject)", () => {
  it("marks the kind and carries no enquiry", () => {
    const facts = buildLeadFacts(LEAD, trail());
    expect(facts.kind).toBe("lead");
    expect(facts.enquiredService).toBeNull();
    expect(facts.enquiredAt).toBeNull();
    expect(facts.message).toBeNull();
  });

  it("has no time-to-enquiry, because there is no enquiry to measure against", () => {
    expect(buildLeadFacts(LEAD, trail()).trail?.minutesToEnquiry).toBeNull();
  });

  it("falls back to the trail for the sector and campaign the scraped row lacks", () => {
    const thin = buildLeadFacts({ ...LEAD, sector: null, campaign: null }, trail());
    expect(thin.sector).toBe("Preschool");
    expect(thin.campaign).toBe("outreach-2026");
  });

  it("still counts the funnel off the trail", () => {
    const t = buildLeadFacts(LEAD, trail()).trail;
    expect(t?.serviceOpens).toBe(3);
    expect(t?.services[0]).toEqual({ service: "gardening", opens: 2 });
    expect(t?.steps).toBe(5);
  });

  it("handles a handed-over lead with nothing tracked at all", () => {
    const facts = buildLeadFacts(LEAD, null);
    expect(facts.trail).toBeNull();
    expect(fallbackSummary(facts)).toContain("cold call");
  });
});

describe("the lead path never claims they got in touch", () => {
  const CONTACT_CLAIMS = /\benquired\b|\benquiry\b|\bgot in touch\b|\breached out\b/i;

  it("holds for the talking points", () => {
    const points = talkingPoints(buildLeadFacts(LEAD, trail()));
    const opener = points[0];
    expect(opener.text).toMatch(/Hasn’t sent an enquiry/);
    // The one permitted mention is the opener saying they HAVEN'T enquired.
    for (const p of points.slice(1)) {
      expect(p.text).not.toMatch(CONTACT_CLAIMS);
    }
  });

  it("holds for the deterministic summary", () => {
    const summary = fallbackSummary(buildLeadFacts(LEAD, trail()));
    expect(summary).toMatch(/hasn't enquired|hasn’t enquired/i);
    expect(summary).toContain("never sent the form");
    expect(summary).toMatch(/Gardening/);
  });

  it("holds when there is no trail either", () => {
    const summary = fallbackSummary(buildLeadFacts(LEAD, null));
    expect(summary).toContain("no tracked portal activity");
    expect(summary).not.toMatch(/\bthey enquired\b/i);
  });

  it("leaves the enquiry path saying they DID enquire", () => {
    const points = talkingPoints(buildEngagementFacts(inquiry(), trail()));
    expect(points[0].text).toMatch(/^Enquired about Gardening/);
    expect(fallbackSummary(buildEngagementFacts(inquiry(), trail()))).toContain(
      "enquired about Gardening",
    );
  });
});
