"use client";

import { useEffect, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  BadgeCheck,
  Briefcase,
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
  Star,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPANY } from "@/lib/legal/company";
import { WhatsAppIcon } from "./WhatsAppIcon";
import { GoogleReviewsPanel } from "./GoogleReviewsPanel";
import heroBg from "@/app/apmgbg.jpg";
import heroTeam from "@/app/apmgteam.jpg";
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
import { Reveal } from "./Reveal";
import { Footer } from "./Footer";
import { SocialLinks } from "./SocialLinks";
import { PortalUnsubscribe } from "./PortalUnsubscribe";
import { PortalChat } from "./PortalChat";
import { ServiceInquiryModal } from "./ServiceInquiryModal";
import { TeamSection } from "./TeamSection";

/**
 * Customer-facing portal (ui-standards §17.8 signal accent, editorial family).
 * A photographic hero over the APMG background image, then a two-tab body
 * (§11.1 sliding-pill tabs): "Our Services" — a friendly grid of the trades we
 * offer — and "Our Team" — the faces behind the work, a deliberate trust
 * surface. Serves two hosts unchanged: the "Our Services" tab inside
 * DashboardShell, and the public standalone /portal route where tracked
 * outreach links land.
 *
 * Event contract (see the portal-telemetry spec):
 *  - `portal_view`          — tracked once per mount (the funnel step between
 *                             the outreach click and a service open)
 *  - `portal_service_open`  — every card + both "Talk to our team" CTAs, via
 *                             data-track with `service` as the slug prop
 *  - `portal_inquiry_submit`— tracked by ServiceInquiryModal on a landed submit
 *  - `portal_tab`           — switching the in-page tab (prop `tab`); NON-contract,
 *                             so it never touches the Enquiries funnel
 * Cards used to be mailto: links; they now open the enquiry modal so the lead's
 * details land in Supabase instead of an unmeasured mail client hand-off.
 *
 * HOST DISCRIMINATION: the two funnel contract events above are only emitted
 * when `standalone` (the public /portal host where outreach links land). The
 * internal "Our Services" tab inside DashboardShell mounts this same component,
 * and letting it fire the contract names would let an admin demoing the tab
 * inflate every Enquiries-tab conversion ratio with visits no customer made —
 * internal opens are tagged `services_card_open` instead (summary ignores it).
 */

/** In-page tabs for the portal body. Order is the pill order — Google Reviews
 *  sits directly beside Our Services (third-party proof next to the pitch). */
const PORTAL_TABS = [
  { key: "services", label: "Our Services", icon: Briefcase },
  { key: "reviews", label: "Google Reviews", icon: Star },
  { key: "team", label: "Our Team", icon: Users },
] as const;
type PortalTab = (typeof PORTAL_TABS)[number]["key"];

/** Hero title + subtitle per tab — swapped (cross-faded) with the background
 *  image so the whole hero reflects the active section, not just the photo.
 *  Copy rule (Company-Brief): checkable facts, not self-assertions — "trusted"
 *  is for the visitor to conclude, "family-run since 2015" is for us to say. */
const HERO_COPY: Record<PortalTab, { title: string; subtitle: string }> = {
  services: {
    title: "Our Services",
    subtitle:
      "Melbourne property maintenance across eight trades — one team, one point of contact. Family-run since 2015.",
  },
  reviews: {
    title: "Google Reviews",
    subtitle:
      "Don’t take our word for it — read what the people we work for say about us, straight from Google.",
  },
  team: {
    title: "Our Team",
    subtitle:
      "The people who’ll actually look after your property — the same faces you’ll deal with from the first call to the job done.",
  },
};

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
  "Family-run since 2015",
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

/** Directional crossfade for the tab panels (§11.1): slide toward the pill the
 *  visitor moved to. `dir` +1 = forward (services→team), −1 = back. */
const PANEL_VARIANTS = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -28 : 28 }),
};

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

