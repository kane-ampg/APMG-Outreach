import type { StaticImageData } from "next/image";
import {
  Droplets,
  Hammer,
  Layers,
  MessageSquare,
  Paintbrush,
  ShieldCheck,
  Sprout,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import photoElectrical from "@/app/services/electrical.png";
import photoPainting from "@/app/services/painting.png";
import photoPlumbing from "@/app/services/plumbing.png";
import photoCarpentry from "@/app/services/carpentry.png";
import photoFlooring from "@/app/services/flooring.png";
import photoGardening from "@/app/services/gardening.png";
import photoHandyman from "@/app/services/handyman.png";
import photoMakeSafe from "@/app/services/make-safe.png";
import type { ProcessIconName } from "./process-icons";

/**
 * The portal's content, extracted verbatim from ServicesPortal.tsx when the
 * 2026-09-22 rebuild split that one scrolling page into five routes. Every
 * section now lives in its own file under portal/sections, and all five of
 * them — plus the internal dashboard tab — read their copy from here, so the
 * services list has exactly one definition rather than one per page.
 *
 * Data only, no "use client": a server component that just needs the service
 * list (app/portal/page.tsx, which picks the random spotlight) can import it
 * without pulling a client boundary along with it.
 */

export interface Service {
  slug: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  /** Card banner — a real APMG job-site photo. Optional so the pseudo-service
   *  (GENERAL_SERVICE) and the modal, which share this shape, need not carry one. */
  photo?: StaticImageData;
  /** Full service description, verbatim from the public site's service detail
   *  page (apmgservices.com.au/services/*) — the copy behind each card's
   *  "Tell me more". Shown in the enquiry modal so the visitor sees what the
   *  trade covers at the exact point they enquire about it. Paragraphs are
   *  separated by "\n\n". Optional: `general` has no site page. */
  description?: string;
  /** The same site page's "what's included" bullet list, verbatim. */
  includes?: string[];
}

/**
 * Pseudo-service for the hero + closing CTAs — the "not sure which trade"
 * path. Same shape as a real service so the modal and the event contract
 * treat it uniformly (slug `general`).
 */
export const GENERAL_SERVICE: Service = {
  slug: "general",
  name: "General enquiry",
  blurb: "Not sure which trade you need? Tell us what's going on and we'll sort the rest.",
  icon: MessageSquare,
};

/** Services from the APMG site. Blurb rule (Company-Brief: avoid exaggeration,
 *  avoid overpromising): describe the work, not superlatives — "flawless",
 *  "perfection" and unbacked speed promises are trust-negative with facility
 *  managers, who've heard them from every contractor that later let them down.
 *
 *  `description` + `includes` are DIFFERENT: they're the client's own published
 *  copy, carried verbatim from each service's detail page on
 *  apmgservices.com.au/services (the "Tell me more" modals) into the enquiry
 *  modal, per the client's request. Verbatim means verbatim — edit the site,
 *  not this file, when the copy needs to change. Synced 2026-07-28. */
export const SERVICES: Service[] = [
  {
    slug: "electrical",
    name: "Electrical Services",
    blurb: "Safe, licensed electrical work — from new power points to full rewires.",
    icon: Zap,
    photo: photoElectrical,
    description:
      "APMG Services offers licensed electrical solutions for residential, commercial, and industrial properties across Melbourne. From power upgrades, rewiring, and lighting installations to switchboard upgrades, testing, maintenance, and emergency repairs we do it all.\n\nOur certified electricians ensure every job meets strict safety and compliance standards. Whether it’s a one-off fix or ongoing electrical maintenance, you can rely on us for efficient, expert service.",
    includes: [
      "Installation and maintenance of lighting systems",
      "Power point and switchboard upgrades",
      "Data and communications cabling",
      "Emergency electrical repairs and fault finding",
      "Testing and tagging for compliance and safety",
      "Energy-efficient solutions to reduce operating costs",
    ],
  },
  {
    slug: "painting",
    name: "Painting Services",
    blurb: "Interior and exterior painting, prepared properly and finished with care.",
    icon: Paintbrush,
    photo: photoPainting,
    description:
      "Transform your spaces with expert painting solutions tailored for residential, commercial, and industrial properties. At APMG Services, our skilled painters deliver flawless finishes, long-lasting results, and minimal disruption — whether it’s a full repaint, touch-up, or detailed surface preparation.\n\nWe use premium materials and follow strict compliance for safety and quality. Trust Melbourne’s trades hub to bring colour, protection, and value to your property.",
    includes: [
      "Interior and exterior painting",
      "Surface preparation, repair, and priming",
      "Protective coatings and weather-resistant finishes",
      "Feature walls and custom colour solutions",
      "Painting for offices, schools, healthcare facilities, and homes",
    ],
  },
  {
    slug: "plumbing",
    name: "Plumbing Services",
    blurb: "Leaks, blocked drains, installs and urgent repairs — handled properly.",
    icon: Droplets,
    photo: photoPlumbing,
    description:
      "From blocked drains and burst pipes to full plumbing fit-outs, APMG Services covers all aspects of residential, commercial, and industrial plumbing. We handle repairs, upgrades, installations, and ongoing maintenance with speed, precision, and care.\n\nOur licensed plumbers ensure every job is completed to Australian standards, keeping your property safe, compliant, and running smoothly. No matter the size or urgency, we’ve got the tools and expertise to get it sorted.",
    includes: [
      "General plumbing repairs and maintenance",
      "Leak detection and emergency plumbing support",
      "Blocked drain clearing and pipework solutions",
      "Hot water system installation, repair, and servicing",
      "Tap, toilet, and fixture installations or replacements",
      "Preventative maintenance to reduce costly breakdowns",
    ],
  },
  {
    slug: "carpentry",
    name: "Carpentry & Joinery",
    blurb: "Repairs, installations and custom timberwork — doors, frames, cabinetry.",
    icon: Hammer,
    photo: photoCarpentry,
    description:
      "From structural framing to detailed finishes, APMG Services delivers expert carpentry and joinery across Melbourne. We specialise in repairs, renovations, fit-outs, and custom-built solutions for residential, commercial, and industrial properties.\n\nOur qualified carpenters work with precision and care to ensure every project is durable, compliant, and built to last. Whether it’s doors, walls, decking or cabinetry — we’ve got every detail covered.",
    includes: [
      "Structural repairs, framing, and general carpentry",
      "Custom joinery and fittings designed for your space",
      "Door, window, and skirting board installation or replacement",
      "Partitioning, shelving, and storage solutions",
      "Restoration and repair of existing timberwork",
      "Outdoor carpentry including decking, fencing, and pergolas",
    ],
  },
  {
    slug: "flooring",
    name: "Flooring Services",
    blurb: "Timber, vinyl, laminate and carpet — repairs, replacement and new floors.",
    icon: Layers,
    photo: photoFlooring,
    description:
      "At APMG Services, we supply and install all types of flooring for residential, commercial, and industrial spaces. From vinyl, laminate, and hybrid to carpet, tiles, and timber — we handle everything from surface prep to final finish.\n\nOur experienced team ensures every floor is level, compliant, and built to withstand daily wear. Whether it’s a fresh installation or a flooring upgrade, we deliver quality, durability, and style in every square metre.",
    includes: [
      "Supply and installation of vinyl, carpet, timber, and laminate flooring",
      "Floor repairs, refinishing, and restoration",
      "Non-slip and safety flooring for commercial spaces",
      "High-performance surfaces designed for heavy use",
      "Floor preparation and levelling prior to installation",
      "Ongoing maintenance to extend the life of flooring investments",
    ],
  },
  {
    slug: "gardening",
    name: "Gardening & Grounds Maintenance",
    blurb: "Lawns, gardens and grounds kept safe, tidy and presentable.",
    icon: Sprout,
    photo: photoGardening,
    description:
      "APMG Services provides professional landscaping and garden maintenance for residential, commercial, and public spaces across Melbourne. We cover everything from lawn care, pruning, and weeding to landscaping, planting, and outdoor upgrades. Our work keeps your grounds safe, tidy, and looking their best all year round.\n\nOur team delivers precision and care on every job, presenting each site at its best and meeting compliance requirements. You can book us for one-off projects or choose a scheduled maintenance plan. Either way, we keep your outdoor areas in top shape.",
    includes: [
      "Consistent and reliable maintenance",
      "Skilled team with attention to detail",
      "Flexible schedules tailored to client needs",
      "Safe and compliant grounds management",
      "Proven experience with large outdoor spaces",
    ],
  },
  {
    slug: "handyman",
    name: "Handyman Services",
    blurb: "The odd jobs and small repairs — all handled in a single call.",
    icon: Wrench,
    photo: photoHandyman,
    // Site source reads "…or general upkeep no task is too small" — an em dash
    // restores the missing punctuation; the words are otherwise untouched.
    description:
      "From minor repairs to odd jobs, APMG Services offers fast, professional handyman support for homes, businesses, and facilities. Whether it’s patching walls, fixing locks, hanging fixtures, assembling furniture, or general upkeep — no task is too small.\n\nOur skilled handymen work efficiently with a focus on safety, quality, and minimal disruption. Ideal for ongoing maintenance or one-off jobs, we’re your trusted team for reliable, no-fuss property support.",
    includes: [
      "General repairs and upkeep",
      "Fixture and fitting installations",
      "Minor carpentry and painting works",
      "Door, window, and lock repairs",
      "Small-scale maintenance tasks",
    ],
  },
  {
    slug: "make-safe",
    name: "Property Make Safe Services",
    blurb: "Securing and making sites safe after storm damage, faults or break-ins.",
    icon: ShieldCheck,
    photo: photoMakeSafe,
    description:
      "When emergencies strike, APMG Services is ready. We provide rapid, all-trade make safe solutions for residential, commercial, and industrial properties — from securing broken windows and damaged doors to addressing structural risks, leaks, and electrical hazards.\n\nOur licensed team responds quickly to minimise damage, restore safety, and meet insurance or compliance requirements. Whether it’s storm damage, vandalism, or urgent repairs, we’re the trusted partner for fast, effective property protection.",
    includes: [
      "Emergency repairs to secure properties",
      "Storm and impact damage response",
      "Temporary structural stabilisation",
      "Boarding up broken windows or doors",
      "Hazard removal to eliminate immediate risks",
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Page copy                                                            */
/* ------------------------------------------------------------------ */

/** Trading since. The one date the proof band and the figures strip both
 *  derive from, so they can never disagree. Substantiated in
 *  knowledgebase/business.md ("Est. 2015"). */
export const FOUNDED = 2015;

/** How `Service.description` separates its paragraphs. Named because the lead
 *  service card shows only the first one. */
export const PARAGRAPH_BREAK = "\n\n";

/**
 * What happens after an enquiry. The sequence IS the information — a facility
 * manager reading this is deciding whether contacting us costs them anything,
 * so each step names who does what and when.
 */
export const PROCESS: readonly { step: string; body: string; icon: ProcessIconName }[] = [
  {
    icon: "enquiry",
    step: "You tell us what's wrong",
    body: "A photo and a sentence is enough to start. Pick the trade if you know it, or send a general enquiry and we'll work out which trades the job needs.",
  },
  {
    icon: "site-visit",
    step: "We come and look",
    body: "We attend before quoting. Scope, access and the hours we're allowed on site get established rather than assumed — which is what stops a quote turning into a variation.",
  },
  {
    icon: "quote",
    step: "An itemised quote",
    body: "Labour, materials and scheduling broken out separately, so whoever approves the spend can see what they're approving. Multi-site work is priced per location.",
  },
  {
    icon: "delivery",
    step: "Work around your operations",
    body: "Staged zone by zone, after hours or on weekends where the space has to stay in use. Aged care and childcare sites are scheduled around residents and sessions.",
  },
  {
    icon: "handover",
    step: "Handed back clean",
    body: "Each area cleaned down and returned as it finishes rather than everything at the end, so you get the use of the space back progressively.",
  },
];

/**
 * How the work is actually run. Each item summarises something already true of
 * the business — none of these is a claim of quality, they are descriptions of
 * method a client can hold us to.
 */
export const APPROACH: readonly { heading: string; body: string }[] = [
  {
    heading: "One contact for every trade",
    body: "Eight trades under one point of contact. The gap between contractors is what usually stalls a job, so the electrician, plumber and carpenter are scheduled against the same programme.",
  },
  {
    heading: "The building keeps running",
    body: "Aged care homes are occupied around the clock and childcare rooms are full all day. Work is staged, isolated or run after hours so the site never closes a space for us.",
  },
  {
    heading: "We attend before we quote",
    body: "Preparation and access are the largest variables in any maintenance job and neither can be judged from a photograph. A site visit comes before a number.",
  },
  {
    heading: "Reactive and preventative",
    body: "Make-safe callouts when something breaks, and scheduled programmes so it breaks less. Most clients start with the first and move to the second.",
  },
  {
    heading: "Licensed, and checkable",
    body: "Licensed multi-trade professionals working across Melbourne and regional Victoria. Our Google reviews are on this page, unedited, straight from Google.",
  },
  {
    heading: "Priced line by line",
    body: "An itemised breakdown rather than one figure, so a committee or a budget holder can approve part of a list now and hold the rest for the next cycle.",
  },
];

/**
 * The four substantiated facts, built rather than stored because two of them
 * are derived: years trading counts from FOUNDED against the current year, and
 * the trade count is the length of SERVICES, so neither can drift out of step
 * with the rest of the page the way a hardcoded string would.
 *
 * Every value must be substantiated (knowledgebase/business.md) — this band is
 * the most quotable thing on the portal, so an unbacked "500+ jobs" style claim
 * cannot be allowed to live here. Each figure carries a detail line precise
 * enough to defend on its own.
 *
 * Read by /portal/approach (the compact band) and by PortalFooter (the tall
 * band, on the internal dashboard tab).
 */
export function portalFacts(): readonly { figure: string; label: string; detail: string }[] {
  const yearsTrading = new Date().getFullYear() - FOUNDED;
  return [
    {
      label: "In business",
      figure: `${yearsTrading} years`,
      detail: `Australian Property Maintenance Group has been trading since ${FOUNDED}.`,
    },
    {
      label: "Trades in-house",
      figure: String(SERVICES.length),
      detail:
        "Electrical through make-safe, scheduled against one programme instead of eight contractors.",
    },
    {
      label: "Where we work",
      figure: "Victoria",
      detail: "Metropolitan Melbourne and regional Victoria, worked from Chirnside Park.",
    },
    {
      label: "How we work",
      figure: "Both",
      detail:
        "Reactive make-safe callouts, and preventative programmes so there are fewer of them.",
    },
  ];
}
