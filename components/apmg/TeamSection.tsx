"use client";

import Image, { type StaticImageData } from "next/image";
import { motion, useReducedMotion } from "motion/react";
import { Linkedin } from "lucide-react";
import { Reveal } from "./Reveal";

// Headshots self-hosted in the repo (app/team/*), normalised to a square
// 640×640 crop so the roster reads as one cohesive rail. Static-imported like
// the hero background so Next optimises them and hands us a blur placeholder —
// no dependency on APMG's WordPress CDN staying up, which matters on a trust
// page.
import farbod from "@/app/team/farbod-mollaei.jpg";
import zac from "@/app/team/zac-karannagoda.jpg";
import fred from "@/app/team/fred-mollaei.jpg";
import craig from "@/app/team/craig-billing.jpg";
import ashley from "@/app/team/ashley-rankin.jpg";
import simon from "@/app/team/simon-taranek.jpg";
import chamz from "@/app/team/chamz-abeyratne.jpg";
import jack from "@/app/team/jack-wilson.jpg";

/**
 * "Our Team" — the customer-facing team roster (ui-standards §17.8).
 *
 * DESIGN INTENT: this page is shown to cold outreach recipients deciding
 * whether APMG is a real business. Its one job is warmth — real, accountable
 * faces with names and roles. An earlier pass dressed it in the internal
 * console's instrument chrome (crew tally, mono roster indices, "ACTIVE"
 * LEDs); that voice belongs to the operator dashboard, not to a customer
 * trust surface — a facility manager reads "08 ACTIVE" as a capacity warning
 * and node indices as surveillance, so all of it is gone. What remains is a
 * warm grid: photo, name, role, and a LinkedIn link where the person lists
 * one (a checkable third-party identity, which is the actual trust signal).
 *
 * Deliberately presentational: no funnel contract events fire from here (a
 * face isn't a service enquiry). LinkedIn links carry a plain
 * `data-track="portal_team_linkedin"` so an outbound click still shows in the
 * ticker without touching the Enquiries funnel.
 */

interface Member {
  name: string;
  role: string;
  photo: StaticImageData;
  /** public LinkedIn profile, when the person lists one */
  linkedin?: string;
}

interface TeamGroup {
  label: string;
  members: Member[];
}

const TEAM: TeamGroup[] = [
  {
    label: "Leadership",
    members: [
      {
        name: "Farbod Mollaei",
        role: "Managing Director",
        photo: farbod,
        linkedin: "https://www.linkedin.com/in/farbod-mollaei-0298199b/",
      },
      {
        name: "Zac Karannagoda",
        role: "Assistant General Manager",
        photo: zac,
        linkedin: "https://www.linkedin.com/in/zac-karannagoda-ba8a6368/",
      },
    ],
  },
  {
    label: "Management",
    members: [
      { name: "Fred Mollaei", role: "Project Manager", photo: fred },
      {
        name: "Craig Billing",
        role: "Head of Projects",
        photo: craig,
        linkedin: "https://www.linkedin.com/in/craig-billing-b2583061/",
      },
      {
        name: "Ash Rankin",
        role: "Service Manager",
        photo: ashley,
        linkedin: "https://www.linkedin.com/in/ashley-rankin-4bb900255/",
      },
      {
        name: "Simon Taranek",
        role: "Senior Business Development Manager",
        photo: simon,
      },
      {
        name: "Chamz Abeyratne",
        role: "Human Resources Manager",
        photo: chamz,
        linkedin: "https://www.linkedin.com/in/chamika-a-26a56682/",
      },
    ],
  },
  {
    label: "Account Managers",
    members: [
      { name: "Jack Wilson", role: "Account Manager — Reactive", photo: jack },
    ],
  },
];

