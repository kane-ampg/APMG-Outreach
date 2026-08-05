"use client";

import { useSyncExternalStore } from "react";
import { isHiddenEvent } from "@/lib/data/leadActivity";
import { adminHeaders } from "@/lib/portal/adminKey";

/**
 * Lead-activity notifications — the source behind the Telemetry nav badge and
 * the per-row "new activity" dots on the Telemetry tab.
 *
 * This is deliberately NOT lib/telemetry.ts's ping counter: that counts the
 * operator's own dashboard clicks (every data-track click, including opening
 * the very dropdowns this badge decorates). Notifications here mean CUSTOMER
 * events only — the same allowlisted per-lead stream the Telemetry tab renders
 * (GET /api/portal/lead-activity), diffed against a per-lead acknowledgement
 * watermark kept in localStorage:
 *
 *   unseen(lead) = events newer than the last lastSeen the operator
 *                  acknowledged by expanding that lead's row
 *
 * The store polls while anything subscribes (the sidebar always does), pauses
 * when the tab is hidden, and refreshes on focus. The Telemetry page feeds its
 * own fetches in via ingest() so the dots never lag the rows it shows. First
 * run (no watermark file yet) baselines silently — pre-existing history isn't
 * "new", only activity from then on notifies. Live mode only: demo data is a
 * client constant, nothing there is ever "new". 401 (key not entered yet) and
 * network errors keep the last known state — never fabricate zeros.
 */

const ACK_STORAGE_KEY = "apmg-lead-activity-ack";
const POLL_MS = 15000;

/** Minimal structural slice of LeadActivity the store needs. */
export interface LeadActivityFeedItem {
  leadId: string;
  lastSeen: string;
  events: { event: string; ts: string }[];
}

const EMPTY_MAP: ReadonlyMap<string, number> = new Map();

let acks: Record<string, string> = {};
/** True once a watermark map exists (loaded or seeded) — first ever run
 *  baselines instead of flagging all history as new. */
let seeded = false;
let ackLoaded = false;
let latest: LeadActivityFeedItem[] = [];
let snapshot: { total: number; byLead: ReadonlyMap<string, number> } = {
  total: 0,
  byLead: EMPTY_MAP,
};
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let windowHooked = false;

/** Tolerant epoch-ms parse — 0 for garbage so comparisons never throw. */
function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

function loadAcks() {
  if (ackLoaded || typeof window === "undefined") return;
  ackLoaded = true;
  try {
    const raw = localStorage.getItem(ACK_STORAGE_KEY);
    if (raw !== null) {
      seeded = true;
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof v === "string") acks[k] = v;
        }
      }
    }
  } catch {
    /* corrupt / unavailable storage — treat as first run */
  }
}

function persistAcks() {
  try {
    localStorage.setItem(ACK_STORAGE_KEY, JSON.stringify(acks));
  } catch {
    /* storage full or disabled — in-memory watermarks still work this session */
  }
}

function emit() {
  for (const l of listeners) l();
}

/** Rebuild the unseen snapshot; swap (and notify) only on real change so
 *  useSyncExternalStore's Object.is check stays quiet. */
function recompute() {
  const byLead = new Map<string, number>();
  let total = 0;
  for (const lead of latest) {
    const watermark = ms(acks[lead.leadId]);
    let n = 0;
    for (const ev of lead.events) {
      if (!isHiddenEvent(ev.event) && ms(ev.ts) > watermark) n += 1;
    }
    if (n > 0) {
      byLead.set(lead.leadId, n);
      total += n;
    }
  }
  if (total === snapshot.total && byLead.size === snapshot.byLead.size) {
    let same = true;
    for (const [k, v] of byLead) {
      if (snapshot.byLead.get(k) !== v) {
        same = false;
        break;
      }
    }
    if (same) return;
  }
  snapshot = { total, byLead };
  emit();
}

/** First ever run: acknowledge everything currently known so long-standing
 *  history doesn't light the badge — only activity from now on notifies. */
function seedBaseline() {
  seeded = true;
  for (const lead of latest) acks[lead.leadId] = lead.lastSeen;
  persistAcks();
  recompute();
}

function applyLatest(leads: LeadActivityFeedItem[]) {
  latest = leads;
  if (!seeded) seedBaseline();
  else recompute();
}

