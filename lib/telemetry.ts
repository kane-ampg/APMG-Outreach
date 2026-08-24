"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * Click telemetry for the APMG lead-gen dashboard.
 *
 * Design goals:
 *  - Zero-config: every click is captured to an in-memory ring buffer +
 *    localStorage regardless of the sink, so the in-app inspector shows
 *    telemetry working even when the backend is unreachable.
 *  - On by default: batches go to /api/portal/events via navigator.sendBeacon
 *    (falls back to fetch keepalive). NEXT_PUBLIC_TELEMETRY_ENDPOINT overrides
 *    the target; it is no longer required to turn telemetry ON (see ENDPOINT).
 *  - Fails loudly: a batch that reaches neither transport warns once, so a
 *    broken sink can never look like "no traffic" again.
 *  - Declarative: any element with a `data-track` attribute is tracked by a
 *    single delegated listener — no per-element onClick wiring required.
 *    `data-track-*` attributes ride along as event properties.
 */

export interface TelemetryEvent {
  id: string;
  name: string;
  /** epoch ms */
  ts: number;
  props: Record<string, string>;
  /** active dashboard view at click time */
  view?: string;
  /** short label of the clicked element, for the inspector */
  target?: string;
}

/**
 * Where batches are shipped. DEFAULTS to the in-app sink rather than staying
 * unset, because an unset value used to disable telemetry *silently*: with no
 * endpoint, ensureFlushTimer() returned early and neither the interval nor the
 * pagehide/visibilitychange listeners were ever registered, so every event died
 * in the ring buffer with no error. That is invisible in the in-app inspector
 * (which reads the ring buffer, not the sink) and it cost us real data — social
 * visitors reach /portal directly, never touching the server-side /t/[id]
 * writer, so a dead beacon means a Facebook/TikTok click leaves no trace at all
 * while outreach clicks keep recording normally.
 *
 * `NEXT_PUBLIC_` vars are baked at BUILD time, so the old behaviour meant one
 * unset var on a Vercel project silently zeroed client telemetry for that whole
 * deployment. Defaulting removes the failure mode: the path is same-origin and
 * relative, so it is correct on every host the app is served from.
 */
const ENDPOINT = process.env.NEXT_PUBLIC_TELEMETRY_ENDPOINT || "/api/portal/events";
const STORAGE_KEY = "apmg-telemetry-log";
const MAX_EVENTS = 100; // ring buffer cap for the local log
/** Server-side cap per POST (MAX_EVENTS_PER_POST in /api/portal/events).
 *  Flushing more than this would have the tail silently discarded by the
 *  sink — e.g. after an outage the retry queue can hold up to MAX_EVENTS —
 *  so flush() ships at most one chunk of this size and leaves the rest
 *  queued for the next interval tick. */
const MAX_BATCH = 50;
const FLUSH_INTERVAL = 4000;

/** Stable reference for the SSR/initial-hydration snapshot so
 *  useSyncExternalStore's Object.is check doesn't loop (React warning). */
const EMPTY_EVENTS: readonly TelemetryEvent[] = [];

let events: TelemetryEvent[] = [];
let queue: TelemetryEvent[] = [];
/** monotonic lifetime click count — the sidebar/header "pings" readout */
let total = 0;
const listeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setInterval> | null = null;
let hydrated = false;

function emit() {
  for (const l of listeners) l();
}

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      events = Array.isArray(parsed.events) ? parsed.events.slice(-MAX_EVENTS) : [];
      total = typeof parsed.total === "number" ? parsed.total : events.length;
    }
  } catch {
    /* corrupt / unavailable storage — start clean */
  }
}

function persist() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ events: events.slice(-MAX_EVENTS), total }),
    );
  } catch {
    /* storage full or disabled — non-fatal, in-memory log still works */
  }
}

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const VISITOR_KEY = "apmg-visitor-id";

/**
 * Anonymous, persistent visitor id so the portal funnel can count unique
 * visitors across sessions (portal_events.visitor_id). Minted lazily on the
 * client with the same uid() the events use and parked in localStorage.
 * Returns "" during SSR or when storage is unavailable so callers can simply
 * omit it — identification is best-effort, never a hard dependency.
 */
export function getVisitorId(): string {
  if (typeof window === "undefined") return "";
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = uid();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    /* storage disabled — the visitor just stays anonymous */
    return "";
  }
}