export function ServicesPortal({ standalone = false }: { standalone?: boolean }) {
  const reduce = useReducedMotion();
  /** The service the enquiry modal is open for; null = closed. */
  const [active, setActive] = useState<Service | null>(null);
  /** Active in-page tab + the direction of the last switch (for the slide). */
  const [tab, setTab] = useState<PortalTab>("services");
  const [dir, setDir] = useState(1);
  /** Attributed sector (lead category) for the hero's message-match line —
   *  null until /api/portal/context resolves (or forever, on a direct visit). */
  const [sector, setSector] = useState<string | null>(null);
  /** Contract funnel events fire ONLY on the customer-facing /portal host;
   *  internal (dashboard) opens get a non-contract name the summary ignores. */
  const openEvent = standalone ? "portal_service_open" : "services_card_open";

  function selectTab(next: PortalTab) {
    if (next === tab) return;
    // pill order defines direction so the panel slides the way the eye moved
    const from = PORTAL_TABS.findIndex((t) => t.key === tab);
    const to = PORTAL_TABS.findIndex((t) => t.key === next);
    setDir(to >= from ? 1 : -1);
    setTab(next);
    track("portal_tab", { tab: next });
  }

  // One `portal_view` per mount of the CUSTOMER host — the funnel step between
  // the outreach redirect (attribution_click, recorded server-side by /t/[id])
  // and the first portal_service_open. Deliberately manual: there's no click
  // to delegate on a page view. Internal dashboard mounts are NOT portal
  // visits and must not pollute the funnel.
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
    // Centred, max-width column so the portal reads as a contained page rather
    // than sprawling edge-to-edge on wide screens (keeps the hero from
    // letterboxing and the card grids from over-stretching).
    <div className="mx-auto flex min-h-full w-full max-w-[105rem] flex-col px-4 py-5 sm:px-6">
      {/* ── Hero over the APMG background image ───────────────────────────── */}
      <Reveal y={6}>
        <section className="relative h-[300px] overflow-hidden rounded-2xl bg-black ring-1 ring-foreground/10 sm:h-[360px]">
          {/* Two hero images stacked, cross-fading on tab change: the depot/fleet
              shot for Services, the team line-up for Our Team. object-COVER fills
              the hero frame edge-to-edge (black letterbox bars made the page open
              on what looked like a placeholder). The bottom scrim keeps the logo
              + copy legible over either. */}
          {(
            [
              { key: "services", src: heroBg },
              // Reviews reuses the depot shot — services→reviews cross-fades
              // between identical frames, i.e. reads as a still hero.
              { key: "reviews", src: heroBg },
              { key: "team", src: heroTeam },
            ] as const
          ).map((layer) => (
            <motion.div
              key={layer.key}
              aria-hidden={tab !== layer.key}
              className="absolute inset-0"
              initial={false}
              animate={{ opacity: tab === layer.key ? 1 : 0 }}
              transition={{ duration: reduce ? 0 : 0.5, ease: [0.16, 1, 0.3, 1] }}
            >
              <Image
                src={layer.src}
                alt=""
                fill
                priority={layer.key === "services"}
                sizes="(min-width: 896px) 896px, 100vw"
                placeholder="blur"
                className="object-cover object-center"
              />
            </motion.div>
          ))}
          {/* bottom-weighted scrim: dark lower band for the overlay, clear photo up top */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
          />
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-r from-primary/15 via-transparent to-transparent"
          />
          {/* light top band so the logo + social icons stay legible over the
              photo's bright sky without darkening the whole frame */}
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/55 to-transparent"
          />

          {/* Top bar: logo anchored top-left so the brand is the first thing
              the page shows (it used to sit in the bottom stack, i.e. below
              the fold of the hero photo), socials top-right — checkable
              proof-of-life for a visitor deciding whether the business is
              real. z-10 lifts it above the inset-0 copy stack below (later in
              DOM order, so it would otherwise swallow clicks on the icons);
              pointer-events-none/auto keeps everything except the icons
              click-transparent so the stack's own controls stay reachable. */}
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between p-5 sm:p-8">
            <Image
              src={brandLogo}
              alt="APMG"
              width={240}
              height={184}
              className="h-10 w-auto drop-shadow-[0_2px_12px_rgba(0,0,0,0.9)] sm:h-16"
            />
            <SocialLinks
              linkClassName="pointer-events-auto rounded-full border border-white/20 bg-black/40 p-2 text-white/90 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
              iconClassName="h-3.5 w-3.5 sm:h-4 sm:w-4"
            />
          </div>

          {/* inset-0 + justify-end keeps the stack bottom-weighted but CLAMPED
              inside the box, so a tall stack can never be clipped by the
              section's overflow-hidden (was bottom-0, which let it overflow
              past the top edge). */}
          <div className="absolute inset-0 flex flex-col justify-end gap-2 p-5 sm:gap-3 sm:p-8">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-black/40 px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-white backdrop-blur-sm">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_2px_hsl(var(--primary)/0.7)]" />
              APMG Services
            </span>
            {/* Title + subtitle cross-fade with the tab (and the hero image),
                so the whole hero reflects the active section. `grid` stacks the
                outgoing/incoming copy in the same cell during the fade so the
                layout below doesn't jump. */}
            <div className="grid">
              <AnimatePresence mode="sync" initial={false}>
                <motion.div
                  key={tab}
                  className="col-start-1 row-start-1"
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8 }}
                  transition={{ duration: reduce ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
                >
                  <h1 className="max-w-2xl font-heading text-xl font-bold tracking-tight text-white sm:text-4xl">
                    {HERO_COPY[tab].title}
                  </h1>
                  <p className="mt-2 max-w-xl text-xs leading-relaxed text-white/85 sm:mt-3 sm:text-base">
                    {HERO_COPY[tab].subtitle}
                  </p>
                  {/* Sector message-match line — only when the visitor arrived
                      from a sector-targeted outreach link. */}
                  {sector && tab === "services" && (
                    <p className="mt-1.5 max-w-xl text-[11px] leading-relaxed text-white/70 sm:text-sm">
                      {sectorLine(sector)}
                    </p>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
            {/* CTA row: the enquiry path AND the phone, side by side. Property
                maintenance demand is often urgent — a contact surface without a
                visible phone number reads as a lead-capture farm, and half the
                real enquiries would rather call anyway. */}
            <div className="mt-1 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => setActive(GENERAL_SERVICE)}
                data-track={openEvent}
                data-track-service="general"
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-white/95 px-3.5 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition-[transform,background-color] hover:bg-white active:translate-y-px"
              >
                Get a quote
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
              {/* WhatsApp deep link (not tel:) — opens a chat with the number,
                  pre-filled so the visitor's first message costs zero typing.
                  WhatsApp brand green (#25D366): the one place a non-token hue
                  is allowed, because instant brand recognition IS the point.
                  Calling stays available via the contact card + footer tel:. */}
              <a
                href={`${COMPANY.whatsappHref}?text=${encodeURIComponent(
                  "Hi APMG Services, I'd like a quote for some property maintenance work.",
                )}`}
                target="_blank"
                rel="noreferrer"
                data-track="portal_whatsapp_click"
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[#25D366] px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-[transform,filter] hover:brightness-105 active:translate-y-px"
              >
                <WhatsAppIcon className="h-3.5 w-3.5" />
                {COMPANY.phone}
              </a>
            </div>
          </div>
        </section>
      </Reveal>

      {/* ── Proof band: checkable facts, right where the eye lands after the
          hero. See PROOF_POINTS for the substantiation rule. ─────────────── */}
      <Reveal delay={0.04} className="mt-4">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10 sm:justify-between sm:px-5">
          {PROOF_POINTS.map((point) => (
            <span
              key={point}
              className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground sm:text-xs"
            >
              <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
              {point}
            </span>
          ))}
        </div>
      </Reveal>

      {/* ── In-page tabs (§11.1 sliding-pill) ────────────────────────────── */}
      <Reveal delay={0.06} className="mb-5 mt-6">
        <div
          role="tablist"
          aria-label="Portal sections"
          className="inline-flex gap-1 rounded-lg bg-card p-1 ring-1 ring-foreground/10"
        >
          {PORTAL_TABS.map((t) => (
            <TabPill
              key={t.key}
              tab={t}
              active={tab === t.key}
              reduce={!!reduce}
              onSelect={() => selectTab(t.key)}
            />
          ))}
        </div>
      </Reveal>

      {/* ── Animated tab panels ──────────────────────────────────────────── */}
      {/* overflow-x-clip (not -hidden) so the directional slide never spawns a
          page scrollbar while keeping the wrapper a non-scroll container.
          px-2 -mx-2 gives the cards ~8px of horizontal bleed room INSIDE the
          clip so their ring, shadow and hover-lift aren't sliced by the clip
          edge (the "cut line" at the outer card edges) — the negative margin
          cancels the padding so the grid's real width is unchanged. pb-2 does
          the same for the bottom shadow. */}
      <div className="-mx-2 overflow-x-clip px-2 pb-2">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={tab}
            custom={dir}
            variants={PANEL_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            role="tabpanel"
          >
            {tab === "services" ? (
              <ServicesPanel
                reduce={!!reduce}
                onOpen={setActive}
                openEvent={openEvent}
              />
            ) : tab === "reviews" ? (
              <GoogleReviewsPanel />
            ) : (
              <TeamSection />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Customer host hides the internal Signal Console build tag (§17.8). */}
      <Footer consoleTag={!standalone} />

      {/* Self-serve opt-out on the customer host only: a fresh portal visitor has
          no address in the URL (unlike the email footer link), so this collects
          it and hands off to the same /api/portal/unsubscribe route. */}
      {standalone && <PortalUnsubscribe />}

      {/* KB-grounded chat bubble — customer host only. Auto-opens ~3s after the
          visitor lands from an outreach link; spends a walled-off key behind a
          rate-limited, KB-only endpoint (see app/api/portal/chat). Never mounted
          inside the internal "Our Services" tab. */}
      {standalone && <PortalChat />}

      {/* Single modal instance shared by every card + CTA on the page. The
          consent gate + funnel event only apply on the customer host. */}
      <ServiceInquiryModal service={active} onClose={() => setActive(null)} standalone={standalone} />
    </div>
  );
}

/**
 * One tab pill (§11.1). Only the active pill renders the sliding indicator; all
 * pills share the `portal-tab` layoutId so Framer glides the single signal-red
 * element between them. Label + icon sit above the indicator at `z-10`.
 */
function TabPill({
  tab,
  active,
  reduce,
  onSelect,
}: {
  tab: (typeof PORTAL_TABS)[number];
  active: boolean;
  reduce: boolean;
  onSelect: () => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-semibold transition-colors sm:text-[13px]",
        active ? "text-white" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="portal-tab"
          className="absolute inset-0 rounded-md bg-gradient-to-r from-primary to-primary-solid shadow-sm shadow-primary/25"
          transition={{ duration: reduce ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      <Icon className="relative z-10 h-3.5 w-3.5" aria-hidden />
      <span className="relative z-10">{tab.label}</span>
    </button>
  );
}

/**
 * The "Our Services" panel body: the trades grid plus the address/website card.
 * Split out of ServicesPortal so it can slide in and out as a tab panel while
 * the hero and footer stay put.
 */
function ServicesPanel({
  reduce,
  onOpen,
  openEvent,
}: {
  reduce: boolean;
  onOpen: (service: Service) => void;
  openEvent: string;
}) {
  return (
    <div>
      {/* Section heading */}
      <div className="mb-4">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          What we do
        </div>
        <h2 className="mt-1.5 font-heading text-lg font-semibold tracking-tight text-foreground">
          Trades we handle
        </h2>
      </div>

      {/* Service cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {SERVICES.map((service, i) => (
          <Reveal
            key={service.slug}
            delay={Math.min(0.05 + i * 0.04, 0.3)}
            y={12}
            className="h-full"
          >
            <ServiceCard
              service={service}
              reduce={reduce}
              onOpen={onOpen}
              openEvent={openEvent}
            />
          </Reveal>
        ))}
      </div>

      {/* ── Common questions — answers the objections a cold visitor actually
          arrives with (Company-Brief "Key Client Pain Points"). Every answer
          is grounded in the KB; nothing invented (no response-time promises,
          no certifications we can't show). ─────────────────────────────── */}
      <Reveal delay={0.12} className="mt-8">
        <div className="mb-4">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Good to know
          </div>
          <h2 className="mt-1.5 font-heading text-lg font-semibold tracking-tight text-foreground">
            Common questions
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {FAQ.map((item) => (
            <div
              key={item.q}
              className="rounded-xl bg-card p-4 ring-1 ring-foreground/10"
            >
              <h3 className="font-heading text-sm font-semibold text-foreground">
                {item.q}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </Reveal>

      {/* Contact — every way to reach us, not just the form. */}
      <Reveal delay={0.14} className="mt-4">
        <div className="flex flex-col gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-primary/15">
              <MapPin className="h-4 w-4" aria-hidden />
            </span>
            <div>
              <h3 className="font-heading text-sm font-semibold text-foreground">
                {COMPANY.tradingName}
              </h3>
              <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                {COMPANY.address}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href={COMPANY.phoneHref}
              data-track="portal_phone_click"
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-semibold text-foreground transition-colors hover:text-primary"
            >
              <Phone className="h-3.5 w-3.5 text-primary" aria-hidden />
              {COMPANY.phone}
            </a>
            <a
              href={`mailto:${COMPANY.contactEmail}`}
              data-track="portal_email_click"
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {COMPANY.contactEmail}
            </a>
            <a
              href={COMPANY.website}
              target="_blank"
              rel="noreferrer"
              data-track="portal_website_click"
              className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden />
              apmgservices.com.au
            </a>
          </div>
        </div>
      </Reveal>
    </div>
  );
}

/** KB-grounded FAQ (knowledgebase/business.md + Company-Brief). The rule:
 *  answer honestly from what's documented, never promise what isn't — a
 *  specific kept commitment beats a vague strong one. */
const FAQ = [
  {
    q: "Can one team really handle multiple trades on the same job?",
    a: "Yes — painting, electrical, plumbing, carpentry, flooring, gardening, handyman and make-safe works are all delivered in-house. You deal with one point of contact instead of coordinating separate contractors.",
  },
  {
    q: "Do you handle urgent repairs?",
    a: `We provide reactive, on-call repairs and property make-safe services. If something needs attention urgently, call us on ${COMPANY.phone} rather than waiting on the form.`,
  },
  {
    q: "Do you do scheduled and preventative maintenance?",
    a: "Yes — alongside reactive repairs we run planned, preventative maintenance programs, from routine upkeep through to larger upgrade works.",
  },
  {
    q: "Where do you work?",
    a: "We're based in Chirnside Park and service properties across Melbourne and Victoria — commercial, industrial and residential, including aged care, childcare, education, strata and government sites.",
  },
  {
    q: "What happens after I enquire?",
    a: "One of our team reviews your enquiry and contacts you to understand the job, then arranges a time to inspect and quote. The same point of contact stays with the job through to completion.",
  },
  {
    q: "Do you work around residents, staff and operating hours?",
    a: "Yes — we plan works to minimise disruption to the people using the site, which matters most in aged care, childcare, education and healthcare environments.",
  },
] as const;

function ServiceCard({
  service,
  reduce,
  onOpen,
  openEvent,
}: {
  service: Service;
  reduce: boolean;
  onOpen: (service: Service) => void;
  /** host-aware data-track name: `portal_service_open` only on /portal */
  openEvent: string;
}) {
  const Icon = service.icon;
  // A button, not a mailto link: opening the enquiry modal keeps the lead on
  // the page (and in our data) instead of bouncing them to a mail client.
  // `w-full text-left` compensates for the button's native shrink-to-fit
  // sizing and centred text so the card renders exactly as the <a> did.
  //
  // Layout: a real APMG job-site PHOTO banner on top (the trust surface — these
  // are our actual crew in branded workwear), then the text block below on the
  // solid card so copy stays fully legible. The category icon sits in a chip
  // that overlaps the banner's lower-left edge, tying photo to text and keeping
  // its role as a quick visual key. overflow-hidden clips the photo to the
  // card's rounded corners.
  return (
    <motion.button
      type="button"
      onClick={() => onOpen(service)}
      data-track={openEvent}
      data-track-service={service.slug}
      whileHover={reduce ? undefined : { y: -1 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="group relative flex h-full w-full flex-col overflow-hidden rounded-xl bg-card text-left ring-1 ring-foreground/10 transition-colors hover:ring-primary/40"
    >
      {/* Photo banner. Fixed 16:9 box so every card's image reads at the same
          height regardless of the source photo. object-COVER fills the frame —
          matte bars around a letterboxed photo read as placeholder content,
          and these job-site shots of the crew in branded workwear are the
          strongest trust asset on the page, so they get the full frame. The
          subtle zoom on hover echoes the card lift; a faint bottom gradient
          seats the overlapping icon chip. */}
      <div className="relative aspect-video w-full overflow-hidden bg-muted">
        {service.photo ? (
          <Image
            src={service.photo}
            alt=""
            fill
            placeholder="blur"
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
            className={cn(
              "object-cover object-center",
              !reduce && "transition-transform duration-500 group-hover:scale-105",
            )}
          />
        ) : null}
        <span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/45 to-transparent"
        />
      </div>

      {/* Text block on the solid card. -mt-6 pulls the icon chip up so it
          straddles the banner edge; pt keeps the heading clear of it. */}
      <div className="relative flex flex-1 flex-col gap-3 p-4">
        <span className="-mt-11 flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-primary shadow-sm ring-1 ring-primary/15">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex-1">
          <h3 className="font-heading text-sm font-semibold leading-snug text-foreground">
            {service.name}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {service.blurb}
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-primary">
          Enquire
          <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </div>
    </motion.button>
  );
}
