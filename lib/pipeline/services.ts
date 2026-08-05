// The 8 APMG service lines, as campaign templates for the Send Campaigns tab.
// Pure and framework-free (like campaign.ts) so the SAME definitions drive the
// client picker (Step 2 Compose), the AI compose route (service focus), and the
// send route (per-service hero image in the branded n8n email).
//
// Copy is grounded in the service descriptions on apmgservices.com.au/services
// (mirrored verbatim in components/apmg/ServicesPortal.tsx) — only facts stated
// there appear here. Voice mirrors DEFAULT_BODY_HTML in campaign.ts: natural
// Australian English, no em dashes, the "who's the best person" ask, and a
// short tailored CTA label. {{business}} and {{link}} are the merge tokens.

export interface ServiceTemplate {
  /** Stable id, used across the client → compose/send routes → n8n payload. */
  slug: string;
  /** Display name, as on the Services portal. */
  name: string;
  /** Short label for the picker chips. */
  short: string;
  /** Shared-template subject line. */
  subject: string;
  /** Shared-template HTML body ({{business}} / {{link}} merge tokens). */
  html: string;
  /** What this service actually covers — appended to the AI compose prompt so
   *  Claude leads with this service and still tailors it to the lead's sector
   *  (e.g. flooring for a childcare centre = safe, non-slip floors for kids). */
  focus: string;
  /** Object path of the service photo in the sector-assets Storage bucket —
   *  the hero image the n8n Split Messages node puts under the email header. */
  image: string;
  /** Accessible alt text for that hero image. */
  imageAlt: string;
}

