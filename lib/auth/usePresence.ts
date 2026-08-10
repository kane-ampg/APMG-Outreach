"use client";

import { useEffect, useRef, useState } from "react";

import { PRESENCE_BEAT_MS } from "./signIn";

/**
 * Presence, from the browser's side.
 *
 * `usePresenceHeartbeat` is what makes a row green in Settings, and its rules
 * are chosen so that green can only ever mean "this person has the console
 * open right now":
 *
 *   - it beats ONLY while the tab is visible. Minimise the window, switch to
 *     another tab, or close the laptop lid, and the beats stop — the row then
 *     expires to grey on its own, with no sign-out required.
 *   - it beats once immediately on becoming visible, so somebody coming back
 *     lights up straight away rather than up to a beat later.
 *   - it stops permanently when the server says beating cannot work here (no
 *     database, or the migration hasn't been run). Retrying forever against a
 *     column that does not exist is just noise in the log.
 *
 * `useServerClock` is the other half. The stamps are written with the server's
 * clock, so the browser must not judge freshness with its own: it measures its
 * offset from a server timestamp and reports a corrected `now`. A laptop whose
 * clock is ten minutes slow would otherwise hold every row green indefinitely.
 */

/** How often the clock hook re-renders so a stale row can decay on its own. */
const CLOCK_TICK_MS = 10_000;

export function usePresenceHeartbeat(enabled = true): void {
  // A ref, not state: flipping this must stop the loop without re-rendering
  // the entire console shell.
  const stopped = useRef(false);

  useEffect(() => {
    if (!enabled) return;
    stopped.current = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    // Survives the effect: an in-flight beat that resolves after unmount must
    // not schedule anything or touch state.
    let cancelled = false;

    async function beat() {
      if (cancelled || stopped.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/auth/heartbeat", {
          method: "POST",
          cache: "no-store",
          // No body at all. The server takes the identity from the session
          // cookie, and sending an address would only invite the idea that it
          // could be honoured.
        });
        if (!res.ok) return;
        const body = (await res.json().catch(() => ({}))) as { stop?: boolean };
        if (body.stop) stopped.current = true;
      } catch {
        // Offline, a sleeping laptop, a redeploy mid-flight. Staying quiet is
        // the point: the row simply decays to its last-seen state, which is
        // the honest outcome — we genuinely do not know they are still there.
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") void beat();
    }

    void beat();
    timer = setInterval(() => void beat(), PRESENCE_BEAT_MS);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);
}

/**
 * A `now` in the SERVER's frame of reference, ticking so that presence decays
 * on screen without waiting for the next fetch.
 *
 * Pass the `serverNow` from the most recent API response. The offset is
 * recomputed on every one, so a browser clock that is wrong — or drifts, or
 * jumps when the machine wakes — cannot keep a row lit after the person has
 * gone.
 */
export function useServerClock(serverNow: string | null): number {
  const [tick, setTick] = useState(() => Date.now());
  const [skew, setSkew] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const parsed = serverNow ? Date.parse(serverNow) : NaN;
    if (Number.isNaN(parsed)) return;
    // Measured just after the response arrived, so network latency makes this
    // read a fraction of a second ahead of the server — against a presence
    // window measured in tens of seconds, that is noise.
    setSkew(Date.now() - parsed);
  }, [serverNow]);

  return tick - skew;
}