export function TeamSection({
  /**
   * Renders this section's own eyebrow, <h2> and lede. TRUE by default, so the
   * internal console is byte-identical to before.
   *
   * The customer portal passes false and supplies the header itself, in the
   * portal's voice. Same reason as GoogleReviewsPanel: with both, the section
   * opened on two headings saying the same thing, the second in the console's
   * typographic voice.
   *
   * The per-tier <h3> labels below are NOT gated — they are the organising idea
   * of the roster, not a section header, and the portal's own <h2> above keeps
   * the outline (h2 -> h3 -> h4) intact either way.
   */
  heading = true,
}: { heading?: boolean } = {}) {
  const reduce = useReducedMotion();

  return (
    <section aria-label="Our team">
      {heading && (
        <Reveal delay={0.04} className="mb-6">
          <div className="border-b border-border pb-3">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Our team
            </div>
            <h2 className="mt-1.5 font-heading text-lg font-semibold tracking-tight text-foreground">
              Meet the people who&rsquo;ll look after your property
            </h2>
          </div>
          <p className="mt-3 max-w-xl text-xs leading-relaxed text-muted-foreground">
            Our Melbourne-based teams, across every trade we deliver.
          </p>
        </Reveal>
      )}

      <div className="flex flex-col gap-8">
        {TEAM.map((group, gi) => (
          <div key={group.label}>
            {/* Simple section label + hairline — structure without the
                instrument-panel voice. The label is a real <h3>, not a styled
                <span>: seniority tiers are the organising idea of this roster,
                and as a span that grouping existed only visually (SC 1.3.1) —
                nothing filed "Jack Wilson" under "Account Managers" for anyone
                reading the document outline or jumping heading to heading. It
                nests under the section's <h2> above, which is why the member
                name inside each card is an <h4>: h2 → h3 → h4, no skipped
                level. The visual result is byte-identical. Tailwind preflight
                already zeroes heading font-size/weight/margin so the explicit
                text-[10px]/font-semibold classes still decide those, and the
                `font-mono` utility beats the h1–h6 font-family rule in
                globals.css because the utilities layer wins over base — the
                mono stamp survives. Layout is untouched as well: a flex item
                is blockified whichever display it started from, so h3 and span
                size identically here and the decorative hairline still shares
                the row (and stays aria-hidden — it carries no meaning the
                heading does not already carry). */}
            <Reveal delay={0.06 + gi * 0.03} className="mb-4 flex items-center gap-3">
              <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {group.label}
              </h3>
              <span aria-hidden className="h-px flex-1 bg-border" />
            </Reveal>

            {/* flex-wrap + justify-center so a short tier (Leadership has 2,
                Account Managers 1) centres instead of sitting flush-left with a
                lopsided gap; full tiers still pack tight. Fixed responsive basis
                reproduces a 2 / 3 / 4-up track (gap-3 gutters subtracted). */}
            <div className="flex flex-wrap justify-center gap-3">
              {group.members.map((member, mi) => (
                <Reveal
                  key={member.name}
                  delay={Math.min(0.08 + gi * 0.03 + mi * 0.03, 0.34)}
                  y={12}
                  className="basis-[calc(50%-0.375rem)] sm:basis-[calc(33.333%-0.5rem)] lg:basis-[calc(25%-0.5625rem)]"
                >
                  <MemberCard member={member} reduce={!!reduce} />
                </Reveal>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MemberCard({ member, reduce }: { member: Member; reduce: boolean }) {
  return (
    <motion.div
      whileHover={reduce ? undefined : { y: -2 }}
      transition={{ type: "spring", stiffness: 320, damping: 24 }}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl bg-card ring-1 ring-border transition-colors hover:ring-primary/40"
    >
      <div className="flex flex-1 flex-col items-center px-4 pb-4 pt-6 text-center">
        {/* Portrait — large and warm; the whole point of the page. The alt is
            deliberately empty (SC 1.1.1): it used to read
            `${member.name}, ${member.role}`, which is word-for-word the h4 and
            p rendered immediately below, so a screen reader announced every
            person twice. With the name and role as adjacent text the portrait
            adds no information of its own — it is decorative here, and an
            empty alt drops it from the accessibility tree instead of
            duplicating the caption. */}
        <div className="relative h-24 w-24 shrink-0 overflow-hidden rounded-full ring-1 ring-border sm:h-28 sm:w-28">
          <Image
            src={member.photo}
            alt=""
            fill
            placeholder="blur"
            sizes="(min-width: 640px) 112px, 96px"
            className="object-cover"
          />
        </div>

        {/* h4, not h3: the tier label above each grid is now the h3, so the
            name sits one level deeper to keep the outline strictly nested. */}
        <h4 className="mt-4 font-heading text-sm font-semibold leading-snug text-foreground">
          {member.name}
        </h4>
        <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
          {member.role}
        </p>
      </div>

      {/* LinkedIn, where the person lists one — a checkable third-party
          identity, the strongest signal on the card. The hairline keeps card
          bottoms aligned across a row regardless of role length. */}
      {member.linkedin ? (
        /* SC 2.5.8: the link measured 64.4x16.5, and it is a standalone control in
           its own footer row rather than a word inside a sentence, so the
           criterion's "inline" exception does not cover it. py-1.5 on the anchor
           takes the target to 28.5px; the row's own padding drops from py-2.5 to
           py-1 by exactly the amount the anchor grew, so the footer stays 36.5px
           and every card keeps its current height (4 + 28.5 + 4 = 10 + 16.5 + 10). */
        <div className="mt-auto flex items-center justify-center border-t border-border/70 px-3.5 py-1">
          <a
            href={member.linkedin}
            target="_blank"
            rel="noreferrer"
            data-track="portal_team_linkedin"
            data-track-person={member.name}
            aria-label={`${member.name} on LinkedIn`}
            className="inline-flex items-center gap-1.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            <Linkedin className="h-3.5 w-3.5" aria-hidden />
            LinkedIn
          </a>
        </div>
      ) : (
        <div aria-hidden className="mt-auto border-t border-border/70 px-3.5 py-2.5">
          {/* height-matched empty footer so cards align when there's no link */}
          <span className="block h-[16px]" />
        </div>
      )}
    </motion.div>
  );
}
