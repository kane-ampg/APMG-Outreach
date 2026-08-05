"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEMO_LEAD_ACTIVITY, type LeadActivity, type LeadActivityEvent } from "@/lib/data/leadActivity";
import { isHotLead, leadScore } from "@/lib/data/leadScore";
import { adminHeaders } from "@/lib/portal/adminKey";
import { type LeadMarker, type MarkerKind, type SalesHandoffResponse } from "@/lib/sales/handoff";
import { forgetSelfHandoff, noteSelfHandoff } from "@/lib/sales/selfHandoff";

/**
 * The Hot Leads store — one shared poll behind BOTH consumers of the surface:
 * the sidebar's count badge and the Hot Leads tab itself. Keeping it in a
 * module store (rather than letting each mount fetch) means opening the tab
 * costs no extra request, and the badge can never disagree with the list.
 *
 * It joins two reads:
 *
 *   GET /api/portal/lead-activity → every attributed lead's click trail, each
 *                                   scored by lib/data/leadScore
 *   GET /api/sales/handoff        → the operator's decisions: which leads have
 *                                   been passed to Sales, and which have been
 *                                   archived off the working lists
 *
 * The store keeps EVERY scored lead, cool through hottest, and lets the page
 * decide which band to show — the tab defaults to the hot cut-off, but an
 * operator can widen it to the full spectrum. The sidebar badge stays narrow
 * on purpose: it counts what's still WAITING (hot, not yet handed off), so it
 * reads as a work queue rather than a lifetime total, no matter which band the
 * page happens to be showing.
 *
 * Hot Leads is an ADMIN staging surface: a lead is scored automatically the
 * moment its behaviour earns it, sits here for review, and leaves only when
 * the operator hands it to Sales.
 *
 * Demo mode (no Supabase, or the portal tables unmigrated) scores the same
 * Melbourne preset the Telemetry tab uses and keeps hand-offs in session
 * memory, so the whole flow stays exercisable without a database.
 *
 * Failure grammar matches TelemetryPage: a background poll that fails leaves
 * the last good data on screen ("slightly stale", never red), and 401 raises
 * the shared access-key prompt rather than a dead end.
 */

const POLL_MS = 20000;

export interface HotLeadsSnapshot {
  status: "loading" | "ready" | "error";
  mode: "live" | "demo";
  /** portal tables missing — run supabase/portal-telemetry.sql */
  needsMigration: boolean;
  /** PORTAL_ADMIN_KEY needed/wrong — the page shows the unlock form */
  unauthorized: boolean;
  error: string | null;
  /** EVERY attributed lead (cool → hottest), ranked score DESC then recency.
   *  The page filters this to a band; the badge counts only the hot ones. */
  leads: LeadActivity[];
  /** leadId → ISO stamp of the hand-off, for those already passed to Sales */
  handedOff: ReadonlyMap<string, string>;
  /** leadId → ISO stamp of the archive, for those hidden from the lists.
   *  Archived leads are NOT in `leads` — they're split out here so the tab can
   *  offer them back without carrying them through ranking and pagination. */
  archived: ReadonlyMap<string, string>;
  /** the archived leads themselves, newest activity first */
  archivedLeads: LeadActivity[];
  /** leadId → when Sales sent it back, and the rep's reason (null if none).
   *  A return CLEARS the hand-off server-side, so these leads are no longer in
   *  Sales — they're back with admin, carrying the feedback. */
  returned: ReadonlyMap<string, { at: string; note: string | null }>;
}

const EMPTY_MARKERS: ReadonlyMap<string, string> = new Map();
const EMPTY_RETURNS: ReadonlyMap<string, { at: string; note: string | null }> = new Map();

const INITIAL: HotLeadsSnapshot = {
  status: "loading",
  mode: "live",
  needsMigration: false,
  unauthorized: false,
  error: null,
  leads: [],
  handedOff: EMPTY_MARKERS,
  archived: EMPTY_MARKERS,
  archivedLeads: [],
  returned: EMPTY_RETURNS,
};

