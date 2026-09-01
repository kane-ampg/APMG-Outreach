import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { InView } from "./reveal";
import { ProcessIcon, type ProcessIconName } from "./process-icons";

/**
 * Customer-portal design kit.
 *
 * Ported from the APMG Painting site (Desktop/APMG Painting v2) so the two
 * customer-facing surfaces read as one business: white paper, `#0F1113` ink,
 * `#C8102E` red as the only accent, a serif display face against Inter body,
 * and section tones that alternate paper / sunken / ink.
 *
 * WHY THESE ARE NOT THE APP'S PRIMITIVES. The internal console is dark-first
 * and drives everything through semantic CSS vars (bg-card, text-foreground)
 * that flip with the operator's theme. The portal is pinned light
 * (app/portal/layout.tsx) and is read by facility managers who have never seen
 * the console. Literal `ink`/`paper`/`brand` classes here are deliberate: a
 * marketing page must not change appearance because a staff member toggled a
 * theme in a different part of the app.
 *
 * The eyebrow lives here on purpose. Impeccable's craft floor bans kickers by
 * default, and defers to a committed visual world — this one uses them as its
 * section-label device throughout, so they are kept rather than invented.
 */

/* ------------------------------------------------------------------ */
/* Layout primitives                                                    */
/* ------------------------------------------------------------------ */

