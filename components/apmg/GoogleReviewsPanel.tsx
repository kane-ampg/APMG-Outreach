"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, ChevronLeft, ChevronRight, Star } from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPANY } from "@/lib/legal/company";
import { Reveal } from "./Reveal";
import { GoogleIcon } from "./GoogleIcon";
import {
  GOOGLE_RATING,
  GOOGLE_REVIEW_COUNT,
  GOOGLE_REVIEWS,
  type GoogleReview,
} from "./googleReviews";

/**
 * "Google Reviews" tab panel. Google blocks iframing its reviews surface
 * (X-Frame-Options / frame-ancestors), so the reviews are a hand-transcribed
 * snapshot of the listing (see googleReviews.ts for the verbatim-only rules
 * and update procedure), rendered as native cards with pagination. The header
 * links out to the live listing so every quote is one click from its source —
 * that checkability is the whole trust argument.
 *
 * Pagination: PAGE_SIZE cards per page, prev/next + numbered pills, with a
 * direction-aware slide between pages (same grammar as the portal's tab
 * panels, §11.1) and a gentle scroll back to the top of the grid so page 3
 * never opens mid-scroll. Reduced motion collapses both to instant.
 */

const GOOGLE_STAR = "#FBBC05"; // Google's review-star yellow (brand context)
const PAGE_SIZE = 6;
const PAGE_COUNT = Math.ceil(GOOGLE_REVIEWS.length / PAGE_SIZE);

const PAGE_VARIANTS = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 28 : -28 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -28 : 28 }),
};

function Stars({ rating, className }: { rating: number; className?: string }) {
  const filled = Math.round(rating);
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-hidden>
      {Array.from({ length: 5 }, (_, i) => (
        <Star
          key={i}
          className="h-3.5 w-3.5"
          style={
            i < filled
              ? { color: GOOGLE_STAR, fill: GOOGLE_STAR }
              : { color: "hsl(var(--muted-foreground) / 0.35)" }
          }
        />
      ))}
    </span>
  );
}

