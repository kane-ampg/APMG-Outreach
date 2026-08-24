import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

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
  ...rest
}: {
  children: ReactNode;
  className?: string;
  tone?: "paper" | "sunken" | "ink" | "brand";
} & Omit<ComponentProps<"section">, "className">) {
  return (
    <section
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
}: {
  eyebrow?: string;
  heading: string;
  children: ReactNode;
  tone?: "paper" | "sunken";
  id?: string;
  lede?: string;
}) {
  return (
    <PortalSection tone={tone} id={id}>
      <Container>
        {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        <SectionHeading className={lede ? "mb-3" : "mb-6"}>{heading}</SectionHeading>
        {lede && <p className="mb-8 max-w-prose text-ink-soft">{lede}</p>}
        {children}
      </Container>
    </PortalSection>
  );
}

/**
 * A black band of plain figures.
 *
 * Every value must be substantiated (knowledgebase/business.md) — this band is
 * the most quotable thing on the page, so an unbacked "500+ jobs" style claim
 * cannot be allowed to live here. Each figure carries a label precise enough to
 * defend on its own.
 */
export function FactStrip({
  facts,
}: {
  facts: readonly { figure: string; label: string; detail: string }[];
}) {
  return (
    <PortalSection tone="ink" className="border-t-4 border-brand-600 py-12 sm:py-14">
      <Container width="wide">
        <dl className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
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
      </Container>
    </PortalSection>
  );
}

export function ProcessSteps({
  steps,
  stepLabel = "Step",
}: {
  steps: readonly { step: string; body: string }[];
  stepLabel?: string;
}) {
  return (
    <ol className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {steps.map((item, index) => (
        <Card as="li" key={item.step} className="gap-2">
          {/* Numbered because the sequence IS the information — these five
              stages happen in this order, and a visitor is reading to find out
              what happens after they enquire. */}
          <span className={cn(microLabel, "text-brand-600")}>
            {stepLabel} {index + 1}
          </span>
          <h3 className="font-display text-lg tracking-tight">{item.step}</h3>
          <p className="text-sm text-ink-soft">{item.body}</p>
        </Card>
      ))}
    </ol>
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