/** Record a telemetry event. Safe to call from anywhere on the client. */
export function track(
  name: string,
  props: Record<string, string | number | boolean | undefined> = {},
  meta: { view?: string; target?: string } = {},
) {
  if (typeof window === "undefined") return;
  hydrate();

  const normalized: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v !== undefined && v !== "") normalized[k] = String(v);
  }

  const event: TelemetryEvent = {
    id: uid(),
    name,
    ts: Date.now(),
    props: normalized,
    view: meta.view,
    target: meta.target,
  };

  events = [...events, event].slice(-MAX_EVENTS);
  total += 1;
  queue.push(event);
  persist();
  emit();

  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.debug("[telemetry]", name, normalized);
  }

  ensureFlushTimer();
}

function ensureFlushTimer() {
  if (flushTimer || !ENDPOINT || typeof window === "undefined") return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL);
  window.addEventListener("pagehide", flush);
  window.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/** Re-queue a failed batch, bounded so a persistently-down endpoint can't
 *  grow the queue (and the re-POSTed body) without limit. */
function requeue(batch: TelemetryEvent[]) {
  queue.unshift(...batch);
  if (queue.length > MAX_EVENTS) queue = queue.slice(-MAX_EVENTS);
}

let warnedSinkUnreachable = false;

/**
 * Warn ONCE per page that events are not reaching the sink. This exists because
 * the old silent-failure mode was expensive to diagnose: the funnel simply read
 * as "no visitors" and there was nothing anywhere to contradict it.
 *
 * LIMIT, deliberately stated: this catches TRANSPORT failures only (both
 * sendBeacon and the fetch fallback refusing the batch). sendBeacon returns
 * true once the batch is merely queued by the browser and cannot read the
 * response, so a sink answering 404/500 still looks like success here. Confirm
 * delivery in DevTools → Network, or against portal_events.
 */
function warnSinkUnreachable(endpoint: string) {
  if (warnedSinkUnreachable) return;
  warnedSinkUnreachable = true;
  // eslint-disable-next-line no-console
  console.warn(
    `[telemetry] events are not reaching ${endpoint} — nothing is being recorded. ` +
      "Check the route is deployed and reachable from this host.",
  );
}

/** Ship queued events to ENDPOINT (always set — see its declaration; the
 *  falsy guard below is defensive only).
 *  Sends at most MAX_BATCH events per call — the sink truncates anything
 *  beyond its per-POST cap without telling us (sendBeacon can't read
 *  responses), so oversized queues drain across successive flush ticks
 *  instead of silently losing their tail. */
export function flush() {
  if (!ENDPOINT || queue.length === 0) return;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  const body = JSON.stringify({
    source: "apmg-leadgen",
    visitorId: getVisitorId() || undefined,
    events: batch,
  });
  try {
    const ok =
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
    if (!ok) {
      void fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      }).catch(() => {
        /* requeue on failure so we retry on the next flush */
        requeue(batch);
        warnSinkUnreachable(ENDPOINT);
      });
    }
  } catch {
    requeue(batch);
    warnSinkUnreachable(ENDPOINT);
  }
}

export function getEvents(): TelemetryEvent[] {
  hydrate();
  return events;
}

export function clearEvents() {
  events = [];
  queue = [];
  persist();
  emit();
}

export function getTotal() {
  hydrate();
  return total;
}

function subscribe(cb: () => void) {
  hydrate();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Reactive read of the event log for the inspector UI. */
export function useTelemetryLog(): TelemetryEvent[] {
  return useSyncExternalStore(
    subscribe,
    () => events,
    () => EMPTY_EVENTS as TelemetryEvent[],
  );
}

/** Reactive read of the lifetime ping count for the signal ticker. */
export function useTelemetryCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => total,
    () => 0,
  );
}

export function isEndpointConfigured() {
  return Boolean(ENDPOINT);
}

function describeTarget(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim().slice(0, 48);
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 48);
  return el.tagName.toLowerCase();
}

/**
 * Mount once at the shell. Attaches a single delegated click listener that
 * tracks any element carrying `data-track`, lifting its `data-track-*`
 * attributes into the event props. Keyboard activation of buttons/links emits
 * a synthetic click, so this also covers Enter/Space without extra wiring.
 */
export function useClickTelemetry(view: string) {
  useEffect(() => {
    function onClick(e: MouseEvent) {
      const start = e.target as HTMLElement | null;
      const el = start?.closest<HTMLElement>("[data-track]");
      if (!el) return;

      const name = el.dataset.track || "click";
      const props: Record<string, string> = {};
      for (const [k, v] of Object.entries(el.dataset)) {
        if (k === "track" || v === undefined) continue;
        if (k.startsWith("track")) {
          // data-track-foo-bar -> foo_bar
          const key = k
            .slice("track".length)
            .replace(/^[A-Z]/, (c) => c.toLowerCase())
            .replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
          props[key] = v;
        }
      }
      track(name, props, { view, target: describeTarget(el) });
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [view]);
}