let snapshot: HotLeadsSnapshot = INITIAL;
const listeners = new Set<() => void>();
let pollTimer: ReturnType<typeof setInterval> | null = null;
let inflight = false;
let windowHooked = false;
/** Demo marks live only for the session — there's no ledger to write to. */
const demoHandoffs = new Map<string, string>();
const demoArchived = new Map<string, string>();
const demoReturned = new Map<string, { at: string; note: string | null }>();

function emit() {
  for (const l of listeners) l();
}

/** Swap the snapshot (and notify) only on a real change — the badge subscribes
 *  for the whole session, so a quiet poll must not re-render the shell. */
function set(next: HotLeadsSnapshot) {
  const same =
    snapshot.status === next.status &&
    snapshot.mode === next.mode &&
    snapshot.needsMigration === next.needsMigration &&
    snapshot.unauthorized === next.unauthorized &&
    snapshot.error === next.error &&
    snapshot.handedOff.size === next.handedOff.size &&
    snapshot.archived.size === next.archived.size &&
    snapshot.returned.size === next.returned.size &&
    snapshot.leads.length === next.leads.length &&
    signature(snapshot) === signature(next);
  if (same) return;
  snapshot = next;
  emit();
}

/** Cheap change key: what a lead did, and whether it's been handed off. */
function signature(s: HotLeadsSnapshot): string {
  const leads = s.leads
    .map((l) => `${l.leadId}:${l.lastSeen}:${leadScore(l)}:${l.events.length}`)
    .join("|");
  const handed = [...s.handedOff.keys()].sort().join(",");
  const archived = [...s.archived.keys()].sort().join(",");
  const returned = [...s.returned.keys()].sort().join(",");
  return `${leads}#${handed}#${archived}#${returned}`;
}

/* ── payload normalisers (same defensive spirit as TelemetryPage's) ───────── */

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

function toLead(v: unknown): LeadActivity | null {
  const o = (v ?? {}) as Partial<LeadActivity>;
  if (typeof o.leadId !== "string" || !o.leadId) return null;
  const events: LeadActivityEvent[] = (Array.isArray(o.events) ? o.events : [])
    .filter((e): e is LeadActivityEvent => {
      const ev = (e ?? {}) as Partial<LeadActivityEvent>;
      return typeof ev.event === "string" && typeof ev.ts === "string";
    })
    .map((e) => ({
      event: e.event,
      service: str(e.service),
      destination: str(e.destination),
      version: str(e.version),
      ts: e.ts,
    }));
  const c = (o.counts ?? {}) as Partial<LeadActivity["counts"]>;
  return {
    leadId: o.leadId,
    business: str(o.business),
    category: str(o.category),
    campaign: str(o.campaign),
    firstSeen: str(o.firstSeen) ?? events[0]?.ts ?? "",
    lastSeen: str(o.lastSeen) ?? events[events.length - 1]?.ts ?? "",
    events,
    counts: {
      emailClicks: num(c.emailClicks),
      portalViews: num(c.portalViews),
      serviceOpens: num(c.serviceOpens),
      inquiries: num(c.inquiries),
      chatPrompts: num(c.chatPrompts),
    },
  };
}

/** Hottest first; most recent activity breaks a score tie. The page re-sorts
 *  to whatever the operator picked — this is just a sane default order. */
function rankByScore(leads: LeadActivity[]): LeadActivity[] {
  return [...leads].sort(
    (a, b) =>
      leadScore(b) - leadScore(a) || (a.lastSeen < b.lastSeen ? 1 : a.lastSeen > b.lastSeen ? -1 : 0),
  );
}

function toMarkerMap(list: LeadMarker[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of Array.isArray(list) ? list : []) {
    if (m && typeof m.leadId === "string" && m.leadId) out.set(m.leadId, str(m.at) ?? "");
  }
  return out;
}

/** Returns keep their note, which is the whole point of the channel. */
function toReturnMap(list: LeadMarker[] | undefined): Map<string, { at: string; note: string | null }> {
  const out = new Map<string, { at: string; note: string | null }>();
  for (const m of Array.isArray(list) ? list : []) {
    if (m && typeof m.leadId === "string" && m.leadId) {
      out.set(m.leadId, { at: str(m.at) ?? "", note: str(m.note) });
    }
  }
  return out;
}

