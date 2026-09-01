"use client";

import { useEffect, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import {
  ArrowRight,
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
import { cn } from "@/lib/cn";
// The portal's design layer — square corners, the display face's real weight,
// the scroll reveal and the process rail, all scoped to `.portal-world`.
// Imported HERE rather than from app/portal/layout.tsx so it travels with the
// component: ServicesPortal has two hosts (the public /portal route and the
// internal "Our Services" tab) and both need it.
import "@/app/portal/portal-world.css";
import {
  Container,
  ContentBlock,
  CtaBand,
  Eyebrow,
  FeatureGrid,
  HeroProof,
  mediaZoom,
  microLabel,
  PortalButton,
  PortalButtonLink,
  PortalSection,
  ProcessSteps,
  SectionHeading,
} from "./portal/kit";
import { PortalReveal } from "./portal/reveal";
import type { ProcessIconName } from "./portal/process-icons";
import { COMPANY } from "@/lib/legal/company";
import { GoogleReviewsPanel } from "./GoogleReviewsPanel";
import heroBg from "@/app/apmgbg.jpg";
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
import { PortalFooter } from "./PortalFooter";
import { PortalChat } from "./PortalChat";
import { ServiceInquiryModal } from "./ServiceInquiryModal";
import { TeamSection } from "./TeamSection";

/**
 * Customer-facing portal.
 *
 * A scrolling marketing page in the visual world of the APMG Painting site
 * (see components/apmg/portal/kit.tsx): white paper, `#0F1113` ink, `#C8102E`
 * as the only accent, Fraunces display against Inter body. Sections run hero →
 * the eight trades → process → approach → reviews → team → CTA → footer, with
 * the figures band inside that last one.
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
 * PROOF — the facts a cold visitor can check. Three figures on the fold's bottom
 * edge (see the HeroProof call below), stated at length in the footer's figures
 * band. Every one must be substantiated (knowledgebase/business.md); adjectives
 * don't build trust with facility managers, verifiable claims do.
 *
 * It used to be five ticked sentences in a row on that strip — a paragraph
 * wearing a list's clothes, none of it scannable, on the most valuable strip of
 * the page. The reference sets figures there instead, and does not repeat in the
 * fold what the footer states properly.
 *
 * TODO(trust): the highest-value additions are still waiting on documentation —
 * public liability insurance (amount), trade licence numbers, and police checks
 * / WWCC policy. Add each the day the certificate is in hand; never before
 * (Company-Brief: no unsupported claims). This is also why the reference's taped
 * wall of accreditation logos is NOT ported into the footer — see PortalFooter.
 */

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

/** How `Service.description` separates its paragraphs. Named because the lead
 *  service card shows only the first one. */
const PARAGRAPH_BREAK = "\n\n";

/**
 * What happens after an enquiry. The sequence IS the information — a facility
 * manager reading this is deciding whether contacting us costs them anything,
 * so each step names who does what and when.
 */
const PROCESS: readonly { step: string; body: string; icon: ProcessIconName }[] = [
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
    // `portal-world` is the scope every rule in app/portal/portal-world.css
    // hangs off — square corners, the display face's real weight, the reveal and
    // the process rail. Without it this renders as the palette-only port it used
    // to be: right colours, wrong character.
    <div className="portal-world bg-white text-ink">
      {/* Arms the scroll reveal. Renders nothing, and nothing on the page is
          hidden until it has confirmed the element was below the fold — see
          portal/reveal.tsx. */}
      <PortalReveal />

      {/* ── Top bar ───────────────────────────────────────────────────────
          WHITE, as the reference is. It used to be ink, and the comment here
          explained why: the only mark in this repo was app/icon.png, white on
          transparency, invisible on a white bar — "swap `bg-ink/95` for
          `bg-white/90` the day an ink logo lands."

          It has landed. The painting repo ships the same APMG mark in both
          recolours (public/images/brand/apmg-logo-{ink,white}.webp — verified as
          the identical artwork at luminance 17 and 255), so both are now in this
          repo too: the ink mark rides the white bar here, the white one the ink
          footer.

          Translucent with a backdrop blur, which the ink bar could not be — over
          a photograph a glassy dark bar computes lighter than the hero beneath
          it and draws a seam across the fold. Over white content there is no
          such seam, and the blur is what keeps the bar legible while the
          hero photograph scrolls under it.

          Sticky only on the customer host: inside the dashboard the portal is a
          preview panel in a shell that already has its own chrome, and a second
          sticky bar there would pin itself over the operator's UI. */}
      <div
        className={cn(
          "z-30 border-b border-paper-edge bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80",
          standalone && "sticky top-0",
        )}
      >
        <Container width="wide">
          {/* h-16 plus this bar's 1px rule is what `.portal-hero-fold`
              subtracts to size the fold. Change one, change both. */}
          <div className="flex h-16 items-center justify-between gap-4">
            <Image
              src="/images/brand/apmg-logo-ink.webp"
              alt="APMG Services"
              width={378}
              height={285}
              priority
              className="h-10 w-auto sm:h-12"
            />
            <div className="flex items-center gap-2 sm:gap-3">
              <a
                href={COMPANY.phoneHref}
                data-track="portal_phone_click"
                className="rounded-md px-2 py-2 text-sm font-semibold text-brand-700 hover:bg-paper-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 sm:px-3"
              >
                <span className="sr-only">Call </span>
                {COMPANY.phone}
              </a>
              <PortalButton
                variant="primary"
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
          The reference's fold: the media full-bleed behind the whole section,
          the copy over it, and a translucent strip of figures along the bottom
          edge. Minus the video — the reference runs a looping reel here; this
          carries the reel's equivalent still (app/apmgbg.jpg, the APMG yard),
          which is also what that reel falls back to.

          It replaces a split composition — copy on a solid ink panel, photograph
          in the right half — chosen because that made the copy's contrast a
          token value rather than a measurement against a fleet of white utes.
          The full-bleed version needs that problem solved rather than avoided,
          and it is, twice over: a two-stop scrim over the whole frame, and the
          same offset text-shadow the reference puts on its headline for exactly
          this reason (its brightest frames — a hazy skyline, a fluorescent-lit
          office — sit behind the descenders when the loop restarts). The scrim
          is heaviest on the left, where the type is, and thins to nothing on the
          right so the yard is still legible as a photograph.

          `reveal={false}`: this section IS the first viewport. There is nothing
          to scroll to, and hiding it to animate it back would be a flash on the
          one screen that has to land instantly. */}
      <PortalSection
        reveal={false}
        tone="ink"
        className={cn(
          "portal-hero-fold relative isolate flex flex-col overflow-hidden py-0 sm:py-0",
          // Exactly one viewport, and no more, from `lg` up — so the proof strip
          // along the bottom edge sits ON the fold and the services section
          // begins at the seam. `height`, not a min-height: a long line of copy
          // must not be able to push the fold past the screen.
          //
          // Customer host only. `<main>` there is `h-dvh`, so one dynamic
          // viewport height IS the scroll container, minus this page's sticky
          // header (h-16) and its 1px rule. Inside the dashboard the same
          // component is a panel in a shell with its own chrome, where a
          // viewport unit would size the hero to the browser window instead of
          // to the panel — see .portal-hero-fold in portal-world.css.
          standalone && "lg:h-[calc(100dvh-4rem-1px)]",
        )}
      >
        <Image
          src={heroBg}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="100vw"
          className="-z-10 object-cover object-[50%_55%]"
        />
        {/*
         * The scrim, in two parts. Horizontal carries the type: ink at 92% under
         * the headline, thinning through 55% to a bare 20% at the right edge, so
         * the copy sits on a value it can be measured against while the
         * photograph keeps its own contrast. Vertical is the lesser of the two —
         * it darkens the top so the white bar's blur has something to bite on,
         * and the bottom so the proof strip is a seam rather than a stripe.
         */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/95 via-ink/80 to-ink/45 lg:via-ink/70 lg:to-ink/30"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/55 via-ink/25 to-ink/70"
        />

        <div className="relative z-10 flex flex-1 items-center">
          <Container width="wide">
            <div className="grid py-12 sm:py-14 lg:grid-cols-2 lg:py-16 short:py-8 tight:py-6">
              <div className="lg:pr-12">
                <p className={cn(microLabel, "flex items-center gap-3 text-brand-400 tight:text-[0.625rem]")}>
                  <span aria-hidden className="h-px w-8 bg-brand-500" />
                  Melbourne property maintenance
                </p>

                {/* Larger than the split version carried, because the fold is
                    one image now rather than a copy panel beside a photograph —
                    the headline is competing with the whole frame for the first
                    second of attention and has to win it. */}
                <h1 className="mt-4 text-balance font-display text-[2.15rem] leading-[1.05] tracking-tight [text-shadow:0_2px_28px_rgba(15,17,19,0.65)] sm:text-[2.85rem] lg:text-[3.3rem] xl:text-[3.6rem] short:text-[2.4rem] tight:text-[1.8rem]">
                  Every trade, <span className="text-brand-400">one partner</span>
                </h1>

                <p className="mt-5 max-w-lg text-base text-white/85 [text-shadow:0_1px_16px_rgba(15,17,19,0.75)] sm:text-lg short:mt-4 short:text-base tight:text-sm">
                  Electrical, plumbing, painting, carpentry, flooring, grounds, handyman and
                  make-safe work across Melbourne and Victoria — run by one team, from the first
                  call to the job done.
                </p>

                {/* Sector message-match — only when the visitor arrived from a
                    sector-targeted outreach link. */}
                {sector && (
                  <p className="mt-3 max-w-lg text-sm text-brand-100 [text-shadow:0_1px_16px_rgba(15,17,19,0.75)]">
                    {sectorLine(sector)}
                  </p>
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

                <p className="mt-5 text-sm text-white/80 [text-shadow:0_1px_16px_rgba(15,17,19,0.75)] short:mt-4">
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

        {/* The fold's bottom edge. Three figures at display size where five
            ticked sentences used to be — see HeroProof in portal/kit.tsx for why
            that trade is worth making on the page's most valuable strip. Each
            one is stated at length in the footer's figures band. */}
        <HeroProof
          proof={[
            { figure: `${yearsTrading} years`, label: "In business" },
            { figure: `${SERVICES.length} trades`, label: "Under one contact" },
            { figure: "Victoria", label: "Melbourne & regional" },
          ]}
          scrollTo={{ label: "What we handle", href: "#services" }}
        />
      </PortalSection>

      {/* ── Services ────────────────────────────────────────────────────
          The reference's shape: the first trade leads at the full width of the
          row with its photograph taking half the card, and the rest run beneath
          it four across. Two reasons it is not the even three-column grid it
          was. Eight services into three columns left an orphan row of two; and
          the identical `sm:grid-cols-2 lg:grid-cols-3` shape ran three times
          down this page — here, then the approach cards, then the team — so the
          services section, the one block that answers what the company actually
          does, read as the same furniture as everything else.

          The lead is `SERVICES[0]`, not a slug named here, so reordering the
          array is what changes which trade gets the large card.

          `width="wide"` because this is now a grid of photographs: prose wants a
          narrow measure, a photographic grid wants the page. */}
      <ContentBlock
        id="services"
        eyebrow="Services"
        heading="The eight trades we handle"
        lede="Most jobs draw on more than one of them — an office repaint that turns out to need the patching and the flooring, or a make-safe that becomes a carpentry repair. Open any trade to see what it covers and send it straight through."
        width="wide"
      >
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {SERVICES.map((service, index) => {
            const lead = index === 0;

            return (
              <li key={service.slug} className={cn(lead && "sm:col-span-2 lg:col-span-4")}>
                <article
                  className={cn(
                    "group relative flex h-full flex-col overflow-hidden rounded-lg border border-paper-edge bg-white",
                    lead && "lg:flex-row",
                  )}
                >
                  {service.photo && (
                    <div
                      className={cn(
                        "relative aspect-[16/9] overflow-hidden bg-paper-sunken",
                        lead && "lg:aspect-[3/2] lg:w-1/2 lg:shrink-0",
                      )}
                    >
                      <Image
                        src={service.photo}
                        alt=""
                        fill
                        loading="lazy"
                        placeholder="blur"
                        sizes={
                          lead
                            ? "(min-width: 1024px) 50vw, 100vw"
                            : "(min-width: 1024px) 22vw, (min-width: 640px) 45vw, 100vw"
                        }
                        className={cn("object-cover", mediaZoom)}
                      />
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex flex-1 flex-col gap-3 p-5",
                      lead && "gap-4 p-6 lg:justify-center lg:p-10",
                    )}
                  >
                    {/* SC 1.3.1: the heading is a real heading, NOT nested inside
                        the button. ARIA gives buttons presentational children, so
                        a card that IS a button strips its own service name out of
                        the document's heading outline and reads the whole card as
                        one run-on accessible name. The roles stay split. */}
                    <h3
                      className={cn(
                        "font-display text-lg tracking-tight",
                        lead && "text-2xl lg:text-3xl",
                      )}
                    >
                      {service.name}
                    </h3>
                    <p
                      className={cn(
                        "flex-1 text-sm text-ink-soft",
                        lead && "max-w-prose flex-none text-base",
                      )}
                    >
                      {service.blurb}
                    </p>
                    {/* The lead card is twice the height of its neighbours, so
                        it gets the opening paragraph of the trade's own copy to
                        fill it — the reference does the same with
                        `service.body[0]`. Desktop only: on a phone the card is
                        already the tallest thing on the page. Split on the blank
                        line because `description` stores its paragraphs that
                        way. */}
                    {lead && service.description && (
                      <p className="hidden max-w-prose text-sm text-ink-soft lg:block">
                        {service.description.split(PARAGRAPH_BREAK)[0]}
                      </p>
                    )}
                    {service.includes && (
                      <ul className="flex flex-wrap gap-1.5">
                        {service.includes.slice(0, lead ? 5 : 3).map((item) => (
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
                      variant={lead ? "primary" : "outline"}
                      onClick={() => setActive(service)}
                      data-track={openEvent}
                      data-track-service={service.slug}
                      className={cn("mt-1", lead ? "self-start" : "w-full")}
                    >
                      Tell me more
                      <ArrowRight aria-hidden className="h-4 w-4" />
                    </PortalButton>
                  </div>
                </article>
              </li>
            );
          })}
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
          GoogleReviewsPanel and TeamSection are SHARED with the internal
          console, so their card internals still carry semantic tokens
          (bg-card / ring-foreground/10). On this pinned-light host those resolve
          to light cards, and the square-corner reset in portal-world.css brings
          their frames into line, so they sit inside the portal's world without
          either component being forked.

          What could not be fixed from the outside was their HEADERS: each one
          rendered its own eyebrow + h2 in the console's `font-mono` /
          `font-heading` voice, directly under the portal's own Fraunces
          heading — two headings saying the same thing in two typefaces. Both now
          take `heading={false}`, which defaults to true so the console is
          unchanged, and the portal supplies the header itself. */}
      <PortalSection tone="sunken" id="reviews">
        <Container>
          <Eyebrow>In their words</Eyebrow>
          <SectionHeading className="mb-3">What clients say</SectionHeading>
          <p className="mb-8 max-w-prose text-ink-soft">
            Straight from Google, unedited. Don&rsquo;t take our word for it — read what the people
            we work for say.
          </p>
          <GoogleReviewsPanel heading={false} />
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
          <TeamSection heading={false} />
        </Container>
      </PortalSection>

      {/* ── Closing CTA ───────────────────────────────────────────────── */}
      <CtaBand
        heading="Tell us what needs doing"
        body="A photo and a sentence is enough to start. We'll come and look before quoting, and the quote is itemised so you can see where the cost sits."
        action={{ label: "Send an enquiry", onClick: () => setActive(GENERAL_SERVICE) }}
        phone={{ display: COMPANY.phone, href: COMPANY.phoneHref }}
      />

      {/* ── Footer ──────────────────────────────────────────────────────
          One ink slab under a red rule, in the reference's shape. It replaces
          two things that used to end this page: a white "Get in touch" section,
          and below it the console's own 11px muted-grey strip — the internal
          chrome leaking onto a customer surface, with the chat launcher sitting
          on top of its right-hand end.

          The figures band moves here with it. It used to be a black slab
          directly under the hero, which meant the page's first move after the
          headline was to recite statistics before the visitor had been told what
          the eight trades even are. In the footer it runs under every scroll
          depth and reads as standing evidence, and the services grid gets the
          slot after the fold it should always have had. */}
      <PortalFooter
        standalone={standalone}
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

      {/* Chat and the enquiry modal are unchanged — same components, same
          consent gate, same events, and now the same corners they were authored
          with: the Corners rule in app/portal/portal-world.css remaps only
          `rounded` / `rounded-md` / `rounded-lg`, and both of these are built
          from `rounded-xl` and `rounded-2xl`. An earlier revision wrapped this
          in `data-portal-chat` to exempt it from a blanket square-corner reset;
          that reset is gone, so the wrapper is too. */}
      <PortalChat />
      <ServiceInquiryModal
        service={active}
        onClose={() => setActive(null)}
        standalone={standalone}
      />
    </div>
  );
}