export function Container({
  children,
  className,
  width = "default",
}: {
  children: ReactNode;
  className?: string;
  width?: "default" | "narrow" | "wide";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-5 sm:px-8",
        width === "narrow" && "max-w-3xl",
        width === "default" && "max-w-6xl",
        width === "wide" && "max-w-7xl",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PortalSection({
  children,
  className,
  tone = "paper",
  reveal = true,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  tone?: "paper" | "sunken" | "ink" | "brand";
  /**
   * Opts the section into the scroll reveal (components/apmg/portal/reveal.tsx).
   * On by default because every section below the fold should get it; set false
   * for anything that can sit in the first viewport, where there is nothing to
   * scroll to and the movement would just be noise.
   */
  reveal?: boolean;
} & Omit<ComponentProps<"section">, "className">) {
  return (
    <section
      data-reveal={reveal ? "" : undefined}
      className={cn(
        "py-14 sm:py-20",
        tone === "paper" && "bg-white text-ink",
        tone === "sunken" && "bg-paper-sunken text-ink",
        tone === "ink" && "bg-ink text-white",
        // The signature APMG slab: black ground, red rule across the top.
        tone === "brand" && "border-t-4 border-brand-600 bg-ink text-white",
        // Anything with an id is an in-page anchor target. The portal scrolls
        // inside <main>, and the nav rail is sticky within it, so a target
        // without this margin lands underneath the rail.
        rest.id && "scroll-mt-16",
        className,
      )}
      {...rest}
    >
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Typography                                                           */
/* ------------------------------------------------------------------ */

/**
 * The one uppercase micro-label treatment. Eyebrows, stage numbers, card meta
 * and the figures band all compose this and add only a colour.
 */
export const microLabel = "text-xs font-semibold uppercase tracking-label";

export function Eyebrow({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <p className={cn(microLabel, "mb-3 text-brand-600", className)}>{children}</p>;
}

export function SectionHeading({
  children,
  as: Tag = "h2",
  className,
}: {
  children: ReactNode;
  as?: "h1" | "h2" | "h3";
  className?: string;
}) {
  return (
    <Tag
      className={cn(
        "text-balance font-display text-3xl leading-tight tracking-tight sm:text-4xl",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

export function Lede({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("max-w-prose text-lg text-ink-soft", className)}>{children}</p>;
}

export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("max-w-prose space-y-4 text-ink-soft [&_strong]:text-ink", className)}>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Button / CTA                                                         */
/* ------------------------------------------------------------------ */

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-md px-5 py-3 text-sm font-semibold " +
  "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 " +
  "focus-visible:ring-brand-600 disabled:cursor-not-allowed disabled:opacity-60";

const buttonVariants = {
  primary: "bg-brand-700 text-white hover:bg-brand-600",
  // Red on a black ground: 600 reads brighter against ink than 700 does.
  accent: "bg-brand-600 text-white hover:bg-brand-500 focus-visible:ring-offset-ink",
  outline: "border border-paper-edge bg-white text-ink hover:bg-paper-sunken",
  ghostLight: "border border-white/30 text-white hover:bg-white/10",
} as const;

export type PortalButtonVariant = keyof typeof buttonVariants;

export function PortalButton({
  children,
  variant = "primary",
  className,
  ...rest
}: { variant?: PortalButtonVariant } & ComponentProps<"button">) {
  return (
    <button className={cn(buttonBase, buttonVariants[variant], className)} {...rest}>
      {children}
    </button>
  );
}

export function PortalButtonLink({
  href,
  children,
  variant = "primary",
  className,
  ...rest
}: {
  href: string;
  children: ReactNode;
  variant?: PortalButtonVariant;
  className?: string;
} & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  // tel:, mailto: and absolute URLs must not go through next/link.
  if (!href.startsWith("/") && !href.startsWith("#")) {
    return (
      <a href={href} className={cn(buttonBase, buttonVariants[variant], className)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={cn(buttonBase, buttonVariants[variant], className)} {...rest}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* Cards                                                                */
/* ------------------------------------------------------------------ */

export function Card({
  children,
  className,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "li" | "article";
}) {
  return (
    <Tag
      className={cn(
        "relative flex h-full flex-col rounded-lg border border-paper-edge bg-white p-6",
        className,
      )}
    >
      {children}
    </Tag>
  );
}

/**
 * The house hover for photography: one slow, quiet zoom.
 *
 * Apply to the <Image> itself. The frame around it must carry `group` and
 * `overflow-hidden` so the growth is clipped by the frame rather than spilling
 * over its neighbours. Held to 1.04 over 700ms — trade photos should settle,
 * not lurch — and it keys off focus-within too, so a keyboard user tabbing to a
 * card's control sees the same movement a mouse user does.
 */
export const mediaZoom =
  "transition-transform duration-700 ease-out " +
  "group-hover:scale-[1.04] group-focus-within:scale-[1.04] " +
  "motion-reduce:transform-none motion-reduce:transition-none";

/* ------------------------------------------------------------------ */
/* Composite sections                                                   */
/* ------------------------------------------------------------------ */

export function ContentBlock({
  eyebrow,
  heading,
  children,
  tone = "paper",
  id,
  lede,
  width = "default",
}: {
  eyebrow?: string;
  heading: string;
  children: ReactNode;
  tone?: "paper" | "sunken";
  id?: string;
  lede?: string;
  /**
   * `wide` for sections carrying a grid of photographs. Prose wants a narrow
   * measure; a photographic grid wants the page. Sharing one width made the
   * images the smaller of the two things it should have favoured.
   */
  width?: "default" | "wide";
}) {
  return (
    <PortalSection tone={tone} id={id}>
      <Container width={width}>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <SectionHeading className={lede ? "mb-3" : "mb-6"}>{heading}</SectionHeading>
        {lede && <p className="mb-8 max-w-prose text-ink-soft">{lede}</p>}
        {children}
      </Container>
    </PortalSection>
  );
}

/**
 * The four figures, as a band on an ink ground.
 *
 * MOVED INTO THE FOOTER, following the reference. It used to be its own black
 * slab directly under the hero, which meant the page's first move after the
 * headline was to stop and recite statistics — before the visitor had been told
 * what the eight trades even are. In the footer it runs under every scroll depth
 * and reads as the standing evidence it is, and the services grid gets the slot
 * straight after the fold that it should always have had.
 *
 * Bare markup, no section wrapper: the footer owns the ink ground and the rules
 * above and below this band.
 *
 * Every value must be substantiated (knowledgebase/business.md) — this band is
 * the most quotable thing on the page, so an unbacked "500+ jobs" style claim
 * cannot be allowed to live here. Each figure carries a detail line precise
 * enough to defend on its own.
 */
export function FactsBand({
  facts,
}: {
  facts: readonly { figure: string; label: string; detail: string }[];
}) {
  return (
    <dl className="grid gap-8 border-b border-white/15 py-12 sm:grid-cols-2 lg:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt className={cn(microLabel, "text-white/60")}>{fact.label}</dt>
          <dd className="mt-2">
            <span className="font-display text-3xl font-semibold leading-none tracking-tight text-brand-400">
              {fact.figure}
            </span>
            <span className="mt-2 block text-sm leading-relaxed text-white/70">
              {fact.detail}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The fold's bottom edge: three figures and a scroll cue.
 *
 * Translucent, so the photograph continues behind it rather than being cut off
 * by a solid bar, and it carries a white hairline along its top — the seam
 * between the fold and the rest of the page, and the same mark the process rail
 * draws further down.
 *
 * The figures are set at display size against a micro-label, not as a row of
 * ticked sentences. Five ticked claims at 13px is a paragraph wearing a list's
 * clothes: nothing in it is scannable, and the fold's most valuable strip ends
 * up being the least read thing on it. Three figures can be taken in at a
 * glance, and each one is stated at length further down the page.
 */
export function HeroProof({
  proof,
  scrollTo,
}: {
  proof: readonly { figure: string; label: string }[];
  scrollTo: { label: string; href: string };
}) {
  return (
    <div className="relative z-10 bg-ink/70 backdrop-blur-sm">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-white/15" />
      <Container width="wide">
        <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-3.5 sm:py-5">
          {/* Stacked into three columns on phones, back onto one baseline from
              sm — a wrapping figure/label pair costs the fold more height than
              it can spare. */}
          <ul className="grid w-full grid-cols-3 gap-x-4 sm:flex sm:w-auto sm:flex-wrap sm:items-baseline sm:gap-x-7 sm:gap-y-2">
            {proof.map((item) => (
              <li key={item.label} className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
                <span className="font-display text-base tracking-tight sm:text-lg">
                  {item.figure}
                </span>
                <span className={cn(microLabel, "text-[0.625rem] text-white/70 sm:text-xs")}>
                  {item.label}
                </span>
              </li>
            ))}
          </ul>

          <a
            href={scrollTo.href}
            className="group hidden items-center gap-2 rounded text-sm font-semibold text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 lg:inline-flex"
          >
            {scrollTo.label}
            <span
              aria-hidden
              className="transition-transform duration-300 ease-out group-hover:translate-y-1 motion-reduce:transition-none motion-reduce:group-hover:translate-y-0"
            >
              &#8595;
            </span>
          </a>
        </div>
      </Container>
    </div>
  );
}

/**
 * The process rail.
 *
 * The one section on the portal where the ORDER is the content, so it is drawn
 * rather than tiled: the stages stand on a single rule, and a red line runs the
 * length of it, lighting each stage's glyph as it passes. It was a grid of six
 * numbered cards, which said "here are five things" — a rail says "here are five
 * things, in this order", which is the only thing a visitor is reading this
 * section to find out.
 *
 * Timing, pausing and the fallback behaviour all live in `.process-rail` in
 * app/portal/portal-world.css, which is also where the reasoning is written
 * down. The short version: it loops on wall-clock time rather than on scroll,
 * `InView` freezes it while off screen, and every resting state is FULLY DRAWN —
 * reduced motion or a bundle that never arrives leaves a finished red rule and a
 * legible set of stages.
 */
export function ProcessSteps({
  steps,
  stepLabel = "Stage",
}: {
  steps: readonly { step: string; body: string; icon?: ProcessIconName }[];
  stepLabel?: string;
}) {
  return (
    <InView>
      <ol
        className="process-rail relative lg:flex lg:gap-10"
        // The stage count drives the glyph stagger: each one lights when the
        // line reaches its column, so the offsets have to know how many columns
        // there are rather than assume five.
        style={{ "--rail-count": steps.length } as CSSProperties}
      >
        {/*
         * The rule, and the red line that draws along it. Inset by a few pixels
         * on the vertical run so it starts at the first numeral rather than at
         * the container's corner, and pinned to the numerals' baseline from `lg`.
         */}
        <span
          aria-hidden
          className="absolute left-0 top-1 h-[calc(100%-0.5rem)] w-px bg-paper-edge lg:top-16 lg:h-px lg:w-full"
        />
        <span
          aria-hidden
          className="process-rail__progress absolute left-0 top-1 h-[calc(100%-0.5rem)] w-0.5 bg-brand-500 lg:top-[3.9375rem] lg:h-0.5 lg:w-full"
        />

        {steps.map((item, index) => (
          <li
            key={item.step}
            className="process-rail__step relative pb-9 pl-7 last:pb-0 lg:flex-1 lg:pb-0 lg:pl-0"
            style={{ "--rail-index": index } as CSSProperties}
          >
            {/*
             * The ordinal and the stage glyph, on one baseline, standing on the
             * rule. The ordinal is at display size and quiet enough that the
             * headings still lead the section — on a rail the numbers are how a
             * reader works out where they are in the run. The glyph is what
             * makes five columns of near-identical text tell themselves apart at
             * a glance, and it is the thing the red line lights on its way past.
             */}
            <span
              aria-hidden
              className="process-rail__marker flex items-end gap-2.5 text-ink-muted lg:h-16"
            >
              <span className="font-display text-4xl leading-none lg:text-5xl">
                {index + 1}
              </span>
              <ProcessIcon
                name={item.icon}
                className="process-rail__glyph mb-0.5 h-6 w-6 shrink-0 lg:mb-1.5 lg:h-8 lg:w-8"
              />
            </span>
            {/* The ordinal above is decorative (it is inside an aria-hidden
                span), so the stage's position in the run is carried here for
                assistive tech instead. */}
            <span className="sr-only">
              {stepLabel} {index + 1}
            </span>

            {/* Two lines' worth of room on the rail, so a stage whose name wraps
                does not push its body a line below its neighbours'. Across five
                columns that misalignment is the first thing the eye finds. */}
            <h3 className="mt-3 font-display text-lg tracking-tight lg:mt-6 lg:min-h-[3.5rem]">
              {item.step}
            </h3>
            <p className="mt-2 text-sm text-ink-soft">{item.body}</p>
          </li>
        ))}
      </ol>
    </InView>
  );
}

/** Plain heading-and-body cards. No icons — nothing here is decorative. */
export function FeatureGrid({
  items,
}: {
  items: readonly { heading: string; body: string }[];
}) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Card as="li" key={item.heading} className="gap-3">
          <h3 className="font-display text-lg tracking-tight">{item.heading}</h3>
          <p className="text-sm leading-relaxed text-ink-soft">{item.body}</p>
        </Card>
      ))}
    </ul>
  );
}

export function CtaBand({
  heading,
  body,
  action,
  phone,
}: {
  heading: string;
  body: string;
  /** Rendered as a button, not a link — the portal's CTA opens the enquiry
   *  modal in place rather than navigating. */
  action: { label: string; onClick: () => void };
  phone: { display: string; href: string };
}) {
  return (
    <PortalSection tone="brand">
      <Container>
        <div className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <SectionHeading className="text-white">{heading}</SectionHeading>
            <p className="mt-3 max-w-prose text-white/80">{body}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <PortalButton variant="accent" onClick={action.onClick}>
              {action.label}
            </PortalButton>
            <PortalButtonLink href={phone.href} variant="ghostLight">
              {phone.display}
            </PortalButtonLink>
          </div>
        </div>
      </Container>
    </PortalSection>
  );
}