/** Split the scored leads into the working set and the archived set. Archived
 *  leads leave `leads` entirely, so they cost nothing to rank, count, page or
 *  render on every poll — they're only materialised for the Archived lane. */
function split(leads: LeadActivity[], archived: ReadonlyMap<string, string>) {
  if (archived.size === 0) return { leads, archivedLeads: [] as LeadActivity[] };
  const working: LeadActivity[] = [];
  const parked: LeadActivity[] = [];
  for (const l of leads) (archived.has(l.leadId) ? parked : working).push(l);
  return { leads: working, archivedLeads: parked };
}

/* ── fetching ─────────────────────────────────────────────────────────────── */

type ActivityPayload = {
  ok?: boolean;
  mode?: string;
  needsMigration?: boolean;
  leads?: unknown;
  error?: string;
};

/**
 * Pull both endpoints and rebuild the snapshot. `silent` marks background
 * polls: those never knock a populated page into an error or loading state.
 */
export async function refreshHotLeads(opts?: { silent?: boolean }): Promise<void> {
  if (typeof window === "undefined") return;
  const silent = opts?.silent === true;
  if (inflight) return;
  inflight = true;
  const populated = snapshot.status === "ready";
  // A failed poll keeps whatever rows are already on screen — realtime
  // degrades to "slightly stale", never to a blank error page.
  const fail = (patch: Partial<HotLeadsSnapshot>) => {
    if (silent && populated) return;
    set({ ...snapshot, status: "error", ...patch });
  };

  try {
    if (!silent && !populated) set({ ...INITIAL, status: "loading" });

    const [actRes, handRes] = await Promise.all([
      fetch("/api/portal/lead-activity", { cache: "no-store", headers: adminHeaders() }),
      fetch("/api/sales/handoff", { cache: "no-store", headers: adminHeaders() }),
    ]);
    const act = (await actRes.json().catch(() => null)) as ActivityPayload | null;
    const hand = (await handRes.json().catch(() => null)) as SalesHandoffResponse | null;

    // Demo (no Supabase / tables missing) → score the same preset Telemetry
    // shows, and keep hand-offs in session memory.
    if (act?.mode === "demo") {
      const archived = new Map(demoArchived);
      const parts = split(rankByScore(DEMO_LEAD_ACTIVITY), archived);
      set({
        status: "ready",
        mode: "demo",
        needsMigration: act.needsMigration === true || hand?.needsMigration === true,
        unauthorized: false,
        error: null,
        leads: parts.leads,
        handedOff: new Map(demoHandoffs),
        archived,
        archivedLeads: parts.archivedLeads,
        returned: new Map(demoReturned),
      });
      return;
    }
    if (actRes.status === 401) {
      fail({
        unauthorized: true,
        error: act?.error ?? "An access key is required to view hot leads.",
      });
      return;
    }
    if (!actRes.ok || !act?.ok) {
      fail({
        unauthorized: false,
        error: act?.error ?? `Couldn't load hot leads (${actRes.status}).`,
      });
      return;
    }

    const leads = (Array.isArray(act.leads) ? act.leads : [])
      .map(toLead)
      .filter((l): l is LeadActivity => l !== null);

    // The marker ledgers are secondary: if they're unreadable the tab still
    // lists the leads (they'd just all read as un-handed and un-archived), so a
    // failure here degrades rather than blanking the page — the last known
    // marks are kept instead of being fabricated as empty.
    const marksOk = handRes.ok && hand?.ok && hand.mode === "live";
    const handedOff = marksOk ? toMarkerMap(hand.handoffs) : snapshot.handedOff;
    const archived = marksOk ? toMarkerMap(hand.archived) : snapshot.archived;
    const returned = marksOk ? toReturnMap(hand.returned) : snapshot.returned;
    const parts = split(rankByScore(leads), archived);

    set({
      status: "ready",
      mode: "live",
      needsMigration: false,
      unauthorized: false,
      error: null,
      leads: parts.leads,
      handedOff,
      archived,
      archivedLeads: parts.archivedLeads,
      returned,
    });
  } catch {
    fail({ unauthorized: false, error: "Network error loading hot leads." });
  } finally {
    inflight = false;
  }
}