export function GoogleReviewsPanel() {
  const reduce = useReducedMotion();
  const [page, setPage] = useState(0);
  const [dir, setDir] = useState(1);
  const gridRef = useRef<HTMLDivElement>(null);

  function goTo(next: number) {
    const clamped = Math.max(0, Math.min(PAGE_COUNT - 1, next));
    if (clamped === page) return;
    setDir(clamped > page ? 1 : -1);
    setPage(clamped);
    // Page 2+ of a tall grid would otherwise land mid-scroll; bring the grid
    // top back into view. scroll-mt clears the sticky-free but padded layout.
    gridRef.current?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }

  const pageReviews = GOOGLE_REVIEWS.slice(
    page * PAGE_SIZE,
    page * PAGE_SIZE + PAGE_SIZE,
  );

  return (
    <div>
      <div className="mb-4">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Third-party proof
        </div>
        <h2 className="mt-1.5 font-heading text-lg font-semibold tracking-tight text-foreground">
          What our clients say
        </h2>
      </div>

      {/* ── Rating header — the listing's own numbers, linked to the source ── */}
      <Reveal y={10}>
        <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 rounded-xl bg-card px-5 py-4 ring-1 ring-foreground/10">
          <div className="flex items-center gap-4">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-background shadow-sm ring-1 ring-foreground/10">
              <GoogleIcon className="h-6 w-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <span className="tnum font-heading text-2xl font-bold tracking-tight text-foreground">
                  {GOOGLE_RATING.toFixed(1)}
                </span>
                <Stars rating={GOOGLE_RATING} />
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                From {GOOGLE_REVIEW_COUNT} reviews on Google — hosted where we
                can&rsquo;t edit a word of them.
              </p>
            </div>
          </div>
          <a
            href={COMPANY.googleReviewsUrl}
            target="_blank"
            rel="noreferrer"
            data-track="portal_google_reviews_click"
            className="inline-flex items-center gap-1.5 rounded-md bg-primary-solid px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-[transform,filter] hover:brightness-110 active:translate-y-px"
          >
            See them on Google
            <ArrowRight className="h-3.5 w-3.5" aria-hidden />
          </a>
        </div>
      </Reveal>

      {/* ── Paginated review grid ──────────────────────────────────────────── */}
      {/* scroll-mt keeps the goTo() scroll from tucking the grid under the
          viewport edge. overflow-x-clip + bleed padding: same trick as the tab
          panels, so the slide never spawns a horizontal scrollbar and card
          shadows aren't sliced. */}
      <div ref={gridRef} className="-mx-2 mt-3 scroll-mt-4 overflow-x-clip px-2 pb-2">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={page}
            custom={dir}
            variants={PAGE_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="grid grid-cols-1 items-start gap-3 sm:grid-cols-2"
          >
            {pageReviews.map((review) => (
              <ReviewCard key={review.author} review={review} />
            ))}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* ── Pagination controls ────────────────────────────────────────────── */}
      <nav
        aria-label="Review pages"
        className="mt-2 flex items-center justify-center gap-1.5"
      >
        <button
          type="button"
          onClick={() => goTo(page - 1)}
          disabled={page === 0}
          aria-label="Previous reviews"
          className="flex h-8 w-8 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-foreground/10 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </button>
        {Array.from({ length: PAGE_COUNT }, (_, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Page ${i + 1} of ${PAGE_COUNT}`}
            aria-current={i === page ? "page" : undefined}
            className={cn(
              "tnum h-8 min-w-8 rounded-md px-2 font-mono text-xs font-semibold ring-1 transition-colors",
              i === page
                ? "bg-primary-solid text-primary-foreground ring-transparent shadow-sm"
                : "bg-card text-muted-foreground ring-foreground/10 hover:text-foreground",
            )}
          >
            {i + 1}
          </button>
        ))}
        <button
          type="button"
          onClick={() => goTo(page + 1)}
          disabled={page === PAGE_COUNT - 1}
          aria-label="Next reviews"
          className="flex h-8 w-8 items-center justify-center rounded-md bg-card text-muted-foreground ring-1 ring-foreground/10 transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" aria-hidden />
        </button>
      </nav>

      <p className="mt-4 text-center text-[11px] text-muted-foreground">
        Worked with us before?{" "}
        <a
          href={COMPANY.googleReviewsUrl}
          target="_blank"
          rel="noreferrer"
          data-track="portal_google_review_write_click"
          className="font-medium text-primary underline underline-offset-2"
        >
          Leave us a review
        </a>{" "}
        — it genuinely helps.
      </p>
    </div>
  );
}

/** One review card: author, stars + relative date, verbatim text (ellipsis +
 *  source link when Google's snippet was truncated), optional photo strip,
 *  and the owner's reply in an inset block. */
function ReviewCard({ review }: { review: GoogleReview }) {
  return (
    <figure className="flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-center gap-2.5">
        {/* Initials avatar — we don't hotlink Google profile photos. */}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-primary ring-1 ring-primary/15">
          {review.author.trim().charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <figcaption className="truncate text-xs font-semibold text-foreground">
            {review.author}
          </figcaption>
          <div className="mt-0.5 flex items-center gap-1.5">
            <Stars rating={review.rating} />
            <span className="text-[10px] text-muted-foreground">{review.when}</span>
          </div>
        </div>
      </div>

      <blockquote className="mt-2.5 text-xs leading-relaxed text-muted-foreground">
        {review.text}
        {review.truncated && (
          <>
            …{" "}
            <a
              href={COMPANY.googleReviewsUrl}
              target="_blank"
              rel="noreferrer"
              data-track="portal_google_reviews_click"
              className="whitespace-nowrap font-medium text-primary underline underline-offset-2"
            >
              Read the full review on Google
            </a>
          </>
        )}
      </blockquote>

      {/* Google-style photo strip — renders only once the files exist under
          public/reviews/ (see googleReviews.ts). Plain <img>: local static
          assets, fixed strip height, no Next image-config dependency. */}
      {review.photos && review.photos.length > 0 && (
        <div className="mt-2.5 flex gap-1.5 overflow-x-auto">
          {review.photos.map((file) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={file}
              src={`/reviews/${file}`}
              alt={`Job photo from ${review.author}'s review`}
              loading="lazy"
              className="h-24 w-24 shrink-0 rounded-lg object-cover ring-1 ring-foreground/10"
            />
          ))}
        </div>
      )}

      {review.ownerReply && (
        <div className="mt-3 rounded-lg border-l-2 border-primary/30 bg-muted/40 px-3 py-2.5">
          <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            Response from {COMPANY.tradingName}
          </div>
          <p className="mt-1 line-clamp-4 text-[11px] leading-relaxed text-muted-foreground">
            {review.ownerReply}
          </p>
        </div>
      )}
    </figure>
  );
}
