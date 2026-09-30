"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { COMPANY } from "@/lib/legal/company";
import {
  GOOGLE_RATING,
  GOOGLE_REVIEW_COUNT,
  GOOGLE_REVIEWS,
  type GoogleReview,
} from "../../googleReviews";

/**
 * The three reviews that open the track, by author. Chosen for the portal's
 * actual reader: a building manager on works completed as quoted, a commercial
 * client on coordination, and a painting client on turning up on time. Every
 * word is the transcribed listing (googleReviews.ts), never paraphrased.
 */
const LEAD_AUTHORS = ["Rob Manfredi", "hongdi chen", "Alastair Stewart"];

const lead = LEAD_AUTHORS.map((author) => GOOGLE_REVIEWS.find((r) => r.author === author)).filter(
  (r): r is GoogleReview => r !== undefined,
);
const ordered = [...lead, ...GOOGLE_REVIEWS.filter((r) => !lead.includes(r))];

/**
 * Google reviews, unedited, on one screen: every transcribed review in one
 * horizontal track, three at a time on a laptop, stepped with the arrows or
 * swiped. It replaces the "show more" disclosure, whose opened list could never
 * fit a single screen.
 *
 * The heading states the listing's own numbers and links straight to it, so
 * every quote is one click from its source; that checkability is the whole
 * trust argument. The count line says which cards are showing and that all
 * of them are on Google, since 20 were transcribed from a listing of 22.
 */
export function ReviewsSection() {
  const trackRef = useRef<HTMLUListElement>(null);
  const [view, setView] = useState({ first: 1, last: 3, atStart: true, atEnd: false });

  // Which cards are in view, read off the track's scroll position. Re-read on
  // scroll (one frame at a time) and on resize, since the number per view
  // changes with the breakpoint.
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    const cards = Array.from(track.children) as HTMLElement[];
    const left = track.scrollLeft;
    const right = left + track.clientWidth;
    const visible = cards
      // Offsets are relative to the track: it is the cards' offsetParent
      // (position: relative in portal-world.css).
      .map((card, i) => ({ i, start: card.offsetLeft, end: card.offsetLeft + card.offsetWidth }))
      .filter((c) => c.start >= left - 2 && c.end <= right + 2);
    if (visible.length === 0) return;
    setView({
      first: visible[0].i + 1,
      last: visible[visible.length - 1].i + 1,
      atStart: left <= 2,
      atEnd: right >= track.scrollWidth - 2,
    });
  }, []);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    track.addEventListener("scroll", onScroll, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(track);
    return () => {
      cancelAnimationFrame(frame);
      track.removeEventListener("scroll", onScroll);
      resize.disconnect();
    };
  }, [measure]);

  const step = (direction: 1 | -1) => {
    const track = trackRef.current;
    if (!track) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    track.scrollBy({ left: direction * track.clientWidth, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <section
      id="reviews"
      className="section screen wrap"
      tabIndex={-1}
      aria-labelledby="reviews-title"
    >
      <div className="sec-head">
        <div className="stack">
          <span className="eyebrow">Reviews</span>
          <h2 id="reviews-title" className="serif h2-sm">
            {GOOGLE_RATING.toFixed(1)} out of 5, across {GOOGLE_REVIEW_COUNT} Google reviews.
          </h2>
        </div>
        <div className="reviews-links">
          <a
            className="underlink"
            href={COMPANY.googleReviewsUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-track="portal_google_reviews_click"
          >
            Read them on Google <span aria-hidden>→</span>
          </a>
          {/* Up here, beside the source link, rather than under the track:
              the chat launcher owns the bottom-right corner of every screen. */}
          <div className="reviews-steps">
            <button
              type="button"
              className="step-btn"
              onClick={() => step(-1)}
              disabled={view.atStart}
              aria-label="Previous reviews"
              data-track="portal_reviews_prev"
            >
              <span aria-hidden>←</span>
            </button>
            <button
              type="button"
              className="step-btn"
              onClick={() => step(1)}
              disabled={view.atEnd}
              aria-label="Next reviews"
              data-track="portal_reviews_next"
            >
              <span aria-hidden>→</span>
            </button>
          </div>
        </div>
      </div>

      <ul
        ref={trackRef}
        className="reviews-track"
        // Focusable so a keyboard user can scroll it with the arrow keys, and
        // named so a screen reader says what it is.
        tabIndex={0}
        aria-label="Google reviews. Scroll sideways, or use the previous and next buttons, for more."
      >
        {ordered.map((review) => (
          <li key={review.author}>
            <ReviewCard review={review} />
          </li>
        ))}
      </ul>

      <div className="reviews-bar">
        <p className="reviews-count" aria-live="polite">
          Showing {view.first}
          {view.last !== view.first ? `–${view.last}` : ""} of {ordered.length}, copied word for
          word from the listing. All {GOOGLE_REVIEW_COUNT} are on Google.
        </p>
      </div>
    </section>
  );
}

function ReviewCard({ review }: { review: GoogleReview }) {
  return (
    <figure className="review">
      <span className="stars" role="img" aria-label={`${review.rating} out of 5 stars`}>
        {"★".repeat(review.rating)}
      </span>
      <blockquote className="review-quote">
        {review.text}
        {review.truncated && "…"}
      </blockquote>
      {/* Google's own snippet ended in "… More": say so, and link to the rest,
          rather than pretend we have the whole review. */}
      {review.truncated && (
        <a
          className="plainlink review-full"
          href={COMPANY.googleReviewsUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-track="portal_google_reviews_click"
        >
          Read the full review on Google
        </a>
      )}
      <figcaption className="review-caption">
        <b>{review.author}</b> · Google review, {review.when}
      </figcaption>
    </figure>
  );
}