/* ── operator actions ─────────────────────────────────────────────────────── */

/** Apply a marker response (or a demo-mode local change) to the snapshot. */
function applyMarks(
  handedOff: Map<string, string>,
  archived: Map<string, string>,
  returned: Map<string, { at: string; note: string | null }>,
) {
  // Re-split from the union of what's on screen: an unarchive has to be able to
  // pull a lead back out of archivedLeads and into the working list.
  const all = [...snapshot.leads, ...snapshot.archivedLeads];
  const parts = split(rankByScore(all), archived);
  set({
    ...snapshot,
    handedOff,
    archived,
    returned,
    leads: parts.leads,
    archivedLeads: parts.archivedLeads,
  });
}

/** POST one marker kind. Resolves to null on success, else a user-facing
 *  message. Server-side this is idempotent, so a retry is always safe. */
async function mark(kind: MarkerKind, leadIds: string[]): Promise<string | null> {
  const ids = [...new Set(leadIds.filter((id) => typeof id === "string" && id))];
  if (ids.length === 0) return null;

  // Demo rows aren't real leads (their ids aren't uuids and a refetch would
  // resurrect them) — record the mark in session memory so the flow still
  // demonstrates end to end.
  if (snapshot.mode === "demo") {
    const now = new Date().toISOString();
    if (kind === "returned") {
      for (const id of ids) {
        if (!demoReturned.has(id)) demoReturned.set(id, { at: now, note: null });
        demoHandoffs.delete(id); // a return retracts the hand-off, as on the server
      }
    } else {
      const target = kind === "handoff" ? demoHandoffs : demoArchived;
      for (const id of ids) if (!target.has(id)) target.set(id, now);
    }
    applyMarks(new Map(demoHandoffs), new Map(demoArchived), new Map(demoReturned));
    return null;
  }

  try {
    const res = await fetch("/api/sales/handoff", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminHeaders() },
      body: JSON.stringify({ kind, leadIds: ids }),
    });
    const data = (await res.json().catch(() => null)) as SalesHandoffResponse | null;
    if (!res.ok || !data?.ok) return data?.error ?? `That didn't save (${res.status}).`;
    applyMarks(toMarkerMap(data.handoffs), toMarkerMap(data.archived), toReturnMap(data.returned));
    return null;
  } catch {
    return "Network error — nothing was saved.";
  }
}

/** DELETE one marker kind for one lead. */
async function unmark(kind: MarkerKind, leadId: string): Promise<string | null> {
  if (!leadId) return null;

  if (snapshot.mode === "demo") {
    if (kind === "returned") demoReturned.delete(leadId);
    else (kind === "handoff" ? demoHandoffs : demoArchived).delete(leadId);
    applyMarks(new Map(demoHandoffs), new Map(demoArchived), new Map(demoReturned));
    return null;
  }

  try {
    const res = await fetch(
      `/api/sales/handoff?kind=${kind}&leadId=${encodeURIComponent(leadId)}`,
      { method: "DELETE", headers: adminHeaders() },
    );
    const data = (await res.json().catch(() => null)) as SalesHandoffResponse | null;
    if (!res.ok || !data?.ok) return data?.error ?? `That didn't save (${res.status}).`;
    applyMarks(toMarkerMap(data.handoffs), toMarkerMap(data.archived), toReturnMap(data.returned));
    return null;
  } catch {
    return "Network error — nothing was saved.";
  }
}

/**
 * Pass hot leads to Sales — the one-way step that puts them in the rep queue.
 *
 * A lead already handed over is dropped here before the request even goes out
 * (and the server skips it again), so it can never be sent twice: the queue
 * keeps its ORIGINAL hand-off time, and a rep can't get the same lead landing
 * back at the top of their list.
 */
