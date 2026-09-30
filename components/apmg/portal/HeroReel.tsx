"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * The hero's background: the Commercial Painters homepage reel
 * (Desktop/Commercial Painters, components/media/hero-reel.tsx), filling the
 * whole charcoal section behind the copy since 2026-09-30, at Kane's request.
 * It replaced the static fleet photograph, first as a framed panel on the
 * right, then as the full background.
 *
 * THE WASH. `.hero-scrim` sits between the footage and the copy: near-solid
 * charcoal behind the copy column, easing off to the right (a flat 90% where
 * the hero is one column). It is what keeps the text readable over the reel's
 * brightest frame, a hazy white sky; see portal-world.css for the numbers.
 *
 * NO POSTER. Kane asked for the still placeholder frame to go (2026-09-30), so
 * the background is the video from the first paint: it is server-rendered and starts
 * downloading as the page parses, and it fades in from the charcoal panel on
 * its first decoded frame rather than popping in.
 *
 * WHEN IT DOES NOT PLAY
 *  - `prefers-reduced-motion: reduce`: twenty-nine seconds of hard cuts is
 *    exactly what that setting refuses.
 *  - `navigator.connection.saveData`: an explicit ask not to be charged for
 *    decoration.
 *  - Autoplay refused: nothing is retried and no play button is forced.
 * In all three the video stays paused on its own first frame, fetched with
 * `preload="metadata"` only, so the panel is never an empty box.
 *
 * ONE ENCODE. Only the 720p file ships here (2.5 MB). Behind a charcoal wash,
 * full width, the 1080p encode would double what every desktop visitor pulls
 * through the free-tier CDN for detail the wash hides anyway.
 *
 * WHILE IT PLAYS. An IntersectionObserver pauses it the moment the hero leaves
 * the screen, which on the portal is the snap to the services section, and
 * resumes it on the way back. WCAG 2.2.2 requires a way to stop motion that
 * runs past five seconds, so the pause toggle is a requirement, and a
 * visitor's pause is never overridden by the observer.
 */

const VIDEO_SRC = "/video/hero-720.mp4";

/** A media query as an external store. `null` on the server and on the
 *  hydrating render, where there is no honest answer yet. */
function useMediaQuery(query: string): boolean | null {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener("change", onChange);
      return () => list.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => null,
  );
}

/** Not in the DOM lib, and absent on Safari and Firefox. */
function prefersLessData(): boolean {
  if (typeof navigator === "undefined") return false;
  const { connection } = navigator as Navigator & { connection?: { saveData?: boolean } };
  return Boolean(connection?.saveData);
}

export function HeroReel() {
  const rootRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** Set when the visitor uses the toggle, never cleared by the observer. */
  const pausedByUser = useRef(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);

  const reduced = useMediaQuery("(prefers-reduced-motion: reduce)");
  /** Motion allowed. `null` until hydration can answer; treated as "not yet". */
  const animate = reduced === false && !prefersLessData();

  useEffect(() => {
    const video = videoRef.current;
    const root = rootRef.current;
    if (!video || !root) return;

    // A first frame that decoded before hydration fired no React event.
    if (video.readyState >= 2) setReady(true);
    if (!animate) return;

    const onPlaying = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (!entry.isIntersecting) video.pause();
        // A refusal is a valid outcome, not an error: the first frame shows.
        else if (!pausedByUser.current) void video.play().catch(() => undefined);
      },
      { threshold: 0 },
    );
    observer.observe(root);

    return () => {
      observer.disconnect();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
    };
  }, [animate]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      pausedByUser.current = false;
      void video.play().catch(() => undefined);
    } else {
      pausedByUser.current = true;
      video.pause();
    }
  }, []);

  return (
    <div ref={rootRef} className="hero-reel">
      <video
        ref={videoRef}
        // Decorative footage: the headline and copy beside it carry the page.
        aria-hidden="true"
        muted
        loop
        playsInline
        // The whole file only when it is going to play; otherwise just enough
        // to paint the first frame.
        preload={animate ? "auto" : "metadata"}
        disablePictureInPicture
        onLoadedData={() => setReady(true)}
        className={`reel-video${ready ? " is-ready" : ""}`}
      >
        <source src={VIDEO_SRC} type="video/mp4" />
      </video>

      <div aria-hidden="true" className="hero-scrim" />

      {/* Only while it can move: a stop button over a still frame is a control
          that lies about what the page is doing. */}
      {animate && ready && (
        <button
          type="button"
          className="reel-toggle"
          onClick={toggle}
          aria-pressed={!playing}
          data-track="portal_reel_toggle"
        >
          <span className="sr-only">{playing ? "Pause the video" : "Play the video"}</span>
          {playing ? (
            <svg aria-hidden="true" viewBox="0 0 12 14" width="12" height="14" fill="currentColor">
              <rect x="0" y="0" width="4" height="14" />
              <rect x="8" y="0" width="4" height="14" />
            </svg>
          ) : (
            <svg aria-hidden="true" viewBox="0 0 12 14" width="12" height="14" fill="currentColor">
              <path d="M0 0l12 7-12 7z" />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