export const SERVICE_TEMPLATES: readonly ServiceTemplate[] = [
  {
    slug: "electrical",
    name: "Electrical Services",
    short: "Electrical",
    subject: "Licensed electrical work for your site, one local crew",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. Our licensed electricians handle lighting installation and maintenance, power point and switchboard upgrades, data cabling, testing and tagging, fault finding and emergency electrical repairs.</p>
<p>We keep sites like yours safe and compliant, working around your day so the people who rely on your site aren't disrupted. Who's the best person to speak to about electrical work at your site?</p>
<p><a href="{{link}}">Electrical work, sorted</a></p>
<p>The APMG Services team</p>`,
    focus:
      "Licensed electrical work for residential, commercial and industrial properties: lighting installation and maintenance, power point and switchboard upgrades, data and communications cabling, emergency electrical repairs and fault finding, testing and tagging for compliance and safety, and energy efficient solutions to reduce operating costs.",
    image: "services/electrical.jpg",
    imageAlt: "An APMG Services licensed electrician at work",
  },
  {
    slug: "painting",
    name: "Painting Services",
    short: "Painting",
    subject: "Painting your site properly, with minimal disruption",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. Our painters handle interior and exterior painting, surface preparation and priming, protective coatings and weather resistant finishes, for offices, schools, healthcare facilities and homes.</p>
<p>We prepare properly, finish with care and work around your day, so the people who rely on your site aren't disrupted. Who's the best person to speak to about painting at your site?</p>
<p><a href="{{link}}">Painting, done properly</a></p>
<p>The APMG Services team</p>`,
    focus:
      "Interior and exterior painting for residential, commercial and industrial properties: surface preparation, repair and priming, protective coatings and weather resistant finishes, feature walls and custom colour solutions, with premium materials, flawless finishes and minimal disruption.",
    image: "services/painting.jpg",
    imageAlt: "An APMG Services painter finishing a wall",
  },
  {
    slug: "plumbing",
    name: "Plumbing Services",
    short: "Plumbing",
    subject: "Plumbing repairs and maintenance, sorted",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. Our licensed plumbers handle general repairs and maintenance, leak detection, blocked drains, hot water systems, tap and fixture replacements and emergency plumbing support.</p>
<p>Every job is completed to Australian standards, keeping your property safe, compliant and running smoothly. Who's the best person to speak to about plumbing at your site?</p>
<p><a href="{{link}}">Plumbing, sorted</a></p>
<p>The APMG Services team</p>`,
    focus:
      "All aspects of residential, commercial and industrial plumbing: general repairs and maintenance, leak detection and emergency support, blocked drain clearing and pipework, hot water system installation and servicing, tap, toilet and fixture installations, and preventative maintenance to reduce costly breakdowns.",
    image: "services/plumbing.jpg",
    imageAlt: "An APMG Services licensed plumber on the tools",
  },
  {
    slug: "carpentry",
    name: "Carpentry & Joinery",
    short: "Carpentry",
    subject: "Carpentry and joinery for your site, done right",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. Our qualified carpenters handle structural repairs and framing, doors, windows and skirting, partitioning, shelving and custom joinery, plus outdoor work like decking and fencing.</p>
<p>Every job is built to last, done with care and worked around your day so the people who rely on your site aren't disrupted. Who's the best person to speak to about carpentry at your site?</p>
<p><a href="{{link}}">Carpentry, done right</a></p>
<p>The APMG Services team</p>`,
    focus:
      "Expert carpentry and joinery: structural repairs, framing and general carpentry, custom joinery and fittings, door, window and skirting board installation or replacement, partitioning, shelving and storage, restoration of existing timberwork, and outdoor carpentry including decking, fencing and pergolas.",
    image: "services/carpentry.jpg",
    imageAlt: "An APMG Services carpenter at work on timber joinery",
  },
  {
    slug: "flooring",
    name: "Flooring Services",
    short: "Flooring",
    subject: "Flooring supplied, installed and repaired, one crew",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. We supply and install vinyl, carpet, timber, laminate and hybrid flooring, handle repairs, refinishing and levelling, and fit non-slip and safety flooring for commercial spaces.</p>
<p>Every floor is level, compliant and built to withstand daily wear, installed around your day so the people who rely on your site aren't disrupted. Who's the best person to speak to about flooring at your site?</p>
<p><a href="{{link}}">Flooring, done right</a></p>
<p>The APMG Services team</p>`,
    focus:
      "Supply and installation of all flooring types for residential, commercial and industrial spaces: vinyl, carpet, timber, laminate and hybrid, floor repairs, refinishing and restoration, non-slip and safety flooring, high performance surfaces for heavy use, floor preparation and levelling, and ongoing maintenance.",
    image: "services/flooring.jpg",
    imageAlt: "An APMG Services installer laying new flooring",
  },
  {
    slug: "gardening",
    name: "Gardening & Grounds Maintenance",
    short: "Grounds",
    subject: "Grounds and gardens kept safe, tidy and presentable",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. Our grounds crew handles lawn care, pruning, weeding, planting and landscaping, on one-off jobs or a scheduled maintenance plan that keeps your outdoor areas at their best all year round.</p>
<p>We keep grounds safe, compliant and looking their best, working around your day so the people who rely on your site aren't disrupted. Who's the best person to speak to about grounds maintenance at your site?</p>
<p><a href="{{link}}">Grounds, kept tidy</a></p>
<p>The APMG Services team</p>`,
    focus:
      "Professional landscaping and garden maintenance for residential, commercial and public spaces: lawn care, pruning, weeding, planting, landscaping and outdoor upgrades, safe and compliant grounds management, available as one-off projects or scheduled maintenance plans, with proven experience on large outdoor spaces.",
    image: "services/gardening.jpg",
    imageAlt: "The APMG Services grounds crew maintaining gardens",
  },
  {
    slug: "handyman",
    name: "Handyman Services",
    short: "Handyman",
    subject: "The small repairs at your site, handled in one call",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. Our handymen take care of the odd jobs that pile up: general repairs and upkeep, fixture and fitting installs, minor carpentry and painting, door, window and lock repairs.</p>
<p>No task is too small, and we work around your day so the people who rely on your site aren't disrupted. Who's the best person to speak to about the small jobs at your site?</p>
<p><a href="{{link}}">Small jobs, sorted</a></p>
<p>The APMG Services team</p>`,
    focus:
      "Fast, professional handyman support for homes, businesses and facilities: general repairs and upkeep, fixture and fitting installations, minor carpentry and painting works, door, window and lock repairs, and small scale maintenance tasks, ideal for ongoing maintenance or one-off jobs.",
    image: "services/handyman.jpg",
    imageAlt: "An APMG Services handyman on a small repair job",
  },
  {
    slug: "make-safe",
    name: "Property Make Safe Services",
    short: "Make Safe",
    subject: "Rapid make safe response for your property",
    html: `<p>Hi {{business}},</p>
<p>We're APMG Services, a Melbourne based property maintenance team. When emergencies strike we provide rapid, all-trade make safe works: securing broken windows and doors, temporary structural stabilisation, and hazard removal after storm damage, vandalism or urgent faults.</p>
<p>Our licensed team responds quickly to minimise damage, restore safety and meet insurance and compliance requirements. Who's the best person to speak to about make safe cover for your site?</p>
<p><a href="{{link}}">Make safe, fast</a></p>
<p>The APMG Services team</p>`,
    focus:
      "Rapid, all-trade make safe solutions for residential, commercial and industrial properties: emergency repairs to secure properties, storm and impact damage response, temporary structural stabilisation, boarding up broken windows or doors, and hazard removal to eliminate immediate risks, meeting insurance and compliance requirements.",
    image: "services/make-safe.jpg",
    imageAlt: "The APMG Services crew securing a site after damage",
  },
] as const;

/** Look up a service template by slug; null for unknown / empty (general). */
export function serviceBySlug(slug: string | null | undefined): ServiceTemplate | null {
  const s = (slug ?? "").trim().toLowerCase();
  if (!s) return null;
  return SERVICE_TEMPLATES.find((t) => t.slug === s) ?? null;
}