export async function handOffToSales(leadIds: string[]): Promise<string | null> {
  const fresh = leadIds.filter((id) => !snapshot.handedOff.has(id));
  if (fresh.length === 0) return null;
  // Re-sending something Sales bounced back is allowed — the admin has
  // presumably dealt with whatever the note said — but the return marker has to
  // go first, or the lead would show as both returned and in Sales.
  for (const id of fresh.filter((x) => snapshot.returned.has(x))) {
    const err = await unmark("returned", id);
    if (err) return err;
  }
  const err = await mark("handoff", fresh);
  // Remember these are OURS, so the Sales desk does not turn round and
  // announce our own hand-off back at us twenty seconds later.
  if (!err) noteSelfHandoff(fresh);
  return err;
}

/** Undo a hand-off — the lead returns to the Hot Leads review list AND leaves
 *  the rep's queue. Only the marker is erased; the lead and its trail stay. */
export function pullBackFromSales(leadId: string): Promise<string | null> {
  // Pulled back, so a later re-hand is a genuine new arrival again.
  forgetSelfHandoff(leadId);
  return unmark("handoff", leadId);
}

/**
 * Archive leads off the Hot Leads working lists. Nothing is deleted — the lead,
 * its click trail and any hand-off are untouched, and Sales is unaffected. It
 * just stops being carried through the tab's ranking, counts, pagination and
 * rendering on every poll, which is what keeps the tab quick once a few hundred
 * leads have been dealt with.
 */
export function archiveLeads(leadIds: string[]): Promise<string | null> {
  return mark("archived", leadIds);
}

/** Bring an archived lead back into the working lists. */
export function unarchiveLead(leadId: string): Promise<string | null> {
  return unmark("archived", leadId);
}

/** Clear a return marker — admin has read the rep's note and dealt with it, so
 *  the lead rejoins the ordinary awaiting list. */
export function clearReturn(leadId: string): Promise<string | null> {
  return unmark("returned", leadId);
}

/* ── subscription ─────────────────────────────────────────────────────────── */

function tick() {
  if (typeof document === "undefined" || document.visibilityState !== "visible") return;
  void refreshHotLeads({ silent: true });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!pollTimer && typeof window !== "undefined") {
    pollTimer = setInterval(tick, POLL_MS);
    if (!windowHooked) {
      windowHooked = true;
      window.addEventListener("focus", tick);
      document.addEventListener("visibilitychange", tick);
    }
    void refreshHotLeads();
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };
}

/** Everything the Hot Leads tab renders. */
export function useHotLeads(): HotLeadsSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => INITIAL,
  );
}

/** HOT leads still awaiting hand-off — the sidebar badge number. Deliberately
 *  the hot cut-off only, whatever band the page is displaying: it's a work
 *  queue, not a lifetime tally, and it's hidden at zero by the caller.
 *
 *  `enabled` gates the underlying subscribe/poll entirely: `GET
 *  /api/sales/handoff` (which this store's poll fetches — see
 *  `refreshHotLeads`) is admin-only (`hotleads.handoff`), so a caller without
 *  `hotleads.view` would otherwise 403 every 20s forever purely to feed a
 *  badge it can never see. Pass `can("hotleads.view")`; when false the hook
 *  never joins the shared listener set (so it can't be the one keeping the
 *  poll timer alive) and reports 0. */
export function useHotLeadsWaiting(enabled: boolean): number {
  const sub = useCallback(
    (cb: () => void) => (enabled ? subscribe(cb) : () => {}),
    [enabled],
  );
  return useSyncExternalStore(
    sub,
    () => (enabled ? waitingCount() : 0),
    () => 0,
  );
}

let waitingCache = { sig: "", n: 0 };

/** Derived from the live snapshot, memoised on its signature so
 *  useSyncExternalStore's Object.is check stays quiet between polls. */
function waitingCount(): number {
  const sig = signature(snapshot);
  if (sig !== waitingCache.sig) {
    waitingCache = {
      sig,
      n: snapshot.leads.reduce(
        (n, l) =>
          n +
          (isHotLead(l) && !snapshot.handedOff.has(l.leadId) && !snapshot.returned.has(l.leadId)
            ? 1
            : 0),
        0,
      ),
    };
  }
  return waitingCache.n;
}