/** Defensive re-validation of one payload lead (same spirit as the page's). */
function toFeedItem(v: unknown): LeadActivityFeedItem | null {
  const o = (v ?? {}) as Partial<LeadActivityFeedItem>;
  if (typeof o.leadId !== "string" || !o.leadId) return null;
  const events = (Array.isArray(o.events) ? o.events : []).filter(
    (e): e is { event: string; ts: string } => {
      const ev = (e ?? {}) as { event?: unknown; ts?: unknown };
      return typeof ev.event === "string" && typeof ev.ts === "string";
    },
  );
  return {
    leadId: o.leadId,
    lastSeen:
      typeof o.lastSeen === "string" && o.lastSeen
        ? o.lastSeen
        : events[events.length - 1]?.ts ?? "",
    events,
  };
}

async function poll() {
  if (inflight || typeof window === "undefined") return;
  if (document.visibilityState === "hidden") return;
  inflight = true;
  try {
    const res = await fetch("/api/portal/lead-activity", {
      cache: "no-store",
      headers: adminHeaders(),
    });
    // 401 (key not entered yet) / 5xx: keep the last known state.
    if (!res.ok) return;
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      mode?: string;
      leads?: unknown;
    } | null;
    if (!data?.ok || data.mode !== "live" || !Array.isArray(data.leads)) return;
    loadAcks();
    applyLatest(data.leads.map(toFeedItem).filter((l): l is LeadActivityFeedItem => l !== null));
  } catch {
    /* network hiccup — the next tick retries */
  } finally {
    inflight = false;
  }
}

function onWindowActive() {
  void poll();
}

function startPolling() {
  if (pollTimer || typeof window === "undefined") return;
  pollTimer = setInterval(() => void poll(), POLL_MS);
  if (!windowHooked) {
    windowHooked = true;
    window.addEventListener("focus", onWindowActive);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") onWindowActive();
    });
  }
  void poll();
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function subscribe(cb: () => void) {
  loadAcks();
  listeners.add(cb);
  startPolling();
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0) stopPolling();
  };
}

/* ── public surface ─────────────────────────────────────────────────────── */

/** The Telemetry page pushes its own successful LIVE fetches in so the row
 *  dots reflect exactly what the page is showing (no ≤15s poll lag). */
export function ingestLeadActivity(leads: LeadActivityFeedItem[]) {
  if (typeof window === "undefined") return;
  loadAcks();
  applyLatest(leads);
}

/** Operator acknowledged a lead (expanded its row) — advance the watermark to
 *  the newest activity we know of and let the badge/dot fall away. */
export function ackLeadActivity(leadId: string, lastSeenHint?: string) {
  if (typeof window === "undefined") return;
  loadAcks();
  const known = latest.find((l) => l.leadId === leadId)?.lastSeen;
  const candidates = [acks[leadId], known, lastSeenHint].filter(
    (s): s is string => typeof s === "string" && !!s,
  );
  const next = candidates.length
    ? candidates.reduce((a, b) => (ms(b) > ms(a) ? b : a))
    : new Date().toISOString();
  if (acks[leadId] === next) return;
  acks[leadId] = next;
  persistAcks();
  recompute();
}

/** Acknowledge EVERY known lead at once — the "clear notifications" action.
 *  Advances each watermark to that lead's newest activity so the nav badge and
 *  all row dots fall away together. No-op (and no re-render) when nothing is
 *  actually unseen. */
export function ackAllLeadActivity() {
  if (typeof window === "undefined") return;
  loadAcks();
  let changed = false;
  for (const lead of latest) {
    const known = lead.lastSeen || lead.events[lead.events.length - 1]?.ts;
    if (!known) continue;
    // Only advance forward — never rewind a watermark already ahead of lastSeen.
    if (ms(known) > ms(acks[lead.leadId])) {
      acks[lead.leadId] = known;
      changed = true;
    }
  }
  if (!changed) return;
  persistAcks();
  recompute();
}

/** A lead's activity was deleted — drop it from the feed and the watermarks. */
export function forgetLeadActivity(leadId: string) {
  if (typeof window === "undefined") return;
  loadAcks();
  latest = latest.filter((l) => l.leadId !== leadId);
  if (leadId in acks) {
    delete acks[leadId];
    persistAcks();
  }
  recompute();
}

/** Total unseen customer events across all leads — the nav badge number. */
export function useLeadActivityUnseenTotal(): number {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.total,
    () => 0,
  );
}

/** Per-lead unseen counts (only leads with unseen > 0 appear) — the row dots. */
export function useLeadActivityUnseenByLead(): ReadonlyMap<string, number> {
  return useSyncExternalStore(
    subscribe,
    () => snapshot.byLead,
    () => EMPTY_MAP,
  );
}
