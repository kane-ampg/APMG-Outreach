"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
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
 *  is for the visitor to conclude, "est. 2015" is for us to say.
 *
 *  The subtitle deliberately does NOT repeat the full company name: the proof
 *  band directly below already leads with it, and saying it twice inside one
 *  eyeful reads as letterhead rather than substance. */
const HERO_COPY: Record<PortalTab, { title: string; subtitle: string }> = {
  services: {
    title: "Our Services",
    subtitle:
      "Melbourne property maintenance across eight trades — one team, one point of contact. Operating since 2015.",
  },
  reviews: {
    title: "Google Reviews",
    subtitle:
      "Don’t take our word for it — read what the people we work for say about us, straight from Google.",
  },
  team: {
    title: "Our Team",
    subtitle:
      "The people who’ll actually look after your property — the same team from the first call to the job done.",
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

  /** One entry per pill, in PORTAL_TABS order, so the keyboard handler can move
   *  DOM focus between them. A ref array rather than a querySelector: the pills
   *  are ours to hold onto, and reaching into the document from a component
   *  would break the moment this portal is mounted twice on one page. */
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function selectTab(next: PortalTab) {
    if (next === tab) return;
    // pill order defines direction so the panel slides the way the eye moved
    const from = PORTAL_TABS.findIndex((t) => t.key === tab);
    const to = PORTAL_TABS.findIndex((t) => t.key === next);
    setDir(to >= from ? 1 : -1);
    setTab(next);
    track("portal_tab", { tab: next });
  }

  /**
   * SC 4.1.2: the pill row has ALWAYS announced itself as role="tablist" with
   * role="tab" children, but nothing implemented the keyboard contract that
   * name promises — arrow keys did literally nothing, so a screen-reader user
   * told "tab, 1 of 3" had no way to reach tabs 2 and 3 except by guessing that
   * Tab (not Arrow) still moved between them. Arrows now move and WRAP,
   * Home/End jump to the ends.
   *
   * AUTOMATIC activation (moving selects, rather than requiring Enter/Space) is
   * the right variant here: switching panels is cheap, purely client-side, and
   * its only side effect is the NON-contract `portal_tab` telemetry event, so
   * arrowing across the row cannot corrupt the Enquiries funnel. Selection is
   * routed through selectTab so the direction-aware slide and that event stay
   * in one place; focus is moved separately because selection alone would leave
   * the user's focus on a pill that is now tabIndex={-1}.
   */
  function onTabKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const count = PORTAL_TABS.length;
    const current = PORTAL_TABS.findIndex((t) => t.key === tab);
    let next: number;
    if (e.key === "ArrowRight") next = (current + 1) % count;
    else if (e.key === "ArrowLeft") next = (current - 1 + count) % count;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = count - 1;
    else return;
    // preventDefault only AFTER we know the key is one of ours, so every other
    // key keeps its default behaviour while a pill holds focus — Tab still
    // leaves the widget, Enter/Space still activate, PageUp/Down still scroll.
    e.preventDefault();
    selectTab(PORTAL_TABS[next].key);
    tabRefs.current[next]?.focus();
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
        {/* SC 1.4.12 (Text Spacing): the height used to be FIXED (h-[300px]
            sm:h-[360px]) with the copy stack absolutely positioned inside it.
            With the criterion's spacing overrides applied at a 320px viewport
            the copy outgrew the box — the h1 collided with the social icons and
            the "APMG Services" chip was pushed past the top edge, where
            overflow-hidden simply deleted it. So the height is now a MINIMUM and
            the section is a flex column: the image layers and the three scrims
            stay absolute (purely decorative, they should always fill the frame),
            while BOTH the top bar and the copy stack are IN-FLOW children. Being
            in flow is what lets them push the section taller when text grows —
            and what makes them unable to overlap each other, which an absolute
            top bar could not guarantee. mt-auto keeps the copy stack
            bottom-weighted so the hero is pixel-identical at default text
            settings. */}
        <section className="relative flex min-h-[300px] flex-col overflow-hidden rounded-2xl bg-black ring-1 ring-foreground/10 sm:min-h-[360px]">
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
          {/* Bottom-weighted scrim: dark lower band for the overlay, clear photo
              up top. SC 1.4.3: the mid-stop was raised from black/25 to
              black/70 (and the bottom from /80 to /95) because 25% could not
              carry white type over this photo — its lower half is a fleet of
              white utes, and measured against the real rendered pixels the h1
              reached only 2.39:1 at p99 (needs 3:1 as large text) and the
              subtitle 3.02:1 (needs 4.5:1). Keep this a SINGLE gradient so the
              numbers stay easy to re-tune against fresh pixel measurements. */}
          <div
            aria-hidden
            className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent"
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

          {/* Top bar: logo top-left so the brand is the first thing the page
              shows (it used to sit in the bottom stack, i.e. below the fold of
              the hero photo), socials top-right — checkable proof-of-life for a
              visitor deciding whether the business is real.
              pointer-events-none/auto keeps everything except the icons
              click-transparent so the stack's own controls stay reachable.

              IN FLOW, not absolute (SC 1.4.12). While this was `absolute
              inset-x-0 top-0`, the copy stack below had no knowledge of it: with
              the criterion's text-spacing overrides at 320px the growing stack
              slid straight up underneath the logo — a 25px overlap, from a 4px
              one that was already there at default settings. Making both the top
              bar and the copy stack in-flow children of the section's flex column
              means the two can no longer occupy the same space at any text size:
              the bar takes its natural height at the top, mt-auto on the stack
              absorbs the slack, and the section grows if their combined height
              ever exceeds min-h. At default settings the sum is well under
              min-h (~80px + ~180px against 300px at 320px; ~128px + ~200px
              against 360px from sm up), so the hero renders unchanged. */}
          <div className="pointer-events-none relative z-10 flex items-start justify-between p-5 sm:p-8">
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

          {/* The one IN-FLOW child of the section (SC 1.4.12 — see the section
              comment). It used to be `absolute inset-0 … justify-end`, which
              bottom-weighted the copy but also CLAMPED it: an out-of-flow stack
              cannot drive its parent's height, so growing text either collided
              with the top bar or was clipped by overflow-hidden. mt-auto in the
              section's flex column reproduces justify-end's bottom alignment
              exactly while letting a tall stack push the hero taller instead.
              `relative` is load-bearing: it keeps the stack in the positioned
              paint layer so it still renders ABOVE the three absolute scrims
              (which precede it in DOM order) and BELOW the z-10 top bar —
              i.e. the identical stacking the absolute version had. */}
          <div className="relative mt-auto flex flex-col gap-2 p-5 sm:gap-3 sm:p-8">
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
                  {/* SC 1.4.3: was text-white/85. Partial-opacity white over a
                      photograph is compounding two contrast problems, so the
                      scrim above carries the legibility and the type is left at
                      full opacity. */}
                  <p className="mt-2 max-w-xl text-xs leading-relaxed text-white sm:mt-3 sm:text-base">
                    {HERO_COPY[tab].subtitle}
                  </p>
                  {/* Sector message-match line — only when the visitor arrived
                      from a sector-targeted outreach link. SC 1.4.3: was
                      text-white/70, which computed as low as 1.98:1 against the
                      brightest pixels behind it (the white utes); full-opacity
                      white on the strengthened scrim clears 4.5:1. */}
                  {sector && tab === "services" && (
                    <p className="mt-1.5 max-w-xl text-[11px] leading-relaxed text-white sm:text-sm">
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
                  Calling stays available via the contact card + footer tel:.
                  SC 1.4.3: the label was text-white, which is only 1.98:1 on
                  this green. text-zinc-900 measures 8.93:1 on the SAME green, so
                  the brand hue survives and the label becomes legible — this is
                  also what WhatsApp itself does on light surfaces. The glyph is
                  currentColor, so it darkens with the text, which is correct.
                  SC 2.4.4 (Link Purpose): the accessible name used to be the
                  bare phone number — the icon is aria-hidden — so assistive tech
                  could not tell this opens a chat rather than dialling, and
                  nothing warned that it leaves the page. The sr-only span
                  APPENDS that context to the visible number rather than
                  replacing it, which keeps the visible text inside the
                  accessible name (SC 2.5.3, Label in Name). */}
              <a
                href={`${COMPANY.whatsappHref}?text=${encodeURIComponent(
                  "Hi APMG Services, I'd like a quote for some property maintenance work.",
                )}`}
                target="_blank"
                rel="noreferrer"
                data-track="portal_whatsapp_click"
                className="inline-flex w-fit items-center gap-1.5 rounded-md bg-[#25D366] px-3.5 py-2 text-xs font-semibold text-zinc-900 shadow-sm transition-[transform,filter] hover:brightness-105 active:translate-y-px"
              >
                <WhatsAppIcon className="h-3.5 w-3.5" />
                {COMPANY.phone}
                {/* Leading space so the name reads "0433 … Message us on
                    WhatsApp", not one run-together token. */}
                <span className="sr-only">{" Message us on WhatsApp (opens in a new tab)"}</span>
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
        {/* The keydown sits on the tablist, not each pill, so it fires whichever
            pill holds focus (SC 4.1.2 — see onTabKeyDown). */}
        <div
          role="tablist"
          aria-label="Portal sections"
          onKeyDown={onTabKeyDown}
          className="inline-flex gap-1 rounded-lg bg-card p-1 ring-1 ring-foreground/10"
        >
          {PORTAL_TABS.map((t, i) => (
            <TabPill
              key={t.key}
              tab={t}
              active={tab === t.key}
              reduce={!!reduce}
              onSelect={() => selectTab(t.key)}
              buttonRef={(el) => {
                tabRefs.current[i] = el;
              }}
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
            // SC 4.1.2: the panel announced role="tabpanel" but was otherwise
            // anonymous — no id for the pills' aria-controls to point at, and no
            // aria-labelledby, so it was read as an unnamed region with no
            // stated relationship to the tab that opened it. tabIndex={0} is
            // required BY the roving tabindex on the pills: the pill row is now
            // a single tab stop, so without a focusable panel the next Tab press
            // would leave the tab widget entirely. AnimatePresence mode="wait"
            // keeps exactly one panel mounted, so these ids are never duplicated
            // (the outgoing panel keeps its own previous id while it animates).
            id={`portal-panel-${tab}`}
            aria-labelledby={`portal-tab-${tab}`}
            tabIndex={0}
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
  buttonRef,
}: {
  tab: (typeof PORTAL_TABS)[number];
  active: boolean;
  reduce: boolean;
  onSelect: () => void;
  /** Registers this pill in the tablist's ref array so arrow keys can move DOM
   *  focus onto it (SC 4.1.2 — see onTabKeyDown in ServicesPortal). */
  buttonRef: (el: HTMLButtonElement | null) => void;
}) {
  const Icon = tab.icon;
  return (
    <button
      ref={buttonRef}
      type="button"
      role="tab"
      id={`portal-tab-${tab.key}`}
      aria-selected={active}
      // Only the SELECTED pill claims aria-controls. AnimatePresence mode="wait"
      // mounts exactly one panel, so on the two inactive pills this attribute
      // would name an id that isn't in the document — which axe flags as
      // aria-valid-attr-value, and which the house rule beside the unsubscribe
      // control already rejects ("pointing at an absent id is worse than omitting
      // the attribute"). The APG's alternative is to render all three panels and
      // hide the inactive ones, but that would mean giving up the directional
      // slide between them, so the attribute yields instead.
      aria-controls={active ? `portal-panel-${tab.key}` : undefined}
      // Roving tabindex (SC 4.1.2): the whole pill row is ONE tab stop, entered
      // at the selected pill, and the arrow keys move within it. Previously every
      // pill was its own tab stop — which is what a plain button row does, not
      // what role="tablist" tells a screen reader to expect.
      tabIndex={active ? 0 : -1}
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
          {/* SC 2.5.8: these three sat at 18px tall. They are laid out as a row of
              chips rather than words inside a sentence, so the criterion's "inline"
              exception does not cover them — py-1 takes each to 26px. The -my-1
              cancels the added height for layout, so the card is unchanged while the
              hit areas grow; margin does not clip a box, so the targets stay 26px.
              gap-y-2 (8px) keeps stacked rows 34px centre-to-centre, clear of the
              24px-circle rule. Same fix, same reason, as the customer footer. */}
          <div className="-my-1 flex flex-wrap items-center gap-x-5 gap-y-2">
            <a
              href={COMPANY.phoneHref}
              data-track="portal_phone_click"
              className="inline-flex shrink-0 items-center gap-1.5 py-1 text-xs font-semibold text-foreground transition-colors hover:text-primary"
            >
              <Phone className="h-3.5 w-3.5 text-primary" aria-hidden />
              {COMPANY.phone}
            </a>
            <a
              href={`mailto:${COMPANY.contactEmail}`}
              data-track="portal_email_click"
              className="inline-flex shrink-0 items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              <Mail className="h-3.5 w-3.5" aria-hidden />
              {COMPANY.contactEmail}
            </a>
            <a
              href={COMPANY.website}
              target="_blank"
              rel="noreferrer"
              data-track="portal_website_click"
              className="inline-flex shrink-0 items-center gap-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
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
  //
  // SC 1.3.1 — "STRETCHED LINK" PATTERN. The whole card used to BE the button,
  // with the <h3> nested inside it. ARIA gives buttons presentational children,
  // so those eight service names were stripped out of the document's heading
  // outline entirely: a screen-reader user listing headings saw "Trades we
  // handle" and then nothing, and the button's own accessible name was the whole
  // card read as one run-on string (name + blurb + "Enquire").
  //
  // So the roles are now split. The wrapper is a plain motion.div that owns all
  // the card's presentation (hover-lift, ring, rounded corners, overflow-hidden)
  // and, crucially, `relative` — it is the positioned ancestor. The service name
  // is a real <h3> in normal flow, and the ONE interactive element is a <button>
  // nested inside that h3 wrapping just the name text, so the accessible name is
  // now exactly "Electrical Services". The button's ::after is stretched over the
  // wrapper (after:absolute after:inset-0) so the ENTIRE card is still a single
  // click target, which is what keeps the delegated telemetry listener working:
  // a click anywhere on the card lands on that pseudo-element, whose event target
  // is the button, and closest("[data-track]") finds the attributes below.
  //
  // Stacking matters here and is easy to break. The overlay must be the topmost
  // thing in the card or clicks would land on whatever sits above it and never
  // reach the button. Because the overlay is positioned and the h3 is late in
  // tree order, it paints above the photo banner and above every in-flow
  // descendant of the text block. That is why the text block below is NO LONGER
  // `relative` (it would have become the containing block, clamping the overlay
  // to the text area) and why the icon chip carries `relative` instead — the chip
  // needs to stay above the photo it straddles, but still below the overlay.
  //
  // Layout is otherwise unchanged: a real APMG job-site PHOTO banner on top (the
  // trust surface — these are our actual crew in branded workwear), then the text
  // block below on the solid card so copy stays fully legible. The category icon
  // sits in a chip that overlaps the banner's lower-left edge, tying photo to text
  // and keeping its role as a quick visual key. overflow-hidden clips the photo to
  // the card's rounded corners.
  return (
    <motion.div
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

      {/* Text block on the solid card. -mt-11 pulls the icon chip up so it
          straddles the banner edge; the gap keeps the heading clear of it.
          NOT `relative` — see the stacking note above. */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* `relative` earns its place: it lifts the chip into the positioned
            paint layer so it renders above the photo banner it straddles (the
            banner is positioned too, but earlier in tree order). It still sits
            below the h3's click overlay, which is later in tree order again. */}
        <span className="relative -mt-11 flex h-11 w-11 items-center justify-center rounded-lg bg-accent text-primary shadow-sm ring-1 ring-primary/15">
          <Icon className="h-5 w-5" aria-hidden />
        </span>
        <div className="flex-1">
          <h3 className="font-heading text-sm font-semibold leading-snug text-foreground">
            {/* The card's only interactive element. text-left because the UA
                centres button text, and the name can wrap to two lines. The
                after:* quartet is the stretched hit area covering the whole
                card — the button needs no positioning of its own, the wrapper
                is the positioned ancestor. The telemetry attributes live HERE,
                on the real click target, not on the wrapper. */}
            <button
              type="button"
              onClick={() => onOpen(service)}
              data-track={openEvent}
              data-track-service={service.slug}
              className="text-left after:absolute after:inset-0 after:rounded-xl after:content-['']"
            >
              {service.name}
            </button>
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
    </motion.div>
  );
}
