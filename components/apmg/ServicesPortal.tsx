"use client";

import { useEffect, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import {
  ArrowRight,
  BadgeCheck,
  Droplets,
  Globe,
  Hammer,
  Layers,
  Mail,
  MapPin,
  MessageSquare,
  Paintbrush,
  Phone,
  ShieldCheck,
  Sprout,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Container,
  ContentBlock,
  CtaBand,
  Eyebrow,
  FactStrip,
  FeatureGrid,
  mediaZoom,
  microLabel,
  PortalButton,
  PortalButtonLink,
  PortalSection,
  ProcessSteps,
  SectionHeading,
} from "./portal/kit";
import { COMPANY } from "@/lib/legal/company";
import { WhatsAppIcon } from "./WhatsAppIcon";
import { GoogleReviewsPanel } from "./GoogleReviewsPanel";
import heroBg from "@/app/apmgbg.jpg";
import brandLogo from "@/app/icon.png";
// Card backgrounds — real APMG job-site photos, self-hosted in the repo
// (app/services/*, mirroring app/team/*) and static-imported so Next optimises
// them and hands us a blur placeholder. Keyed to each service slug below.
import photoElectrical from "@/app/services/electrical.png";
import photoPainting from "@/app/services/painting.png";
import photoPlumbing from "@/app/services/plumbing.png";
import photoCarpentry from "@/app/services/carpentry.png";
import photoFlooring from "@/app/services/flooring.png";
import photoGardening from "@/app/services/gardening.png";
import photoHandyman from "@/app/services/handyman.png";
import photoMakeSafe from "@/app/services/make-safe.png";
import { track } from "@/lib/telemetry";
import { Footer } from "./Footer";
import { SocialLinks } from "./SocialLinks";
import { PortalUnsubscribe } from "./PortalUnsubscribe";
import { PortalChat } from "./PortalChat";
import { ServiceInquiryModal } from "./ServiceInquiryModal";
import { TeamSection } from "./TeamSection";

/**
 * Customer-facing portal.
 *
 * A scrolling marketing page in the visual world of the APMG Painting site
 * (see components/apmg/portal/kit.tsx): white paper, `#0F1113` ink, `#C8102E`
 * as the only accent, Fraunces display against Inter body. Sections run hero →
 * figures → the eight trades → process → approach → reviews → team → CTA.
 *
 * Serves two hosts unchanged: the "Our Services" tab inside DashboardShell
 * (`standalone={false}`), and the public /portal route where tracked outreach
 * links land (`standalone`).
 *
 * Event contract (see the portal-telemetry spec):
 *  - `portal_view`          — tracked once per mount of the CUSTOMER host (the
 *                             funnel step between the outreach click and a
 *                             service open)
 *  - `portal_service_open`  — every service card + every general-enquiry CTA,
 *                             via data-track with `service` as the slug prop
 *  - `portal_inquiry_submit`— tracked by ServiceInquiryModal on a landed submit
 *  - `portal_phone_click`, `portal_email_click`, `portal_website_click`,
 *    `portal_whatsapp_click` — the contact surfaces, unchanged
 *
 * `portal_tab` is NO LONGER EMITTED. It named the in-page pill switcher, which
 * the 2026-08-24 redesign replaced with scrolled sections and in-page anchors.
 * It was never a contract event (the summary ignored it), so nothing that reads
 * the funnel changes — but a query filtering on it will return only history.
 *
 * HOST DISCRIMINATION: the funnel contract events are only emitted when
 * `standalone`. The internal tab mounts this same component, and letting it
 * fire the contract names would let an admin demoing the tab inflate every
 * Enquiries-tab conversion ratio with visits no customer made — internal opens
 * are tagged `services_card_open` instead (the summary ignores it).
 */

/**
 * PROOF BAND — the facts a cold visitor can check, shown right under the hero.
 * Every line here must be substantiated (knowledgebase/business.md); adjectives
 * don't build trust with facility managers, verifiable claims do.
 *
 * TODO(trust): the highest-value additions are still waiting on documentation —
 * public liability insurance (amount), trade licence numbers, police checks /
 * WWCC policy, and the ABN. Add each line the day the certificate is in hand;
 * never before (Company-Brief: no unsupported claims).
 */
const PROOF_POINTS = [
  "Australian Property Maintenance Group · Est. 2015",
  "Licensed, multi-trade professionals",
  "Melbourne & Victoria-wide",
  "Reactive & preventative maintenance",
  "One partner for every trade",
] as const;

/**
 * Sector line for the hero (message-match with the outreach email). The lead's
 * category arrives from /api/portal/context (resolved from the httpOnly
 * attribution cookie — category only, nothing identifying). The copy is a
 * template over the category so new sectors need no code change; the sectors
 * we target are all in the KB's "Sectors served" list, so the claim is
 * grounded. Null (no cookie / direct visit / demo) → no line, generic hero.
 */
function sectorLine(category: string): string {
  const c = category.trim();
  if (!c) return "";
  return `We support ${c.charAt(0).toLowerCase()}${c.slice(1)} sites across Melbourne — with minimal disruption to your daily operations.`;
}

interface Service {
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
const GENERAL_SERVICE: Service = {
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
const SERVICES: Service[] = [
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
const FOUNDED = 2015;

/**
 * What happens after an enquiry. The sequence IS the information — a facility
 * manager reading this is deciding whether contacting us costs them anything,
 * so each step names who does what and when.
 */
const PROCESS: readonly { step: string; body: string }[] = [
  {
    step: "You tell us what's wrong",
    body: "A photo and a sentence is enough to start. Pick the trade if you know it, or send a general enquiry and we'll work out which trades the job needs.",
  },
  {
    step: "We come and look",
    body: "We attend before quoting. Scope, access and the hours we're allowed on site get established rather than assumed — which is what stops a quote turning into a variation.",
  },
  {
    step: "An itemised quote",
    body: "Labour, materials and scheduling broken out separately, so whoever approves the spend can see what they're approving. Multi-site work is priced per location.",
  },
  {
    step: "Work around your operations",
    body: "Staged zone by zone, after hours or on weekends where the space has to stay in use. Aged care and childcare sites are scheduled around residents and sessions.",
  },
  {
    step: "Handed back clean",
    body: "Each area cleaned down and returned as it finishes rather than everything at the end, so you get the use of the space back progressively.",
  },
];

/**
 * How the work is actually run. Each item summarises something already true of
 * the business — none of these is a claim of quality, they are descriptions of
 * method a client can hold us to.
 */
const APPROACH: readonly { heading: string; body: string }[] = [
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

/* ------------------------------------------------------------------ */
/* Portal                                                               */
/* ------------------------------------------------------------------ */

/**
 * Customer-facing services portal.
 *
 * Rewritten 2026-08-24 from a tabbed console-styled panel into a scrolling
 * marketing page, in the visual world of the APMG Painting site
 * (components/apmg/portal/kit.tsx). Operator decision: the two customer-facing
 * surfaces should read as one business.
 *
 * WHAT CHANGED, AND WHAT DID NOT. Every funnel event, the attribution
 * message-match, the enquiry modal, the consent gate, the chat and the two
 * hosts are untouched:
 *
 *  - `portal_view` still fires once per mount of the CUSTOMER host only.
 *  - `data-track={openEvent}` + `data-track-service` still name each enquiry
 *    open, and `openEvent` is still host-aware, so internal dashboard opens
 *    stay out of the Enquiries funnel.
 *  - The phone / email / website / WhatsApp `data-track` names are unchanged.
 *  - `portal_tab` is GONE, because the tabs are gone. It was never a contract
 *    event (the summary ignored it); Services, Reviews and Team are now
 *    scrolled sections with in-page anchors.
 *
 * The tab keyboard contract (SC 4.1.2 arrow/Home/End handling) went with the
 * tablist it implemented — there is no widget left to implement it for. What
 * replaces it is ordinary document order plus a skip link, which is a weaker
 * thing to get wrong.
 *
 * One accessibility problem this fixes structurally rather than by tuning: the
 * old hero set white type over a photograph whose lower half is a fleet of
 * white utes, and needed three stacked scrims measured against real pixels to
 * clear SC 1.4.3. Here the copy sits on solid `bg-ink` and the photograph is
 * beside it, so the contrast is a token value rather than a measurement.
 */
export function ServicesPortal({ standalone = false }: { standalone?: boolean }) {
  /** The service the enquiry modal is open for; null = closed. */
  const [active, setActive] = useState<Service | null>(null);
  /** Attributed sector (lead category) for the hero's message-match line —
   *  null until /api/portal/context resolves (or forever, on a direct visit). */
  const [sector, setSector] = useState<string | null>(null);
  /** Contract funnel events fire ONLY on the customer-facing /portal host;
   *  internal (dashboard) opens get a non-contract name the summary ignores. */
  const openEvent = standalone ? "portal_service_open" : "services_card_open";

  const yearsTrading = new Date().getFullYear() - FOUNDED;

  // One `portal_view` per mount of the CUSTOMER host — the funnel step between
  // the outreach redirect (attribution_click, recorded server-side by /t/[id])
  // and the first portal_service_open. Deliberately manual: there's no click to
  // delegate on a page view. Internal dashboard mounts are NOT portal visits
  // and must not pollute the funnel.
  useEffect(() => {
    if (standalone) track("portal_view");
  }, [standalone]);

  // Message-match: resolve the visitor's attributed sector (customer host
  // only). The outreach email spoke their sector's language — the landing page
  // greeting the same sector is what makes the email feel personal instead of
  // templated. Best-effort: any miss just leaves the generic hero.
  useEffect(() => {
    if (!standalone) return;
    let cancelled = false;
    fetch("/api/portal/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; category?: string | null } | null) => {
        if (cancelled || !j?.ok) return;
        if (typeof j.category === "string" && j.category.trim()) {
          setSector(j.category.trim());
        }
      })
      .catch(() => {
        /* no attribution / offline — generic hero */
      });
    return () => {
      cancelled = true;
    };
  }, [standalone]);

  return (
    <div className="bg-white text-ink">
      {/* ── Top bar ───────────────────────────────────────────────────────
          Sticky only on the customer host. Inside the dashboard the portal is
          a preview panel in a shell that already has its own chrome, and a
          second sticky bar there would pin itself over the operator's UI.

          INK, not the white the painting site uses. There is exactly one logo
          asset in this repo (app/icon.png — a white mark on transparency), and
          on a white bar it is invisible. The painting site can run a white
          header because it ships two files, an ink mark and a white one; until
          an ink version exists, the ground goes dark instead of the mark going
          missing.

          It earns its keep: bar and hero are the same ink, so at rest the bar
          dissolves into the hero and the page opens on one uninterrupted black
          field. It only declares itself once white content scrolls under it,
          which is the moment a persistent phone number and CTA start being
          useful. Swap `bg-ink/95` for `bg-white/90` and the border back to
          `border-paper-edge` the day an ink logo lands. */}
      <div
        className={cn(
          // Solid, not translucent. A glassy bar computes as ink-over-white at
          // scroll-top, which is lighter than the hero directly beneath it and
          // draws a seam across the fold — the one thing this bar is supposed
          // not to do. Opaque ink dissolves into the hero exactly.
          "z-30 border-b border-white/10 bg-ink",
          standalone && "sticky top-0",
        )}
      >
        <Container width="wide">
          <div className="flex h-16 items-center justify-between gap-4">
            <Image
              src={brandLogo}
              alt="APMG Services"
              width={240}
              height={184}
              priority
              className="h-9 w-auto sm:h-11"
            />
            <div className="flex items-center gap-2 sm:gap-3">
              <a
                href={COMPANY.phoneHref}
                data-track="portal_phone_click"
                className="rounded-md px-2 py-2 text-sm font-semibold text-white hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 sm:px-3"
              >
                <span className="sr-only">Call </span>
                {COMPANY.phone}
              </a>
              <PortalButton
                variant="accent"
                onClick={() => setActive(GENERAL_SERVICE)}
                data-track={openEvent}
                data-track-service="general"
                className="hidden px-4 py-2.5 sm:inline-flex"
              >
                Get a quote
              </PortalButton>
            </div>
          </div>
        </Container>
      </div>

      {/* ── Hero ──────────────────────────────────────────────────────────
          A photographic band above the copy below lg, the photograph in the
          right half beside it from lg up. The copy never sits on the
          photograph, which is what makes its contrast a token rather than a
          measurement against a fleet of white utes. */}
      <section
        className={cn(
          "relative isolate flex flex-col overflow-hidden bg-ink text-white",
          "min-h-[30rem] sm:min-h-[34rem]",
          // One viewport on the customer host, where <main> owns the dvh.
          standalone && "lg:min-h-[calc(100dvh-4rem)]",
        )}
      >
        <div className="relative min-h-20 flex-1 lg:absolute lg:inset-0 lg:left-1/2 lg:min-h-0 lg:flex-none tight:hidden">
          <Image
            src={heroBg}
            alt=""
            fill
            priority
            placeholder="blur"
            sizes="(min-width: 1024px) 50vw, 100vw"
            className="object-cover object-[50%_55%] lg:object-center"
          />
          {/* Fade the band into the ink panel under it rather than butting it. */}
          <div
            aria-hidden
            className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink to-transparent lg:hidden"
          />
          {/* Desktop: dissolve the seam down the middle of the section. */}
          <div
            aria-hidden
            className="absolute inset-y-0 left-0 hidden w-32 bg-gradient-to-r from-ink to-transparent lg:block"
          />
        </div>

        <div className="relative z-10 lg:flex lg:flex-1 lg:items-center tight:flex tight:flex-1 tight:items-center">
          <Container width="wide">
            <div className="grid py-10 sm:py-12 lg:grid-cols-2 lg:py-16 short:py-8 tight:py-6">
              <div className="lg:pr-12">
                <p className={cn(microLabel, "flex items-center gap-3 text-brand-400")}>
                  <span aria-hidden className="h-px w-8 bg-brand-500" />
                  Melbourne property maintenance
                </p>

                <h1 className="mt-4 text-balance font-display text-[1.95rem] leading-[1.06] tracking-tight sm:text-[2.6rem] lg:text-[3.4rem] short:text-[2.35rem] tight:text-[1.7rem]">
                  Every trade,{" "}
                  <span className="text-brand-400">one partner</span>
                </h1>

                <p className="mt-4 max-w-lg text-base text-white/75 sm:text-lg short:text-base tight:text-sm">
                  Electrical, plumbing, painting, carpentry, flooring, grounds, handyman and
                  make-safe work across Melbourne and Victoria — run by one team, from the first
                  call to the job done.
                </p>

                {/* Sector message-match — only when the visitor arrived from a
                    sector-targeted outreach link. */}
                {sector && (
                  <p className="mt-3 max-w-lg text-sm text-brand-100">{sectorLine(sector)}</p>
                )}

                <div className="mt-7 flex flex-wrap gap-3 short:mt-5">
                  <PortalButton
                    variant="accent"
                    onClick={() => setActive(GENERAL_SERVICE)}
                    data-track={openEvent}
                    data-track-service="general"
                  >
                    Tell us what needs doing
                    <ArrowRight aria-hidden className="h-4 w-4" />
                  </PortalButton>
                  <PortalButtonLink href="#services" variant="ghostLight">
                    See all eight trades
                  </PortalButtonLink>
                </div>

                <p className="mt-5 text-sm text-white/70 short:mt-4">
                  Or call{" "}
                  <a
                    href={COMPANY.phoneHref}
                    data-track="portal_phone_click"
                    className="rounded font-semibold text-white underline decoration-brand-500 decoration-2 underline-offset-4 hover:text-brand-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
                  >
                    {COMPANY.phone}
                  </a>{" "}
                  — reactive callouts and planned work, Monday to Friday.
                </p>
              </div>
            </div>
          </Container>
        </div>

        {/* The fold's bottom edge. Translucent so the photograph continues
            behind it rather than being cut off by a solid bar. */}
        <div className="relative z-10 border-t border-white/15 bg-ink/70 backdrop-blur-sm">
          <Container width="wide">
            <ul className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5 sm:gap-x-8 sm:py-4">
              {PROOF_POINTS.map((point) => (
                <li key={point} className="flex items-center gap-2 text-xs text-white/75 sm:text-sm">
                  <BadgeCheck aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-400" />
                  {point}
                </li>
              ))}
            </ul>
          </Container>
        </div>
      </section>

      <FactStrip
        facts={[
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
        ]}
      />

      {/* ── Services ──────────────────────────────────────────────────── */}
      <ContentBlock
        id="services"
        eyebrow="Services"
        heading="The eight trades we handle"
        lede="Most jobs draw on more than one of them — an office repaint that turns out to need the patching and the flooring, or a make-safe that becomes a carpentry repair. Open any trade to see what it covers and send it straight through."
      >
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((service) => (
            <li key={service.slug}>
              <article className="group relative flex h-full flex-col overflow-hidden rounded-lg border border-paper-edge bg-white">
                {service.photo && (
                  <div className="relative aspect-[3/2] overflow-hidden bg-paper-sunken">
                    <Image
                      src={service.photo}
                      alt=""
                      fill
                      loading="lazy"
                      placeholder="blur"
                      sizes="(min-width: 1024px) 30vw, (min-width: 640px) 45vw, 100vw"
                      className={cn("object-cover", mediaZoom)}
                    />
                  </div>
                )}
                <div className="flex flex-1 flex-col gap-3 p-5">
                  {/* SC 1.3.1: the heading is a real heading, NOT nested inside
                      the button. ARIA gives buttons presentational children, so
                      a card that IS a button strips its own service name out of
                      the document's heading outline and reads the whole card as
                      one run-on accessible name. The roles stay split. */}
                  <h3 className="font-display text-lg tracking-tight">{service.name}</h3>
                  <p className="flex-1 text-sm text-ink-soft">{service.blurb}</p>
                  {service.includes && (
                    <ul className="flex flex-wrap gap-1.5">
                      {service.includes.slice(0, 3).map((item) => (
                        <li
                          key={item}
                          className="rounded bg-paper-sunken px-2 py-1 text-xs font-medium text-ink-soft"
                        >
                          {item}
                        </li>
                      ))}
                    </ul>
                  )}
                  <PortalButton
                    variant="outline"
                    onClick={() => setActive(service)}
                    data-track={openEvent}
                    data-track-service={service.slug}
                    className="mt-1 w-full"
                  >
                    Tell me more
                    <ArrowRight aria-hidden className="h-4 w-4" />
                  </PortalButton>
                </div>
              </article>
            </li>
          ))}
        </ul>
      </ContentBlock>

      {/* ── Process ───────────────────────────────────────────────────── */}
      <ContentBlock
        tone="sunken"
        eyebrow="How it works"
        heading="What happens after you enquire"
        lede="The same five stages whether it's one dripping tap or a maintenance programme across a campus."
      >
        <ProcessSteps steps={PROCESS} />
      </ContentBlock>

      {/* ── Approach ──────────────────────────────────────────────────── */}
      <ContentBlock
        eyebrow="How we work"
        heading="What actually makes the difference"
        lede="Almost nobody picks a maintenance contractor on the trade work itself. These are the things that separate a job that lands on time from one that doesn't."
      >
        <FeatureGrid items={APPROACH} />
      </ContentBlock>

      {/* ── Reviews ───────────────────────────────────────────────────────
          GoogleReviewsPanel and TeamSection still carry the console's semantic
          tokens internally (bg-card / text-foreground). On this pinned-light
          host they render as light cards, so nothing is unreadable — but they
          are not yet in the portal's own palette. Porting those two internals
          is the follow-up to this pass. */}
      <PortalSection tone="sunken" id="reviews">
        <Container>
          <Eyebrow>In their words</Eyebrow>
          <SectionHeading className="mb-3">What clients say</SectionHeading>
          <p className="mb-8 max-w-prose text-ink-soft">
            Straight from Google, unedited. Don&rsquo;t take our word for it — read what the people
            we work for say.
          </p>
          <GoogleReviewsPanel />
        </Container>
      </PortalSection>

      {/* ── Team ──────────────────────────────────────────────────────── */}
      <PortalSection id="team">
        <Container>
          <Eyebrow>The team</Eyebrow>
          <SectionHeading className="mb-3">Who&rsquo;ll actually turn up</SectionHeading>
          <p className="mb-8 max-w-prose text-ink-soft">
            The same people from the first call to the job done — not a call centre and a
            subcontractor you&rsquo;ve never met.
          </p>
          <TeamSection />
        </Container>
      </PortalSection>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <CtaBand
        heading="Tell us what needs doing"
        body="A photo and a sentence is enough to start. We'll come and look before quoting, and the quote is itemised so you can see where the cost sits."
        action={{ label: "Send an enquiry", onClick: () => setActive(GENERAL_SERVICE) }}
        phone={{ display: COMPANY.phone, href: COMPANY.phoneHref }}
      />

      {/* ── Contact + legal ──────────────────────────────────────────── */}
      <PortalSection tone="paper" className="py-12">
        <Container>
          <div className="flex flex-col gap-8 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-3 text-sm text-ink-soft">
              <h2 className={cn(microLabel, "text-ink")}>Get in touch</h2>
              <p className="flex items-center gap-2">
                <Phone aria-hidden className="h-4 w-4 text-brand-600" />
                <a
                  href={COMPANY.phoneHref}
                  data-track="portal_phone_click"
                  className="font-semibold text-ink hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  {COMPANY.phone}
                </a>
              </p>
              <p className="flex items-center gap-2">
                <Mail aria-hidden className="h-4 w-4 text-brand-600" />
                <a
                  href={`mailto:${COMPANY.contactEmail}`}
                  data-track="portal_email_click"
                  className="hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  {COMPANY.contactEmail}
                </a>
              </p>
              <p className="flex items-center gap-2">
                <Globe aria-hidden className="h-4 w-4 text-brand-600" />
                <a
                  href={COMPANY.website}
                  data-track="portal_website_click"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                >
                  apmgservices.com.au
                </a>
              </p>
              <p className="flex items-start gap-2">
                <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
                {COMPANY.address}
              </p>
              <a
                href={COMPANY.whatsappHref}
                data-track="portal_whatsapp_click"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-paper-edge px-3 py-2 font-semibold text-ink hover:bg-paper-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
              >
                <WhatsAppIcon className="h-4 w-4" />
                Message us on WhatsApp
              </a>
            </div>

            <div className="space-y-4">
              <h2 className={cn(microLabel, "text-ink")}>Follow</h2>
              <SocialLinks
                linkClassName="rounded-full border border-paper-edge p-2 text-ink-soft transition-colors hover:bg-paper-sunken hover:text-ink"
                iconClassName="h-4 w-4"
              />
              {standalone && <PortalUnsubscribe />}
            </div>
          </div>
        </Container>
      </PortalSection>

      <Footer consoleTag={false} />

      {/* Chat and the enquiry modal are unchanged — same components, same
          consent gate, same events. */}
      <PortalChat />
      <ServiceInquiryModal
        service={active}
        onClose={() => setActive(null)}
        standalone={standalone}
      />
    </div>
  );
}
